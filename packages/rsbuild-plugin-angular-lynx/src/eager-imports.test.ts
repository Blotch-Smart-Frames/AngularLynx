import { describe, expect, it } from 'vitest';
import { importEagerly, resolveEagerImports } from './eager-imports.js';
import { trackSourceMap } from './source-map-edits.js';

const APP = '/app/src/app/app.routes.ts';

describe('resolveEagerImports', () => {
  it('is off when neither the plugin nor angular.json sets it', () => {
    expect(resolveEagerImports(undefined, undefined)).toBe(false);
    expect(resolveEagerImports(undefined, {})).toBe(false);
  });

  it("takes angular.json's build option", () => {
    expect(resolveEagerImports(undefined, { eagerImports: true })).toBe(true);
  });

  it("lets the plugin's option win", () => {
    expect(resolveEagerImports(false, { eagerImports: true })).toBe(false);
    expect(resolveEagerImports(true, undefined)).toBe(true);
  });

  // A JavaScript lynx.config.ts isn't type-checked.
  it('rejects anything but a boolean', () => {
    expect(() => resolveEagerImports('false' as never, undefined)).toThrow(
      'eagerImports must be true or false, not "false"',
    );
  });
});

describe('importEagerly', () => {
  it("compiles a lazy route's import() as a static import the call resolves to", () => {
    const code = [
      `export const routes = [`,
      `  { path: 'a', loadComponent: () => import('./screens/a').then((m) => m.A) },`,
      `];`,
    ].join('\n');
    expect(importEagerly(code, APP)).toBe(
      [
        `import * as __eagerImport0 from "./screens/a";export const routes = [`,
        `  { path: 'a', loadComponent: () => Promise.resolve(__eagerImport0).then((m) => m.A) },`,
        `];`,
      ].join('\n'),
    );
  });

  it('imports each module once, however many calls load it', () => {
    const code = [
      `const a = () => import('./a');`,
      `const b = () => import("./b");`,
      'const c = () => import(`./a`);',
    ].join('\n');
    expect(importEagerly(code, APP)).toBe(
      [
        `import * as __eagerImport0 from "./a";import * as __eagerImport1 from "./b";const a = () => Promise.resolve(__eagerImport0);`,
        `const b = () => Promise.resolve(__eagerImport1);`,
        'const c = () => Promise.resolve(__eagerImport0);',
      ].join('\n'),
    );
  });

  it('resolves to the namespace object, after the module has run, as import() does', async () => {
    // What the call becomes, with the static import's binding standing in
    // for the module rspack links it to.
    const namespace = Object.freeze({ A: class A {} });
    const call = new Function(
      '__eagerImport0',
      `return ${importEagerly(`import('./a')`, APP).replace(/^import[^;]*;/, '')};`,
    );
    const result = call(namespace) as Promise<unknown>;
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe(namespace);
  });

  it('picks a name nothing in the module starts with', () => {
    // `_\u005f_eagerImportX` is `___eagerImportX` as it's parsed, so with
    // `__eagerImport` taken too, both of those prefixes are.
    const code = `const __eagerImport = 1; const _\\u005f_eagerImportX = 2; import('./a');`;
    expect(importEagerly(code, APP)).toBe(
      `import * as ____eagerImport0 from "./a";const __eagerImport = 1; const _\\u005f_eagerImportX = 2; Promise.resolve(____eagerImport0);`,
    );
  });

  it('puts the imports after a hashbang, on the line after it', () => {
    const code = `#!/usr/bin/env node\nimport('./a');\n`;
    expect(importEagerly(code, APP)).toBe(
      `#!/usr/bin/env node\nimport * as __eagerImport0 from "./a";Promise.resolve(__eagerImport0);\n`,
    );
  });

  it('adds no line, so the source map keeps its lines', () => {
    const code = `const a = 1;\nconst load = () => import('./a');\n`;
    const out = importEagerly(code, APP);
    expect(out.split('\n')).toHaveLength(code.split('\n').length);
    // The edit is recorded for the module's map, as the other passes' are.
    const { code: tracked, map } = trackSourceMap(
      code,
      { version: 3, sources: [APP], names: [], mappings: 'AAAA;AAAA' },
      (input) => importEagerly(input, APP),
    );
    expect(tracked).toBe(out);
    expect(map?.mappings.split(';')).toHaveLength(2);
  });

  it("compiles AngularLynx's own packages', which node_modules/@blotch holds", () => {
    const code = `export const load = () => import('./a');`;
    expect(
      importEagerly(
        code,
        '/app/node_modules/@blotch/angular-lynx/fesm2022/a.mjs',
      ),
    ).not.toBe(code);
  });

  describe('leaves alone', () => {
    it('a module with no import()', () => {
      const code = `import { a } from './a'; export const b = a;`;
      expect(importEagerly(code, APP)).toBe(code);
    });

    it('a module that only mentions one', () => {
      const code = `// import('./a') would load it\nconst s = "import('./b')";`;
      expect(importEagerly(code, APP)).toBe(code);
    });

    it("another package's modules", () => {
      const code = `export const load = () => import('./a');`;
      expect(
        importEagerly(code, '/app/node_modules/some-lib/fesm2022/lib.mjs'),
      ).toBe(code);
    });

    it('a specifier that is not a string literal', () => {
      const code = 'const load = (x) => [import(x), import(`./${x}`)];';
      expect(importEagerly(code, APP)).toBe(code);
    });

    it('an import() with options', () => {
      const code = `const load = () => import('./a.json', { with: { type: 'json' } });`;
      expect(importEagerly(code, APP)).toBe(code);
    });

    it('an import() rspack is told to leave to the engine', () => {
      const code = `const load = () => import(/* webpackIgnore: true */ './a');`;
      expect(importEagerly(code, APP)).toBe(code);
    });

    it("compiles one whose comment doesn't say to ignore it", () => {
      const code = `const load = () => import(/* webpackChunkName: "a" */ './a');`;
      expect(importEagerly(code, APP)).toBe(
        `import * as __eagerImport0 from "./a";const load = () => Promise.resolve(__eagerImport0);`,
      );
    });

    it("a @defer block's dependency function, as Angular names it", () => {
      const code = [
        `const Card_Defer_1_DepsFn = () => [import('./heavy').then((m) => m.Heavy)];`,
        `function Card_Defer_3_DepsFn() { return [import('./other').then((m) => m.Other)]; }`,
        `const Card_DeferFn = () => [import('./all').then((m) => m.All)];`,
      ].join('\n');
      expect(importEagerly(code, APP)).toBe(code);
    });

    it("ɵsetClassMetadataAsync()'s imports", () => {
      const code = `(() => { i0.ɵsetClassMetadataAsync(Card, () => [import('./heavy').then((m) => m.Heavy)], (Heavy) => {}); })();`;
      expect(importEagerly(code, APP)).toBe(code);
    });

    it('compiles a route beside a @defer block in the same module', () => {
      const code = [
        `const Card_Defer_1_DepsFn = () => [import('./heavy')];`,
        `export const routes = [{ loadComponent: () => import('./screen') }];`,
        `const notDeferFn = function named() { return import('./third'); };`,
      ].join('\n');
      expect(importEagerly(code, APP)).toBe(
        [
          `import * as __eagerImport0 from "./screen";import * as __eagerImport1 from "./third";const Card_Defer_1_DepsFn = () => [import('./heavy')];`,
          `export const routes = [{ loadComponent: () => Promise.resolve(__eagerImport0) }];`,
          `const notDeferFn = function named() { return Promise.resolve(__eagerImport1); };`,
        ].join('\n'),
      );
    });
  });
});
