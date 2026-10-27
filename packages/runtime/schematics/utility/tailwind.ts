import { type Rule, type Tree, chain } from '@angular-devkit/schematics';
import {
  addDependency,
  DependencyType,
  ExistingBehavior,
  InstallBehavior,
} from '@schematics/angular/utility/dependency';
import { JSONFile } from '@schematics/angular/utility/json-file';
import { updateWorkspace } from '@schematics/angular/utility/workspace';

import { VERSIONS } from '../ng-add/versions';

/** A Tailwind CSS major version the schematics can set up. */
export type TailwindVersion = '3' | '4';

/**
 * The Tailwind CSS major version the project already depends on, if any. A
 * range such as `^4.1.0` gives 4; `@tailwindcss/postcss`, Tailwind 4's
 * PostCSS plugin, means 4 too.
 */
export const installedTailwindVersion = (
  tree: Tree,
): TailwindVersion | undefined => {
  if (!tree.exists('package.json')) {
    return undefined;
  }
  const { dependencies = {}, devDependencies = {} } = tree.readJson(
    'package.json',
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...dependencies, ...devDependencies };
  if (all['@tailwindcss/postcss']) {
    return '4';
  }
  const major = /\d+/.exec(all['tailwindcss'] ?? '')?.[0];
  return major === '3' || major === '4' ? major : undefined;
};

/**
 * The version to set up: the one asked for, else the one the project already
 * has, else 4. An app that `ng new --style=tailwind` made, or one that is
 * already on Tailwind 3, keeps its version, so running `ng add` again never
 * moves it to another.
 */
export const tailwindVersionFor = (
  tree: Tree,
  requested: TailwindVersion | 3 | 4 | undefined,
): TailwindVersion =>
  requested === undefined
    ? (installedTailwindVersion(tree) ?? '4')
    : (String(requested) as TailwindVersion);

/** Where things go in the project. */
export type TailwindTarget = {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly sourceRoot: string;
};

/**
 * Sets Tailwind CSS up in a project: Tailwind 4 as Angular CLI sets it up
 * (`ng new --style=tailwind`), or Tailwind 3 with Lynx's preset.
 */
export const setUpTailwind = (
  target: TailwindTarget,
  version: TailwindVersion,
): Rule => (version === '3' ? setUpTailwind3(target) : setUpTailwind4(target));

const prefixed = (projectRoot: string, file: string) =>
  projectRoot ? `${projectRoot}/${file}` : file;

/**
 * Tailwind 4, without its Preflight reset, whose rules are for HTML elements
 * (`h1`, `button`, `img`) that a Lynx app doesn't have: Lynx drops most of
 * them, and the web preview would apply them, so the two would differ.
 * Tailwind documents this way of leaving Preflight out.
 */
export const TAILWIND_4_STYLESHEET = `@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
`;

/** The PostCSS config files Angular CLI reads, and its Tailwind schematic writes. */
const POSTCSS_CONFIG_FILES = ['.postcssrc.json', 'postcss.config.json'];

const setUpTailwind4 = ({
  projectName,
  projectRoot,
  sourceRoot,
}: TailwindTarget): Rule => {
  const installed = (tree: Tree) => installedTailwindVersion(tree) === '4';
  return chain([
    writeTailwind4Stylesheet(projectName, sourceRoot),
    addTailwindPostcssPlugin(projectRoot),
    (tree) =>
      chain(
        ['tailwindcss', '@tailwindcss/postcss'].map((name) =>
          addDependency(name, VERSIONS.tailwindcss4, {
            type: DependencyType.Dev,
            install: InstallBehavior.Auto,
            // Keep the version of a project that already has Tailwind 4, as
            // Angular CLI does; replace a Tailwind 3 one.
            existing: installed(tree)
              ? ExistingBehavior.Skip
              : ExistingBehavior.Replace,
          }),
        ),
      ),
    (tree, context) => {
      const config = ['ts', 'js', 'mjs', 'cjs']
        .map((extension) =>
          prefixed(projectRoot, `tailwind.config.${extension}`),
        )
        .find((file) => tree.exists(file));
      if (config) {
        context.logger.warn(
          `Tailwind CSS 4 doesn't read ${config}. Move its theme into @theme in the stylesheet, load its plugins with @plugin, and delete it.`,
        );
      }
    },
  ]);
};

/**
 * Writes the Tailwind 4 stylesheet: over `styles.css`, or, in a project
 * styled with Sass (which would read Tailwind's `@import`s as its own), to a
 * `tailwind.css` added to the build's styles, as Angular CLI does.
 */
const writeTailwind4Stylesheet =
  (projectName: string, sourceRoot: string): Rule =>
  (tree) => {
    const cssPath = `${sourceRoot}/styles.css`;
    if (tree.exists(cssPath) || !tree.exists(`${sourceRoot}/styles.scss`)) {
      writeFile(tree, cssPath, TAILWIND_4_STYLESHEET);
      return;
    }
    const tailwindPath = `${sourceRoot}/tailwind.css`;
    writeFile(tree, tailwindPath, TAILWIND_4_STYLESHEET);
    return updateWorkspace((workspace) => {
      const build = workspace.projects.get(projectName)?.targets.get('build');
      if (!build) {
        return;
      }
      const options = (build.options ??= {});
      const styles = (options['styles'] as string[] | undefined) ?? [];
      if (!styles.includes(tailwindPath)) {
        options['styles'] = [tailwindPath, ...styles];
      }
    });
  };

/**
 * Lists `@tailwindcss/postcss` in the project's PostCSS config, which the
 * build reads, creating `.postcssrc.json` if there's none, as Angular CLI's
 * Tailwind schematic does.
 */
const addTailwindPostcssPlugin =
  (projectRoot: string): Rule =>
  (tree) => {
    const existing = [...new Set(['', projectRoot])]
      .flatMap((root) =>
        POSTCSS_CONFIG_FILES.map((file) => prefixed(root, file)),
      )
      .find((file) => tree.exists(file));
    if (!existing) {
      tree.create(
        prefixed(projectRoot, '.postcssrc.json'),
        `${JSON.stringify({ plugins: { '@tailwindcss/postcss': {} } }, null, 2)}\n`,
      );
      return;
    }
    const config = new JSONFile(tree, existing);
    if (config.get(['plugins', '@tailwindcss/postcss']) === undefined) {
      config.modify(['plugins', '@tailwindcss/postcss'], {});
    }
  };

const setUpTailwind3 = ({ projectRoot, sourceRoot }: TailwindTarget): Rule =>
  chain([
    (tree) => {
      // The build runs Tailwind with this `content`, so it has to take in
      // both inline templates (.ts) and the .html templates `ng generate
      // component` writes by default, as in Angular's own Tailwind setup.
      writeFile(
        tree,
        prefixed(projectRoot, 'tailwind.config.ts'),
        `import type { Config } from 'tailwindcss';
import preset from '@lynx-js/tailwind-preset';

const config: Config = {
  content: ['./src/**/*.{html,ts}'],
  presets: [preset],
};

export default config;
`,
      );
      // Prefer styles.scss if it exists (the user picked SCSS at `ng new`
      // time): overwriting it with .css content would break their other
      // imports.
      //
      // Only @tailwind base + utilities, no @tailwind components. Lynx doesn't
      // support all of Tailwind's component-layer reset rules (button resets
      // that reference focus-visible, form input pseudo-classes), and bundling
      // them in would generate CSS the runtime can't parse, producing
      // diagnostic noise. The base layer ships with @lynx-js/tailwind-preset's
      // own Lynx-compatible normalize rules.
      const scssPath = `${sourceRoot}/styles.scss`;
      writeFile(
        tree,
        tree.exists(scssPath) ? scssPath : `${sourceRoot}/styles.css`,
        '@tailwind base;\n@tailwind utilities;\n',
      );
    },
    addDependency('tailwindcss', VERSIONS.tailwindcss, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
    addDependency('@lynx-js/tailwind-preset', VERSIONS.tailwindPreset, {
      type: DependencyType.Dev,
      install: InstallBehavior.Auto,
    }),
  ]);

const writeFile = (tree: Tree, path: string, content: string): void => {
  if (tree.exists(path)) {
    tree.overwrite(path, content);
  } else {
    tree.create(path, content);
  }
};
