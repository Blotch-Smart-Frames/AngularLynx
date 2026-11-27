import * as ts from 'typescript';
import { applyEdits } from './source-map-edits.js';

const RUNTIME = '@blotch/angular-lynx';
const REGISTER = 'registerHostElement';
const PURE = '/*#__PURE__*/ ';
/** The name of the declarations the registrations become, before their number. */
const DECLARATION = 'ɵhostElement';

/**
 * Turns a module's top-level `registerHostElement()` calls into pure
 * declarations nothing reads, for the background layer, so a bundler can drop
 * them with the components they name.
 *
 * A call next to its component (`registerHostElement(UiCardTitle, 'text')`, as
 * `@blotch/ui` has for 11 of them) is a side effect of loading the module.
 * When a module the background thread runs imports the component's file, for
 * one of its background functions, the call kept the component in the
 * background bundle, and through it Angular's component and renderer code,
 * though the background thread never renders and never reads the
 * registrations. Only the background's copy changes: on the main thread the
 * registration is what makes the component's host a `<text>`.
 *
 * Marking the call pure isn't enough. Rspack's tree shaking (its inner graph)
 * counts what a top-level statement reads as read by the module itself, pure
 * or not: `/*#__PURE__*\/ registerHostElement(UiIcon, 'svg')` kept UiIcon, and
 * with it the `input()`, `computed()`, `inject()` and `cn()` it imports, so
 * the bundle kept `@angular/core` and tailwind-merge whole for the minifier to
 * pick through, which it couldn't (issue #716). As the value of a variable
 * nothing reads, the call belongs to that declaration, which is pure and
 * unused, so rspack itself leaves out the component and the imports only it
 * used. An argument that does something makes the declaration impure, and
 * rspack keeps it, as the minifier keeps such an argument of a pure call.
 *
 * Only calls of the runtime's own function count: the name a named import
 * gives it, renamed or not, or a namespace import's property. A function of
 * the app's that's called the same, or a call inside a function, is left
 * alone.
 *
 * @param code - The module's code, after its cross-thread IDs are set, so
 *   they come from the same code as the main thread's.
 * @param filename - The module's path, for the parser: a `.ts` module can
 *   still hold types in a development build (see wrapPureClasses).
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const markHostElementsPure = (
  code: string,
  filename: string,
): string => {
  if (!code.includes(REGISTER)) {
    return code;
  }
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );

  // What the module calls it: `registerHostElement`, an `as` name, or a
  // namespace import's `ns.registerHostElement`.
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      (statement.moduleSpecifier as ts.StringLiteral).text !== RUNTIME
    ) {
      continue;
    }
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (!bindings || clause!.phaseModifier === ts.SyntaxKind.TypeKeyword) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (
        !element.isTypeOnly &&
        (element.propertyName ?? element.name).text === REGISTER
      ) {
        names.add(element.name.text);
      }
    }
  }

  const starts: number[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression)
    ) {
      continue;
    }
    const callee = statement.expression.expression;
    const registers = ts.isIdentifier(callee)
      ? names.has(callee.text)
      : ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        namespaces.has(callee.expression.text) &&
        callee.name.text === REGISTER;
    if (registers) starts.push(statement.expression.getStart(sourceFile));
  }

  if (starts.length === 0) {
    return code;
  }

  // A name no identifier in the module starts with, so a declaration can't
  // shadow or redeclare one of the module's own. Read from the parsed
  // identifiers, which hold a name as the engine reads it: written with a
  // Unicode escape (`\u0275hostElement0`), it's the same name as `ɵhostElement0`.
  const identifiers: string[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.push(node.text);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  let name = DECLARATION;
  while (identifiers.some((identifier) => identifier.startsWith(name))) {
    name = `_${name}`;
  }

  return applyEdits(
    code,
    starts.map((start, index) => ({
      start,
      end: start,
      text: `const ${name}${index} = ${PURE}`,
    })),
  );
};
