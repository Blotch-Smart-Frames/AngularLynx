import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyNativeFeatures,
  canvasNamed,
  createNativeFeaturesCollector,
  NATIVE_FEATURES_FILE,
  NativeFeaturesPlugin,
  webglNamed,
} from './native-features.js';

describe('canvasNamed', () => {
  it('is false for a module that never draws', () => {
    expect(
      canvasNamed(
        `export class Card { title = 'Image of the day'; canvas = 1; }`,
        '/app/src/card.ts',
      ),
    ).toBe(false);
  });

  it.each([
    ['a template’s <canvas>', `ɵɵelementStart(0, "canvas");`],
    ['a canvas made in code', `document.createElement('canvas');`],
    ['the 2D context', `c.getContext('2d');`],
    ['the bitmaprenderer context', `c.getContext("bitmaprenderer");`],
    ['WebGL2, even in a comment', `// draws with webgl2`],
    ['an OffscreenCanvas', `new OffscreenCanvas(1, 1);`],
    ['an Image', `const image = new Image();`],
    ['createImageBitmap()', `await createImageBitmap(blob);`],
    ['a 2D class', `new Path2D('M0 0');`],
    ['a check against a canvas', `x instanceof HTMLCanvasElement;`],
    ['an enable function the app calls itself', `ɵenableCanvas2D();`],
    ['a name spelled with an escape', `c.getContext('\\x32d');`],
    ['a name spelled with an identity escape', `new globalThis['Im\\age']();`],
    ['a name spelled with an octal escape', `new globalThis['\\111mage']();`],
    [
      'a name spelled with a line continuation',
      `new globalThis['Ima\\\nge']();`,
    ],
  ])('is true for %s', (_, code) => {
    expect(canvasNamed(code, '/app/src/draw.js')).toBe(true);
  });

  it('reads TypeScript', () => {
    expect(
      canvasNamed(
        `const c: HTMLElement = document.createElement('canvas') as any;`,
        '/app/src/draw.ts',
      ),
    ).toBe(true);
  });

  it('leaves out words in other strings and a property named canvas', () => {
    expect(
      canvasNamed(
        `const label = 'canvas size'; this.canvas.width = 2; const t = 'Images';`,
        '/app/src/x.js',
      ),
    ).toBe(false);
  });

  it('leaves out AngularLynx’s own packages, which name all of them', () => {
    expect(
      canvasNamed(
        `c.getContext('2d'); new Image();`,
        '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
      ),
    ).toBe(false);
  });

  it('is false for every module of Angular’s packages, which every app bundles', () => {
    // If this fails after an Angular update, look at what the new mention
    // does: one in code every app runs would link the canvas code into every
    // app.
    const require = createRequire(import.meta.url);
    const scope = path.dirname(
      path.dirname(require.resolve('@angular/core/package.json')),
    );
    const drawing: string[] = [];
    for (const name of readdirSync(scope)) {
      // The compiler is only in a JIT app's bundle, and the CLI's and the
      // build's packages in none.
      if (name === 'compiler') continue;
      const dir = path.join(scope, name, 'fesm2022');
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
        const full = path.join(dir, file);
        if (canvasNamed(readFileSync(full, 'utf8'), full)) {
          drawing.push(`@angular/${name}/${file}`);
        }
      }
    }
    expect(drawing).toEqual([]);
    // It reads and checks every module of Angular's packages: about 350 ms
    // on its own, but 5 to 10 s in CI when a change to the runtime runs the
    // tests of every package built on it at once.
  }, 60_000);
});

const NOTHING = { canvas: false, webgl: false };
const ONLY_2D = { canvas: true, webgl: false };
const EVERYTHING = { canvas: true, webgl: true };

describe('webglNamed', () => {
  it.each([
    ['a module that never draws', `export const a = 1;`],
    ['a 2D canvas', `ɵɵelementStart(0, "canvas"); c.getContext('2d');`],
    ['an Image and createImageBitmap()', `new Image(); createImageBitmap(b);`],
    ['the word in another case or another word', `const webgl = 'WEBGL2x';`],
  ])('is false for %s', (_, code) => {
    expect(webglNamed(code, '/app/src/draw.js')).toBe(false);
  });

  it.each([
    ['the WebGL2 context', `c.getContext('webgl2');`],
    ['three.js’s context name', `const contextName = 'webgl2';`],
    ['WebGL2, even in a comment', `// draws with webgl2`],
    ['a check against the context', `x instanceof WebGL2RenderingContext;`],
    ['the enable function the app calls itself', `ɵenableWebGL2();`],
    ['the class as a string', `globalThis['WebGL2RenderingContext'];`],
    [
      'a name spelled with an escape',
      `globalThis['\\u0057ebGL2RenderingContext'];`,
    ],
    [
      'a name spelled with an identity escape',
      `globalThis['\\WebGL2RenderingContext'];`,
    ],
  ])('is true for %s', (_, code) => {
    expect(webglNamed(code, '/app/src/scene.js')).toBe(true);
  });

  it('is canvasNamed too wherever it’s true', () => {
    for (const code of [
      `c.getContext('webgl2');`,
      `x instanceof WebGL2RenderingContext;`,
      `ɵenableWebGL2();`,
    ]) {
      expect(canvasNamed(code, '/app/src/scene.js')).toBe(true);
    }
  });

  it('leaves out AngularLynx’s own packages', () => {
    expect(
      webglNamed(
        `c.getContext('webgl2');`,
        '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
      ),
    ).toBe(false);
  });
});

describe('createNativeFeaturesCollector', () => {
  it('asks for the canvas when one of the files draws, and WebGL when one draws in 3D', () => {
    const collector = createNativeFeaturesCollector();
    collector.record('/app/src/a.ts', 'export const a = 1;');
    collector.record('/app/src/b.ts', `c.getContext('2d');`);
    collector.record('/app/src/c.ts', `c.getContext('webgl2');`);
    expect(collector.featuresOf(['/app/src/a.ts'])).toEqual(NOTHING);
    expect(collector.featuresOf(['/app/src/a.ts', '/app/src/b.ts'])).toEqual(
      ONLY_2D,
    );
    expect(collector.featuresOf(['/app/src/c.ts'])).toEqual(EVERYTHING);
    expect(
      collector.featuresOf(['/app/src/a.ts', '/app/src/b.ts', '/app/src/c.ts']),
    ).toEqual(EVERYTHING);
  });

  it('takes a module’s new code over its old, as a watch rebuild sends it', () => {
    const collector = createNativeFeaturesCollector();
    collector.record('/app/src/b.ts', `c.getContext('2d');`);
    collector.record('/app/src/b.ts', 'export const b = 1;');
    expect(collector.featuresOf(['/app/src/b.ts'])).toEqual(NOTHING);
  });
});

type Module = { nameForCondition(): string | undefined; layer?: string };

const runPlugin = (
  modules: Module[],
  options: { cache?: unknown } = {},
  collector = createNativeFeaturesCollector(),
) => {
  const outputPath = mkdtempSync(path.join(tmpdir(), 'native-features-'));
  let finishModules: ((modules: Module[]) => void) | undefined;
  let afterEmit: (() => void) | undefined;
  const compilation = {
    hooks: {
      finishModules: {
        tap: (_: string, fn: (modules: Module[]) => void) => {
          finishModules = fn;
        },
      },
    },
  };
  const compiler = {
    options,
    // A folder rspack hasn't made yet, which the plugin makes.
    outputPath: path.join(outputPath, 'dist'),
    hooks: {
      thisCompilation: {
        tap: (_: string, fn: (c: typeof compilation) => void) =>
          fn(compilation),
      },
      afterEmit: {
        tap: (_: string, fn: () => void) => {
          afterEmit = fn;
        },
      },
    },
  };
  try {
    new NativeFeaturesPlugin(collector).apply(compiler as never);
    finishModules?.(modules);
    afterEmit?.();
    return JSON.parse(
      readFileSync(
        path.join(compiler.outputPath, NATIVE_FEATURES_FILE),
        'utf8',
      ),
    );
  } finally {
    rmSync(outputPath, { recursive: true, force: true });
  }
};

const module = (file: string, layer = 'main'): Module => ({
  nameForCondition: () => file,
  layer,
});

describe('NativeFeaturesPlugin', () => {
  it('writes what the bundle’s main-thread modules need', () => {
    const collector = createNativeFeaturesCollector();
    collector.record('/app/src/app.ts', 'export const app = 1;');
    expect(runPlugin([module('/app/src/app.ts')], {}, collector)).toEqual(
      NOTHING,
    );
  });

  it('asks for the canvas without WebGL when a main-thread module draws only in 2D', () => {
    const collector = createNativeFeaturesCollector();
    collector.record('/app/src/chart.ts', `c.getContext('2d');`);
    expect(
      runPlugin(
        [module('/app/src/app.ts'), module('/app/src/chart.ts')],
        {},
        collector,
      ),
    ).toEqual(ONLY_2D);
  });

  it('asks for the canvas when a main-thread module draws', () => {
    const collector = createNativeFeaturesCollector();
    collector.record('/app/src/scene.ts', `c.getContext('webgl2');`);
    expect(
      runPlugin(
        [module('/app/src/app.ts'), module('/app/src/scene.ts')],
        {},
        collector,
      ),
    ).toEqual(EVERYTHING);
  });

  it('leaves out a module rspack didn’t bundle, or bundled for the background thread or as a stylesheet', () => {
    const collector = createNativeFeaturesCollector();
    collector.record('/app/src/scene.ts', `c.getContext('2d');`);
    collector.record('/app/src/styles.css', `c.getContext('2d');`);
    expect(
      runPlugin(
        [
          module('/app/src/scene.ts', 'background'),
          module('/app/src/styles.css'),
          { nameForCondition: () => undefined },
        ],
        {},
        collector,
      ),
    ).toEqual(NOTHING);
  });

  it('asks for everything with rspack’s persistent cache, whose modules aren’t transformed again', () => {
    const collector = createNativeFeaturesCollector();
    collector.record('/app/src/app.ts', 'export const app = 1;');
    expect(
      runPlugin(
        [module('/app/src/app.ts')],
        { cache: { type: 'persistent' } },
        collector,
      ),
    ).toEqual(EVERYTHING);
    expect(
      runPlugin([module('/app/src/app.ts')], { cache: true }, collector),
    ).toEqual(NOTHING);
  });
});

describe('applyNativeFeatures', () => {
  it('adds the plugin to the lynx environment alone', () => {
    let modify:
      | ((chain: unknown, utils: { environment: { name: string } }) => void)
      | undefined;
    applyNativeFeatures(
      { modifyBundlerChain: (fn: never) => (modify = fn) } as never,
      createNativeFeaturesCollector(),
    );
    const use = vi.fn();
    const chain = { plugin: vi.fn(() => ({ use })) };
    modify!(chain, { environment: { name: 'web' } });
    expect(chain.plugin).not.toHaveBeenCalled();
    modify!(chain, { environment: { name: 'lynx' } });
    expect(use).toHaveBeenCalledWith(NativeFeaturesPlugin, [expect.anything()]);
  });
});
