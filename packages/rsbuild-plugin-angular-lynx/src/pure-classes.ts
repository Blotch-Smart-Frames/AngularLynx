import * as ts from 'typescript';

type Edit = { start: number; end: number; text: string };

/** Built-in constructors that create a value and do nothing else. */
const PURE_CONSTRUCTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

/**
 * Wraps each top-level class with private or static members in a pure IIFE,
 * so a bundler can drop the classes nothing uses.
 *
 * The background layer compiles to ES2015 (layers.ts), so SWC lowers private
 * and static class fields. A class declaration keeps its own statement, but the
 * class expressions that bundled libraries are written in (`var X = class
 * {…}`) become a sequence that assigns each private field's `WeakMap` to an
 * outer variable: `var X = (_a = new WeakMap(), class {…})`. The assignment
 * counts as a side effect, so rspack keeps every such class, and every import
 * it uses, even when nothing uses the class. The runtime's own classes are
 * like that (it uses `#private` fields throughout), which kept Angular's
 * renderer and change detection in the background bundle.
 *
 * Angular's build already wraps a class whose static members are Angular's
 * own (`ɵcmp`, `ɵfac` and so on) in `/*#__PURE__*\/ (() => {…})()`; this does
 * the same for the rest. Inside the IIFE, the lowering's assignments are local
 * and the call is marked pure. A class whose static members could have side
 * effects of their own (anything but literals, functions and new collections)
 * is left alone.
 *
 * @param code - The module's code, before SWC lowers it (and, for a `.ts`
 *   file, strips its types).
 * @param filename - The module's path, for the parser.
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const wrapPureClasses = (code: string, filename: string): string => {
  if (!code.includes('class')) {
    return code;
  }
  // The script kind comes from the file name. A `.ts` module can still hold
  // TypeScript here: Angular's development output keeps type annotations and
  // type arguments for SWC to strip, and parsed as JavaScript, a call such as
  // `httpResource<Data>(…)` reads as comparisons and ends the class early.
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );

  const edits: Edit[] = [];
  const wrap = (classNode: ts.ClassLikeDeclaration): void => {
    edits.push(
      {
        start: classNode.getStart(sourceFile),
        end: classNode.getStart(sourceFile),
        text: '/*#__PURE__*/ (() => ',
      },
      { start: classNode.end, end: classNode.end, text: ')()' },
    );
  };

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const [declaration, ...rest] = statement.declarationList.declarations;
      const value = declaration?.initializer;
      if (
        rest.length === 0 &&
        value &&
        ts.isClassExpression(value) &&
        isLoweredPureClass(value)
      ) {
        wrap(value);
      }
      continue;
    }
    if (
      ts.isClassDeclaration(statement) &&
      statement.name &&
      isLoweredPureClass(statement)
    ) {
      const modifiers = ts.getModifiers(statement) ?? [];
      const isExport = modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      const isDefault = modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      );
      const name = statement.name.text;
      const start = statement.getStart(sourceFile);
      // The `export` and `default` keywords are replaced, up to `class`.
      const classStart = statement
        .getChildren(sourceFile)
        .find((child) => child.kind === ts.SyntaxKind.ClassKeyword)!
        .getStart(sourceFile);
      // `class X {}` becomes `let X = /*#__PURE__*/ (() => class X {})();`.
      // A class declaration isn't hoisted, so `let` keeps its scoping.
      edits.push(
        {
          start,
          end: classStart,
          text: `${isExport && !isDefault ? 'export ' : ''}let ${name} = /*#__PURE__*/ (() => `,
        },
        {
          start: statement.end,
          end: statement.end,
          text: `)();${isDefault ? `\nexport { ${name} as default };` : ''}`,
        },
      );
    }
  }

  if (edits.length === 0) {
    return code;
  }
  // From the end, so earlier offsets stay valid. Edits never share a start.
  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const { start, end, text } of edits) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return result;
};

/**
 * Whether SWC's lowering would make the class a side effect (it has private or
 * static members) while the class itself has none (its `extends` and static
 * initializers are pure).
 */
const isLoweredPureClass = (node: ts.ClassLikeDeclaration): boolean => {
  // A decorator runs when the class is defined.
  if (ts.getDecorators(node)?.length) {
    return false;
  }
  const heritage = node.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const base = heritage?.types[0]?.expression;
  if (base && !isPureReference(base)) {
    return false;
  }
  let lowered = false;
  for (const member of node.members) {
    if (ts.isClassStaticBlockDeclaration(member)) {
      return false;
    }
    const isStatic = ts
      .getModifiers(member as ts.HasModifiers)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
    const isPrivate = member.name && ts.isPrivateIdentifier(member.name);
    if (member.name && ts.isComputedPropertyName(member.name)) {
      return false;
    }
    if (isStatic || isPrivate) {
      lowered = true;
    }
    if (
      isStatic &&
      ts.isPropertyDeclaration(member) &&
      member.initializer &&
      !isPure(member.initializer)
    ) {
      return false;
    }
  }
  return lowered;
};

const isPureReference = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) ||
  (ts.isPropertyAccessExpression(node) && isPureReference(node.expression));

const isPure = (node: ts.Expression): boolean => {
  if (
    ts.isLiteralExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isIdentifier(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isVoidExpression(node)) return isPure(node.expression);
  if (ts.isParenthesizedExpression(node)) return isPure(node.expression);
  if (ts.isPrefixUnaryExpression(node)) return isPure(node.operand);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(
      (element) => !ts.isSpreadElement(element) && isPure(element),
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        !ts.isComputedPropertyName(property.name) &&
        isPure(property.initializer),
    );
  }
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    PURE_CONSTRUCTORS.has(node.expression.text) &&
    (node.arguments ?? []).every(isPure)
  );
};
