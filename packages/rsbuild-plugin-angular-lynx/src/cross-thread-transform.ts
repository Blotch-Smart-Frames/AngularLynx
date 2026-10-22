import { createHash } from 'node:crypto';
import path from 'node:path';
import * as ts from 'typescript';

const RUNTIME_MODULE = '@blotch/angular-lynx';

/** Runtime functions whose module-level calls get an ID argument. */
const TAGGED_CALLS = new Set(['backgroundFn', 'createMainThreadRef']);
/** Runtime classes whose module-level `new` expressions get an ID argument. */
const TAGGED_CLASSES = new Set(['MainThreadRef']);

const MIRROR_IMPORT = '__ɵmirrorImport';
const REGISTER_MIRRORED_IMPORT = '__ɵregisterMirroredImport';

export type CrossThreadTransformOptions = {
  /** The directory the file keys are relative to, the same for both bundles. */
  root: string;
  /**
   * Whether to rewrite `import()` so the background thread loads each lazy
   * chunk the main thread loads. Only for the app's own files: a library's
   * lazy chunk, such as the runtime's web-only glass renderer, can't run on
   * the background thread.
   */
  mirrorImports: boolean;
};

type Edit = { start: number; end: number; text: string };

/**
 * Prepares a module for running on both threads. Angular runs on the main
 * thread only, but the background thread runs every module too, for the
 * functions that main-thread code calls there. Two things tie a module's two
 * copies together, and this transform sets both up:
 *
 * - **IDs.** `backgroundFn(fn)`, `createMainThreadRef(value)` and
 *   `new MainThreadRef(value)` at module level get one more argument: an ID
 *   from the file and the call's position, such as `'3f9a1c2b7d:0'`. The main
 *   thread sends a handle or ref across by this ID, and the other thread finds
 *   its own copy by it. The runtime's fallback is a counter, which only matches
 *   if both threads run the same calls in the same order. They don't: the
 *   main thread loads a lazy chunk before the background thread does, and
 *   Angular code (which also creates refs) runs on the main thread only.
 *   Calls inside a function or class are left alone, since one call site can
 *   run any number of times there.
 *
 * - **Lazy chunks** (`mirrorImports`). Only the main thread's router and
 *   `@defer` blocks run `import()`, so `import('./x')` becomes
 *   `__ɵmirrorImport(key, () => import('./x'))`, which also tells the
 *   background thread to load the chunk, and the module ends by registering
 *   the same loader there. See mirrored-imports.ts in the runtime. Only a
 *   string specifier is rewritten: a computed one may depend on local
 *   variables, which the registration can't see.
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
  const mightTag =
    code.includes(RUNTIME_MODULE) &&
    (code.includes('backgroundFn') || code.includes('MainThreadRef'));
  const mightMirror = options.mirrorImports && code.includes('import(');
  if (!mightTag && !mightMirror) {
    return code;
  }

  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const runtime = runtimeBindings(sourceFile);
  const fileKey = keyForFile(filename, options.root);
  let nextIndex = 0;
  const nextId = (): string => `${fileKey}:${nextIndex++}`;

  const edits: Edit[] = [];
  const registrations: string[] = [];

  /**
   * Inserts the ID after the call's arguments, or after an `undefined` first
   * argument when there are none (`new MainThreadRef()`).
   */
  const tag = (node: ts.CallExpression | ts.NewExpression): void => {
    const args = node.arguments ?? ts.factory.createNodeArray();
    // A spread could fill the ID's parameter itself.
    if (args.length > 1 || args.some(ts.isSpreadElement)) return;
    const id = JSON.stringify(nextId());
    if (args.length === 1) {
      edits.push({ start: args[0].end, end: args[0].end, text: `, ${id}` });
      return;
    }
    // `new MainThreadRef` without parentheses has nowhere to insert into.
    const close = node.getEnd() - 1;
    if (code[close] !== ')') return;
    edits.push({ start: close, end: close, text: `undefined, ${id}` });
  };

  const visit = (node: ts.Node, topLevel: boolean): void => {
    if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        options.mirrorImports &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const key = JSON.stringify(nextId());
        const load = `() => ${node.getText(sourceFile)}`;
        edits.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: `${MIRROR_IMPORT}(${key}, ${load})`,
        });
        registrations.push(`${REGISTER_MIRRORED_IMPORT}(${key}, ${load});`);
        // An import's own arguments hold nothing to rewrite.
        return;
      }
      if (
        topLevel &&
        isRuntimeReference(node.expression, runtime, TAGGED_CALLS)
      ) {
        tag(node);
      }
    } else if (
      ts.isNewExpression(node) &&
      topLevel &&
      isRuntimeReference(node.expression, runtime, TAGGED_CLASSES)
    ) {
      tag(node);
    }
    const childTopLevel =
      topLevel && !ts.isFunctionLike(node) && !ts.isClassLike(node);
    ts.forEachChild(node, (child) => visit(child, childTopLevel));
  };
  visit(sourceFile, true);

  if (edits.length === 0) {
    return code;
  }

  // Apply from the end so earlier offsets stay valid. Edits never overlap: an
  // ID goes after a call's arguments, and an import's replacement ends no later
  // than the argument it's in.
  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const { start, end, text } of edits) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  if (registrations.length > 0) {
    // After the module's own code, so a nested function's import registers
    // only once the module has run. On the main thread the runtime ignores it.
    result =
      `import { ɵmirrorImport as ${MIRROR_IMPORT}, ɵregisterMirroredImport as ${REGISTER_MIRRORED_IMPORT} } from '${RUNTIME_MODULE}';\n` +
      result +
      `\n;${registrations.join('\n')}\n`;
  }
  return result;
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
