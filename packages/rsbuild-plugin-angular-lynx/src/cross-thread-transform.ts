import { createHash } from 'node:crypto';
import path from 'node:path';
import * as ts from 'typescript';

const RUNTIME_MODULE = '@blotch/angular-lynx';

/** Runtime functions whose module-level calls get an ID argument. */
const TAGGED_CALLS = new Set(['backgroundFn', 'createMainThreadRef']);
/** Runtime classes whose module-level `new` expressions get an ID argument. */
const TAGGED_CLASSES = new Set(['MainThreadRef']);

export type CrossThreadTransformOptions = {
  /** The directory the file keys are relative to, the same for both bundles. */
  root: string;
};

type Edit = { start: number; end: number; text: string };

/**
 * Gives each module-level `backgroundFn(fn)`, `createMainThreadRef(value)` and
 * `new MainThreadRef(value)` one more argument: an ID from the file and the
 * call's position, such as `'3f9a1c2b7d:0'`.
 *
 * Angular runs on the main thread only, but the background thread runs the
 * modules that make these calls too (see background-entry.ts), for the
 * functions that main-thread code calls there. The main thread sends a handle
 * or ref across by this ID, and the other thread finds its own copy by it.
 * The runtime's fallback is a counter, which only matches if both threads run
 * the same calls in the same order. They don't: the background thread runs
 * only some of the app's modules, and in a different order, and Angular code
 * (which also creates refs) runs on the main thread only.
 *
 * Calls inside a function or class are left alone, since one call site can run
 * any number of times there.
 *
 * @param code - The module's JavaScript.
 * @param filename - The module's path.
 * @param options - See {@link CrossThreadTransformOptions}.
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const transformCrossThread = (
  code: string,
  filename: string,
  options: CrossThreadTransformOptions,
): string => {
  const calls = findModuleLevelCalls(code, filename);
  if (calls.length === 0) {
    return code;
  }

  const fileKey = keyForFile(filename, options.root);
  const edits: Edit[] = [];
  // Numbered in source order, so both bundles give a call the same ID.
  calls.forEach((node, index) => {
    const edit = tagEdit(node, JSON.stringify(`${fileKey}:${index}`), code);
    if (edit) edits.push(edit);
  });

  // Apply from the end so earlier offsets stay valid. Edits never overlap:
  // each goes after one call's arguments.
  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const { start, end, text } of edits) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return result;
};

/**
 * Whether the module calls `backgroundFn()`, `createMainThreadRef()` or
 * `new MainThreadRef()` at module level, so the background thread has to run
 * it too. These are the calls {@link transformCrossThread} tags.
 *
 * @param code - The module's JavaScript.
 * @param filename - The module's path.
 * @returns `true` when the module defines a value the main thread can send
 *   across by ID.
 */
export const definesCrossThreadValues = (
  code: string,
  filename: string,
): boolean => findModuleLevelCalls(code, filename).length > 0;

/**
 * The module-level calls of the runtime's tagged functions and classes, in
 * source order.
 */
const findModuleLevelCalls = (
  code: string,
  filename: string,
): Array<ts.CallExpression | ts.NewExpression> => {
  if (
    !code.includes(RUNTIME_MODULE) ||
    (!code.includes('backgroundFn') && !code.includes('MainThreadRef'))
  ) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const runtime = runtimeBindings(sourceFile);
  const calls: Array<ts.CallExpression | ts.NewExpression> = [];

  const visit = (node: ts.Node, topLevel: boolean): void => {
    if (
      topLevel &&
      ((ts.isCallExpression(node) &&
        isRuntimeReference(node.expression, runtime, TAGGED_CALLS)) ||
        (ts.isNewExpression(node) &&
          isRuntimeReference(node.expression, runtime, TAGGED_CLASSES)))
    ) {
      calls.push(node);
    }
    const childTopLevel =
      topLevel && !ts.isFunctionLike(node) && !ts.isClassLike(node);
    ts.forEachChild(node, (child) => visit(child, childTopLevel));
  };
  visit(sourceFile, true);
  return calls;
};

/**
 * The edit that inserts `id` after the call's arguments, or after an
 * `undefined` first argument when there are none (`new MainThreadRef()`).
 * `undefined` when the call can't take one.
 */
const tagEdit = (
  node: ts.CallExpression | ts.NewExpression,
  id: string,
  code: string,
): Edit | undefined => {
  const args = node.arguments ?? ts.factory.createNodeArray();
  // A second argument is already an ID, and a spread could fill the ID's
  // parameter itself.
  if (args.length > 1 || args.some(ts.isSpreadElement)) return undefined;
  if (args.length === 1) {
    return { start: args[0].end, end: args[0].end, text: `, ${id}` };
  }
  // `new MainThreadRef` without parentheses has nowhere to insert into.
  const close = node.getEnd() - 1;
  if (code[close] !== ')') return undefined;
  return { start: close, end: close, text: `undefined, ${id}` };
};

/**
 * The names the module imports the runtime's exports under: named imports by
 * local name, and namespace imports (`import * as lynx from …`).
 */
type RuntimeBindings = {
  named: Map<string, string>;
  namespaces: Set<string>;
};

const runtimeBindings = (sourceFile: ts.SourceFile): RuntimeBindings => {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== RUNTIME_MODULE
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      named.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return { named, namespaces };
};

/**
 * Whether `expression` is one of `exports`, imported from the runtime under any
 * local name or reached through a namespace import.
 */
const isRuntimeReference = (
  expression: ts.Expression,
  runtime: RuntimeBindings,
  exports: Set<string>,
): boolean => {
  if (ts.isIdentifier(expression)) {
    const imported = runtime.named.get(expression.text);
    return imported !== undefined && exports.has(imported);
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    runtime.namespaces.has(expression.expression.text) &&
    exports.has(expression.name.text)
  );
};

/**
 * A short hash of the file's path from `root`, in POSIX form so a Windows
 * build gives the same keys.
 */
const keyForFile = (filename: string, root: string): string => {
  const relative = path.relative(root, filename).split(path.sep).join('/');
  return createHash('sha1').update(relative).digest('hex').slice(0, 10);
};
