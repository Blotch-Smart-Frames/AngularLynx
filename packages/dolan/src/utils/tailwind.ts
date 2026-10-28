import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** The config files Tailwind 3 reads. Tailwind 4 needs none. */
export const TAILWIND_CONFIG_FILES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
];

/** The Tailwind config in the project's folder, if it has one. */
export const tailwindConfigFile = (cwd: string): string | undefined =>
  TAILWIND_CONFIG_FILES.find((file) => existsSync(join(cwd, file)));

/**
 * The version of `tailwindcss` that `require` finds, if any. Both majors'
 * package.json resolve: Tailwind 3 has no `exports` map, and Tailwind 4's
 * lists `./package.json`.
 */
const tailwindVersion = (require: NodeJS.Require): string | undefined => {
  try {
    return (require('tailwindcss/package.json') as { version: string }).version;
  } catch {
    return undefined;
  }
};

/**
 * The version of Tailwind CSS installed for the project, resolved from its
 * folder as the build resolves it. Reading the project's package.json missed
 * two setups that build fine: a workspace whose root installs `tailwindcss`
 * for every package, and a Tailwind 4 app that lists only
 * `@tailwindcss/postcss`, which depends on `tailwindcss` itself.
 *
 * npm hoists that dependency next to the plugin, where the app finds it.
 * pnpm's strict layout keeps it out of the app's reach, so this looks from
 * the plugin's own folder too. The build still finds it under pnpm: pnpm's
 * bin scripts, `ng` among them, put the packages pnpm hoists on `NODE_PATH`,
 * and Tailwind resolves the stylesheet's `@import 'tailwindcss'` against it.
 * Undefined when neither finds it.
 */
export const installedTailwindVersion = (cwd: string): string | undefined => {
  const require = createRequire(join(cwd, 'package.json'));
  const version = tailwindVersion(require);
  if (version !== undefined) return version;
  try {
    // The plugin's `exports` map doesn't list its package.json, so this
    // starts from its entry point.
    return tailwindVersion(
      createRequire(require.resolve('@tailwindcss/postcss')),
    );
  } catch {
    return undefined;
  }
};

/** A version's major, `4` for `4.3.3`. */
export const majorVersion = (version: string): number =>
  Number.parseInt(version, 10);

/**
 * Whether the project is set up for Tailwind 4, where the stylesheet imports
 * the theme's `tailwind.css` rather than `tailwind.config.ts` listing its
 * plugin: it has no Tailwind config, and Tailwind 4 installed, as
 * `ng add @blotch/angular-lynx` and `ng new --style=tailwind` set it up. A
 * config means a Tailwind 3 setup, even with Tailwind 4 installed, as
 * `doctor` warns.
 */
export const usesTailwind4 = (cwd: string): boolean => {
  if (tailwindConfigFile(cwd)) return false;
  const version = installedTailwindVersion(cwd);
  return version !== undefined && majorVersion(version) >= 4;
};

/**
 * The theme files a project takes: the colors, and what maps them to
 * Tailwind's utilities, `tailwind.css` for Tailwind 4 (imported in the
 * stylesheet) or `tailwind-plugin.ts` for Tailwind 3 (a config plugin).
 *
 * With `tests`, the plugin comes with its test, for the same reason as a
 * component's (see getComponentFiles): it covers the plugin in the app's
 * coverage report. `tailwind.css` has no code to cover. The theme folder's
 * other tests stay behind: they check the theme in packages/ui with Node,
 * against the components and Tailwind's own builds, which an app's `ng test`
 * can't do.
 */
export const themeFilesFor = (
  cwd: string,
  { tests = false }: { tests?: boolean } = {},
): string[] =>
  usesTailwind4(cwd)
    ? ['default.css', 'dark.css', 'tailwind.css']
    : [
        'default.css',
        'dark.css',
        'tailwind-plugin.ts',
        ...(tests ? ['tailwind-plugin.test.ts'] : []),
      ];
