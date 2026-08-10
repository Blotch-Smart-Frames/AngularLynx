import * as p from '@clack/prompts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pc from 'picocolors';
import { configExists, writeConfig } from '../config.js';
import { getUiSourceDir } from '../utils/resolve-paths.js';
import { formatContent } from '../utils/format.js';
import { printBanner } from '../utils/banner.js';

export const initCommand = async () => {
  const cwd = process.cwd();

  printBanner();
  p.intro(pc.bold('dolan init'));

  if (configExists(cwd)) {
    const overwrite = await p.confirm({
      message: 'dolan.config.json already exists. Overwrite?',
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Init canceled.');
      process.exit(0);
    }
  }

  const config = await p.group(
    {
      components: () =>
        p.text({
          message: 'Where should components be installed?',
          placeholder: 'src/components/ui',
          defaultValue: 'src/components/ui',
        }),
      theme: () =>
        p.text({
          message: 'Where should theme files be installed?',
          placeholder: 'src/styles',
          defaultValue: 'src/styles',
        }),
    },
    {
      onCancel: () => {
        p.cancel('Init canceled.');
        process.exit(0);
      },
    },
  );

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
  const installThemeFile = (file: string) => {
    const src = join(uiSrc, 'theme', file);
    if (!existsSync(src)) return;
    const destPath = join(themeDir, file);
    writeFileSync(
      destPath,
      formatContent(readFileSync(src, 'utf-8'), destPath),
    );
  };

  for (const file of ['default.css', 'dark.css']) {
    installThemeFile(file);
  }
  installThemeFile('tailwind-plugin.ts');

  s.stop('Setup complete!');

  const componentsDir = resolve(cwd, config.components);
  mkdirSync(componentsDir, { recursive: true });

  p.note(
    [
      `${pc.bold('1.')} Add ${pc.cyan('@blotch/dolan')} as a dependency in your ${pc.cyan('package.json')}`,
      '',
      `${pc.bold('2.')} Add the Tailwind plugin to your ${pc.cyan('tailwind.config.ts')}:`,
      '',
      `   ${pc.dim("import { blotchPlugin } from './")}${pc.dim(config.theme)}${pc.dim("/tailwind-plugin';")}`,
      `   ${pc.dim('plugins: [blotchPlugin]')}`,
      '',
      `${pc.bold('3.')} Import a theme in your global styles:`,
      '',
      `   ${pc.dim("@import './")}${pc.dim(config.theme)}${pc.dim("/default.css';")}`,
      '',
      `${pc.bold('4.')} Add components:`,
      '',
      `   ${pc.dim('npx dolan add button card')}`,
    ].join('\n'),
    'Next steps',
  );

  p.outro('Ready to go!');
};
