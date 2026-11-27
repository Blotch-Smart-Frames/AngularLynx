import { createRequire } from 'node:module';
import path from 'node:path';
import * as ts from 'typescript';
import { isAngularLynxPackageModule } from './layers.js';
import { isStrictEsmFile } from './strict-esm.js';
import { applyEdits } from './source-map-edits.js';

const RUNTIME = '@blotch/angular-lynx';
/**
 * The start of the name each import gives an enable function: a module can
 * import one itself (`ɵenableWebGL2`, as getContext()'s console warning
 * suggests), and a second binding of a name is a syntax error. The rest of
 * the function's name follows (`__angularLynxEnableWebGL2`), and a number
 * after it while the module already uses that name (see localNames).
 */
const LOCAL = '__angularLynx';

/** A JavaScript line terminator: CRLF (one, as ECMAScript counts it), LF, CR, LS or PS. */
const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/;

/**
 * The name a module asks for the WebGL2 context by. The runtime's `<canvas>`
 * has no other 3D context (`'webgl'` is null), so code that draws 3D with it
 * names it: three.js's `const contextName = 'webgl2'`, or an app's
 * `canvas.getContext('webgl2')`. A comment that mentions it matches too,
 * which only brings the context into a bundle that didn't need it.
 */
const WEBGL2 = /\bwebgl2\b/;

/**
 * The main thread's globals the runtime installs only for the apps that use
 * them, each by the enable function the build calls, and the names in a
 * module's code that ask for it (namedGlobals()). Lynx's main thread has none
 * of them, and they're in the runtime's network and element code
 * (network/enable.ts, lynx-element/intersection-observer.ts).
 *
 * - `fetch` comes with `Headers`, `Request` and `Response`, which the relayed
 *   `fetch` builds, so any of them asks for all four. So does what an app
 *   asks `HttpClient` for its default backend, `FetchBackend`, with:
 *   `provideHttpClient()`, `HttpClientModule` or `withFetch()`. Every app
 *   bundles `@angular/common/http`'s modules (`@angular/common` and
 *   `@angular/platform-browser` import them), so the names in them don't
 *   count (ANGULAR_UNUSED).
 * - `XMLHttpRequest` sends each request through `fetch`, and brings it too.
 *   `withXhr()` and `HttpXhrBackend` ask for it.
 * - `IntersectionObserver` is also what Angular's `@defer (on viewport)`
 *   observes with, so the instructions a template compiles to for one ask for
 *   it: Angular core names the observer in every app (ANGULAR_UNUSED).
 * - `TextEncoder`, `TextDecoder`, `ReadableStream` and `Blob` each by name
 *   (#760). `fetch` brings all four, since code that reads a response uses
 *   them without naming them, and so do `@angular/common`'s HTTP modules,
 *   whose names don't count either (ANGULAR_UNUSED). `@angular/localize`'s
 *   message ids name `TextEncoder`, so an app with `$localize` gets it.
 *   `Blob` also comes where a module names a canvas's `toBlob` or
 *   `convertToBlob`, which make one.
 * - The 2D canvas context, with its classes as globals (#729), comes where a
 *   module asks for it as code does, with the string `'2d'`
 *   (`getContext('2d')`): unlike WEBGL2, not the bare word, which hashes,
 *   CSS and comments hold. It comes too where a module names one of the
 *   context's classes, which code checks a context against, patches, or
 *   builds a `Path2D` from, maybe before it asks for a context. No module of
 *   Angular's or rxjs's names any of them.
 */
const GLOBALS: readonly { enable: string; names: readonly string[] }[] = [
  {
    enable: 'ɵenableCanvas2D',
    names: [
      '2d',
      'CanvasRenderingContext2D',
      'OffscreenCanvasRenderingContext2D',
      'CanvasGradient',
      'CanvasPattern',
      'TextMetrics',
      'Path2D',
    ],
  },
  {
    enable: 'ɵenableFetch',
    names: [
      'fetch',
      'Headers',
      'Request',
      'Response',
      'provideHttpClient',
      'HttpClientModule',
      'withFetch',
      'FetchBackend',
    ],
  },
  {
    enable: 'ɵenableXMLHttpRequest',
    names: ['XMLHttpRequest', 'withXhr', 'HttpXhrBackend'],
  },
  {
    enable: 'ɵenableIntersectionObserver',
    names: [
      'IntersectionObserver',
      'ɵɵdeferOnViewport',
      'ɵɵdeferPrefetchOnViewport',
      'ɵɵdeferHydrateOnViewport',
    ],
  },
  { enable: 'ɵenableTextEncoder', names: ['TextEncoder'] },
  { enable: 'ɵenableTextDecoder', names: ['TextDecoder'] },
  { enable: 'ɵenableReadableStream', names: ['ReadableStream'] },
  { enable: 'ɵenableBlob', names: ['Blob', 'toBlob', 'convertToBlob'] },
];

/**
 * A Unicode or hexadecimal escape, with which a string or an identifier can
 * spell a name (`\u0066`, `\u{66}`, `\x66`).
 */
const ESCAPE = /\\[ux]/;

const GLOBAL_NAMES: ReadonlySet<string> = new Set(
  GLOBALS.flatMap(({ names }) => names),
);

/**
 * A string's line continuation, a backslash before a line terminator, which
 * adds nothing to the string: `'2\<newline>d'` is `'2d'`.
 */
const CONTINUATION = String.raw`(?:\\(?:\r\n|[\n\r\u2028\u2029]))*`;

/**
 * The ways a string can spell one character that ESCAPE doesn't find: the
 * character itself, a legacy octal escape (`\62` is `2`), and for a
 * character with no escape of its own, the character after a backslash
 * (`\d` is `d`).
 */
/**
 * The letters a backslash makes another character of in a string (`\n` is a
 * newline), or starts an escape with (`\x32`).
 */
const ESCAPE_LETTERS: ReadonlySet<string> = new Set([
  'b',
  'f',
  'n',
  'r',
  't',
  'v',
  'u',
  'x',
]);

const stringCharacter = (character: string): string => {
  const literal = character.replace(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`);
  const spellings = [
    literal,
    String.raw`\\0*` + character.charCodeAt(0).toString(8),
  ];
  if (!/\d/.test(character) && !ESCAPE_LETTERS.has(character)) {
    spellings.push(String.raw`\\` + literal);
  }
  return `(?:${spellings.join('|')})`;
};

/**
 * A string of only the name, in quotes or backticks, spelled any way
 * namedGlobals() reads as the name, apart from the escapes ESCAPE finds.
 */
const quotedName = (name: string): RegExp =>
  new RegExp(
    `['"\`]${CONTINUATION}${[...name]
      .map((character) => stringCharacter(character) + CONTINUATION)
      .join('')}['"\`]`,
  );

/**
 * For each name that isn't an identifier, `2d`, the strings that spell it
 * (see mayName()).
 */
const QUOTED_NAMES: ReadonlyMap<string, RegExp> = new Map(
  [...GLOBAL_NAMES]
    .filter((name) => /^\d/.test(name))
    .map((name) => [name, quotedName(name)]),
);

/**
 * Whether the module's text can hold the name, as namedGlobals() reads it,
 * before it's parsed. A name that isn't an identifier, `2d`, can only be a
 * string's, so it's looked for in quotes: bare, it's in hashes, numbers and
 * CSS of many modules that would be parsed for nothing. A string can spell
 * it with escapes and line continuations, which QUOTED_NAMES (or ESCAPE)
 * finds, so those modules are parsed too.
 */
const mayName = (code: string, name: string): boolean =>
  QUOTED_NAMES.get(name)?.test(code) ?? code.includes(name);

/**
 * Names that Angular's packages use for code an app doesn't run, or runs only
 * through a name of its own. Every app bundles these packages' modules, so
 * any of these would bring a global into every app:
 *
 * - `@angular/core`: `@defer (on viewport)`'s observer, which only a
 *   template's `ɵɵdefer…OnViewport` instructions reach (see GLOBALS), and
 *   those instructions, which core defines and exports.
 * - `@angular/common`: `HttpClient`'s backends, which come with
 *   `@angular/common`'s and `@angular/platform-browser`'s modules but only
 *   run when an app names one of the APIs that provide them (see GLOBALS),
 *   and the body APIs they and `HttpRequest` read and write a body with,
 *   which `fetch` brings: `TextDecoder`, `Blob`, and `TextEncoder` for the
 *   HTTP transfer cache's keys.
 * - `@angular/platform-browser` and `@angular/router`: `fetch` to load a
 *   component's `templateUrl` and `styleUrl`, only with JIT (`ngJitMode`),
 *   which AOT builds leave out.
 *
 * A test checks every name Angular's packages use against this list, so a
 * new one is looked at when Angular adds it (on-demand.test.ts).
 */
export const ANGULAR_UNUSED: Readonly<Record<string, readonly string[]>> = {
  '@angular/common': [
    'fetch',
    'Headers',
    'Request',
    'Response',
    'XMLHttpRequest',
    'provideHttpClient',
    'HttpClientModule',
    'withFetch',
    'FetchBackend',
    'withXhr',
    'HttpXhrBackend',
    'TextEncoder',
    'TextDecoder',
    'Blob',
  ],
  '@angular/core': [
    'IntersectionObserver',
    'ɵɵdeferOnViewport',
    'ɵɵdeferPrefetchOnViewport',
    'ɵɵdeferHydrateOnViewport',
  ],
  '@angular/platform-browser': ['fetch'],
  '@angular/router': ['fetch'],
};

/** An Angular package's name, from the path of one of its modules. */
const ANGULAR_PACKAGE = /[\\/]node_modules[\\/](@angular[\\/][^\\/]+)[\\/]/;

const scriptKind = (filename: string): ts.ScriptKind =>
  /\.[cm]?tsx?$/.test(filename) ? ts.ScriptKind.TS : ts.ScriptKind.JS;

/**
 * The names of GLOBALS a module's code uses, each with how many times: as
 * an identifier, anywhere (a
 * global, `window.fetch`, `self.fetch`, a library's `root.fetch`), or as a
 * string of only the name (`globalThis['fetch']`, `'fetch' in window`).
 * Comments and other strings don't count, unlike WEBGL2's: a library's prose
 * says "fetch" and "request" often, and an error message such as Angular's
 * "Response status" isn't a use.
 *
 * @param code - The module's code.
 * @param filename - The module's path, for whether it's TypeScript.
 */
export const namedGlobals = (
  code: string,
  filename: string,
): Map<string, number> => {
  const found = new Map<string, number>();
  // Most modules name none of them, and parsing is the slow part. A string or
  // an identifier can spell a name with escapes (`'\u0066etch'` is
  // `'fetch'`), which no search of the text finds, so a module with any goes
  // on to be parsed: its tokens hold the names decoded.
  if (
    ![...GLOBAL_NAMES].some((name) => mayName(code, name)) &&
    !ESCAPE.test(code)
  ) {
    return found;
  }
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(filename),
  );
  const visit = (node: ts.Node): void => {
    if (
      (ts.isIdentifier(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
      GLOBAL_NAMES.has(node.text)
    ) {
      found.set(node.text, (found.get(node.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

/**
 * The enable functions a main-thread module needs, in GLOBALS's order.
 *
 * @param code - The module's code.
 * @param filename - The module's path.
 */
const globalsAskedFor = (code: string, filename: string): string[] => {
  const names = namedGlobals(code, filename);
  const angularPackage = ANGULAR_PACKAGE.exec(filename)?.[1].replace('\\', '/');
  for (const name of (angularPackage && ANGULAR_UNUSED[angularPackage]) ?? []) {
    names.delete(name);
  }
  return GLOBALS.filter((global) =>
    global.names.some((name) => names.has(name)),
  ).map((global) => global.enable);
};

/**
 * Gives a main-thread module what it asks for of the runtime's code that not
 * every app needs, by calling the runtime's enable function for each at its
 * top: `ɵenableWebGL2()` when it names `'webgl2'`, and the enable function of
 * each global of GLOBALS it names.
 *
 * PrimJS reads a script's whole bytecode as it loads it, so every app paid in
 * memory for the code, whether it ran or not: the WebGL2 context (about
 * 37 kB of a minified main-thread script, #707), the 2D context (#729), the
 * relayed `fetch` and
 * `XMLHttpRequest`, `IntersectionObserver` (#719), and `TextEncoder`,
 * `TextDecoder`, `ReadableStream` and `Blob` (#760). The runtime keeps each
 * out of reach until its enable function runs, so an app that never names it
 * leaves it out. A name an app builds at runtime isn't seen: getContext()
 * says so on the console, and an app can call the enable function itself.
 *
 * AngularLynx's own packages are left out: the runtime names these itself,
 * and would bring them into every app. So are names in Angular's packages
 * that every app bundles but doesn't run (ANGULAR_UNUSED). The calls run
 * before the rest of the module, after the modules it imports, which call
 * them themselves if they need them.
 *
 * @param code - The module's code, as it will be bundled.
 * @param filename - The module's path.
 * @param runtime - The specifier the calls import the runtime from.
 * @returns The code with the calls at its top, or `code` itself.
 */
export const enableOnDemand = (
  code: string,
  filename: string,
  runtime: string = RUNTIME,
): string => {
  if (isAngularLynxPackageModule(filename)) return code;
  const enables = [
    ...(WEBGL2.test(code) ? ['ɵenableWebGL2'] : []),
    ...globalsAskedFor(code, filename),
  ];
  if (enables.length === 0) return code;
  const specifier = JSON.stringify(runtime);
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(filename),
  );
  // A hashbang must stay first, and the calls go on the line after it. They
  // never add a line, so a source map the module carries still fits. A
  // module that is only a hashbang has no code to ask for anything.
  // Any of JavaScript's line terminators ends the hashbang, and the calls go
  // after the whole of it: inside a CRLF they would make two line breaks.
  let head = 0;
  if (code.startsWith('#!')) {
    const end = LINE_TERMINATOR.exec(code);
    if (!end) return code;
    head = end.index + end[0].length;
  }
  // An `.mjs` file, or a `.js` file in a `"type": "module"` package, is an ES
  // module even with no import or export, and has no `require` (strict-esm.ts
  // builds it as one).
  if (ts.isExternalModule(sourceFile) || isStrictEsmFile(filename)) {
    // Imports are hoisted, so the import can go anywhere; the calls go after
    // the module's own imports, which run first whatever their place.
    const locals = localNames(code, sourceFile, enables);
    const bindings = enables
      .map((enable, i) => `${enable} as ${locals[i]}`)
      .join(', ');
    const calls = locals.map((local) => `${local}(); `).join('');
    return applyEdits(code, [
      {
        start: head,
        end: head,
        text: `import { ${bindings} } from ${specifier}; ${calls}`,
      },
    ]);
  }
  // A CommonJS module (or a script) has no imports. The calls go after its
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
  const calls = enables
    .map((enable) => `require(${specifier}).${enable}();`)
    .join('');
  return applyEdits(code, [{ start: offset, end: offset, text: `;${calls} ` }]);
};

/**
 * A name for each enable function's import that the module doesn't use:
 * neither in its text nor, decoded, among its identifiers, which can be
 * written with escapes (`\u005f_angularLynxEnableWebGL2` is
 * `__angularLynxEnableWebGL2`).
 *
 * @param code - The module's code.
 * @param sourceFile - The module, parsed.
 * @param enables - The enable functions, such as `ɵenableWebGL2`.
 */
const localNames = (
  code: string,
  sourceFile: ts.SourceFile,
  enables: readonly string[],
): string[] => {
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return enables.map((enable) => {
    // `ɵenableWebGL2` → `__angularLynxEnableWebGL2`.
    const base = `${LOCAL}${enable.charAt(1).toUpperCase()}${enable.slice(2)}`;
    let name = base;
    for (let n = 2; code.includes(name) || identifiers.has(name); n++) {
      name = `${base}${n}`;
    }
    // Keeps the next function's name off this one.
    identifiers.add(name);
    return name;
  });
};

/**
 * The runtime's entry as the app resolves it, so a third-party module a call
 * goes in reaches the same copy: under pnpm, three.js can't resolve
 * `@blotch/angular-lynx` from its own folder. The bare specifier where the app
 * can't resolve it either, so the build says so where it can.
 *
 * @param root - The app's folder.
 */
export const resolveRuntimeEntry = (root: string): string => {
  try {
    return createRequire(path.join(root, 'package.json')).resolve(RUNTIME);
  } catch {
    return RUNTIME;
  }
};
