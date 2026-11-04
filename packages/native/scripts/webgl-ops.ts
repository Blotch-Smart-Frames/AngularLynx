/**
 * Writes the WebGL bridge's opcodes into the shells, from the runtime's
 * `webgl-ops.ts`, the one list of them: `<canvas>`'s context records its GL
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

/** The `name: number` entries of the runtime's OP object, in order. */
export const parseOps = (source: string): [string, number][] => {
  const body = source.slice(source.indexOf('export const OP = {'));
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

const header = (comment: string): string =>
  `${comment} Generated from packages/runtime/src/lib/canvas/webgl-ops.ts by
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ops = parseOps(readFileSync(OPS_SOURCE, 'utf8'));
  writeFileSync(IOS_OPS, renderIosOps(ops));
  writeFileSync(ANDROID_OPS, renderAndroidOps(ops));
  console.log(`Wrote ${ops.length} opcodes to the iOS and Android shells.`);
}
