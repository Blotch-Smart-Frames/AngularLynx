import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { transformCrossThread } from './cross-thread-transform.js';

const ROOT = '/proj';
const FILE = '/proj/src/app/page.ts';
/** The key prefix for FILE: a hash of its path from ROOT. */
const KEY = createHash('sha1')
  .update('src/app/page.ts')
  .digest('hex')
  .slice(0, 10);

const IMPORT = `import { backgroundFn, createMainThreadRef, MainThreadRef } from '@blotch/angular-lynx';\n`;

const tag = (code: string, mirrorImports = false): string =>
  transformCrossThread(code, FILE, { root: ROOT, mirrorImports });

describe('transformCrossThread', () => {
  it('returns code without runtime calls or imports untouched', () => {
    const code = 'export const x = 1;';
    expect(tag(code, true)).toBe(code);
  });

  describe('IDs', () => {
    it('gives a module-level backgroundFn() an ID from the file and position', () => {
      const result = tag(`${IMPORT}const a = backgroundFn((x) => x);`);

      expect(result).toContain(`backgroundFn((x) => x, "${KEY}:0")`);
    });

    it('numbers the calls in a file in order', () => {
      const result = tag(
        `${IMPORT}const a = createMainThreadRef(1);\nconst b = backgroundFn(() => 2);\nconst c = new MainThreadRef(3);`,
      );

      expect(result).toContain(`createMainThreadRef(1, "${KEY}:0")`);
      expect(result).toContain(`backgroundFn(() => 2, "${KEY}:1")`);
      expect(result).toContain(`new MainThreadRef(3, "${KEY}:2")`);
    });

    it('gives a ref created without a value an undefined one', () => {
      const result = tag(
        `${IMPORT}const a = createMainThreadRef();\nconst b = new MainThreadRef();`,
      );

      expect(result).toContain(`createMainThreadRef(undefined, "${KEY}:0")`);
      expect(result).toContain(`new MainThreadRef(undefined, "${KEY}:1")`);
    });

    it('leaves `new MainThreadRef` without parentheses alone', () => {
      const code = `${IMPORT}const a = new MainThreadRef;`;
      expect(tag(code)).toBe(code);
    });

    it('gives the same file the same IDs on every build, and different files different ones', () => {
      const code = `${IMPORT}const a = backgroundFn(() => 1);`;
      const other = transformCrossThread(code, '/proj/src/app/other.ts', {
        root: ROOT,
        mirrorImports: false,
      });

      expect(tag(code)).toBe(tag(code));
      expect(other).not.toBe(tag(code));
    });

    it('keys the file by its path from the root, wherever the project is', () => {
      const code = `${IMPORT}const a = backgroundFn(() => 1);`;
      const moved = transformCrossThread(code, '/elsewhere/src/app/page.ts', {
        root: '/elsewhere',
        mirrorImports: false,
      });

      expect(moved).toBe(tag(code));
    });

    it('finds the runtime under any local name or a namespace', () => {
      const result = tag(
        `import { backgroundFn as bg } from '@blotch/angular-lynx';\nimport * as ng from '@blotch/angular-lynx';\nconst a = bg(() => 1);\nconst b = ng.createMainThreadRef(2);\nconst c = new ng.MainThreadRef(3);`,
      );

      expect(result).toContain(`bg(() => 1, "${KEY}:0")`);
      expect(result).toContain(`ng.createMainThreadRef(2, "${KEY}:1")`);
      expect(result).toContain(`new ng.MainThreadRef(3, "${KEY}:2")`);
    });

    it("leaves a function of the same name that isn't the runtime's alone", () => {
      const code = `import { MainThreadRef } from '@blotch/angular-lynx';\nimport { backgroundFn } from './local';\nimport other from '@blotch/angular-lynx';\nimport '@blotch/angular-lynx';\nconst a = backgroundFn(() => 1);\nconst b = other.backgroundFn(() => 2);\nconst c = MainThreadRef.from(3);`;
      expect(tag(code)).toBe(code);
    });

    // One call site inside a function can run any number of times, so a
    // fixed ID would give different values the same one.
    it('leaves calls inside functions and classes alone', () => {
      const code = `${IMPORT}function make() { return backgroundFn(() => 1); }\nconst f = () => createMainThreadRef(2);\nclass Page { ref = new MainThreadRef(3); }`;
      expect(tag(code)).toBe(code);
    });

    it('tags a module-level call inside a block', () => {
      const result = tag(
        `${IMPORT}if (ready) { var a = backgroundFn(() => 1); }`,
      );

      expect(result).toContain(`backgroundFn(() => 1, "${KEY}:0")`);
    });

    it('leaves a call that already has an ID, or a spread, alone', () => {
      const code = `${IMPORT}const a = backgroundFn(() => 1, 'mine');\nconst b = backgroundFn(...args);`;
      expect(tag(code)).toBe(code);
    });
  });

  describe('lazy imports', () => {
    it('mirrors an import() and registers its loader at the end of the module', () => {
      const result = tag(
        `export const routes = [{ loadComponent: () => import('./home').then((m) => m.Home) }];`,
        true,
      );

      expect(result).toContain(
        `loadComponent: () => __ɵmirrorImport("${KEY}:0", () => import('./home')).then((m) => m.Home)`,
      );
      expect(
        result.startsWith(
          `import { ɵmirrorImport as __ɵmirrorImport, ɵregisterMirroredImport as __ɵregisterMirroredImport } from '@blotch/angular-lynx';\n`,
        ),
      ).toBe(true);
      expect(
        result
          .trimEnd()
          .endsWith(
            `;__ɵregisterMirroredImport("${KEY}:0", () => import('./home'));`,
          ),
      ).toBe(true);
    });

    it("keeps an import's options and comments", () => {
      const result = tag(
        `const load = () => import(/* webpackChunkName: "x" */ './x', { with: { mode: 'sync' } });`,
        true,
      );

      expect(result).toContain(
        `__ɵmirrorImport("${KEY}:0", () => import(/* webpackChunkName: "x" */ './x', { with: { mode: 'sync' } }))`,
      );
    });

    it('mirrors a template-literal specifier without substitutions', () => {
      expect(tag('const load = () => import(`./x`);', true)).toContain(
        `__ɵmirrorImport("${KEY}:0", () => import(\`./x\`))`,
      );
    });

    // The registration at the end of the module can't see local variables.
    it('leaves a computed specifier alone', () => {
      const code = 'const load = (name) => import(`./pages/${name}`);';
      expect(tag(code, true)).toBe(code);
    });

    it('leaves imports alone unless asked to mirror them', () => {
      const code = "const load = () => import('./x');";
      expect(tag(code)).toBe(code);
    });

    it('mirrors imports and tags IDs in the same module', () => {
      const result = tag(
        `${IMPORT}const a = backgroundFn(async () => (await import('./x')).run());`,
        true,
      );

      expect(result).toContain(
        `backgroundFn(async () => (await __ɵmirrorImport("${KEY}:1", () => import('./x'))).run(), "${KEY}:0")`,
      );
    });
  });
});
