import * as ts from 'typescript';
import { THIRD_PARTY } from './layers.js';
import { applyEdits, type Edit } from './source-map-edits.js';

/**
 * Whether a build compiles the main thread's `import()`s as static imports
 * (see {@link importEagerly}): the plugin's own option wins, as
 * `backgroundTreeShaking`'s does, since a plain rspeedy app has no Angular
 * CLI build options to set it in. Otherwise angular.json's `eagerImports`
 * build option, which the builder's schema has already checked, and off
 * without either.
 *
 * @param option - The plugin's `eagerImports` option.
 * @param buildOptions - The Angular CLI's build options, under `ng build` or
 *   `ng serve`.
 * @returns Whether to compile them as static imports.
 */
export const resolveEagerImports = (
  option: boolean | undefined,
  buildOptions: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  const value = option ?? buildOptions?.['eagerImports'] ?? false;
  if (typeof value !== 'boolean') {
    // A plain rspeedy app's lynx.config.ts may be JavaScript, which nothing
    // type-checks. A string such as 'false' read as on would be a surprise.
    throw new Error(
      `pluginAngularLynx(): eagerImports must be true or false, not ${JSON.stringify(value)}.`,
    );
  }
  return value;
};

/**
 * A call `import(` anywhere: a module without one has nothing to compile, so
 * it isn't parsed. It matches more than that (a comment, a string), never
 * less.
 */
const IMPORT_HINT = /\bimport\s*\(/;

/**
 * What Angular names the functions that load a `@defer` block's
 * dependencies: `<Component>_Defer_<slot>_DepsFn` for each block, and
 * `<Component>_DeferFn` for all of a component's blocks under local
 * compilation (`resolveDeferDepsFns` and `compileComponentFromMetadata` in
 * `@angular/compiler`).
 */
const DEFER_DEPS_FUNCTION = /(?:_Defer_\d+_DepsFn|_DeferFn)$/;

/** The runtime call that holds a `@defer` block's imports for TestBed. */
const SET_CLASS_METADATA_ASYNC = /(?:^|\.)ɵsetClassMetadataAsync$/;

/**
 * Whether `node` is inside what loads a `@defer` block's dependencies, whose
 * `import()`s stay as they are: the block's whole point is to load its
 * dependencies when it's shown.
 */
const inDeferLoader = (node: ts.Node): boolean => {
  for (let at = node.parent; at; at = at.parent) {
    if (
      (ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at)) &&
      at.name &&
      ts.isIdentifier(at.name) &&
      DEFER_DEPS_FUNCTION.test(at.name.text)
    ) {
      return true;
    }
    if (
      ts.isCallExpression(at) &&
      SET_CLASS_METADATA_ASYNC.test(at.expression.getText())
    ) {
      return true;
    }
  }
  return false;
};

/**
 * A comment before the specifier that tells rspack to leave the `import()`
 * to the engine (`/* webpackIgnore: true *\/`): its module isn't the
 * bundle's to load.
 */
const IGNORED = /\bwebpackIgnore\s*:\s*true\b/;

/**
 * Compiles each `import('<specifier>')` in the app's own main-thread modules
 * as a static import of the module, which the call then resolves to:
 *
 * ```js
 * loadComponent: () => import('./screens/tabs').then((m) => m.Tabs),
 * // becomes
 * import * as __eagerImport0 from './screens/tabs';
 * loadComponent: () => (async () => __eagerImport0)().then((m) => m.Tabs),
 * ```
 *
 * Without `experimental_isLazyBundle`, a lazy route is in the main thread's
 * script already (`asyncChunks: false`, see split-chunks.ts): the
 * `import()` only puts off running its module. But rspack can't concatenate
 * a module loaded with `import()` into the one importing it, and then every
 * module it shares with the rest of the app has importers in two places, so
 * it can't be concatenated into either: Angular's packages, rxjs, the
 * runtime and the app's shared files each stay a module of their own,
 * joined by export getters and `require` calls (issue #944). In the
 * benchmark app that's 24 kB of its 635 kB main-thread script, which PrimJS
 * reads whole as it loads (#707). Static imports let rspack concatenate
 * nearly all of it.
 *
 * The cost, and why it's opt-in: each module an `import()` loaded now runs
 * when the app starts, before the module importing it, as a static import
 * does. Its top-level code runs at launch even when the route is never
 * shown, and an import cycle through it (a screen importing the routes file
 * that lazily loads it) can make a top-level read of the other's export a
 * used-before-defined error, where the `import()` broke the cycle.
 *
 * Left as they are:
 *
 * - `@defer` blocks' imports (see {@link inDeferLoader}), and any inside
 *   `ɵsetClassMetadataAsync()`.
 * - An `import()` whose specifier isn't a string literal, or that has
 *   options (`import(x, { with })`), which a static import can't express.
 * - One a comment tells the bundler to ignore (see {@link IGNORED}).
 * - Other packages' (THIRD_PARTY): a package's `import()` loads what it
 *   doesn't always need, and its authors didn't opt in.
 *
 * The call still returns a promise of the module's namespace object, after
 * the module has run, as an `import()` does. Edits never add or remove a
 * line, so source maps keep their lines, as for the passes before it.
 *
 * @param code - The module's code.
 * @param filename - The module's path.
 * @returns The rewritten code, or `code` itself when nothing applies.
 */
export const importEagerly = (code: string, filename: string): string => {
  if (THIRD_PARTY.test(filename) || !IMPORT_HINT.test(code)) {
    return code;
  }
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: Array<{ call: ts.CallExpression; specifier: string }> = [];
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      names.push(node.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      !IGNORED.test(
        code.slice(node.expression.end, node.arguments[0]!.getStart()),
      ) &&
      !inDeferLoader(node)
    ) {
      calls.push({ call: node, specifier: node.arguments[0]!.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (calls.length === 0) {
    return code;
  }
  // A name nothing in the module uses, so it can't take another's place:
  // one its identifiers don't start with, read as they're parsed, so a name
  // written with escapes (`__eagerImport0`) counts too.
  let prefix = '__eagerImport';
  while (names.some((name) => name.startsWith(prefix))) {
    prefix = `_${prefix}`;
  }
  // One namespace import for each module, however many calls load it.
  const bindings = new Map<string, string>();
  const edits: Edit[] = [];
  for (const { call, specifier } of calls) {
    let binding = bindings.get(specifier);
    if (binding === undefined) {
      binding = `${prefix}${bindings.size}`;
      bindings.set(specifier, binding);
    }
    // An async arrow function that returns the namespace: like import(), it
    // makes the engine's own promise whatever `Promise` names where the call
    // is (`function load(Promise) { return import('./a'); }`), and resolves
    // it with the namespace, which is a thenable to both when the module
    // exports `then`. The line breaks the call spanned (`import(\n  './a'\n)`)
    // stay after it, so every line after it stays where it was.
    const start = call.getStart();
    edits.push({
      start,
      end: call.end,
      text: `(async () => ${binding})()${code.slice(start, call.end).replace(/[^\r\n\u2028\u2029]+/g, '')}`,
    });
  }
  const imports = [...bindings]
    .map(
      ([specifier, binding]) =>
        `import * as ${binding} from ${JSON.stringify(specifier)};`,
    )
    .join('');
  // At the start of the line after a hashbang, which must open the file,
  // and on no line of their own. Import declarations are hoisted, so where
  // they stand among the module's statements doesn't change when the
  // modules they name run. A module with a call has a line after its
  // hashbang: the hashbang is a comment.
  const at = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
  // First among the edits: one at the same offset, a call that starts the
  // line, goes after it.
  edits.unshift({ start: at, end: at, text: imports });
  return applyEdits(code, edits);
};
