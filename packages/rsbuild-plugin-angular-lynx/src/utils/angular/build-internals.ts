import { createRequire } from 'node:module';
import path from 'node:path';
import type * as AngularCompilationModule from '@angular/build/src/tools/angular/compilation';
import type * as ComponentStylesheetsModule from '@angular/build/src/tools/esbuild/angular/component-stylesheets';
import type * as JavaScriptTransformerModule from '@angular/build/src/tools/javascript-transformer';

/**
 * The `@angular/build` internals the plugin compiles Angular with.
 *
 * `createAngularCompilation`, `JavaScriptTransformer` and
 * `ComponentStylesheetBundler` aren't part of `@angular/build`'s public API, and
 * its package.json `exports` map doesn't list them, so a bare
 * `import '@angular/build/src/...'` fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 * `exports` only restricts bare specifiers, though: requiring the same files by
 * absolute path from the resolved package root is allowed. That lets the plugin
 * load them without touching the user's node_modules. It previously relied on a
 * postinstall script that added these paths to `@angular/build`'s `exports`,
 * which npm 11 skips by default for dependencies (and pnpm, Yarn and
 * `--ignore-scripts` never ran), leaving freshly scaffolded apps unable to build.
 *
 * `@angular/build` ships CommonJS, so `require` returns the same module
 * instances Angular's own code (and `@angular/build/private`) uses. Resolving
 * from this file finds the app's `@angular/build`, the plugin's peer dependency.
 * The type-only imports above resolve through the `paths` mapping in
 * tsconfig.json for the same `exports` reason.
 */
const require = createRequire(import.meta.url);

/** Absolute path of the installed `@angular/build` package root. */
export const angularBuildRoot = path.dirname(
  require.resolve('@angular/build/package.json'),
);

/**
 * Loads a module from inside `@angular/build` by its path relative to the
 * package root, bypassing the `exports` map.
 */
export const loadAngularBuildInternal = <T>(subpath: string): T =>
  require(path.join(angularBuildRoot, subpath)) as T;

export const { createAngularCompilation, DiagnosticModes } =
  loadAngularBuildInternal<typeof AngularCompilationModule>(
    'src/tools/angular/compilation',
  );

export const { JavaScriptTransformer } = loadAngularBuildInternal<
  typeof JavaScriptTransformerModule
>('src/tools/javascript-transformer');

export const { ComponentStylesheetBundler } = loadAngularBuildInternal<
  typeof ComponentStylesheetsModule
>('src/tools/esbuild/angular/component-stylesheets');

// Re-export the instance type under the class's name so callers can keep
// annotating with `ComponentStylesheetBundler` as they would with a real import.
export type ComponentStylesheetBundler =
  ComponentStylesheetsModule.ComponentStylesheetBundler;
