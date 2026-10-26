import { resolve, join } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const getUiSourceDir = (): string => {
  // dist/utils/resolve-paths.js → dist/utils → dist → package root
  const packageRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  return resolve(packageRoot, 'dist', 'ui');
};

export const getComponentSourceDir = (componentName: string): string => {
  return join(getUiSourceDir(), 'components', componentName);
};

/**
 * The files a component ships: its `.ts` sources and, when `tests` is set,
 * its `<name>.test.ts`. Tests render with
 * `@blotch/angular-lynx-testing-library`, so the commands pass
 * `copiesTests(cwd)`: an app without the library would fail to compile them
 * in `ng test`. `*-render.test.ts` always stays behind: those render the
 * component through the library's own JIT test harness, so in an app they
 * wouldn't compile either.
 */
export const getComponentFiles = (
  componentName: string,
  { tests }: { tests: boolean },
): string[] => {
  const dir = getComponentSourceDir(componentName);
  return readdirSync(dir).filter(
    (f) =>
      f.endsWith('.ts') &&
      !f.endsWith('-render.test.ts') &&
      (tests || !f.endsWith('.test.ts')),
  );
};

/**
 * When copying component source files from the bundled @blotch/ui package
 * into the user's project, relative imports to shared utilities
 * (e.g., `from '../../utils/cn'`) must be rewritten to the published
 * package path (`from '@blotch/dolan/utils/cn'`). The relative paths
 * only work inside the monorepo source tree — in the user's project,
 * the utils are consumed as package exports from @blotch/dolan.
 *
 * Tests import the library's test helpers the same way
 * (`../../../test-utils/set-input-signal`), and @blotch/dolan ships those
 * too, as `@blotch/dolan/testing/*`. Without the rewrite, a copied test
 * imported a file the app doesn't have and broke its `ng test`.
 */
export const rewriteImports = (fileContent: string): string => {
  return fileContent
    .replace(
      /from\s+['"]\.\.\/\.\.\/utils\/([^'"]+)['"];?/g,
      (_match, utilName: string) => {
        return `from '@blotch/dolan/utils/${utilName}';`;
      },
    )
    .replace(
      /from\s+['"]\.\.\/\.\.\/\.\.\/test-utils\/([^'"]+)['"];?/g,
      (_match, helperName: string) => {
        return `from '@blotch/dolan/testing/${helperName}';`;
      },
    );
};
