// cspell:words ɵcmp
import path from 'node:path';
import { transformCrossThread } from './cross-thread-transform.js';
import { transformWorklets } from './worklet-transform.js';

/**
 * The stylesheets extracted from one module's components (see
 * component-styles.ts), written as CSS files.
 */
export type ModuleStylesheets = {
  /** The CSS files, in the order the module's components declare them. */
  imports: string[];
  /** Each Emulated component's class name and the scope ID its CSS uses. */
  scopes: Array<{ className: string; scopeId: string }>;
};

/**
 * Transforms the Angular-compiled JS for a single component module before rspack
 * bundles it. This is the per-module half of the AngularLynx pipeline, extracted
 * from angular.ts's `api.transform` hook so it can be unit-tested as a pure
 * string→string function (no rspack loader context, no compilation cache).
 *
 * It applies, in order:
 *   1. Prepends `import "<component.css>"` statements for the stylesheets
 *      extracted from the module's components (resolved relative to the
 *      component file).
 *   2. Appends a `Component.ɵcmp.id = '<scopeId>'` assignment for each
 *      Emulated component, which ties its scoped CSS to its renderer.
 *   3. Runs the worklet ("main thread" directive) transform over the result.
 *   4. Runs the cross-thread transform (cross-thread-transform.ts), which gives
 *      module-level background functions and refs IDs that match on both
 *      threads and lets the background thread load the lazy chunks the main
 *      thread loads.
 *
 * It deliberately does NOT make the bootstrap entry accept its own hot
 * updates (`module.hot.accept()`), which an earlier version did. On Lynx the
 * screen is drawn by the Angular app on the main thread, but webpack HMR only
 * runs on the background thread: nothing loads the main-thread hot-update
 * chunk. A self-accepting entry let the background thread apply the update
 * and re-bootstrap its own copy of the app, so HMR reported success and the
 * main thread kept rendering the old code until a manual reload. With no
 * module accepting, the update aborts and the Lynx HMR client
 * (`@lynx-js/webpack-dev-transport`) falls back to a full `Page.reload`, which
 * re-runs both threads with the new bundle.
 */
export const buildTransformedCode = (params: {
  code: string;
  resourcePath: string;
  stylesheets: ModuleStylesheets | undefined;
  /** The project root, which cross-thread IDs are relative to. */
  root: string;
}): string => {
  const { resourcePath, stylesheets, root } = params;
  let code = params.code;

  if (stylesheets) {
    const { imports } = stylesheets;
    let importsString = '';
    for (let i = 0; i < imports.length; ++i) {
      // Stylesheets live in node_modules/.cache/angular-lynx-css/, so
      // compute the relative path from the component file. Prepending
      // `./` when the relative path doesn't start with `..` keeps it a
      // valid ES module specifier (rspack rejects bare specifiers here).
      let relativeImport = path.relative(
        path.dirname(resourcePath),
        imports[i],
      );
      if (!relativeImport.startsWith('.')) {
        relativeImport = `./${relativeImport}`;
      }
      importsString += `import "${relativeImport}";`;
    }
    // Prepend the imports so the CSS chunks are pulled into the bundle
    // before the component class is defined — matching the side-effect
    // ordering Angular itself produces in its standard build.
    code = importsString + code;
  }
  // Angular's runtime fills the %COMP% in an Emulated component's scoped
  // styles with ɵcmp.id. The CSS was compiled ahead of time with a scope ID
  // derived from the class name and file path, so set ɵcmp.id to the same ID:
  // EmulatedLynxRenderer builds its _ngcontent-<id> and _nghost-<id> classes
  // from it.
  for (const { className, scopeId } of stylesheets?.scopes ?? []) {
    code += `\n;${className}.ɵcmp.id = '${scopeId}';\n`;
  }
  return transformCrossThread(
    transformWorklets(code, resourcePath),
    resourcePath,
    { root, mirrorImports: true },
  );
};
