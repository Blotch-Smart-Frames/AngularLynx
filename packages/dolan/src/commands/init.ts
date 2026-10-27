import * as p from '@clack/prompts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import pc from 'picocolors';
import { configExists, writeConfig } from '../config.js';
import {
  getOrCreateLockfile,
  hashContent,
  writeLockfile,
} from '../lockfile.js';
import { getUiSourceDir } from '../utils/resolve-paths.js';
import { themeFilesFor, usesTailwind4 } from '../utils/tailwind.js';
import { formatContent } from '../utils/format.js';
import { printBanner } from '../utils/banner.js';
import { isInteractive } from '../utils/interactive.js';
import {
  copiesTests,
  detectPackageManager,
  installCommand,
  installPackages,
  missingPackages,
} from '../utils/packages.js';

/**
 * The global stylesheet the theme gets imported into: the first `styles`
 * entry of the first project in angular.json, as `ng new` writes it, or
 * `src/styles.css`.
 */
export const globalStylesheet = (cwd: string): string => {
  const fallback = 'src/styles.css';
  try {
    const workspace = JSON.parse(
      readFileSync(join(cwd, 'angular.json'), 'utf-8'),
    ) as {
      projects?: Record<
        string,
        {
          architect?: {
            build?: { options?: { styles?: (string | { input: string })[] } };
          };
        }
      >;
    };
    const project = Object.values(workspace.projects ?? {})[0];
    const style = project?.architect?.build?.options?.styles?.[0];
    if (!style) return fallback;
    return typeof style === 'string' ? style : style.input;
  } catch {
    return fallback;
  }
};

/**
 * The path a CSS `@import` in `from` uses to reach `to` (both relative to
 * the project root): `./styles/default.css` from `src/styles.css`.
 */
export const cssImportPath = (from: string, to: string): string => {
  const path = relative(dirname(from), to).split(sep).join('/');
  return path.startsWith('.') ? path : `./${path}`;
};

export type InitOptions = {
  /** Overwrite an existing config and theme files without asking. */
  force?: boolean;
  /** Ask nothing, and take each question's default. */
  yes?: boolean;
  /** The components folder, instead of asking for it. */
  components?: string;
  /** The theme folder, instead of asking for it. */
  theme?: string;
};

/**
 * Sets up a project for dolan: writes `dolan.config.json`, copies the theme
 * files and records their hashes in `dolan.lock.json`, makes `@blotch/dolan`
 * a dependency, and prints what's left to wire up by hand.
 *
 * `force` overwrites an existing config and theme files without asking.
 * Without it, init asks first, as `add` does for components: theme files are
 * the app's to edit, and init used to replace them silently.
 *
 * `components` and `theme` answer the folder questions. With `yes`, or when
 * stdin isn't a terminal, init asks nothing and takes each default: the
 * default folders, and existing theme files kept. An existing config stops it
 * with exit code 1 instead: the default answer there cancels the run, and a
 * script that exited 0 would never learn that nothing was set up.
 */
export const initCommand = async (options: InitOptions = {}) => {
  const cwd = process.cwd();
  const interactive = !options.yes && isInteractive();

  printBanner();
  p.intro(pc.bold('dolan init'));

  if (configExists(cwd) && !options.force) {
    if (!interactive) {
      p.log.error(
        `${pc.cyan('dolan.config.json')} already exists. Run ${pc.bold('dolan init --force')} to overwrite it.`,
      );
      process.exit(1);
    }

    const overwrite = await p.confirm({
      message: 'dolan.config.json already exists. Overwrite?',
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Init canceled.');
      process.exit(0);
    }
  }

  /**
   * A folder from its flag, else the answer to its question, else its default.
   */
  const folder = async (
    flag: string | undefined,
    message: string,
    defaultValue: string,
  ): Promise<string> => {
    if (flag !== undefined) return flag;
    if (!interactive) return defaultValue;
    const answer = await p.text({
      message,
      placeholder: defaultValue,
      defaultValue,
    });
    if (p.isCancel(answer)) {
      p.cancel('Init canceled.');
      process.exit(0);
    }
    return answer;
  };

  const config = {
    components: await folder(
      options.components,
      'Where should components be installed?',
      'src/components/ui',
    ),
    theme: await folder(
      options.theme,
      'Where should theme files be installed?',
      'src/styles',
    ),
  };

  const s = p.spinner();
  s.start('Setting up dolan...');

  writeConfig(cwd, {
    aliases: {
      components: config.components,
      theme: config.theme,
    },
  });

  // Theme files are physically copied from the bundled @blotch/ui package
  // into the user's project rather than imported as package exports.
  // This makes them user-owned source files that can be customized freely
  // and that `dolan update` can track with the three-way merge algorithm —
  // just like component files.
  const uiSrc = getUiSourceDir();

  const themeDir = resolve(cwd, config.theme);
  mkdirSync(themeDir, { recursive: true });

  /**
   * Write theme files through formatContent so they match EXACTLY what
   * `dolan update` recomputes for them. `update` normalizes upstream content to
   * the consumer's oxfmt config; if init copied verbatim instead, the one JS/TS
   * theme file (`tailwind-plugin.ts`) would land unformatted here but come back
   * formatted from the next update in an oxfmt project — surfacing a spurious
   * "conflict" on a file the user never touched. `.css` files pass through
   * formatContent unchanged, and non-oxfmt projects get verbatim content, so
   * this is a no-op copy everywhere except the case it fixes.
   */
  const themeFiles = themeFilesFor(cwd, { tests: copiesTests(cwd) }).flatMap(
    (file) => {
      const src = join(uiSrc, 'theme', file);
      if (!existsSync(src)) return [];
      const destPath = join(themeDir, file);
      const content = formatContent(readFileSync(src, 'utf-8'), destPath);
      const current = existsSync(destPath)
        ? readFileSync(destPath, 'utf-8')
        : null;
      return [{ file, destPath, content, current }];
    },
  );

  // A file that already matches needs no write and no question.
  const changed = themeFiles.filter(
    ({ content, current }) => current !== null && current !== content,
  );
  let overwrite = options.force === true;
  if (changed.length > 0 && !overwrite) {
    s.stop('Config written.');
    // Default to "no", like `add`: these may hold the app's own colors. That
    // default is also the answer when nobody can be asked.
    if (interactive) {
      const answer = await p.confirm({
        message: `${changed.map(({ file }) => pc.yellow(file)).join(', ')} already exist in ${pc.dim(config.theme)} and differ. Overwrite?`,
        initialValue: false,
      });
      overwrite = !p.isCancel(answer) && answer === true;
    }
    if (!overwrite) {
      // Says why, since a run without the question never mentioned it.
      p.log.info(
        `Kept your ${changed.map(({ file }) => pc.cyan(file)).join(', ')}: the bundled theme differs. Run ${pc.bold('dolan init --force')} to replace yours.`,
      );
    }
    s.start('Copying theme files...');
  }

  // Record each theme file init leaves as upstream's, as `add` does for
  // components, so `update` has a base to merge against. Without one, it
  // called any theme file that differed from the next release a conflict,
  // though nobody had touched it. A kept file keeps whatever base the
  // lockfile already has: it isn't upstream's.
  const lockfile = getOrCreateLockfile(cwd);
  for (const { file, destPath, content, current } of themeFiles) {
    if (current !== null && current !== content && !overwrite) continue;
    if (current !== content) writeFileSync(destPath, content);
    lockfile.theme[file] = { hash: hashContent(content) };
  }
  writeLockfile(cwd, lockfile);

  s.stop('Setup complete!');

  const componentsDir = resolve(cwd, config.components);
  mkdirSync(componentsDir, { recursive: true });

  // The components import dolan's utilities (`@blotch/dolan/utils/cn`), so
  // the app depends on it, which also makes `npx dolan` run this CLI: without
  // a local install, npx finds an unrelated `dolan` package.
  const { version } = createRequire(import.meta.url)('../../package.json') as {
    version: string;
  };
  const dolanSpec = `@blotch/dolan@^${version}`;
  let dolanInstalled = missingPackages(cwd, [dolanSpec]).length === 0;
  if (!dolanInstalled) {
    p.log.step(`Installing ${pc.cyan(dolanSpec)}`);
    dolanInstalled = installPackages(cwd, [dolanSpec]);
  }

  const stylesheet = globalStylesheet(cwd);
  // Each step: its sentence, then the lines to copy.
  const steps: [string, ...string[]][] = [
    ...(dolanInstalled
      ? []
      : [
          [
            `Add ${pc.cyan('@blotch/dolan')} to your dependencies. The components import its utilities, such as ${pc.cyan('@blotch/dolan/utils/cn')}:`,
            installCommand(detectPackageManager(cwd), [dolanSpec]).join(' '),
          ] as [string, string],
        ]),
    // Tailwind 4 takes the theme in the stylesheet, Tailwind 3 in its config.
    ...(usesTailwind4(cwd)
      ? [
          [
            `Import the theme in ${pc.cyan(stylesheet)}, after Tailwind. ${pc.cyan('dark.css')} holds the dark mode colors, under ${pc.cyan('page.dark')}, and ${pc.cyan('tailwind.css')} gives them their utilities:`,
            ...['default.css', 'dark.css', 'tailwind.css'].map(
              (file) =>
                `@import '${cssImportPath(stylesheet, join(config.theme, file))}';`,
            ),
          ] as [string, ...string[]],
        ]
      : [
          [
            `Add the Tailwind plugin to your ${pc.cyan('tailwind.config.ts')}:`,
            `import { blotchPlugin } from './${config.theme}/tailwind-plugin';`,
            'plugins: [blotchPlugin]',
          ] as [string, ...string[]],
          [
            `Import the theme in ${pc.cyan(stylesheet)}. ${pc.cyan('dark.css')} holds the dark mode colors, under ${pc.cyan('page.dark')}:`,
            `@import '${cssImportPath(stylesheet, join(config.theme, 'default.css'))}';`,
            `@import '${cssImportPath(stylesheet, join(config.theme, 'dark.css'))}';`,
          ] as [string, ...string[]],
        ]),
    [
      'Add components:',
      `npx ${dolanInstalled ? 'dolan' : '@blotch/dolan'} add button card`,
    ],
  ];
  p.note(
    steps
      .map(([sentence, ...lines], i) =>
        [
          `${pc.bold(`${i + 1}.`)} ${sentence}`,
          '',
          ...lines.map((line) => `   ${pc.dim(line)}`),
        ].join('\n'),
      )
      .join('\n\n'),
    'Next steps',
  );

  p.outro('Ready to go!');
};
