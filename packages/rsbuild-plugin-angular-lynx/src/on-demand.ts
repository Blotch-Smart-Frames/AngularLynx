import { createRequire } from 'node:module';
import path from 'node:path';
import * as ts from 'typescript';
import { isAngularLynxPackageModule } from './layers.js';

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
 */
const GLOBALS: readonly { enable: string; names: readonly string[] }[] = [
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
];

const GLOBAL_NAMES: ReadonlySet<string> = new Set(
  GLOBALS.flatMap(({ names }) => names),
);

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
 *   run when an app names one of the APIs that provide them (see GLOBALS).
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
  // Most modules name none of them, and parsing is the slow part.
  if (![...GLOBAL_NAMES].some((name) => code.includes(name))) return found;
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
 * 37 kB of a minified main-thread script, #707), the relayed `fetch` and
 * `XMLHttpRequest`, and `IntersectionObserver` (#719). The runtime keeps each
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
  // An `.mjs` or `.mts` file is an ES module even with no import or export,
  // and has no `require` (strict-esm.ts builds it as one).
  if (ts.isExternalModule(sourceFile) || /\.m[jt]s$/.test(filename)) {
    // Imports are hoisted, so the import can go anywhere; the calls go after
    // the module's own imports, which run first whatever their place.
    const locals = localNames(code, sourceFile, enables);
    const bindings = enables
      .map((enable, i) => `${enable} as ${locals[i]}`)
      .join(', ');
    const calls = locals.map((local) => `${local}(); `).join('');
    return `${code.slice(0, head)}import { ${bindings} } from ${specifier}; ${calls}${code.slice(head)}`;
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
  return `${code.slice(0, offset)};${calls} ${code.slice(offset)}`;
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
