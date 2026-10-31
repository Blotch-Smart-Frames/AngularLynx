import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

const PLUGIN_NAME = 'lynx:angular:file-replacement';

/**
 * Matches exactly the module path `file`, as a resolved module's resource.
 */
const exactPath = (file: string): RegExp =>
  new RegExp(`^${file.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')}$`);

/**
 * Swaps each of angular.json's `fileReplacements` into the bundle: a module
 * that resolves to a `replace` file is built from its `with` file instead.
 *
 * Angular's compiler host only redirects TypeScript's module resolution (see
 * `fileReplacements` in angular.ts), so the compiled program type-checks and
 * emits the `with` file. The compiled code still imports the `replace` path,
 * though, and the bundler resolves imports itself. Angular's own builders
 * redirect them too: the esbuild one when it loads the module (TypeScript,
 * JavaScript and JSON files), and the webpack one, which this mirrors, with a
 * `NormalModuleReplacementPlugin` for each replacement.
 *
 * Replacing the module rather than its contents makes rspack treat the `with`
 * file as the module: its own imports resolve from its folder, wherever it is
 * (`../common/environments/environment.prod.ts`), the loader finds its
 * compiled output, and a watch build rebuilds when it changes. Every
 * environment gets the plugins, and every module request goes through them,
 * so both threads' bundles and the generated background entry get the `with`
 * file.
 *
 * @param fileReplacements - The `replace` files' absolute paths, mapped to
 *   their `with` files' (`normalizeBuildOptions`).
 */
export const applyFileReplacements = (
  api: Pick<RsbuildPluginAPI, 'modifyBundlerChain'>,
  fileReplacements: Readonly<Record<string, string>> | undefined,
): void => {
  if (!fileReplacements) {
    return;
  }
  api.modifyBundlerChain((chain, { rspack }) => {
    for (const [replace, replacement] of Object.entries(fileReplacements)) {
      chain
        .plugin(`${PLUGIN_NAME}:${replace}`)
        .use(rspack.NormalModuleReplacementPlugin, [
          exactPath(replace),
          replacement,
        ]);
    }
  });
};
