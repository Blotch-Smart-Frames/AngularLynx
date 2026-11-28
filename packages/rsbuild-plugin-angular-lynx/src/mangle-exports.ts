import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * Gives each module's exports the shortest names in a production build
 * (rspack's `optimization.mangleExports: 'size'`), rather than the
 * three-character hashes of rspack's default (`'deterministic'`).
 *
 * A module that rspack can't concatenate into the module importing it hands
 * its exports over through an object of getters (`{sZ2:()=>rN, ...}`), and
 * each use of one elsewhere is a property read (`(0,n.sZ2)(...)`). Every
 * module that both the app's root and a lazy route (`loadComponent:
 * () => import(...)`) import is such a module, since a module imported with
 * `import()` can't be concatenated, so it can't take in the modules it shares
 * with the rest of the app: Angular's packages, rxjs and the runtime among
 * them. The benchmark app (benchmarks/apps/angular-lynx) has five lazy
 * screens, and its main-thread script spends about 21 kB on those getters
 * and imports. Named by how often each is used, most of them take one
 * character, which took 3.3 kB off that script (issue #707). PrimJS reads
 * the whole script's bytecode as it loads, so the bytes cost heap too.
 *
 * `'deterministic'` keeps a name the same while the module's other exports
 * change, so a browser's cache keeps a chunk that didn't change. A Lynx app
 * loads its bundle whole, so there's nothing for that to keep. Development
 * builds keep rspack's default there, which mangles nothing, and an app's
 * config that sets `mangleExports` keeps its own value.
 *
 * @param api - The plugin API.
 */
export const applyMangleExports = (api: RsbuildPluginAPI): void => {
  api.modifyBundlerChain((chain, { isProd }) => {
    if (isProd && chain.optimization.get('mangleExports') === undefined) {
      chain.optimization.mangleExports('size');
    }
  });
};
