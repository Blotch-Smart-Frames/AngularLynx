import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The config files Tailwind 3 reads. Tailwind 4 needs none. */
export const TAILWIND_CONFIG_FILES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
];

/**
 * Whether the project is set up for Tailwind 4, where the theme's plugin is
 * loaded with `@plugin` in the stylesheet rather than listed in
 * `tailwind.config.ts`: it has no Tailwind config, and depends on Tailwind 4
 * or on its PostCSS plugin, as `ng add @blotch/angular-lynx` and
 * `ng new --style=tailwind` set it up.
 */
export const usesTailwind4 = (cwd: string): boolean => {
  if (TAILWIND_CONFIG_FILES.some((file) => existsSync(join(cwd, file)))) {
    return false;
  }
  try {
    const { dependencies = {}, devDependencies = {} } = JSON.parse(
      readFileSync(join(cwd, 'package.json'), 'utf-8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...dependencies, ...devDependencies };
    const major = Number(/\d+/.exec(all['tailwindcss'] ?? '')?.[0]);
    return Boolean(all['@tailwindcss/postcss']) || major >= 4;
  } catch {
    return false;
  }
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
