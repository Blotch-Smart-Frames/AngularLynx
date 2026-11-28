import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * Resolves `import`s to a package's ES module build.
 *
 * The Lynx build engine resolves every request with the conditions `lynx`,
 * `import`, `require` and `browser`, whether it comes from an `import` or a
 * `require()`. A package whose `exports` list `require` before any of the
 * others then resolves to its CommonJS build even from an `import`. rxjs is
 * one (`types`, `node`, `require`, `es2015`, `default`), and Angular and the
 * runtime import it everywhere. CommonJS can't be tree-shaken, so every app
 * carried all of rxjs on both threads, about 130 kB of each bundle, when the
 * background thread uses `Subject` alone.
 *
 * So `import`s get the engine's conditions without `require`, and with
 * `module` after `import`, as webpack's defaults have them (tslib's ES module
 * build is behind `module`). A `require()` still resolves with all of the
 * engine's conditions.
 *
 * They also get `es2015` and `es2020`, which Angular's own application
 * builder resolves with (`@angular/build`'s application-code-bundle.js). For
 * rxjs, `default` is its ES5 build: each class a function and a prototype,
 * extended through tslib's `__extends`. `es2015` is the same code as ES2015
 * classes, which the main thread's ES2019 target and the background's ES2015
 * keep as they are. It took 7.8 kB off the benchmark app's main-thread
 * script and 2.6 kB off its background script, rxjs and the tslib helpers
 * only its ES5 build calls (issue #707), and it's the build an Angular app
 * runs on the web.
 */
export const applyResolve = (api: RsbuildPluginAPI): void => {
  // The final config rather than the chain, so the engine's conditions are
  // there whichever plugin's chain hook runs first.
  api.modifyRspackConfig((config) => {
    const resolve = (config.resolve ??= {});
    const conditions = (resolve.conditionNames ?? []).filter(
      (condition) => condition !== 'require',
    );
    if (!conditions.includes('module')) {
      conditions.splice(conditions.indexOf('import') + 1, 0, 'module');
    }
    for (const condition of ['es2020', 'es2015']) {
      if (!conditions.includes(condition)) conditions.unshift(condition);
    }
    resolve.byDependency = {
      ...resolve.byDependency,
      esm: { ...resolve.byDependency?.['esm'], conditionNames: conditions },
    };
  });
};
