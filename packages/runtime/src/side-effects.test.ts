import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The runtime's package.json says `"sideEffects": false`, and an app's build
// drops whatever of it the app doesn't use: the Router and the outlets for an
// app without them, and nearly everything on the background thread, which
// runs no components. A module-level statement that does something (an
// assignment, a call, a class's `static {}` block) is a side effect of loading
// its module, so bundlers keep it, and everything it reaches, in every bundle
// that imports the runtime. Five `static {}` blocks and two `Object.assign()`
// calls once kept the Router, Angular's renderer and the WebGL context in the
// background thread's bundle, more than doubling it. This keeps such
// statements to the modules whose job is to install something when they load.

const src = dirname(fileURLToPath(import.meta.url));

/**
 * The modules that do something when they load on purpose: those that install
 * globals or the bridges between the threads, which runtime.ts imports for
 * that, and the base64 table.
 */
const INSTALLERS = new Set([
  'lib/background-call.ts',
  'lib/error-reporting.ts',
  'lib/exposure/global-exposure-bridge.ts',
  'lib/global-callbacks.ts',
  'lib/lynx-logger/lynx-logger.ts',
  // Fills its decoding table, which the atob() that polyfills.ts installs on
  // both threads needs.
  'lib/network/base64.ts',
  'lib/polyfills.ts',
]);

/**
 * What a module can have at its top level without doing anything.
 */
const isDeclaration = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) ||
  ts.isImportEqualsDeclaration(statement) ||
  ts.isExportDeclaration(statement) ||
  ts.isTypeAliasDeclaration(statement) ||
  ts.isInterfaceDeclaration(statement) ||
  ts.isFunctionDeclaration(statement) ||
  ts.isVariableStatement(statement) ||
  ts.isClassDeclaration(statement) ||
  // Angular's build wraps a TypeScript enum's IIFE in a pure one.
  ts.isEnumDeclaration(statement) ||
  // `declare global { … }` holds only types.
  ts.isModuleDeclaration(statement) ||
  ts.isEmptyStatement(statement);

/**
 * The runtime's shipped sources: not its tests or test doubles.
 */
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return path === join(src, 'lib', 'testing') ? [] : sources(path);
    }
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
      ? [path]
      : [];
  });

const parsed = sources(src).map((path) => ({
  name: relative(src, path).split(sep).join('/'),
  file: ts.createSourceFile(
    path,
    readFileSync(path, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
  ),
}));

/**
 * Where a node is, as `file:line`, for the failure message.
 */
const at = (name: string, file: ts.SourceFile, node: ts.Node): string =>
  `${name}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;

describe('module side effects', () => {
  it('finds the sources', () => {
    // A wrong path would make the tests below pass on nothing.
    expect(parsed.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'public-api.ts',
        'lib/router/lynx-location-strategy.ts',
        ...INSTALLERS,
      ]),
    );
  });

  it('has statements that do something only in the installers', () => {
    const found = parsed.flatMap(({ name, file }) =>
      INSTALLERS.has(name)
        ? []
        : file.statements
            .filter((statement) => !isDeclaration(statement))
            .map(
              (statement) =>
                `${at(name, file, statement)} ${statement.getText(file).split('\n')[0]}`,
            ),
    );

    expect(found).toEqual([]);
  });

  it("decides each module-level block's thread at build time", () => {
    // The build defines __MAIN_THREAD__, so rspack drops a block that tests it
    // from the other thread's bundle, with everything only that block reaches.
    // It can't see through a call: behind `if (isMainThread())`, polyfills.ts
    // kept the network classes (Blob, ReadableStream, TextDecoder) in the
    // background thread's script, and the minifier, which does see that the
    // block never runs, left part of them there (issue #717). Test
    // `typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__` instead
    // where unit tests load the module without the define.
    const found: string[] = [];
    for (const { name, file } of parsed) {
      for (const statement of file.statements) {
        if (!ts.isIfStatement(statement)) continue;
        const visit = (node: ts.Node): void => {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'isMainThread'
          ) {
            found.push(at(name, file, statement));
          }
          ts.forEachChild(node, visit);
        };
        visit(statement.expression);
      }
    }

    expect(found).toEqual([]);
  });

  it('has no class static blocks', () => {
    // A static block runs when its class is defined, so it makes the class
    // a side effect wherever it is. Neither Angular's build nor the build
    // plugin's pure-class pass can mark such a class pure. Assign what it
    // would in the constructor instead, once, as LynxLocationStrategy does.
    const found: string[] = [];
    for (const { name, file } of parsed) {
      const visit = (node: ts.Node): void => {
        if (ts.isClassStaticBlockDeclaration(node)) {
          found.push(at(name, file, node));
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }

    expect(found).toEqual([]);
  });
});
