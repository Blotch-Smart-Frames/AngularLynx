import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { applyEdits } from './source-map-edits.js';

/**
 * The folder of the built-ins' modules (`es-builtins/`), next to the plugin's
 * bundled index in its dist folder, and next to this file in the tests.
 */
export const ES_BUILTINS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './es-builtins',
);

/**
 * The ECMAScript built-ins Lynx's JavaScript engines lack, each module of
 * `es-builtins/` with the names that call for it.
 *
 * The main thread, where Angular and the app run, implements ES2019 and some
 * later additions. Probed on Lynx 4.1, iOS and Android alike, it lacks most of
 * what ES2021 to ES2026 added, from `.at()` and `toSorted()` to
 * `Object.groupBy()` and the Set methods. The background thread also lacks
 * `Promise.allSettled()` and `Promise.any()`. Libraries written for current
 * browsers call these freely, often at module load, where a missing one throws
 * "not a function" and blanks the app before it renders, while every spec
 * passes in Node.
 *
 * The modules add every built-in up to ES2026 that JavaScript can define next
 * to the engine's own, and `String.prototype.normalize()`, older but missing
 * too. They leave out what only the engine can provide, rather than replace a
 * constructor: RegExp's `d` and `v` flags, Error's `cause` option,
 * `JSON.parse` source text access, resizable ArrayBuffers and `transfer()`,
 * `Atomics.waitAsync` and `Float16Array`. They're written out rather than
 * taken from core-js: `core-js/es` adds about 400 kB, and also replaces
 * `Promise`, `Set` or `RegExp#exec` wherever core-js judges the engine's own
 * lacking.
 *
 * `Iterator` is the one global; the rest are methods, so only a property
 * name asks for them (see namedBuiltins). The iterator helpers' names are
 * the array methods' too, so nearly every app carries them.
 */
export const ES_BUILTINS: readonly {
  readonly file: string;
  readonly names: readonly string[];
}[] = [
  { file: 'at.js', names: ['at'] },
  { file: 'array-find-last.js', names: ['findLast', 'findLastIndex'] },
  {
    file: 'change-array-by-copy.js',
    names: ['toReversed', 'toSorted', 'toSpliced', 'with'],
  },
  { file: 'string-normalize.js', names: ['normalize'] },
  { file: 'well-formed-strings.js', names: ['isWellFormed', 'toWellFormed'] },
  { file: 'string-replace-all.js', names: ['replaceAll'] },
  { file: 'object-has-own.js', names: ['hasOwn'] },
  { file: 'group-by.js', names: ['groupBy'] },
  { file: 'promise-all-settled.js', names: ['allSettled'] },
  { file: 'promise-any.js', names: ['any'] },
  { file: 'promise-with-resolvers.js', names: ['withResolvers'] },
  { file: 'promise-try.js', names: ['try'] },
  { file: 'array-from-async.js', names: ['fromAsync'] },
  {
    file: 'set-methods.js',
    names: [
      'union',
      'intersection',
      'difference',
      'symmetricDifference',
      'isSubsetOf',
      'isSupersetOf',
      'isDisjointFrom',
    ],
  },
  {
    file: 'iterator-helpers.js',
    names: [
      // Iterator.from() and Iterator.concat() too, and `instanceof Iterator`.
      'Iterator',
      'map',
      'filter',
      'take',
      'drop',
      'flatMap',
      'reduce',
      'toArray',
      'forEach',
      'some',
      'every',
      'find',
    ],
  },
  { file: 'regexp-escape.js', names: ['escape'] },
  { file: 'math-f16round.js', names: ['f16round'] },
  { file: 'math-sum-precise.js', names: ['sumPrecise'] },
  { file: 'error-is-error.js', names: ['isError'] },
  {
    file: 'uint8array-base64.js',
    names: [
      'fromBase64',
      'fromHex',
      'toBase64',
      'toHex',
      'setFromBase64',
      'setFromHex',
    ],
  },
  { file: 'upsert.js', names: ['getOrInsert', 'getOrInsertComputed'] },
  { file: 'number-to-locale-string.js', names: ['toLocaleString'] },
];

/** The built-ins that are globals rather than methods. */
const GLOBALS: ReadonlySet<string> = new Set(['Iterator']);

const NAMES: ReadonlySet<string> = new Set(
  ES_BUILTINS.flatMap(({ names }) => names),
);

/** A JavaScript line terminator: CRLF (one, as ECMAScript counts it), LF, CR, LS or PS. */
const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/;

/**
 * Whether an identifier is a property's name: read (`a.at`, `a?.at`), taken
 * apart (`const { at } = a`, `({ at } = a)`) or given (`{ at: 1 }`, a class's
 * `toArray()`). Giving one isn't a use, but a destructuring pattern can look
 * like an object literal until its `=`, and counting both only costs bytes.
 */
const isPropertyName = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  return (
    ((ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
      parent.name === node) ||
    ts.isShorthandPropertyAssignment(parent) ||
    // `{ at: last }` names the property first, `{ at }` only once.
    (ts.isBindingElement(parent) &&
      (parent.propertyName === node ||
        (parent.propertyName === undefined && parent.name === node)))
  );
};

/** The operators that compare a string rather than use it. */
const COMPARISONS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/**
 * Whether a string can be the name a property is reached by: a key
 * (`a['at']`, `{ 'at': x } = a`), the left of an `in`, an argument
 * (`Reflect.get(a, 'at')`), or a value that can end up as one
 * (`const method = sorted ? 'toSorted' : 'slice'`). Not data that only holds
 * the text: an item of a list (the runtime's canvas blend modes include
 * `'difference'`), a property's value (`providedIn: 'any'`), or what a
 * comparison or a `case` matches against.
 */
const mayNameProperty = (
  node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
): boolean => {
  const parent = node.parent;
  return !(
    ts.isArrayLiteralExpression(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
    (ts.isBinaryExpression(parent) &&
      COMPARISONS.has(parent.operatorToken.kind)) ||
    ts.isCaseClause(parent)
  );
};

/**
 * The names of ES_BUILTINS a module's code can call the built-in by, as Babel's
 * `useBuiltIns: 'usage'` finds them: a global as any identifier, and a method
 * as a property's name, or a string that can name one. A local variable
 * or function named `difference` or `fromHex` isn't a use, nor is a comment
 * or other text ("at", "try", "with"), which nearly every module has.
 *
 * A name built at runtime (`a['to' + 'Sorted']`) isn't seen. Neither is a
 * method of an object the module only passes on to code that calls it, but
 * that code names it itself.
 *
 * @param sourceFile - The module, parsed with its parent nodes.
 */
export const namedBuiltins = (sourceFile: ts.SourceFile): Set<string> => {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      NAMES.has(node.text) &&
      (GLOBALS.has(node.text) || isPropertyName(node))
    ) {
      found.add(node.text);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      NAMES.has(node.text) &&
      mayNameProperty(node)
    ) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

/**
 * Whether `file` is one of the built-ins' own modules, which name every
 * method they define.
 */
const isBuiltinModule = (file: string, dir: string): boolean => {
  const relative = path.relative(dir, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** Whether each folder's nearest `package.json` has `"type": "module"`. */
const modulePackageFolders = new Map<string, boolean>();

/**
 * Whether `file`'s nearest `package.json` has `"type": "module"`, as rspack
 * reads it for strict-esm.ts's rule. A folder with none, up to the root, is
 * CommonJS's, as it is to Node.
 *
 * @param file - The module's path.
 */
const isInModulePackage = (file: string): boolean => {
  const folder = path.dirname(file);
  let isModule = modulePackageFolders.get(folder);
  if (isModule === undefined) {
    let text: string | undefined;
    try {
      text = readFileSync(path.join(folder, 'package.json'), 'utf8');
    } catch {
      // No package.json here: the folder above decides.
    }
    if (text !== undefined) {
      try {
        isModule = (JSON.parse(text) as { type?: unknown }).type === 'module';
      } catch {
        // One rspack can't read either, which then fails the build itself.
        isModule = false;
      }
    } else {
      isModule =
        path.dirname(folder) !== folder &&
        isInModulePackage(path.join(path.dirname(folder), 'package.json'));
    }
    modulePackageFolders.set(folder, isModule);
  }
  return isModule;
};

/**
 * Imports, at the top of a module, the module of each built-in Lynx lacks
 * that the module names (ES_BUILTINS), so an app carries only those its code
 * can call.
 *
 * They all used to load before the app, with the build's first preEntry
 * (polyfills.js): about 20 kB of every app's main-thread script, and PrimJS
 * reads a script's whole bytecode as it loads it, at about 9 bytes of heap
 * per byte (#707, #720). Imported by the modules that need them, they still
 * run before those modules' code, as libraries that call them at module load
 * need. A module that rspack leaves out, such as an unused one of a
 * `"sideEffects": false` package, takes its imports with it.
 *
 * Every module but the built-ins' own is looked at, AngularLynx's packages
 * included: the runtime calls `.at()`. Naming a method of something else
 * (Angular's `Location.normalize()`) only brings in a module the app didn't
 * need, a few hundred bytes.
 *
 * @param code - The module's code, as it will be bundled.
 * @param filename - The module's path.
 * @param dir - The folder of the built-ins' modules.
 * @returns The code with the imports at its top, or `code` itself.
 */
export const importEsBuiltinsWhereNamed = (
  code: string,
  filename: string,
  dir: string = ES_BUILTINS_DIR,
): string => {
  // Most modules name at least one, but text that names none needs no parse.
  if (
    isBuiltinModule(filename, dir) ||
    // A name can be written with escapes (`a.\u0061t(-1)`), which only the
    // parse decodes.
    (!code.includes('\\') && ![...NAMES].some((name) => code.includes(name)))
  ) {
    return code;
  }
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?tsx?$/.test(filename) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const names = namedBuiltins(sourceFile);
  const specifiers = ES_BUILTINS.filter((builtin) =>
    builtin.names.some((name) => names.has(name)),
  ).map((builtin) => JSON.stringify(path.join(dir, builtin.file)));
  if (specifiers.length === 0) return code;
  // A hashbang must stay first, and the imports go on the line after it. They
  // never add a line, so a source map the module carries still fits. Any of
  // JavaScript's line terminators ends the hashbang, and the imports go after
  // the whole of it: inside a CRLF they would make two line breaks. A module
  // that is only a hashbang names nothing.
  let head = 0;
  if (code.startsWith('#!')) {
    const end = LINE_TERMINATOR.exec(code) as RegExpExecArray;
    head = end.index + end[0].length;
  }
  // An `.mjs` or `.mts` file is an ES module even with no import or export,
  // and so is a `.js` file in a `"type": "module"` package: neither has
  // `require` (strict-esm.ts builds both as ES modules). Imports run in the
  // order they're written, so these, first, run before the module's own.
  if (
    ts.isExternalModule(sourceFile) ||
    /\.m[jt]s$/.test(filename) ||
    (filename.endsWith('.js') && isInModulePackage(filename))
  ) {
    const imports = specifiers.map((specifier) => `import ${specifier}; `);
    return applyEdits(code, [
      { start: head, end: head, text: imports.join('') },
    ]);
  }
  // A CommonJS module (or a script) has no imports. The requires go after its
  // directives: before a `'use strict'`, it would stop being one. The `;`
  // ends a directive written without one.
  let offset = head;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    offset = statement.end;
  }
  const requires = specifiers.map((specifier) => `require(${specifier});`);
  return applyEdits(code, [
    { start: offset, end: offset, text: `;${requires.join('')} ` },
  ]);
};
