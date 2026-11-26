/**
 * Writes the WebGL bridge's opcodes into the shells, from the runtime's
 * `webgl-ops.ts`, the one list of them, and the 2D context's from its
 * `canvas-2d-ops.ts`: `<canvas>`'s context records its GL
 * calls as these numbers (packages/runtime/src/lib/canvas), and each shell's
 * `AngularLynxWebGL` module reads them back. The two sides ship in different
 * packages of the same version, so they must agree; webgl-ops.test.ts fails
 * when the checked-in files are stale.
 *
 * Run with `npm run generate:webgl-ops -w packages/native`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const OPS_SOURCE = join(root, '../runtime/src/lib/canvas/webgl-ops.ts');
export const IOS_OPS = join(root, 'templates/ios/App/AngularLynxWebGLOps.h');
export const ANDROID_OPS = join(
  root,
  'templates/android/app/src/main/java/dev/angularlynx/shell/WebGLOps.kt',
);

export const CANVAS_2D_OPS_SOURCE = join(
  root,
  '../runtime/src/lib/canvas/canvas-2d-ops.ts',
);
export const IOS_CANVAS_2D_OPS = join(
  root,
  'templates/ios/App/AngularLynxCanvas2DOps.h',
);
export const ANDROID_CANVAS_2D_OPS = join(
  root,
  'templates/android/app/src/main/java/dev/angularlynx/shell/Canvas2DOps.kt',
);

/** The `name: number` entries of one of the runtime's op objects, in order. */
export const parseOps = (source: string, name = 'OP'): [string, number][] => {
  const start = source.indexOf(`export const ${name} = {`);
  const body = source.slice(start, source.indexOf('\n}', start));
  const ops: [string, number][] = [];
  for (const match of body.matchAll(/^ {2}(\w+): (\d+),$/gm)) {
    ops.push([match[1], Number(match[2])]);
  }
  return ops;
};

const pascal = (name: string): string =>
  name.charAt(0).toUpperCase() + name.slice(1);

const screaming = (name: string): string =>
  name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

const header = (comment: string, file = 'webgl-ops.ts'): string =>
  `${comment} Generated from packages/runtime/src/lib/canvas/${file} by
${comment} packages/native/scripts/webgl-ops.ts: run \`npm run generate:webgl-ops -w
${comment} packages/native\` rather than editing it.
`;

export const renderIosOps = (ops: [string, number][]): string =>
  `${header('//')}
#import <Foundation/Foundation.h>

/// The commands of the WebGL bridge, as \`<canvas>\`'s context in the runtime
/// records them: below 200 they return nothing, from 200 each answers one
/// query.
typedef NS_ENUM(NSInteger, ALWebGLOp) {
${ops.map(([name, value]) => `  ALWebGLOp${pascal(name)} = ${value},`).join('\n')}
};
`;

export const renderAndroidOps = (ops: [string, number][]): string =>
  `${header('//')}
package dev.angularlynx.shell

/**
 * The commands of the WebGL bridge, as \`<canvas>\`'s context in the runtime
 * records them: below 200 they return nothing, from 200 each answers one
 * query.
 */
internal object WebGLOps {
${ops.map(([name, value]) => `    const val ${screaming(name)} = ${value}`).join('\n')}
}
`;

/**
 * The 2D context's commands (canvas-2d-ops.ts), and the path segments its
 * paths cross the bridge as.
 */
export const renderIosCanvas2DOps = (
  ops: [string, number][],
  pathOps: [string, number][],
): string =>
  `${header('//', 'canvas-2d-ops.ts')}
#import <Foundation/Foundation.h>

/// The commands of the 2D context's bridge, as \`<canvas>\`'s 2D context in
/// the runtime records them: below 200 they return nothing, from 200 each
/// answers one query.
typedef NS_ENUM(NSInteger, ALCanvas2DOp) {
${ops.map(([name, value]) => `  ALCanvas2DOp${pascal(name)} = ${value},`).join('\n')}
};

/// The segments of a path, each followed by its points.
typedef NS_ENUM(NSInteger, ALCanvas2DPathOp) {
${pathOps.map(([name, value]) => `  ALCanvas2DPathOp${pascal(name)} = ${value},`).join('\n')}
};
`;

export const renderAndroidCanvas2DOps = (
  ops: [string, number][],
  pathOps: [string, number][],
): string =>
  `${header('//', 'canvas-2d-ops.ts')}
package dev.angularlynx.shell

/**
 * The commands of the 2D context's bridge, as \`<canvas>\`'s 2D context in
 * the runtime records them: below 200 they return nothing, from 200 each
 * answers one query.
 */
internal object Canvas2DOps {
${ops.map(([name, value]) => `    const val ${screaming(name)} = ${value}`).join('\n')}
}

/** The segments of a path, each followed by its points. */
internal object Canvas2DPathOps {
${pathOps.map(([name, value]) => `    const val ${screaming(name)} = ${value}`).join('\n')}
}
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ops = parseOps(readFileSync(OPS_SOURCE, 'utf8'));
  writeFileSync(IOS_OPS, renderIosOps(ops));
  writeFileSync(ANDROID_OPS, renderAndroidOps(ops));
  const canvas2D = readFileSync(CANVAS_2D_OPS_SOURCE, 'utf8');
  const ops2D = parseOps(canvas2D);
  const pathOps = parseOps(canvas2D, 'PATH_OP');
  writeFileSync(IOS_CANVAS_2D_OPS, renderIosCanvas2DOps(ops2D, pathOps));
  writeFileSync(
    ANDROID_CANVAS_2D_OPS,
    renderAndroidCanvas2DOps(ops2D, pathOps),
  );
  console.log(
    `Wrote ${ops.length} WebGL and ${ops2D.length} 2D opcodes to the iOS and Android shells.`,
  );
}
