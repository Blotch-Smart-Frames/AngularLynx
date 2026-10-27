import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getUiSourceDir,
  getComponentSourceDir,
  getComponentFiles,
  rewriteImports,
} from './resolve-paths';

// Deliberately unmocked (unlike the command tests, which stub this module out
// for isolation): this is the one place that must exercise the real
// filesystem lookups. The dolan vite.config.ts `copy-ui` plugin copies
// packages/ui/src/lib into packages/dolan/dist/ui on every Vite config
// resolution (including vitest's), so `dist/ui/components/*` is always
// populated with real @blotch/ui source when this test runs — no fixture
// needed.
describe('getUiSourceDir', () => {
  it('resolves to the dist/ui directory inside the package root', () => {
    const dir = getUiSourceDir();
    expect(dir.endsWith(join('dist', 'ui'))).toBe(true);
  });
});

describe('getComponentSourceDir', () => {
  it('joins the ui source dir with components/<name>', () => {
    expect(getComponentSourceDir('card')).toBe(
      join(getUiSourceDir(), 'components', 'card'),
    );
  });
});

describe('getComponentFiles', () => {
  it('lists only .ts files for a real registry component', () => {
    // card/ ships card.ts + index.ts alongside no non-.ts files, so this also
    // pins that non-.ts assets (if any were added later) would be filtered.
    const files = getComponentFiles('card', { tests: true });
    expect(files).toContain('card.ts');
    expect(files).toContain('index.ts');
    for (const file of files) {
      expect(file.endsWith('.ts')).toBe(true);
    }
  });

  it('ships every test in the component folder', () => {
    // Together they cover the component, so an app's coverage report can
    // include the copies (packages/ui checks the coverage).
    const components = join(getUiSourceDir(), 'components');
    for (const name of readdirSync(components)) {
      const tests = readdirSync(join(components, name)).filter((file) =>
        file.endsWith('.test.ts'),
      );
      expect(tests, name).not.toEqual([]);
      expect(getComponentFiles(name, { tests: true }), name).toEqual(
        expect.arrayContaining(tests),
      );
    }
  });

  it('leaves every test behind for an app without the testing library', () => {
    const files = getComponentFiles('line-chart', { tests: false });
    expect(files).toContain('line-chart.ts');
    expect(files.filter((file) => file.endsWith('.test.ts'))).toEqual([]);
  });

  it('ships every test helper the copied tests import', () => {
    // rewriteImports points `../../../test-utils/<name>` at
    // `@blotch/dolan/testing/<name>`, so each one needs a file and an export.
    const exports = (
      JSON.parse(
        readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
      ) as { exports: Record<string, unknown> }
    ).exports;
    const components = join(getUiSourceDir(), 'components');
    for (const name of readdirSync(components)) {
      for (const file of getComponentFiles(name, { tests: true })) {
        const source = readFileSync(join(components, name, file), 'utf-8');
        for (const [, helper] of source.matchAll(
          /from '\.\.\/\.\.\/\.\.\/test-utils\/([^']+)'/g,
        )) {
          expect(exports, `${name}/${file}`).toHaveProperty([
            `./testing/${helper}`,
          ]);
          expect(
            existsSync(new URL(`../testing/${helper}.ts`, import.meta.url)),
          ).toBe(true);
        }
      }
    }
  });
});

describe('rewriteImports', () => {
  it('rewrites relative ../../utils/* imports to the published package path', () => {
    const source = readFileSync(
      join(getComponentSourceDir('card'), 'card.ts'),
      'utf-8',
    );
    const rewritten = rewriteImports(source);

    expect(rewritten).toContain("from '@blotch/dolan/utils/animate';");
    expect(rewritten).toContain("from '@blotch/dolan/utils/cn';");
    expect(rewritten).not.toContain('../../utils/');
  });

  it('leaves content without relative util imports untouched', () => {
    const content = "import { Foo } from './foo';\nexport const x = 1;\n";
    expect(rewriteImports(content)).toBe(content);
  });

  it('rewrites the test helpers to the ones @blotch/dolan ships', () => {
    const content =
      "import { setInputSignal } from '../../../test-utils/set-input-signal';";
    expect(rewriteImports(content)).toBe(
      "import { setInputSignal } from '@blotch/dolan/testing/set-input-signal';",
    );
  });

  it('rewrites an import with no trailing semicolon', () => {
    const content = "import { cn } from '../../utils/cn'";
    expect(rewriteImports(content)).toBe(
      "import { cn } from '@blotch/dolan/utils/cn';",
    );
  });
});
