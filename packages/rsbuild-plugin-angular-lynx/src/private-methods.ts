import { createHash } from 'node:crypto';
import path from 'node:path';
import * as ts from 'typescript';
import {
  isAngularLynxPackageModule,
  PACKAGES_DIR,
  THIRD_PARTY,
} from './layers.js';

export type PrivateMethodsOptions = {
  /** The directory the file keys are relative to, as in cross-thread-transform.ts. */
  root: string;
};

type Edit = { start: number; end: number; text: string };

/**
 * One class in a module, as {@link analyzeClasses} found it.
 */
type ClassInfo = {
  node: ts.ClassLikeDeclaration;
  /** The class's place among the module's classes, in source order. */
  index: number;
  /**
   * Whether the class can be made more than once while the module is
   * evaluated once: it's inside a function that isn't called at once, a loop,
   * or an instance field's initializer.
   */
  repeated: boolean;
  /** Whether the class has an `extends` clause. */
  extendsAnother: boolean;
  /**
   * Whether the class, or a class inside it, uses `#name in object`, which
   * asks whether the object has the class's brand: only a private member
   * carries one.
   */
  branded: boolean;
  /** Its private members' declarations, by name (a getter and setter share one). */
  members: Map<string, ts.ClassElement[]>;
  /**
   * Every `#name` that resolves to one of the class's private members, its
   * declarations' names included.
   */
  uses: Map<string, ts.PrivateIdentifier[]>;
};

/**
 * The declaration of a private method, getter or setter: a private name
 * that isn't after a `.` (as a use is), followed by `(` or, for type
 * parameters, `<`. A module without one is left without being parsed: most
 * of an app's modules have none, and a private field (`#x = signal(…)`,
 * `this.#x()`) or a color (`'#fff'`) doesn't match.
 */
const PRIVATE_METHOD_HINT =
  /(?<![.\p{ID_Continue}$\\\u200C\u200D])#[\p{ID_Start}$_\\][\p{ID_Continue}$\\\u200C\u200D]*\s*[(<]/u;

/**
 * A private name anywhere: the packages' pass (see
 * {@link renamePrivateMethods}) turns fields into symbol-keyed properties as
 * well as renaming methods, so a module with only private fields needs it too.
 * A color (`'#fff'`) matches, which only costs a parse.
 */
const PRIVATE_NAME_HINT =
  /(?<![\p{ID_Continue}$\\\u200C\u200D])#[\p{ID_Start}$_\\]/u;

/**
 * Whether `file` is the app's own code: outside `node_modules` (the app's
 * sources, and the UI components dolan copies into them) and not one of
 * AngularLynx's packages.
 *
 * @param file - The module's path.
 * @param packagesDir - The folder this plugin's package is in.
 */
export const isAppModule = (
  file: string,
  packagesDir: string = PACKAGES_DIR,
): boolean =>
  !THIRD_PARTY.test(file) && !isAngularLynxPackageModule(file, packagesDir);

/**
 * Whether SWC compiles the module's `#private` members to properties
 * (`privateFieldsAsProperties`, layers.ts): AngularLynx's packages and the
 * app's own code, on both threads. Such a module needs
 * {@link splitPrivateChains}.
 *
 * @param file - The module's path.
 * @param packagesDir - The folder this plugin's package is in.
 */
export const compilesPrivatesAsProperties = (
  file: string,
  packagesDir: string = PACKAGES_DIR,
): boolean =>
  isAngularLynxPackageModule(file, packagesDir) ||
  isAppModule(file, packagesDir);

/**
 * Compiles a main-thread module's instance `#private` methods so they're no
 * longer defined on every instance: {@link renamePrivateMethods} for
 * AngularLynx's own packages (see {@link isAngularLynxPackageModule}), which
 * also keys their private fields by symbols, and
 * {@link hidePrivateMethods} for the app's own code (see
 * {@link isAppModule}). Other packages' modules come back unchanged: their
 * private members keep SWC's standard compile (layers.ts).
 *
 * The two differ in what other code can see. The packages' classes are ours,
 * written to keep clear of the differences listed on renamePrivateMethods,
 * and its prototype methods are the faster to call. An app's code is anyone's,
 * and code that walks a prototype's own names would find a renamed method:
 * Angular itself does, as it hashes a component's prototype into its
 * generated ID (`getComponentId`), and so do auto-binding helpers and MobX's
 * `makeAutoObservable()`. hidePrivateMethods leaves the prototype as it was.
 *
 * @param code - The module's code, after the cross-thread and worklet
 *   transforms (their IDs come from the code as written) and before SWC.
 * @param filename - The module's path, for the parser and the key.
 * @param options - See {@link PrivateMethodsOptions}.
 * @param packagesDir - The folder this plugin's package is in.
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const transformPrivateMethods = (
  code: string,
  filename: string,
  options: PrivateMethodsOptions,
  packagesDir: string = PACKAGES_DIR,
): string => {
  // Last, on what the pass left private: a chain it turned into symbol keys
  // and renamed methods needs nothing more.
  if (isAngularLynxPackageModule(filename, packagesDir)) {
    return splitPrivateChains(
      renamePrivateMethods(code, filename, options),
      filename,
    );
  }
  if (isAppModule(filename, packagesDir)) {
    return splitPrivateChains(
      hidePrivateMethods(code, filename, options),
      filename,
    );
  }
  return code;
};

/**
 * A `.` (or `?.`) and then a private name, maybe with spaces and comments
 * between (`this./* c *\/#a`). Each comment matches exactly one way, a
 * block comment up to its first `*\/` and a line comment only up to its
 * line's end (the lookahead keeps it from stopping at a later `//` on the
 * line), so a run of them can't backtrack exponentially.
 */
const PRIVATE_ACCESS =
  /\.(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n\r\u2028\u2029]*(?![^\n\r\u2028\u2029]))*#[\p{ID_Start}$_\\]/u
    .source;

/**
 * Two private member accesses (see {@link PRIVATE_ACCESS}) anywhere in the
 * module: a chain {@link splitPrivateChains} splits has them, with whatever
 * is between (comments, parentheses, a type assertion). Coarse on purpose: a
 * hint that followed the chain's syntax between the two (repeated,
 * overlapping comment alternatives) backtracked exponentially on a run of
 * slashes or comments, and this one only scans forward to the second access.
 */
const PRIVATE_CHAIN_HINT = new RegExp(
  `${PRIVATE_ACCESS}[\\s\\S]*?${PRIVATE_ACCESS}`,
  'u',
);

/** One private member access, as in {@link PRIVATE_ACCESS}. */
const PRIVATE_ACCESS_HINT = new RegExp(PRIVATE_ACCESS, 'u');

/**
 * Rewrites the private member reads SWC compiles wrong, so it compiles them
 * as they run natively. The modules whose private members SWC compiles to
 * properties (layers.ts) need it (see {@link compilesPrivatesAsProperties}),
 * on both threads: {@link transformPrivateMethods} runs it on the main
 * thread's. A module with neither two private accesses nor a `?.` and one is
 * left without being parsed. It fixes three things.
 *
 * **A private member read on another one** (`a.#b.#c`, `a.#b.#c()`,
 * `(a.#b).#c = v`). With `privateFieldsAsProperties`, SWC (1.16, and rspack
 * 2.2's) lowers the outer access and leaves the inner one as it was:
 * `_class_private_field_loose_base(a.#b, _c)[_c]`. The class's `#b` is gone,
 * so swc-loader fails the module ("private name #b is not defined"), and
 * code that gets past it is a SyntaxError when it loads ("Private field '#b'
 * must be declared in an enclosing class"). It lowers any other object
 * (`a.#b.x.#c`, `f(a.#b).#c`), so `a.#b.#c` becomes `(0, a.#b).#c`: the
 * same value, read once, and nothing added or removed changes what `this` a
 * call of it gets.
 *
 * **What follows a private member inside an optional chain.** SWC, in both
 * of its private-member compiles, ends the chain's short-circuit at the
 * private member: `a?.#b.c` comes out as `(a == null ? void 0 : <a.#b>).c`,
 * which throws for a nullish `a` where natively it gives `undefined`. So the
 * next link gets its own `?.` (`a?.#b?.c`, `a?.#b?.[k]`, `a?.#b?.#c`), which
 * SWC compiles: the result differs only when `a.#b` is itself nullish, where
 * natively the next link throws a TypeError and here it gives `undefined`.
 * Parentheses (`(0, a?.#b).#c`) would end the chain, so a chained read inside
 * one gets the `?.` too.
 *
 * **A call of a private member inside an optional chain, or with its own
 * `?.`** (`a?.#m(x)`, `a?.#b.#m(x)`, `a.#m?.(x)[k]`). SWC calls it outside
 * the short-circuit, and inside a chain without its receiver:
 * `(a == null ? void 0 : <a.#m>)(x)`. So the call becomes one of `call`,
 * itself optional, which SWC compiles: `this.#m?.call(this, x)`. Any
 * receiver but `this` is read once, into a variable, before the member is
 * (`(__receiver0 = a)?.#m?.call(__receiver0, x)`): the receiver could have
 * side effects, and a private getter that runs as the member is read could
 * assign a new value to a name. The variable is declared in the function
 * the call is in (see {@link receiverScope}), so a call that runs again
 * before this one has read it back, from such a getter, has its own. The
 * arguments stay inside the short-circuit, as they're evaluated only when
 * the call is made. The result differs only when the member is nullish or
 * the receiver part of the chain is (`a?.b.#m(x)` with `a.b` nullish):
 * natively the call throws a TypeError, and here it gives `undefined`.
 *
 * Edits never add or remove a line, and an inline source map's columns are
 * moved to match, as for the passes before it.
 *
 * @param code - The module's code, before SWC.
 * @param filename - The module's path, for the parser.
 * @returns The rewritten code, or `code` itself when nothing applies.
 */
export const splitPrivateChains = (code: string, filename: string): string => {
  if (
    !PRIVATE_CHAIN_HINT.test(code) &&
    !(code.includes('?.') && PRIVATE_ACCESS_HINT.test(code))
  ) {
    return code;
  }
  const sourceFile = parse(code, filename);
  const edits: Edit[] = [];
  // Where a `?` goes, before a link's `.`: a set, as two rules can ask for
  // the same one (`a?.#b.#m()`).
  const questionMarks = new Set<number>();
  // The receivers' variables, by the scope that declares them.
  const receivers = new Map<ts.Node, string[]>();
  let receiverCount = 0;
  // A name nothing in the module uses, so it can't take another's place.
  let prefix = '__receiver';
  while (code.includes(prefix)) prefix = `_${prefix}`;

  /**
   * Visits `node`. `yielding` is whether it's in a destructuring's default
   * value that has a `yield` or an `await` (see {@link yieldingDefault}).
   */
  const visit = (node: ts.Node, yielding: boolean): void => {
    const inYielding = yielding || yieldingDefault(node);
    if (ts.isCallExpression(node)) {
      const callee = skipNonNull(node.expression);
      if (
        !inYielding &&
        isPrivateAccess(callee) &&
        (node.questionDotToken || ts.isOptionalChain(callee))
      ) {
        // Before the edits inside the receiver, which visiting it adds:
        // edits at one place are made in the order they're pushed, so an
        // inner `(0, ` comes after the `(__receiver0 = `.
        const receiver = callee.expression;
        let text: string;
        if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
          text = 'this';
        } else {
          text = `${prefix}${receiverCount++}`;
          const scope = receiverScope(node);
          receivers.set(scope, [...(receivers.get(scope) ?? []), text]);
          const start = receiver.getStart(sourceFile);
          edits.push(
            { start, end: start, text: `(${text} = ` },
            { start: receiver.end, end: receiver.end, text: ')' },
          );
          // The parentheses end the chain, so the member's `.` must start
          // one again.
          if (!callee.questionDotToken && ts.isOptionalChain(callee)) {
            questionMarks.add(dotOf(callee, sourceFile));
          }
        }
        const end = node.expression.end;
        edits.push({ start: end, end, text: '?.call' });
        if (node.questionDotToken) {
          edits.push({
            start: node.questionDotToken.getStart(sourceFile),
            end: node.questionDotToken.end,
            text: '',
          });
        }
        edits.push({
          start: node.arguments.pos,
          end: node.arguments.pos,
          text: node.arguments.length > 0 ? `${text}, ` : text,
        });
      }
    } else if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ts.isOptionalChain(node) &&
      !node.questionDotToken
    ) {
      // A link right after a private member of the same chain. A private
      // one is split even in a default value with a `yield` or an `await`:
      // without the `?.` SWC leaves the inner read and fails the module
      // (see above), and with it the default value still compiles and runs
      // (checked in the tests).
      const inner = skipNonNull(node.expression);
      if (
        isPrivateAccess(inner) &&
        ts.isOptionalChain(inner) &&
        (!inYielding ||
          (ts.isPropertyAccessExpression(node) &&
            ts.isPrivateIdentifier(node.name)))
      ) {
        const at = dotOf(node, sourceFile);
        if (ts.isPropertyAccessExpression(node)) {
          questionMarks.add(at);
        } else {
          edits.push({ start: at, end: at, text: '?.' });
        }
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPrivateIdentifier(node.name) &&
      !node.questionDotToken &&
      // Inside a chain the rule above gives it a `?.`.
      !ts.isOptionalChain(node)
    ) {
      // Through parentheses, which SWC drops, leaving the same shape, and
      // type assertions, should a .ts module still have them.
      const inner = skipWrappers(node.expression);
      if (isPrivateAccess(inner)) {
        // Outer edits come first, so `a.#b.#c.#d` gets `(0, (0, ` where
        // both start.
        const start = node.expression.getStart(sourceFile);
        edits.push(
          { start, end: start, text: '(0, ' },
          { start: node.expression.end, end: node.expression.end, text: ')' },
        );
      }
    }
    ts.forEachChild(node, (child) => visit(child, inYielding));
  };
  visit(sourceFile, false);
  for (const at of questionMarks) {
    edits.push({ start: at, end: at, text: '?' });
  }
  // A scope's opening edit goes before, and its closing edit after, the
  // edits at the same place inside it (`(__receiver0 = ` where an arrow
  // function's body starts, `)` where it ends): edits at one place are made
  // in the order they're pushed. Two scopes can end at one place (a field
  // whose initializer ends with an arrow function), so the one that starts
  // later, inside the other, closes first.
  const opening: Edit[] = [];
  const closing: Array<Edit & { scopeStart: number }> = [];
  for (const [scope, names] of receivers) {
    const declaration = `var ${names.join(', ')};`;
    if (ts.isSourceFile(scope)) {
      // After the last statement, on its line, so no line moves.
      const end = scope.statements[scope.statements.length - 1]!.end;
      edits.push({ start: end, end, text: `;${declaration}` });
    } else if (ts.isBlock(scope)) {
      // After any directives (`'use strict'`), which must come first. The
      // statement with the call isn't one, so there's always a statement
      // after them.
      const directives = scope.statements.findIndex(
        (statement) =>
          !ts.isExpressionStatement(statement) ||
          !ts.isStringLiteral(statement.expression),
      );
      const at =
        directives > 0
          ? scope.statements[directives - 1]!.end
          : scope.getStart(sourceFile) + 1;
      opening.push({
        start: at,
        end: at,
        // A directive written without its `;` needs one.
        text:
          directives > 0 && code[at - 1] !== ';'
            ? `; ${declaration}`
            : ` ${declaration}`,
      });
    } else {
      // An arrow function's expression body becomes a block that declares
      // them, and an initializer (a field's, or a default value's) an arrow
      // function called at once, which keeps its `this` and `arguments`.
      // The expression stays on the line it was on, so `return` can't end
      // before it.
      const wrapped = !ts.isArrowFunction(scope.parent);
      const start = scope.getStart(sourceFile);
      opening.push({
        start,
        end: start,
        text: `${wrapped ? '(() => ' : ''}{ ${declaration} return `,
      });
      closing.push({
        start: scope.end,
        end: scope.end,
        text: wrapped ? ' })()' : ' }',
        scopeStart: start,
      });
    }
  }
  closing.sort((a, b) => b.scopeStart - a.scopeStart);
  return applyEdits(
    code,
    [
      ...opening,
      ...edits,
      ...closing.map(({ start, end, text }) => ({ start, end, text })),
    ],
    sourceFile,
  );
};

/**
 * Where the variable for a receiver the call reads (see
 * {@link splitPrivateChains}) is declared: the body of the function, method
 * or static block the call is in, so each run of it has its own. An arrow
 * function's expression body, a field's initializer and a default value
 * in a parameter list (a parameter's, or one in its destructuring), which
 * run once per call or instance, are given one: a parameter's default
 * value can't see the function body's variables. A default value in a
 * destructuring elsewhere is in the function's body, which keeps its
 * `await` and `yield` in their function, as a wrapper wouldn't. A call in a computed key, `extends` or a decorator is in the
 * scope around them, and one outside any function, which runs once, in the
 * module.
 */
const receiverScope = (call: ts.Node): ts.Node => {
  let child = call;
  for (let parent = call.parent; parent; parent = parent.parent) {
    if (
      ((ts.isFunctionLike(parent) ||
        ts.isClassStaticBlockDeclaration(parent)) &&
        (parent as { body?: ts.Node }).body === child) ||
      ((ts.isPropertyDeclaration(parent) ||
        ts.isParameter(parent) ||
        (ts.isBindingElement(parent) && inParameter(parent))) &&
        parent.initializer === child)
    ) {
      return child;
    }
    child = parent;
  }
  return child;
};

/**
 * Whether a node is a destructuring's default value (`[a = v] = …`,
 * `{ a = v } = …`, in a declaration or an assignment) with a `yield` or an
 * `await` of its function in it. SWC (1.16) compiles such a default value
 * that has an optional chain it needs a variable for into an arrow function
 * called at once, where the `yield` or `await` is a SyntaxError, whatever
 * the chain reads. The rewritten calls and links need one, where SWC's own
 * compile of them doesn't, so there they're left to SWC: the module loads,
 * with SWC's short-circuit and receiver, rather than failing to.
 */
const yieldingDefault = (node: ts.Node): boolean => {
  const parent = node.parent;
  const isDefault =
    parent !== undefined &&
    ((ts.isBindingElement(parent) && parent.initializer === node) ||
      (ts.isShorthandPropertyAssignment(parent) &&
        parent.objectAssignmentInitializer === node) ||
      (ts.isBinaryExpression(parent) &&
        parent.right === node &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isArrayLiteralExpression(parent.parent) ||
          ts.isPropertyAssignment(parent.parent))));
  if (!isDefault) return false;
  /**
   * Whether `test` holds for any of the node's children.
   */
  const any = (node: ts.Node, test: (child: ts.Node) => boolean): boolean =>
    ts.forEachChild(node, (child) => test(child) || undefined) ?? false;
  /**
   * Whether what runs as the default value is evaluated has a `yield` or an
   * `await`: a function's computed name, but not its body or parameters,
   * and a class's `extends`, decorators and computed member names, but not
   * its members' bodies or initializers.
   */
  const yields = (inner: ts.Node): boolean => {
    if (ts.isYieldExpression(inner) || ts.isAwaitExpression(inner)) {
      return true;
    }
    if (ts.isClassLike(inner)) {
      return any(inner, (child) =>
        ts.isClassElement(child)
          ? any(child, (part) =>
              ts.isDecorator(part) || ts.isComputedPropertyName(part)
                ? yields(part)
                : false,
            )
          : yields(child),
      );
    }
    if (ts.isFunctionLike(inner)) {
      return (
        inner.name !== undefined &&
        ts.isComputedPropertyName(inner.name) &&
        yields(inner.name)
      );
    }
    return any(inner, yields);
  };
  return yields(node);
};

/**
 * Whether a destructuring's element is in a parameter list, rather than in
 * a variable declaration, an assignment's target or a `catch` clause.
 */
const inParameter = (element: ts.BindingElement): boolean => {
  let node: ts.Node = element;
  while (
    ts.isBindingElement(node) ||
    ts.isObjectBindingPattern(node) ||
    ts.isArrayBindingPattern(node)
  ) {
    node = node.parent;
  }
  return ts.isParameter(node);
};

/**
 * Whether a node is a private member access (`a.#b` or `a?.#b`).
 */
const isPrivateAccess = (
  node: ts.Node,
): node is ts.PropertyAccessExpression & { name: ts.PrivateIdentifier } =>
  ts.isPropertyAccessExpression(node) && ts.isPrivateIdentifier(node.name);

/**
 * The expression inside any non-null assertions (`a!`), which stay in an
 * optional chain where parentheses would end it.
 */
const skipNonNull = (node: ts.Expression): ts.Expression =>
  ts.isNonNullExpression(node) ? skipNonNull(node.expression) : node;

/**
 * The expression inside any parentheses and type assertions around it.
 */
const skipWrappers = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node) ||
  ts.isNonNullExpression(node)
    ? skipWrappers(node.expression)
    : node;

/**
 * Where the `.` of a property access is, or the `[` of an element access:
 * the first token after its object, past any comments.
 */
const dotOf = (
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
): number => {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    sourceFile.languageVariant,
    sourceFile.text,
    undefined,
    node.expression.end,
  );
  scanner.scan();
  return scanner.getTokenStart();
};

/**
 * Turns each class's `#private` methods, getters and setters into ordinary
 * methods with unique public names, so an instance one is defined once on
 * the prototype instead of on every instance, and its `#private` fields into
 * properties keyed by symbols, static members included. AngularLynx's own packages use it
 * (see {@link transformPrivateMethods}).
 *
 * The main thread compiles to ES2019 with SWC's `privateFieldsAsProperties`
 * (layers.ts). It lowers an instance private method to an
 * `Object.defineProperty(this, _m, { value: m })` in the constructor, so each
 * `new` makes one descriptor and one defineProperty call per method, and the
 * instance gets one more property for each. `LynxElement` has 41 of them, all
 * for methods that never change, and the runtime makes one for every element,
 * text node and anchor Angular creates. They were about half the time it took
 * to create one under V8 without its JIT (`node --jitless`), the nearest
 * stand-in for PrimJS, which has no JIT to take that cost away.
 *
 * `#m(…) {…}` becomes `__m_<key><n>(…) {…}`, where `<key>` comes from the
 * file and `<n>` counts the module's classes, so a subclass's `#m` doesn't
 * override its base's, even in another module. Every `x.#m` and `x?.#m`
 * that names it becomes `x.__m_<key><n>` (or `x?.…`). A private name belongs
 * to the innermost class that declares it, so a nested class's own `#m` is
 * renamed apart from the outer one's.
 *
 * The names are per class in the source, not per class made, which is the
 * same thing for a class the module makes once: one at the top level, or in
 * a function called at once that can't be called again, such as the pure
 * `(() => {…})()` Angular wraps a decorated class in (see
 * {@link isCalledAtOnce}). A class expression that can run more
 * than once (a mixin or a class factory) makes a class each time, all with
 * the same names on their prototypes, so one of them made from another, as
 * `Mixin(Mixin(Base))` is, would override its base's `#m` with its own.
 *
 * **Fields.** SWC compiles a private field to a property for PrimJS's sake
 * (issue #237, layers.ts), but defines each with its own descriptor in the
 * constructor (`Object.defineProperty(this, _x, { writable: true, value })`)
 * and reads and writes it through a function that checks the instance has
 * it (`_class_private_field_loose_base`). On an iPhone 14 Pro, 5,000 objects
 * with 60 such fields took 54–61 ms to make, and 100,000 reads and writes of
 * one 28 ms; keyed by symbols, 13 ms and 8 ms. `LynxElement` has 40, and the
 * runtime makes one for every element, text node and anchor. So
 * `#x = v` becomes `[__x_<key><n>] = v` where it was, every `a.#x` becomes
 * `a[__x_<key><n>]` and `a?.#x` becomes `a?.[__x_<key><n>]`, and the module
 * declares the symbols, `var __x_<key><n> = Symbol("x")`, at the start of its
 * first line, before any class that needs them. A symbol-keyed property is
 * left out of `Object.keys()`, `JSON.stringify()` and `for…in`, as a private
 * field is (and as SWC's non-enumerable one was), and is collected as an
 * ordinary property is. An instance's is enumerable, though, so spreading
 * the instance copies it, under its symbol: making it non-enumerable would
 * take an `Object.defineProperty()` for each field of each instance, what
 * this saves. Code that misuses a field sees a difference,
 * as for methods: reading one on an object that isn't an instance gives
 * `undefined` rather than a TypeError. An auto-accessor (`accessor #x`) and
 * a decorated field stay private.
 *
 * **Static members** are renamed and keyed the same way. A class makes its
 * static ones once, but each `LynxElement.#registry` read went through
 * `_class_private_field_loose_base` all the same, and a static private
 * method was a field holding a function, read through it before each call:
 * `LynxElement`'s static members are read for every element it makes,
 * inserts and commits (about 9% of building 5,000 views under
 * `node --jitless`). A renamed static method is a static method of the
 * class, so a subclass inherits it and `Object.getOwnPropertyNames()` of the
 * class lists it, and a subclass reads its base's static fields through its
 * prototype chain: only code that reaches a static private member through a
 * subclass, which natively throws a TypeError, sees that. A static field is
 * made non-enumerable right after it's initialized (`; static {
 * Object.defineProperty(this, __x_<key><n>, { enumerable: false }); }`, on
 * the same line), so spreading the class doesn't copy it: once per class,
 * unlike an instance's.
 *
 * Left as they are:
 *
 * - The private fields of a module that binds the name `Symbol` (its
 *   methods are still renamed), as the symbols are made from it, and the
 *   static private fields of one that binds `Object`, which hides them.
 * - Any class that uses `#name in object`: a public name can't answer it.
 * - A class with `extends` that can be made more than once: one inside a
 *   function that isn't called at once, or is but has a name or uses
 *   `arguments` (either can call it again), inside a loop, or in an
 *   instance field's initializer. One without `extends` can't be made from
 *   another, and is renamed.
 *
 * As class methods, the renamed ones are non-enumerable and live on the
 * prototype: `Object.keys()` of an instance doesn't change, and
 * `Object.getOwnPropertyNames()` of one no longer lists them, while that of
 * the prototype does (which is why the app's code uses
 * {@link hidePrivateMethods} instead). Otherwise only code that misuses a
 * private member sees a difference: calling a method on an object that isn't
 * an instance (which TypeScript allows only through `any` or a cast) still
 * throws a TypeError, but "is not a function" rather than the brand check's;
 * reading one without calling it gives `undefined`; and assigning to a
 * method, or reading an accessor that has no getter, which TypeScript
 * rejects, no longer throws.
 *
 * Edits never add or remove a line. When Angular's transformer left an
 * inline source map, its columns are moved to match, so the chain from the
 * original source stays exact.
 *
 * @param code - The module's code, after the cross-thread and worklet
 *   transforms (their IDs come from the code as written) and before SWC.
 * @param filename - The module's path, for the parser and the key.
 * @param options - See {@link PrivateMethodsOptions}.
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const renamePrivateMethods = (
  code: string,
  filename: string,
  options: PrivateMethodsOptions,
): string => {
  if (!PRIVATE_NAME_HINT.test(code)) {
    return code;
  }
  const sourceFile = parse(code, filename);
  const key = keyForFile(filename, options.root);
  const edits: Edit[] = [];
  const symbols: string[] = [];
  // The static block that hides a static field calls `Object.defineProperty`
  // where the field is, so it needs `Object` to be the global there.
  const globalObject = !bindsName(sourceFile, 'Object');
  // The symbols are made at the top of the module, from `Symbol`, so a module
  // that binds the name keeps its private fields as SWC compiles them.
  const globalSymbol = !bindsName(sourceFile, 'Symbol');
  for (const info of analyzeClasses(sourceFile)) {
    // Every class it makes would share these names, and one made from
    // another would override its base's methods (see above).
    if (info.branded || (info.repeated && info.extendsAnother)) continue;
    for (const [name, declarations] of info.members) {
      const text = `__${name.slice(1)}_${key}${info.index}`;
      const uses = info.uses.get(name)!;
      // A getter and setter share one name, and so one new name.
      if (
        declarations.every(
          (member) => ts.isMethodDeclaration(member) || ts.isAccessor(member),
        )
      ) {
        // Its declarations' names are among its uses.
        for (const use of uses) {
          edits.push({ start: use.getStart(sourceFile), end: use.end, text });
        }
        continue;
      }
      const [field] = declarations;
      const fieldStatic = isStatic(field!);
      // A static field is hidden with `Object` (below): in a module that
      // names something else that, it stays private, so a spread of its
      // class still leaves it out.
      const fieldEdits =
        globalSymbol &&
        (globalObject || !fieldStatic) &&
        isPlainField(declarations)
          ? symbolKeyEdits(uses, text, code, sourceFile)
          : null;
      if (!fieldEdits) continue;
      edits.push(...fieldEdits);
      if (fieldStatic) {
        // An empty `;` is a class element of its own, so this follows a
        // field with or without its semicolon (see above).
        edits.push({
          start: field!.end,
          end: field!.end,
          text: `; static { Object.defineProperty(this, ${text}, { enumerable: false }); }`,
        });
      }
      symbols.push(`${text} = Symbol(${JSON.stringify(name.slice(1))})`);
    }
  }
  if (symbols.length > 0) {
    // Before everything, on the first line (a hashbang keeps it), so a class
    // whose field keys they are can be defined: `import` declarations are
    // hoisted anyway, and nothing before this line can use them.
    const start = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
    edits.push({ start, end: start, text: `var ${symbols.join(', ')}; ` });
  }
  return applyEdits(code, edits, sourceFile);
};

/**
 * Whether a private member's declarations are one field that can be keyed
 * by a symbol: not an auto-accessor (`accessor #x`), which defines a getter
 * and setter, and without decorators, which receive its private name.
 */
const isPlainField = (declarations: ts.ClassElement[]): boolean => {
  const [field] = declarations;
  return (
    declarations.length === 1 &&
    ts.isPropertyDeclaration(field!) &&
    !ts
      .getModifiers(field)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.AccessorKeyword) &&
    !ts.getDecorators(field)?.length
  );
};

/**
 * The edits that key a private field by the symbol `text` names: `#x` in its
 * declaration becomes `[text]`, `a.#x` becomes `a[text]` and `a?.#x`
 * becomes `a?.[text]`. Null when a comment comes between a `.` and the
 * name, so the field stays as it is.
 */
const symbolKeyEdits = (
  uses: ts.PrivateIdentifier[],
  text: string,
  code: string,
  sourceFile: ts.SourceFile,
): Edit[] | null => {
  const edits: Edit[] = [];
  for (const use of uses) {
    const start = use.getStart(sourceFile);
    const parent = use.parent;
    edits.push({ start, end: use.end, text: `[${text}]` });
    if (ts.isPropertyDeclaration(parent)) continue;
    // Otherwise `a.#x` or `a?.#x`: a private name is used nowhere else but in
    // `#x in object`, whose class the caller leaves as it is.
    if ((parent as ts.PropertyAccessExpression).questionDotToken) continue;
    // The `.` goes, and any space after it stays: `a\n  [x]` is still
    // `a[x]`, and no line is removed.
    let dot = start - 1;
    while (dot > 0 && /\s/.test(code[dot]!)) dot--;
    if (code[dot] !== '.') return null;
    edits.push({ start: dot, end: dot + 1, text: '' });
  }
  return edits;
};

/**
 * Turns each class's instance `#private` methods into functions the module
 * defines once, which the class calls with `.call(this, …)`, so they're no
 * longer defined on every instance, and the class's prototype and instances
 * have no property for them at all. The app's own code uses it (see
 * {@link transformPrivateMethods}), as the dolan components in it have up to
 * 34 private methods each (the bottom sheet), each defined on every instance
 * by SWC's lowering (see {@link renamePrivateMethods}).
 *
 * `#m(…) {…}` becomes `static { __m_<key><n> = { m(…) {…} }.m; }` where it
 * was, and every `this.#m(…)` becomes `__m_<key><n>.call(this, …)`, with
 * `;var __m_<key><n>;` after the module's last statement (the static block
 * assigns it, as a class can't declare a variable its methods share). As an object
 * literal's method, it keeps a method's semantics: strict, with its own
 * `this` and `arguments`, not a constructor. Its async and generator markers
 * stay with it.
 *
 * The prototype doesn't change, unlike {@link renamePrivateMethods}', so
 * whatever walks its own names finds what it found before: Angular's
 * component IDs, which hash them, stay the same. An instance no longer has
 * the own, non-enumerable property per method that SWC's lowering gave it,
 * as natively it has none: `Object.getOwnPropertyNames()` of one lists only
 * its fields, and `Object.keys()`, `JSON.stringify()` and spreading, which
 * never listed them, don't change.
 *
 * A method is turned into a function only when nothing could tell, in valid
 * code, and stays a private method otherwise:
 *
 * - Every use of it is a call on `this` (`this.#m(…)` or `this.#m?.(…)`),
 *   in an instance member of its own class or an arrow function inside one.
 *   A call on another object (`other.#m()`) keeps the brand check that throws
 *   for an object that isn't an instance; so does reading the method without
 *   calling it, or `#m in object`, which keeps the whole class as it is.
 *   Called on an object that doesn't carry the class's private brand, or
 *   doesn't yet, a function runs where the method would throw a TypeError:
 *   on the wrong `this`, which TypeScript rejects (an unbound callback), or
 *   before the instance has its private methods, as when a base class's
 *   constructor calls an overridden method that uses the subclass's `#m`.
 * - Its body doesn't use `super`, whose home is the class's prototype.
 * - No static block or static field initializer that could run code (more
 *   than a literal or a function) comes before it: they run in order, and
 *   one could make an instance that calls the method before its static block
 *   assigns it, where natively every method is there from the start.
 * - Its class is made once (see {@link renamePrivateMethods}): one variable
 *   can't hold the function of every class a factory makes.
 * - It has no decorators, and isn't an overload, a getter or a setter.
 *   Getters and setters stay private: a function call can't stand in for an
 *   assignment's value, or `this.#x += 1`.
 *
 * Edits never add or remove a line: the variables go on the line the last
 * statement ends on. An inline source map's columns are moved to match.
 *
 * @param code - The module's code, after the cross-thread and worklet
 *   transforms (their IDs come from the code as written) and before SWC.
 * @param filename - The module's path, for the parser and the key.
 * @param options - See {@link PrivateMethodsOptions}.
 * @returns The transformed code, or `code` itself when nothing applies.
 */
export const hidePrivateMethods = (
  code: string,
  filename: string,
  options: PrivateMethodsOptions,
): string => {
  if (!PRIVATE_METHOD_HINT.test(code)) {
    return code;
  }
  const sourceFile = parse(code, filename);
  const key = keyForFile(filename, options.root);
  const edits: Edit[] = [];
  const variables: string[] = [];
  for (const info of analyzeClasses(sourceFile)) {
    if (info.branded || info.repeated) continue;
    for (const [name, [declaration, ...others]] of info.members) {
      if (
        others.length > 0 ||
        !ts.isMethodDeclaration(declaration!) ||
        !canBecomeFunction(declaration, info.node)
      ) {
        continue;
      }
      const calls: ts.CallExpression[] = [];
      for (const use of info.uses.get(name)!) {
        if (use === declaration.name) continue;
        const call = thisCall(use, info.node, sourceFile);
        if (!call) {
          calls.length = 0;
          break;
        }
        calls.push(call);
      }
      // A method nothing calls is left too: there's nothing to gain.
      if (calls.length === 0) continue;

      const bare = name.slice(1);
      const variable = `__${bare}_${key}${info.index}`;
      variables.push(variable);
      const start = declaration.getStart(sourceFile);
      edits.push(
        { start, end: start, text: `static { ${variable} = { ` },
        {
          start: declaration.name.getStart(sourceFile),
          end: declaration.name.end,
          text: bare,
        },
        {
          start: declaration.end,
          end: declaration.end,
          text: ` }.${bare}; }`,
        },
      );
      for (const call of calls) {
        edits.push({
          start: call.expression.getStart(sourceFile),
          end: call.arguments.pos,
          text: `${variable}.call(this${call.arguments.length > 0 ? ', ' : ''}`,
        });
      }
    }
  }
  if (variables.length === 0) {
    return code;
  }
  // `var`, so the declaration is hoisted above the classes, whose static
  // blocks assign it during the module's evaluation; a `let` there would
  // still be in its temporal dead zone. Right after the last statement, at
  // the top level, on its line: no line moves, and nothing in a string or a
  // comment can be taken for the end of the code. The `;` ends a last
  // statement written without one.
  const end = sourceFile.statements[sourceFile.statements.length - 1]!.end;
  edits.push({ start: end, end, text: `;var ${variables.join(', ')};` });
  return applyEdits(code, edits, sourceFile);
};

/**
 * Whether a private method's declaration allows it to become a function
 * (see {@link hidePrivateMethods}), whatever calls it.
 */
const canBecomeFunction = (
  declaration: ts.MethodDeclaration,
  classNode: ts.ClassLikeDeclaration,
): boolean => {
  if (
    isStatic(declaration) ||
    !declaration.body ||
    declaration.questionToken ||
    ts.getDecorators(declaration)?.length ||
    contains(declaration, (node) => node.kind === ts.SyntaxKind.SuperKeyword)
  ) {
    return false;
  }
  return !classNode.members
    .slice(0, classNode.members.indexOf(declaration))
    .some(
      (member) =>
        ts.isClassStaticBlockDeclaration(member) ||
        (ts.isPropertyDeclaration(member) &&
          isStatic(member) &&
          member.initializer !== undefined &&
          !isInert(member.initializer)),
    );
};

/**
 * Whether `test` holds for the node or anything inside it, nested functions
 * and classes included (which only makes a check for `super` or `arguments`
 * stricter).
 */
const contains = (node: ts.Node, test: (node: ts.Node) => boolean): boolean =>
  test(node) ||
  (ts.forEachChild(node, (child) => contains(child, test) || undefined) ??
    false);

/**
 * Whether evaluating a static field's initializer can't run any code, so
 * can't make an instance: a literal or a function, maybe in parentheses or
 * a type assertion.
 */
const isInert = (expression: ts.Expression): boolean => {
  const node = skipWrappers(expression);
  return (
    ts.isLiteralExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
};

/**
 * The call `use` is the method of, when it's `this.#m(…)` or `this.#m?.(…)`
 * with `this` an instance of `classNode` (see {@link instanceClassOf}), and
 * the code from `this` to the `(` is on one line, as the edit that replaces
 * it must be.
 */
const thisCall = (
  use: ts.PrivateIdentifier,
  classNode: ts.ClassLikeDeclaration,
  sourceFile: ts.SourceFile,
): ts.CallExpression | undefined => {
  const access = use.parent;
  if (
    !ts.isPropertyAccessExpression(access) ||
    access.questionDotToken ||
    access.expression.kind !== ts.SyntaxKind.ThisKeyword ||
    instanceClassOf(access.expression) !== classNode
  ) {
    return undefined;
  }
  const call = access.parent;
  if (!ts.isCallExpression(call) || call.expression !== access) {
    return undefined;
  }
  const callee = sourceFile.text.slice(
    access.getStart(sourceFile),
    call.arguments.pos,
  );
  return /[\n\r\u2028\u2029]/.test(callee) ? undefined : call;
};

/**
 * The class whose instance `this` is, when it's in an instance member's body,
 * parameters or field initializer (arrow functions inside count, as they
 * keep `this`). `undefined` for any other `this`: in a static member, a
 * function, an object literal's method, a computed key, `extends` or a
 * decorator.
 */
const instanceClassOf = (
  thisNode: ts.Node,
): ts.ClassLikeDeclaration | undefined => {
  const owner = ts.findAncestor(thisNode.parent, bindsThis);
  return owner &&
    (ts.isMethodDeclaration(owner) ||
      ts.isAccessor(owner) ||
      ts.isConstructorDeclaration(owner) ||
      ts.isPropertyDeclaration(owner)) &&
    ts.isClassLike(owner.parent) &&
    !isStatic(owner)
    ? owner.parent
    : undefined;
};

/**
 * Whether `this` inside the node is the node's own, or not the instance's:
 * a member or a function binds it, and a computed key, `extends` or a
 * decorator is evaluated outside the class's instances.
 */
const bindsThis = (node: ts.Node): boolean =>
  ts.isMethodDeclaration(node) ||
  ts.isAccessor(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isPropertyDeclaration(node) ||
  ts.isClassStaticBlockDeclaration(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isComputedPropertyName(node) ||
  ts.isHeritageClause(node) ||
  ts.isDecorator(node);

/**
 * Parses a module. The script kind comes from the file name, as a `.ts`
 * module can still hold types here (see pure-classes.ts).
 */
const parse = (code: string, filename: string): ts.SourceFile =>
  ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);

/**
 * Every class in a module, outer ones before the classes inside them, with
 * its private members and the uses of their names.
 */
const analyzeClasses = (sourceFile: ts.SourceFile): ClassInfo[] => {
  const classes: ClassInfo[] = [];
  /**
   * The innermost class around a use that declares the name: a private name
   * belongs to it.
   */
  const resolve = (name: string, scopes: ClassInfo[]) => {
    for (let index = scopes.length - 1; index >= 0; index--) {
      if (scopes[index]!.members.has(name)) return scopes[index];
    }
    return undefined;
  };

  /**
   * Visits `node`. `repeated` is whether the code it's in can run more than
   * once while the module is evaluated once: in a function that isn't
   * called at once, a loop, or an instance field's initializer.
   */
  const visit = (
    node: ts.Node,
    scopes: ClassInfo[],
    repeated: boolean,
  ): void => {
    if (ts.isClassLike(node)) {
      const members = new Map<string, ts.ClassElement[]>();
      for (const member of node.members) {
        if (!member.name || !ts.isPrivateIdentifier(member.name)) continue;
        const declarations = members.get(member.name.text) ?? [];
        declarations.push(member);
        members.set(member.name.text, declarations);
      }
      const info: ClassInfo = {
        node,
        index: classes.length,
        repeated,
        extendsAnother:
          node.heritageClauses?.some(
            (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
          ) ?? false,
        branded: false,
        members,
        uses: new Map(),
      };
      classes.push(info);
      const inner = [...scopes, info];
      // `extends` and the class's decorators are evaluated outside its body,
      // where its private names don't exist yet.
      ts.forEachChild(node, (child) =>
        visit(
          child,
          ts.isHeritageClause(child) || ts.isDecorator(child) ? scopes : inner,
          repeated ||
            // An instance field's initializer runs for each instance.
            (ts.isPropertyDeclaration(child) && !isStatic(child)),
        ),
      );
      return;
    }
    if (ts.isPrivateIdentifier(node)) {
      const scope = resolve(node.text, scopes);
      if (scope) {
        const uses = scope.uses.get(node.text) ?? [];
        uses.push(node);
        scope.uses.set(node.text, uses);
      }
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      ts.isPrivateIdentifier(node.left)
    ) {
      // `#m in object` asks whether the object has the class's brand, which
      // only a private member carries. The class that declares the name, and
      // every class around the check, keep their private methods.
      for (const scope of scopes) {
        scope.branded = true;
      }
    }
    const repeats =
      repeated ||
      (ts.isFunctionLike(node) && !isCalledAtOnce(node)) ||
      ts.isIterationStatement(node, false);
    ts.forEachChild(node, (child) => visit(child, scopes, repeats));
  };
  visit(sourceFile, [], false);
  return classes;
};

/**
 * `code` with `edits` made, its inline source map moved to match, or `code`
 * itself when there are none.
 */
const applyEdits = (
  code: string,
  edits: Edit[],
  sourceFile: ts.SourceFile,
): string => {
  if (edits.length === 0) {
    return code;
  }
  const mapEdit = shiftInlineSourceMap(edits, sourceFile);
  const all = mapEdit ? [...edits, mapEdit] : edits;
  // In source order, as the loop below expects. Edits never overlap.
  all.sort((a, b) => a.start - b.start);
  let result = '';
  let last = 0;
  for (const { start, end, text } of all) {
    result += code.slice(last, start) + text;
    last = end;
  }
  return result + code.slice(last);
};

/**
 * The declarations whose `name` binds an identifier in their scope (unlike
 * a property's or a method's).
 */
const BINDING_KINDS = new Set([
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.NamespaceImport,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
]);

/**
 * Whether anything in the module binds `name`, in any scope: a variable, a
 * parameter, a function, a class or an import.
 */
const bindsName = (sourceFile: ts.SourceFile, name: string): boolean =>
  contains(
    sourceFile,
    (node) =>
      ts.isIdentifier(node) &&
      node.text === name &&
      BINDING_KINDS.has(node.parent.kind) &&
      (node.parent as ts.NamedDeclaration).name === node,
  );

/**
 * Whether a class member is static.
 */
const isStatic = (member: ts.ClassElement): boolean =>
  ts
    .getModifiers(member as ts.HasModifiers)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ??
  false;

/**
 * Whether a function is called where it's written, and so runs once each
 * time the code around it does: `(() => {…})()`, as Angular wraps a
 * decorated class, or `(function () {…}())`. Parentheses around it don't
 * count. Only an arrow function, or a function expression without a name
 * that doesn't use `arguments`, can't run again: a name lets it call itself,
 * or leave by an assignment and be called later, and so does
 * `arguments.callee` in sloppy code.
 */
const isCalledAtOnce = (node: ts.Node): boolean => {
  if (
    !ts.isArrowFunction(node) &&
    !(
      ts.isFunctionExpression(node) &&
      !node.name &&
      !contains(
        node,
        (inner) => ts.isIdentifier(inner) && inner.text === 'arguments',
      )
    )
  ) {
    return false;
  }
  let callee: ts.Node = node;
  while (ts.isParenthesizedExpression(callee.parent)) {
    callee = callee.parent;
  }
  return (
    ts.isCallExpression(callee.parent) && callee.parent.expression === callee
  );
};

/**
 * A short hash of the file's path from `root`, in POSIX form so a Windows
 * build gives the same names.
 */
const keyForFile = (filename: string, root: string): string => {
  const relative = path.relative(root, filename).split(path.sep).join('/');
  return createHash('sha1').update(relative).digest('hex').slice(0, 6);
};

/**
 * The inline source map Angular's transformer and compiler append, as the
 * text of a `//` comment.
 */
const INLINE_SOURCE_MAP =
  /^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/]+=*)/;

/**
 * Where the base64 of the module's inline source map is: in the last `//`
 * comment at its top level that holds one, the one a bundler reads. Only a
 * comment between the module's statements, or before or after them, counts:
 * the same text in a template literal or a block comment is the code's own.
 * The map isn't always the last thing in the module: the plugin appends the
 * code that takes hot updates, and component scope IDs, after the one
 * Angular's compiler left (transform-module.ts).
 */
const findInlineSourceMap = (
  sourceFile: ts.SourceFile,
): { start: number; end: number } | undefined => {
  const { text } = sourceFile;
  let found: { start: number; end: number } | undefined;
  const readComments = (position: number) =>
    ts.forEachLeadingCommentRange(text, position, (start, end, kind) => {
      const match =
        kind === ts.SyntaxKind.SingleLineCommentTrivia &&
        INLINE_SOURCE_MAP.exec(text.slice(start, end));
      if (match) {
        found = { start: end - match[1]!.length, end };
      }
    });
  readComments(0);
  for (const statement of sourceFile.statements) {
    readComments(statement.end);
  }
  return found;
};

/**
 * The edit that moves the columns of the module's inline source map by
 * `edits`, made to the code the map was written for. None when it has no
 * inline map, or one this can't read: the build goes on, with a map that's as
 * wrong as it was.
 */
const shiftInlineSourceMap = (
  edits: Edit[],
  sourceFile: ts.SourceFile,
): Edit | undefined => {
  const found = findInlineSourceMap(sourceFile);
  if (!found) {
    return undefined;
  }
  let map: { mappings?: unknown };
  try {
    map = JSON.parse(
      Buffer.from(
        sourceFile.text.slice(found.start, found.end),
        'base64',
      ).toString('utf8'),
    );
  } catch {
    return undefined;
  }
  const mappings = map.mappings;
  if (typeof mappings !== 'string') {
    return undefined;
  }
  // The edits on each line, in order, by column.
  const editsByLine = new Map<
    number,
    Array<{ start: number; end: number; delta: number }>
  >();
  for (const { start, end, text } of edits) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    const lineEdits = editsByLine.get(line) ?? [];
    lineEdits.push({
      start: character,
      end: character + end - start,
      delta: text.length - (end - start),
    });
    editsByLine.set(line, lineEdits);
  }
  try {
    map.mappings = mappings
      .split(';')
      .map((segments, line) => {
        const lineEdits = editsByLine.get(line);
        return lineEdits ? shiftColumns(segments, lineEdits) : segments;
      })
      .join(';');
  } catch {
    return undefined;
  }
  return {
    ...found,
    text: Buffer.from(JSON.stringify(map)).toString('base64'),
  };
};

/**
 * One line of a source map's `mappings` with each segment's column moved past
 * the edits before it. A column inside an edit moves to the edit's start.
 */
const shiftColumns = (
  segments: string,
  edits: Array<{ start: number; end: number; delta: number }>,
): string => {
  const shift = (column: number): number => {
    let shifted = column;
    for (const { start, end, delta } of edits) {
      if (column >= end) shifted += delta;
      else if (column > start) shifted -= column - start;
    }
    return shifted;
  };
  // Each segment's first field is its column, relative to the segment
  // before it on the line; the other fields are left as they are.
  let column = 0;
  let previous = 0;
  return segments
    .split(',')
    .map((segment) => {
      if (segment === '') return segment;
      const [delta, next] = decodeVlq(segment);
      column += delta;
      const shifted = shift(column);
      const text = encodeVlq(shifted - previous) + segment.slice(next);
      previous = shifted;
      return text;
    })
    .join(',');
};

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The first base64 VLQ value in `text`, and where the next one starts. Throws
 * on a character that isn't base64, or a value that never ends, which would
 * otherwise read on forever.
 */
const decodeVlq = (text: string): [value: number, next: number] => {
  let value = 0;
  let shift = 0;
  let index = 0;
  let digit: number;
  do {
    digit = index < text.length ? BASE64.indexOf(text[index++]) : -1;
    if (digit < 0) {
      throw new Error(`Invalid source map segment: ${text}`);
    }
    value += (digit & 31) * 2 ** shift;
    shift += 5;
  } while (digit & 32);
  // The lowest bit is the sign.
  return [value % 2 ? -(value - 1) / 2 : value / 2, index];
};

const encodeVlq = (value: number): string => {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let text = '';
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    text += BASE64[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);
  return text;
};
