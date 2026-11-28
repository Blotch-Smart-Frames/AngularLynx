import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';
import * as ts from 'typescript';
import { isAngularLynxPackageModule, LAYERS } from './layers.js';
import {
  createElementName,
  ESCAPE,
  namedGlobals,
  quotedName,
  scriptKind,
  WEBGL2,
} from './on-demand.js';

/**
 * The file the `lynx` environment writes beside its bundle, which tells
 * `ng build --platform ios|android` (`@blotch/angular-lynx-native`) which of
 * the shells' optional native code the app needs. packages/native reads it
 * under the same name (`NATIVE_FEATURES_FILE` in its `features.ts`). Its
 * name starts with a dot, so the native builder leaves it out of the app
 * when it copies the bundle in.
 */
export const NATIVE_FEATURES_FILE = '.angular-lynx-native.json';

/**
 * What the file holds: `canvas` is whether the app can draw on a canvas,
 * which takes the shells' `<canvas>`, its `AngularLynxWebGL` module (the
 * WebGL2, 2D and `bitmaprenderer` contexts, and the decoding behind `Image`
 * and `createImageBitmap()`), `<video>`'s readable frames and, on iOS,
 * ANGLE. That's about 176 kB of the iOS executable and 6 MB of ANGLE
 * frameworks (issue #837), which an app that never draws leaves out.
 *
 * `webgl` is whether it can draw with the WebGL2 context, the only one
 * that needs ANGLE: an app that draws only in 2D (a chart, a signature pad,
 * an image editor) leaves the context and ANGLE out and keeps the rest
 * (issue #847). It's true only with `canvas`.
 */
export type NativeFeatures = {
  readonly canvas: boolean;
  readonly webgl: boolean;
};

/** What every module that can draw in 3D asks for, and a build can't tell. */
const EVERYTHING: NativeFeatures = { canvas: true, webgl: true };

/**
 * The names that make a module a canvas's user, as an identifier or as a
 * string of only the name (see canvasNamed()):
 *
 * - The 2D context's classes, which bring the runtime's 2D context too
 *   (on-demand.ts).
 * - The canvases made outside a template (`OffscreenCanvas`) and the classes
 *   code checks a canvas or a context against.
 * - `Image` (`HTMLImageElement`), `ImageBitmap` and `createImageBitmap()`,
 *   which the shells' module decodes, and the `bitmaprenderer` context's
 *   class.
 * - The runtime's enable functions, which an app can call itself where it
 *   makes a canvas by a tag, or asks for a context by a name, built at run
 *   time (on-demand.ts): that's then how it asks for the native code too.
 *
 * A module the runtime's canvas comes to (`ɵenableCanvas()`, on-demand.ts)
 * names one of them, or passes `'img'` to `createElement()` (canvasNamed()),
 * so an app with the canvas has its native code, unless all it names is
 * `ImageData`, which is pixels in JavaScript and needs none.
 *
 * `Image` and `HTMLCanvasElement` don't appear in Angular's packages, nor any
 * of the others (native-features.test.ts checks), so they bring nothing into
 * an app that doesn't draw.
 */
const CANVAS_NAMES: ReadonlySet<string> = new Set([
  'CanvasRenderingContext2D',
  'OffscreenCanvasRenderingContext2D',
  'CanvasGradient',
  'CanvasPattern',
  'TextMetrics',
  'Path2D',
  'OffscreenCanvas',
  'HTMLCanvasElement',
  'WebGL2RenderingContext',
  'Image',
  'HTMLImageElement',
  'ImageBitmap',
  'createImageBitmap',
  'ImageBitmapRenderingContext',
  'ɵenableCanvas',
  'ɵenableCanvas2D',
  'ɵenableWebGL2',
]);

/**
 * The names that count only as a string: a context's name (`'2d'`,
 * `'bitmaprenderer'`, as `getContext()` takes it) and the element's
 * (`'canvas'`), which a template compiles to (`ɵɵelementStart(0, 'canvas')`)
 * and `document.createElement('canvas')` takes. As an identifier, `canvas` is
 * a property or a variable of any name's choosing. `'webgl2'` is WEBGL2's, as
 * on-demand.ts reads it.
 */
const CANVAS_STRINGS: ReadonlyMap<string, RegExp> = new Map(
  ['2d', 'bitmaprenderer', 'canvas'].map((name) => [name, quotedName(name)]),
);

/**
 * A string of only one of the names, spelled any way a string can spell it
 * (on-demand.ts's quotedName()).
 */
const QUOTED_NAMES: readonly RegExp[] = [
  ...[...CANVAS_NAMES].map(quotedName),
  ...CANVAS_STRINGS.values(),
];

/**
 * The names that bring the runtime's WebGL2 context, besides `webgl2`
 * (WEBGL2) anywhere: its class, which code checks a context against, and
 * its enable function, which an app calls where it builds the context's name
 * at run time (on-demand.ts). Both are CANVAS_NAMES too, so a module that
 * names one draws on a canvas as well.
 */
const WEBGL_NAMES: ReadonlySet<string> = new Set([
  'WebGL2RenderingContext',
  'ɵenableWebGL2',
]);

const QUOTED_WEBGL_NAMES: readonly RegExp[] = [...WEBGL_NAMES].map(quotedName);

/**
 * Whether `node`, or any node in it, is an identifier or a string of only
 * one of `names` or `strings`.
 */
const namesAny = (
  node: ts.Node,
  names: ReadonlySet<string>,
  strings: ReadonlyMap<string, unknown> = new Map(),
): boolean => {
  if (ts.isIdentifier(node) && names.has(node.text)) return true;
  if (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    (names.has(node.text) || strings.has(node.text))
  ) {
    return true;
  }
  return (
    ts.forEachChild(node, (child) => namesAny(child, names, strings)) ?? false
  );
};

const parse = (code: string, filename: string): ts.SourceFile =>
  ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(filename),
  );

/**
 * Whether a main-thread module can draw on a canvas: it names one of
 * CANVAS_NAMES as an identifier or a string, one of CANVAS_STRINGS as a
 * string, or `webgl2` anywhere, as the runtime's WebGL2 context comes where
 * it does (on-demand.ts), or it makes an image with `createElement('img')`,
 * which the shells' module decodes, as on-demand.ts reads it. AngularLynx's
 * own packages name them all, and would bring the native code into every
 * app, so they don't count.
 *
 * @param code - The module's code.
 * @param filename - The module's path.
 */
export const canvasNamed = (code: string, filename: string): boolean => {
  if (isAngularLynxPackageModule(filename)) return false;
  if (WEBGL2.test(code)) return true;
  // Parsing is the slow part, and most modules name none of them. A string
  // can spell a name in ways a search for it doesn't find: a Unicode or
  // hexadecimal escape (ESCAPE, which an identifier can use too), and an
  // octal or identity escape or a line continuation (`'Im\age'` is
  // `'Image'`), which QUOTED_NAMES looks for. A module with any is parsed.
  if (
    ![...CANVAS_NAMES].some((name) => code.includes(name)) &&
    !QUOTED_NAMES.some((pattern) => pattern.test(code)) &&
    !code.includes('createElement') &&
    !ESCAPE.test(code)
  ) {
    return false;
  }
  return (
    namesAny(parse(code, filename), CANVAS_NAMES, CANVAS_STRINGS) ||
    namedGlobals(code, filename).has(createElementName('img'))
  );
};

/**
 * Whether a main-thread module can draw with the WebGL2 context: it names
 * `webgl2` anywhere, as the runtime's context comes where it does
 * (on-demand.ts), or one of WEBGL_NAMES as an identifier or a string. Every
 * such module is canvasNamed() too. AngularLynx's own packages don't count.
 *
 * @param code - The module's code.
 * @param filename - The module's path.
 */
export const webglNamed = (code: string, filename: string): boolean => {
  if (isAngularLynxPackageModule(filename)) return false;
  if (WEBGL2.test(code)) return true;
  // As in canvasNamed(): only a module whose text can spell a name is parsed.
  if (
    ![...WEBGL_NAMES].some((name) => code.includes(name)) &&
    !QUOTED_WEBGL_NAMES.some((pattern) => pattern.test(code)) &&
    !ESCAPE.test(code)
  ) {
    return false;
  }
  return namesAny(parse(code, filename), WEBGL_NAMES);
};

/** A JavaScript or TypeScript module, which the main thread's transform sees. */
const SCRIPT = /\.[cm]?[jt]sx?$/;

const PLUGIN_NAME = 'lynx:angular:native-features';

/**
 * Keeps, for each main-thread module of the `lynx` environment, whether it
 * draws on a canvas, as angular.ts's transform reports them, and writes what
 * the bundle's modules need into NATIVE_FEATURES_FILE.
 */
export type NativeFeaturesCollector = {
  /**
   * Records one main-thread module's code, as it's bundled. A module
   * transformed again (a watch rebuild) replaces what it said before.
   */
  record(file: string, code: string): void;
  /** What the modules among `files` need. */
  featuresOf(files: Iterable<string>): NativeFeatures;
};

export const createNativeFeaturesCollector = (): NativeFeaturesCollector => {
  const drawing = new Map<string, NativeFeatures>();
  return {
    record(file, code) {
      // A module that names `webgl2` draws on a canvas, whatever else it
      // names: three.js asks for its context by that name alone.
      const webgl = webglNamed(code, file);
      drawing.set(path.normalize(file), {
        canvas: webgl || canvasNamed(code, file),
        webgl,
      });
    },
    featuresOf(files) {
      let canvas = false;
      for (const file of files) {
        const features = drawing.get(path.normalize(file));
        if (features?.webgl) return EVERYTHING;
        canvas ||= features?.canvas ?? false;
      }
      return { canvas, webgl: false };
    },
  };
};

/**
 * A module as rspack's `finishModules` passes it: its file and its layer.
 */
type BundledModule = {
  nameForCondition(): string | null | undefined;
  readonly layer?: string | null;
};

/**
 * Writes NATIVE_FEATURES_FILE for the `lynx` environment: what the bundle's
 * main-thread modules need, from rspack's module graph once it's built
 * (`finishModules`), so a file only reached for its types, or left out of
 * this build, doesn't count.
 *
 * A module rspack takes from its persistent cache isn't transformed again,
 * so the collector never hears about it. With that cache on, the file asks
 * for everything: leaving out code the app needs would leave it with a
 * blank canvas, while keeping code it doesn't only costs size.
 */
export class NativeFeaturesPlugin {
  readonly #collector: NativeFeaturesCollector;

  constructor(collector: NativeFeaturesCollector) {
    this.#collector = collector;
  }

  apply(compiler: Rspack.Compiler): void {
    const cache = compiler.options.cache;
    const persistent =
      typeof cache === 'object' &&
      cache !== null &&
      cache.type === 'persistent';
    let features: NativeFeatures = EVERYTHING;
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      features = EVERYTHING;
      compilation.hooks.finishModules.tap(PLUGIN_NAME, (modules) => {
        if (persistent) return;
        const files: string[] = [];
        for (const module of modules as Iterable<BundledModule>) {
          const file = module.nameForCondition();
          if (
            file &&
            module.layer === LAYERS.MAIN_THREAD &&
            SCRIPT.test(file)
          ) {
            files.push(file);
          }
        }
        features = this.#collector.featuresOf(files);
      });
    });
    // Written beside the bundle once it's out, rather than emitted as an
    // asset: it isn't part of the app, so it stays out of the build's list
    // of file sizes and angular.json's budgets.
    compiler.hooks.afterEmit.tap(PLUGIN_NAME, () => {
      const dir = compiler.outputPath;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, NATIVE_FEATURES_FILE),
        `${JSON.stringify(features, null, 2)}\n`,
      );
    });
  }
}

/**
 * Adds NativeFeaturesPlugin to the `lynx` environment, the one the native
 * builder takes its bundle from. The `web` environment's preview draws with
 * the browser's canvas.
 */
export const applyNativeFeatures = (
  api: Pick<RsbuildPluginAPI, 'modifyBundlerChain'>,
  collector: NativeFeaturesCollector,
): void => {
  api.modifyBundlerChain((chain, { environment }) => {
    if (environment.name !== 'lynx') return;
    chain.plugin(PLUGIN_NAME).use(NativeFeaturesPlugin, [collector]);
  });
};
