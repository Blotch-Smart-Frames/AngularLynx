import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  definesCrossThreadValues,
  transformCrossThread,
} from './cross-thread-transform.js';

const ROOT = '/proj';
const FILE = '/proj/src/app/page.ts';
/** The key prefix for FILE: a hash of its path from ROOT. */
const KEY = createHash('sha1')
  .update('src/app/page.ts')
  .digest('hex')
  .slice(0, 10);

const IMPORT = `import { backgroundFn, createMainThreadRef, MainThreadRef } from '@blotch/angular-lynx';\n`;

const tag = (code: string): string =>
  transformCrossThread(code, FILE, { root: ROOT });

describe('transformCrossThread', () => {
  it('returns code without runtime calls or imports untouched', () => {
    const code = 'export const x = 1;';
    expect(tag(code)).toBe(code);
  });

  // The background entry used to load each lazy chunk the main thread loaded,
  // through rewritten imports. It now imports the modules up front.
  it('leaves lazy imports alone', () => {
    const code = `${IMPORT}const load = () => import('./x');`;
    expect(tag(code)).toBe(code);
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
      });

      expect(tag(code)).toBe(tag(code));
      expect(other).not.toBe(tag(code));
    });

    it('keys the file by its path from the root, wherever the project is', () => {
      const code = `${IMPORT}const a = backgroundFn(() => 1);`;
      const moved = transformCrossThread(code, '/elsewhere/src/app/page.ts', {
        root: '/elsewhere',
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
});

describe('definesCrossThreadValues', () => {
  it('finds a module-level backgroundFn(), createMainThreadRef() or new MainThreadRef()', () => {
    expect(
      definesCrossThreadValues(
        `${IMPORT}const a = backgroundFn(() => 1);`,
        FILE,
      ),
    ).toBe(true);
    expect(
      definesCrossThreadValues(
        `${IMPORT}const a = createMainThreadRef(1);`,
        FILE,
      ),
    ).toBe(true);
    expect(
      definesCrossThreadValues(
        `${IMPORT}const a = new MainThreadRef(1);`,
        FILE,
      ),
    ).toBe(true);
  });

  // The background thread needs the module even when the build can't tag the
  // call, so it still counts.
  it('counts a call the transform leaves alone', () => {
    expect(
      definesCrossThreadValues(
        `${IMPORT}const a = backgroundFn(...args);`,
        FILE,
      ),
    ).toBe(true);
  });

  it('ignores calls inside functions, other functions and modules without the runtime', () => {
    expect(
      definesCrossThreadValues(
        `${IMPORT}function make() { return backgroundFn(() => 1); }`,
        FILE,
      ),
    ).toBe(false);
    expect(
      definesCrossThreadValues(
        `import { backgroundFn } from './local';\nconst a = backgroundFn(() => 1);`,
        FILE,
      ),
    ).toBe(false);
    expect(
      definesCrossThreadValues('export const backgroundFn = 1;', FILE),
    ).toBe(false);
    expect(
      definesCrossThreadValues(
        `import { inject } from '@blotch/angular-lynx';\nconst a = 1;`,
        FILE,
      ),
    ).toBe(false);
  });
});
