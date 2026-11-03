import type { Compilation, Compiler } from '@rspack/core';
import * as ts from 'typescript';

/**
 * What a zero BigInt literal becomes: the same value, made when the code runs
 * rather than stored in the bytecode.
 */
const ZERO_BIGINT_CALL = 'BigInt(0)';

/**
 * Text that may be a zero BigInt literal (`0n`, `0x0n`, `0b0_0n`...). It only
 * spares the parse when there's none: strings, comments and regular
 * expressions match it too, and the parse tells them apart.
 */
const MAYBE_ZERO_BIGINT = /(?<![\w$.])0(?:[xXoObB][0_]+)?n(?![\w$])/;

/**
 * Finds the zero BigInt literals in a script, such as Firebase Firestore's
 * `e >= 0n`, which the main thread can't load.
 *
 * Lynx compiles the main thread's script to PrimJS bytecode at build time,
 * and PrimJS writes a zero BigInt constant with a length of 0 bytes. Reading
 * it back, it subtracts one from that length in unsigned arithmetic
 * (`JS_ReadBigInt` in quickjs.cc), so it asks for half a billion limbs and
 * fails with "BigInt is too large to allocate". The whole bundle fails to load ("Decode error: Context
 * construct failed"), on iOS and Android alike, so the app stays blank. Every
 * other BigInt constant, small, large or negative, loads fine, and so does a
 * zero BigInt made at run time; the background thread isn't compiled ahead,
 * so its literals load too.
 *
 * A literal used as a property name (`{ 0n: x }`) is left alone: it names the
 * property `"0"` when the script is compiled, so no BigInt is stored, and
 * `BigInt(0)` isn't a property name.
 *
 * @param code - The script, as JavaScript.
 * @returns The literals' `[start, end)` offsets in `code`, in order.
 */
export const findZeroBigIntLiterals = (
  code: string,
): Array<{ start: number; end: number }> => {
  if (!MAYBE_ZERO_BIGINT.test(code)) {
    return [];
  }
  const sourceFile = ts.createSourceFile(
    'main-thread.js',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const literals: Array<{ start: number; end: number }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBigIntLiteral(node) &&
      isZero(node.getText(sourceFile)) &&
      !isPropertyName(node)
    ) {
      literals.push({ start: node.getStart(sourceFile), end: node.end });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
};

/**
 * Whether a BigInt literal's source (`0x0_0n`) is zero. `BigInt()` reads
 * every radix prefix, but not the separators or the `n`.
 */
const isZero = (literal: string): boolean =>
  BigInt(literal.slice(0, -1).replaceAll('_', '')) === 0n;

const isPropertyName = (node: ts.Node): boolean => {
  const parent = node.parent as Partial<
    Record<'name' | 'propertyName', ts.Node>
  >;
  return parent.name === node || parent.propertyName === node;
};

/**
 * Rewrites each zero BigInt literal in the main thread's scripts into
 * `BigInt(0)`, so the bundle loads on a device (see
 * {@link findZeroBigIntLiterals}). It covers everything in those scripts,
 * packages included, since it works on the emitted files.
 *
 * It runs before minification, so source maps follow the rewrite; the
 * minifier keeps `BigInt(0)` as it is. The scripts are the ones
 * AngularWebpackPlugin marks as `lynx:main-thread`, at an earlier stage. Only
 * the native bundle needs it: on the web, the main thread's script runs as
 * plain JavaScript.
 */
export class ZeroBigIntLiteralsPlugin {
  apply(compiler: Compiler): void {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap(
      ZeroBigIntLiteralsPlugin.name,
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: ZeroBigIntLiteralsPlugin.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY,
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (asset.info['lynx:main-thread'] !== true) {
                continue;
              }
              const literals = findZeroBigIntLiterals(
                asset.source.source().toString(),
              );
              if (literals.length === 0) {
                continue;
              }
              compilation.updateAsset(asset.name, (old) => {
                const source = new sources.ReplaceSource(old);
                for (const { start, end } of literals) {
                  // ReplaceSource's end is inclusive.
                  source.replace(start, end - 1, ZERO_BIGINT_CALL);
                }
                return source;
              });
            }
          },
        );
      },
    );
  }
}
