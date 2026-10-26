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
    resolve.byDependency = {
      ...resolve.byDependency,
      esm: { ...resolve.byDependency?.['esm'], conditionNames: conditions },
    };
  });
};
