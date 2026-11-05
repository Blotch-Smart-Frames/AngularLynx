// cspell:words ɵcmp
import path from 'node:path';
import { transformCrossThread } from './cross-thread-transform.js';
import {
  addEntryHotAccept,
  addHotAccept,
  componentClassNames,
  hotUpdateSignature,
} from './hot-updates.js';
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
 * The specifier a module imports one of its stylesheets by: the stylesheet's
 * path relative to the module, with `/` between its segments on every OS.
 *
 * On Windows, path.relative() separates them with backslashes, which in the
 * import's string literal are escapes: `..\..\node_modules\.cache\…` read as
 * `....` plus a newline and `ode_modules.cache…`, which didn't resolve. So
 * every component with styles failed to build on Windows. `paths` is
 * node:path, or path.win32 in tests.
 */
export const stylesheetSpecifier = (
  resourcePath: string,
  stylesheet: string,
  paths: Pick<typeof path, 'dirname' | 'relative' | 'sep'> = path,
): string => {
  const relative = paths
    .relative(paths.dirname(resourcePath), stylesheet)
    .split(paths.sep)
    .join('/');
  // Stylesheets live in node_modules/.cache/angular-lynx-css/. Prepending
  // `./` when the relative path doesn't start with `..` keeps it a valid ES
  // module specifier (rspack rejects bare specifiers here).
  return relative.startsWith('.') ? relative : `./${relative}`;
};

/**
 * Prepends an import of each of a module's stylesheets (see
 * component-styles.ts) to its code.
 */
export const importStylesheets = (
  code: string,
  resourcePath: string,
  imports: readonly string[],
): string => {
  let importsString = '';
  for (const stylesheet of imports) {
    // JSON.stringify writes the specifier as a string literal whatever
    // characters it holds.
    importsString += `import ${JSON.stringify(stylesheetSpecifier(resourcePath, stylesheet))};`;
  }
  // Prepend the imports so the CSS chunks are pulled into the bundle
  // before the component class is defined — matching the side-effect
  // ordering Angular itself produces in its standard build.
  return importsString + code;
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
 *      threads.
 *   5. In a development build with hot updates (`hot` is set), makes the
 *      module take them (hot-updates.ts): an entry module re-bootstraps the
 *      app, and a module that defines components updates them in place when
 *      only their templates or styles changed. Other modules pass their
 *      updates on to the modules that import them.
 *
 * The hot update clients apply each update on both threads (see client/).
 * Before they did, only the background thread took hot updates, so a
 * self-accepting entry (which an earlier version had) re-bootstrapped the
 * background thread's copy of the app while the main thread, which draws the
 * screen, kept running the old code.
 */
export const buildTransformedCode = (params: {
  code: string;
  resourcePath: string;
  stylesheets: ModuleStylesheets | undefined;
  /** The project root, which cross-thread IDs are relative to. */
  root: string;
  /**
   * Set in a development build with hot updates. `entry` says whether the
   * module is one of the app's entries, and `source` reads its TypeScript
   * source.
   */
  hot?: { entry: boolean; source: () => string };
}): string => {
  const { resourcePath, stylesheets, root, hot } = params;
  let code = params.code;

  if (stylesheets) {
    code = importStylesheets(code, resourcePath, stylesheets.imports);
  }
  // Angular's runtime fills the %COMP% in an Emulated component's scoped
  // styles with ɵcmp.id. The CSS was compiled ahead of time with a scope ID
  // derived from the class name and file path, so set ɵcmp.id to the same ID:
  // EmulatedLynxRenderer builds its _ngcontent-<id> and _nghost-<id> classes
  // from it.
  for (const { className, scopeId } of stylesheets?.scopes ?? []) {
    code += `\n;${className}.ɵcmp.id = '${scopeId}';\n`;
  }
  const transformed = transformCrossThread(
    transformWorklets(code, resourcePath),
    resourcePath,
    {
      root,
    },
  );
  if (!hot) return transformed;
  if (hot.entry) return addEntryHotAccept(transformed);
  const components = componentClassNames(params.code, resourcePath);
  if (components.length === 0) return transformed;
  return addHotAccept(transformed, {
    components,
    signature: hotUpdateSignature(hot.source(), resourcePath),
    compiled: params.code,
  });
};
