import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The file the build plugin writes beside the Lynx bundle
 * (`@blotch/rsbuild-plugin-angular-lynx`'s native-features.ts, under the
 * same name): which of the shells' optional native code the app needs, from
 * what its main-thread modules name. The leading dot keeps copyBundle from
 * copying it into the app.
 */
export const NATIVE_FEATURES_FILE = '.angular-lynx-native.json';

/**
 * The shells' optional native code. `canvas` is `<canvas>` and its
 * `AngularLynxWebGL` module (the WebGL2, 2D and `bitmaprenderer` contexts,
 * and the decoding behind `Image` and `createImageBitmap()`), `<video>`'s
 * frames a canvas reads, and on iOS ANGLE, which WebGL draws with. Without
 * it, an app's iOS executable is about 176 kB smaller and it embeds no ANGLE
 * frameworks, about 6 MB (issue #837).
 *
 * `webgl` is the part of it only the WebGL2 context uses: the context itself
 * (`AngularLynxWebGLContext.m`, `WebGLContext.kt`), its command numbers and,
 * on iOS, ANGLE. An app that draws only in 2D (a chart, a signature pad, an
 * image editor) keeps the canvas without it, since the 2D context draws with
 * Core Graphics and `android.graphics.Canvas` (issue #847). It's never true
 * without `canvas`.
 */
export type NativeFeatures = {
  readonly canvas: boolean;
  readonly webgl: boolean;
};

/** Everything: what an app gets when nothing says what it needs. */
export const ALL_NATIVE_FEATURES: NativeFeatures = {
  canvas: true,
  webgl: true,
};

/**
 * What the bundle in `bundleDir` needs, from NATIVE_FEATURES_FILE.
 *
 * Everything when there's no bundle (`ng serve --platform`'s development
 * app, which loads its bundle from the dev server and gets every edit, so a
 * canvas added while it runs has to draw), or no file or one this version
 * can't read (a bundle from an older plugin or another build): leaving out
 * code the app uses would leave it a blank canvas, while keeping what it
 * doesn't use only costs size. For the same reason a file with
 * `"canvas": true` and no `webgl`, from a plugin before #847, keeps WebGL.
 *
 * @param bundleDir - The rspeedy output folder, or undefined for the
 *   development app.
 */
export const readNativeFeatures = (
  bundleDir: string | undefined,
): NativeFeatures => {
  if (!bundleDir) return ALL_NATIVE_FEATURES;
  const file = path.join(bundleDir, NATIVE_FEATURES_FILE);
  if (!existsSync(file)) return ALL_NATIVE_FEATURES;
  try {
    const features: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof features === 'object' && features !== null) {
      const { canvas, webgl } = features as {
        canvas?: unknown;
        webgl?: unknown;
      };
      if (canvas === false) return { canvas: false, webgl: false };
      if (canvas === true && webgl === false) {
        return { canvas: true, webgl: false };
      }
    }
  } catch {
    // An unreadable file says nothing, so the app gets everything.
  }
  return ALL_NATIVE_FEATURES;
};

/**
 * Deletes `files` (relative to `dir`), each of which must be in the
 * template: a renamed file would otherwise stay in every app unnoticed.
 */
export const removeTemplateFiles = (
  dir: string,
  files: readonly string[],
): void => {
  for (const file of files) {
    const absolute = path.join(dir, file);
    if (!existsSync(absolute)) {
      throw new Error(`The template has no ${file} to leave out.`);
    }
    rmSync(absolute);
  }
};

/**
 * Takes out of a source file the lines between `// angular-lynx:<name>` and
 * `// /angular-lynx:<name>`, the markers with them, wherever they are. The
 * templates mark the few lines that use optional code, so the project still
 * builds once it's gone.
 */
export const removeMarkedLines = (file: string, name: string): void => {
  const lines = readFileSync(file, 'utf8').split('\n');
  const open = `// angular-lynx:${name}`;
  const close = `// /angular-lynx:${name}`;
  const kept: string[] = [];
  let inside = false;
  let blocks = 0;
  for (const line of lines) {
    const marker = line.trim();
    if (marker === open && !inside) {
      inside = true;
      blocks++;
    } else if (marker === close && inside) {
      inside = false;
    } else if (!inside) {
      kept.push(line);
    }
  }
  if (inside || blocks === 0) {
    throw new Error(
      `${file} has no complete ${open} … ${close} block to take out.`,
    );
  }
  writeFileSync(file, kept.join('\n'));
};
