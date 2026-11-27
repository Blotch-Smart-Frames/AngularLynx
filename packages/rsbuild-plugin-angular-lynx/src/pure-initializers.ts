import * as ts from 'typescript';
import { findModuleLevelCalls } from './cross-thread-transform.js';
import { isPure, pureConstructions } from './pure-classes.js';
import { applyEdits, type Edit } from './source-map-edits.js';

/**
 * The runtime's names whose module-level calls register something on the
 * background thread (see cross-thread-transform.ts). A declaration that makes
 * one is kept whether or not anything reads it. By name, for the runtime's own
 * modules, which define them rather than import them; the calls of another
 * package that imports them, under any name, are found as the cross-thread
 * transform finds them.
 */
const CROSS_THREAD_NAMES =
  /\b(?:backgroundFn|createMainThreadRef|MainThreadRef)\b/;

/**
 * Wraps each top-level variable's initializer in a pure IIFE, for the
 * background layer's copy of AngularLynx's own packages, so a bundler can drop
 * the variables nothing uses.
 *
 * The background thread runs none of the runtime but its bridges (see
 * background-entry.ts), so nearly all of its module-level values go unused
 * there. The minifier drops an unused one only when its initializer can't do
 * anything, and it can't tell that of a property read or a method call:
 * `const colorSchemePreference = preference.asReadonly()` kept Angular's
 * signals in the background bundle, `const UNPACK_FLIP_Y_WEBGL =
 * GL.UNPACK_FLIP_Y_WEBGL` kept the WebGL constants, and
 * `new Set(TEXT_TAGS.filter(…))` the HTML tag tables (issue #710). Angular's
 * own build makes the same assumption of a `"sideEffects": false` package's
 * top-level calls, which it marks pure: a value made at module level is there
 * to be read. The runtime's side-effects test keeps the statements that do
 * something on purpose out of variable declarations.
 *
 * An initializer that's pure already (see pure-classes.ts) isn't wrapped:
 * the minifier inlines such a small IIFE and then keeps what it held. Its
 * collections get `/*#__PURE__*\/` on each `new` instead, because the
 * minifier doesn't know that a built-in constructor does nothing else: with
 * its constant gone, `typeof FinalizationRegistry === 'function' ? new
 * FinalizationRegistry(releaseImage) : null` stayed in the background script
 * as a statement, and with `releaseImage` the WebGL bridge's loader (issue
 * #764).
 *
 * Left alone: a destructuring (which reads its properties as it binds them),
 * one with `await` or `yield` (which can't move into a function), and one
 * that makes a cross-thread value.
 *
 * @param code - The module's code.
 * @param filename - The module's path, for the parser.
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const wrapPureInitializers = (
  code: string,
  filename: string,
): string => {
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const crossThreadCalls = findModuleLevelCalls(code, filename);
  const makesCrossThreadValue = (value: ts.Expression): boolean =>
    CROSS_THREAD_NAMES.test(value.getText(sourceFile)) ||
    crossThreadCalls.some(
      (call) => call.pos >= value.pos && call.end <= value.end,
    );
  const edits: Edit[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer;
      if (
        !value ||
        !ts.isIdentifier(declaration.name) ||
        suspends(value) ||
        makesCrossThreadValue(value)
      ) {
        continue;
      }
      if (isPure(value)) {
        for (const construction of pureConstructions(value)) {
          if (!isAnnotatedPure(construction, code, sourceFile)) {
            const start = construction.getStart(sourceFile);
            edits.push({ start, end: start, text: '/*#__PURE__*/ ' });
          }
        }
        continue;
      }
      if (isMarkedPure(value, code, sourceFile)) {
        continue;
      }
      const start = value.getStart(sourceFile);
      edits.push(
        { start, end: start, text: '/*#__PURE__*/ (() => (' },
        { start: value.end, end: value.end, text: '))()' },
      );
    }
  }
  if (edits.length === 0) {
    return code;
  }
  // Edits never share a start.
  return applyEdits(code, edits);
};

/**
 * Whether the initializer is a call or `new` annotated pure, as Angular's
 * build and the pure-class pass leave them, whose arguments are pure: the
 * minifier drops such a call, but evaluates its arguments anyway.
 */
const isMarkedPure = (
  node: ts.Expression,
  code: string,
  sourceFile: ts.SourceFile,
): boolean => {
  const annotated = isAnnotatedPure(node, code, sourceFile);
  if (ts.isParenthesizedExpression(node)) {
    return annotated || isMarkedPure(node.expression, code, sourceFile);
  }
  return (
    annotated &&
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    (node.arguments ?? []).every(isPure)
  );
};

/**
 * Whether a `@__PURE__` or `#__PURE__` comment comes right before the node.
 */
const isAnnotatedPure = (
  node: ts.Node,
  code: string,
  sourceFile: ts.SourceFile,
): boolean =>
  /[@#]__PURE__/.test(
    code.slice(node.getFullStart(), node.getStart(sourceFile)),
  );

/**
 * Whether the expression awaits or yields outside any function of its own.
 */
const suspends = (node: ts.Node): boolean => {
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return true;
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
  return ts.forEachChild(node, suspends) ?? false;
};
