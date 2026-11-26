import { createRequire } from 'node:module';
import path from 'node:path';
import * as ts from 'typescript';
import { isAngularLynxPackageModule } from './layers.js';

const RUNTIME = '@blotch/angular-lynx';
const ENABLE = 'ɵenableWebGL2';

/**
 * The name a module asks for the context by. The runtime's `<canvas>` has no
 * other 3D context (`'webgl'` is null), so code that draws 3D with it names it:
 * three.js's `const contextName = 'webgl2'`, or an app's
 * `canvas.getContext('webgl2')`. A comment that mentions it matches too, which
 * only brings the context into a bundle that didn't need it.
 */
const WEBGL2 = /\bwebgl2\b/;

/**
 * Gives `<canvas>` its WebGL2 context in the bundles that can ask for one:
 * when a main-thread module names `'webgl2'`, a call to the runtime's
 * `ɵenableWebGL2()` goes at its top.
 *
 * The context is about 37 kB of a minified main-thread script, and PrimJS
 * reads a script's whole bytecode as it loads it, so every app paid for it in
 * memory, whether it drew or not (#707). The runtime keeps it out of reach of
 * the canvas until the call (webGL2ContextFactory in canvas-surface.ts), so an
 * app that never names the context leaves it out. A context name an app builds
 * at runtime isn't seen, and getContext() says so on the console.
 *
 * AngularLynx's own packages are left out: the runtime names `'webgl2'` itself,
 * and would bring the context into every app. The call runs before the rest of
 * the module, after the modules it imports, which call it themselves if they
 * need it.
 *
 * @param code - The module's code, as it will be bundled.
 * @param filename - The module's path.
 * @param runtime - The specifier the call imports the runtime from.
 * @returns The code with the call at its top, or `code` itself.
 */
export const enableWebGL2WhereNamed = (
  code: string,
  filename: string,
  runtime: string = RUNTIME,
): string => {
  if (!WEBGL2.test(code) || isAngularLynxPackageModule(filename)) {
    return code;
  }
  const specifier = JSON.stringify(runtime);
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    false,
    /\.[cm]?tsx?$/.test(filename) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  if (ts.isExternalModule(sourceFile)) {
    // Imports are hoisted, so the import can go anywhere; the call goes after
    // the module's own imports, which run first whatever their place.
    return `import { ${ENABLE} } from ${specifier};\n${ENABLE}();\n${code}`;
  }
  // A CommonJS module (or a script) has no imports. The call goes after its
  // directives: before a `'use strict'`, it would stop being one.
  let offset = 0;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    offset = statement.end;
  }
  return `${code.slice(0, offset)}\nrequire(${specifier}).${ENABLE}();\n${code.slice(offset)}`;
};

/**
 * The runtime's entry as the app resolves it, so a third-party module the call
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
