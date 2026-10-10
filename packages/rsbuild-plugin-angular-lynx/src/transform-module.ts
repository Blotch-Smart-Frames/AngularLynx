// cspell:words ɵcmp
import path from 'node:path';
import { transformWorklets } from './worklet-transform.js';
import type {
  ComponentScopeInfo,
  ComponentStylesEntry,
} from './component-styles-cache.js';

/**
 * Transforms the Angular-compiled JS for a single component module before rspack
 * bundles it. This is the per-module half of the AngularLynx pipeline, extracted
 * from angular.ts's `api.transform` hook so it can be unit-tested as a pure
 * string→string function (no rspack loader context, no compilation cache).
 *
 * It applies, in order:
 *   1. Prepends `import "<scoped.css>"` statements for the component's scoped
 *      stylesheets (resolved relative to the component file).
 *   2. Appends the `Component.ɵcmp.id = '<scopeId>'` assignment that ties the CSS
 *      files (whose filenames carry the same scope ID) to the runtime component.
 *   3. Runs the worklet ("main thread" directive) transform over the result.
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
  componentStyles: Pick<ComponentStylesEntry, 'imports'> | undefined;
  scopeInfo: ComponentScopeInfo | undefined;
}): string => {
  const { resourcePath, componentStyles, scopeInfo } = params;
  let code = params.code;

  if (componentStyles) {
    const { imports } = componentStyles;
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
  // Patch the component's ɵcmp.id to match the scope ID derived from the
  // component's class name + file path. Angular normally generates this via
  // encapsulateStyle, but we bypass Angular's style encapsulation entirely
  // (Lynx's template engine handles scoping). This ID connects CSS files
  // (which use the scope ID in their filename) to the component's renderer
  // (EmulatedLynxRenderer adds _nghost-{id} to the host element).
  if (scopeInfo) {
    code += `\n;${scopeInfo.className}.ɵcmp.id = '${scopeInfo.scopeId}';\n`;
  }
  return transformWorklets(code, resourcePath);
};
