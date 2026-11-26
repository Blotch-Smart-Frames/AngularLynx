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
  if (isAngularLynxPackageModule(filename, packagesDir)) {
    return renamePrivateMethods(code, filename, options);
  }
  if (isAppModule(filename, packagesDir)) {
    return hidePrivateMethods(code, filename, options);
  }
  return code;
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
 * **Constant fields start on the prototype.** An instance field whose
 * initializer is a constant (`null`, `false`, `''`, a number, `void 0`, or
 * none at all) doesn't become a property of each instance: its declaration
 * goes, and one `static { this.prototype[__x_<key><n>] = v; … }` at the start
 * of the class's body puts the defaults on the prototype (a field without an
 * initializer needs none: a missing property reads `undefined` too), before
 * any static initializer, which could make an instance and read one. An
 * instance reads the default from its prototype and gets a property of its
 * own only once the field is written. A declaration that spans lines stays,
 * as removing it would remove a line. In PrimJS every own property costs each
 * instance about 45 bytes: on the iOS Simulator, 5,000 objects with 55 fields
 * took 12.6 MB of its heap, and 5,000 with 10 took 2.6 MB. `LynxElement`
 * has 41 private fields, most of them `null` or `false` until something sets
 * them, and the runtime makes one for every element, text node and anchor:
 * a screen of 5,000 views took 4 MB less with them on the prototype
 * (issue #586). A constant is the same value for every instance and can't
 * run code, so it doesn't matter when it's read; only code that misuses the
 * field sees a difference, as above (reading it on another instance of the
 * class before its fields are initialized gives the default, not a TypeError).
 * An initializer that makes an object (`[]`, `new Map()`) still runs for each
 * instance, as each needs its own. So do a subclass's fields (a class with
 * `extends`): when its base's constructor returns another object, the
 * subclass's fields are defined on that object, which doesn't inherit the
 * subclass's prototype. `LynxElement` has no base, so it loses nothing.
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
    // The class's constant fields' defaults (see above), which a static block
    // at the start of its body puts on the prototype: before any static
    // initializer, which could make an instance and read one.
    const defaults: string[] = [];
    const defaultsAt = edits.length;
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
      // A subclass's fields stay on each instance: its base's constructor
      // can return another object, which then gets them natively but
      // doesn't inherit the subclass's prototype (see above).
      const initial =
        fieldStatic || info.extendsAnother
          ? undefined
          : prototypeDefault(field as ts.PropertyDeclaration, sourceFile);
      if (initial !== undefined) {
        // A constant field starts on the prototype (see above): its
        // declaration goes, and only its uses are keyed.
        const start = field!.getStart(sourceFile);
        edits.push(
          ...fieldEdits.filter(
            (edit) => edit.start < start || edit.start >= field!.end,
          ),
          { start, end: field!.end, text: '' },
        );
        if (initial !== null) {
          defaults.push(`this.prototype[${text}] = ${initial};`);
        }
        symbols.push(`${text} = Symbol(${JSON.stringify(name.slice(1))})`);
        continue;
      }
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
    if (defaults.length > 0) {
      // Ahead of the class's other edits, so it comes before an edit to a
      // first member that starts right after the `{`.
      const at = info.node.members.pos;
      edits.splice(defaultsAt, 0, {
        start: at,
        end: at,
        text: ` static { ${defaults.join(' ')} } `,
      });
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
 * What an instance private field starts as, when it can start on the
 * prototype instead of on each instance (see {@link renamePrivateMethods}):
 * the initializer's text when it's a constant, a literal that is the same
 * value for every instance (`null`, `true`, `false`, a number, maybe negated,
 * a string or `void 0`); `null` when it has no initializer, so starts
 * `undefined`, which a missing property reads as too; and `undefined` when
 * it must stay on each instance: an initializer that makes an object (`[]`,
 * `new Map()`), reads anything, or spans lines (the edit must not remove a
 * line).
 */
const prototypeDefault = (
  field: ts.PropertyDeclaration,
  sourceFile: ts.SourceFile,
): string | null | undefined => {
  const { initializer } = field;
  // Removing a declaration that spans lines would remove a line (a comment
  // inside it can), and the edits must leave every line where it was.
  const declaration = sourceFile.text.slice(
    field.getStart(sourceFile),
    field.end,
  );
  if (/[\n\r\u2028\u2029]/.test(declaration)) return undefined;
  if (!initializer) return null;
  let value: ts.Expression = initializer;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value)
  ) {
    value = value.expression;
  }
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.MinusToken
  ) {
    value = value.operand;
  }
  const constant =
    ts.isNumericLiteral(value) ||
    ts.isStringLiteral(value) ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isVoidExpression(value) && ts.isNumericLiteral(value.expression));
  return constant ? initializer.getText(sourceFile) : undefined;
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
const isInert = (node: ts.Expression): boolean => {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return isInert(node.expression);
  }
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
