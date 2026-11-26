import * as ts from 'typescript';

type Edit = { start: number; end: number; text: string };

/** Built-in constructors that create a value and do nothing else. */
const PURE_CONSTRUCTORS = new Set([
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  // Registers nothing until register() is called: the runtime's LynxElement
  // keeps one, behind a check that the engine has it.
  'FinalizationRegistry',
  'WeakRef',
]);

/**
 * Operators whose result is computed from their operands alone, with no
 * conversion that could call the app's code when both are primitives or
 * the operator doesn't convert (`===`, `typeof x === 'function'`).
 */
const PURE_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

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
  const aliases = findClassAliases(sourceFile);
  const wrap = (
    classNode: ts.ClassLikeDeclaration,
    name: string,
    next: ts.Statement | undefined,
  ): void => {
    // A class that names itself inside its body can come with an alias the
    // package's build added: `var _a;` above it and `_a = X;` after it, for
    // the body to use. That assignment is a statement of its own, which kept
    // the class (the runtime's LynxElement, and everything it uses) in the
    // background bundle. Made inside the pure IIFE, it goes with the class,
    // so only when nothing outside the class reads the alias (dropped with
    // an unused class, it would leave that reader `undefined`), and only from
    // the statement right after the class's, so the alias holds the class
    // from the same point on: code between the two would see it set earlier.
    const candidate = aliases.get(name);
    const alias =
      candidate &&
      candidate.statement === next &&
      candidate.reads.every(
        (read) =>
          read >= classNode.getStart(sourceFile) && read < classNode.end,
      )
        ? candidate
        : undefined;
    edits.push(
      {
        start: classNode.getStart(sourceFile),
        end: classNode.getStart(sourceFile),
        text: `/*#__PURE__*/ (() => ${alias ? `${alias.name} = ` : ''}`,
      },
      { start: classNode.end, end: classNode.end, text: ')()' },
    );
    if (alias) {
      // From the statement itself, not the trivia before it: written without
      // a semicolon, the class's statement ends where that trivia starts,
      // which is where `)()` goes, and the comments before it stay. A `;`
      // takes its place, which ends the class's statement if it had no
      // semicolon of its own: a `(` starting the next statement would
      // otherwise call what `)()` returns, the class.
      edits.push({
        start: alias.statement.getStart(sourceFile),
        end: alias.statement.end,
        text: ';',
      });
    }
  };

  for (const [index, statement] of sourceFile.statements.entries()) {
    if (ts.isVariableStatement(statement)) {
      const [declaration, ...rest] = statement.declarationList.declarations;
      const value = declaration?.initializer;
      if (
        rest.length === 0 &&
        value &&
        ts.isClassExpression(value) &&
        isLoweredPureClass(value)
      ) {
        wrap(
          value,
          declaration.name.getText(sourceFile),
          sourceFile.statements[index + 1],
        );
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

type ClassAlias = {
  /** The alias's name. */
  name: string;
  /** The `alias = X;` statement. */
  statement: ts.Statement;
  /**
   * Where the alias's name appears, other than in its `var` and that
   * statement: each read of it.
   */
  reads: number[];
};

/**
 * The aliases a package's build gives a class that names itself in its body,
 * keyed by the class's variable: each `alias = X;` statement at the top level
 * whose alias is a top-level `var alias;` that nothing else assigns.
 */
const findClassAliases = (
  sourceFile: ts.SourceFile,
): Map<string, ClassAlias> => {
  const declared = new Map<string, ts.Identifier>();
  const assignments = new Map<
    string,
    { target: string; statement: ts.Statement }[]
  >();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && !declaration.initializer) {
          declared.set(declaration.name.text, declaration.name);
        }
      }
      continue;
    }
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(statement.expression.left) &&
      ts.isIdentifier(statement.expression.right)
    ) {
      const alias = statement.expression.left.text;
      assignments.set(alias, [
        ...(assignments.get(alias) ?? []),
        { target: statement.expression.right.text, statement },
      ]);
    }
  }
  const aliases = new Map<string, ClassAlias>();
  for (const [name, assigned] of assignments) {
    const [only, ...others] = assigned;
    const declaration = declared.get(name);
    if (declaration && only && others.length === 0) {
      aliases.set(only.target, { name, statement: only.statement, reads: [] });
    }
  }
  if (aliases.size === 0) {
    return aliases;
  }
  // Every identifier spelled like an alias counts as a read of it, even a
  // property name or another scope's variable: at worst, a class keeps its
  // alias statement and stays in the bundle, as it did before.
  const byName = new Map(
    [...aliases.values()].map((alias) => [alias.name, alias]),
  );
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const alias = byName.get(node.text);
      if (
        alias &&
        node !== declared.get(alias.name) &&
        !(node.pos >= alias.statement.pos && node.end <= alias.statement.end)
      ) {
        alias.reads.push(node.getStart(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
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
      // A well-known symbol, such as `[Symbol.iterator]()`, is the only key
      // that's computed without converting anything. SWC lowers any computed
      // key to a `_to_property_key()` call outside the class, so the class
      // is lowered too.
      if (!isWellKnownSymbol(member.name.expression)) {
        return false;
      }
      lowered = true;
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

/**
 * Whether defining the class does nothing but make it: no decorators, an
 * `extends` and computed member names that only read a name or a property of
 * one, no `static {}` block, and pure static initializers. A pure IIFE around
 * such a class claims nothing that isn't so (see renamePrivateMethods, which
 * wraps the classes it gives a static block of its own).
 */
export const definesClassPurely = (node: ts.ClassLikeDeclaration): boolean => {
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
  return node.members.every((member) => {
    if (ts.isClassStaticBlockDeclaration(member)) {
      return false;
    }
    if (
      member.name &&
      ts.isComputedPropertyName(member.name) &&
      !isPureReference(member.name.expression)
    ) {
      return false;
    }
    const isStatic = ts
      .getModifiers(member as ts.HasModifiers)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
    return !(
      isStatic &&
      ts.isPropertyDeclaration(member) &&
      member.initializer &&
      !isPure(member.initializer)
    );
  });
};

const isPureReference = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) ||
  (ts.isPropertyAccessExpression(node) && isPureReference(node.expression));

const isWellKnownSymbol = (node: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'Symbol' &&
  ts.isIdentifier(node.name);

export const isPure = (node: ts.Expression): boolean => {
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
  // `++x` and `--x` write to `x`.
  if (ts.isPrefixUnaryExpression(node)) {
    return (
      node.operator !== ts.SyntaxKind.PlusPlusToken &&
      node.operator !== ts.SyntaxKind.MinusMinusToken &&
      isPure(node.operand)
    );
  }
  // `typeof` of an undeclared name is `'undefined'`, not a ReferenceError.
  if (ts.isTypeOfExpression(node)) return isPure(node.expression);
  if (ts.isConditionalExpression(node)) {
    return (
      isPure(node.condition) && isPure(node.whenTrue) && isPure(node.whenFalse)
    );
  }
  if (ts.isBinaryExpression(node)) {
    return (
      PURE_OPERATORS.has(node.operatorToken.kind) &&
      isPure(node.left) &&
      isPure(node.right)
    );
  }
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
