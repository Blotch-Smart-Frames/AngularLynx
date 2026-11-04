import type { RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * The rules that build ES module files as strict ES modules.
 */
export const STRICT_ESM_RULES = {
  MJS: 'strict-esm:mjs',
  MODULE_PACKAGE_JS: 'strict-esm:module-package-js',
};

/**
 * Builds `.mjs` files, and `.js` files in a package whose `package.json` has
 * `"type": "module"`, as strict ES modules, as Node, esbuild (so Angular's own
 * builders) and rspack's defaults do.
 *
 * Rsbuild's JavaScript rule sets `type: 'javascript/auto'` on every script it
 * matches, which overrides rspack's default rules for both. In an auto module,
 * a default import of CommonJS that sets `exports.__esModule` is
 * `module.exports.default`, where Node gives the whole `module.exports`. A
 * package whose ES module entry is an `.mjs` wrapper over its CommonJS build
 * (`import mod from './index.js'; export const DataSet = mod.DataSet;`, as
 * TypeScript's CommonJS output and obscenity have it) then reads a property of
 * `undefined`, and throws as it loads.
 *
 * Separate rules after Rsbuild's (which it adds in a `pre` hook) rather than a
 * change to it: a later rule's `type` wins, and the JavaScript rule's loaders
 * stay as Rsbuild and the layers set them.
 */
export const applyStrictEsm = (api: RsbuildPluginAPI): void => {
  api.modifyBundlerChain((chain) => {
    chain.module
      .rule(STRICT_ESM_RULES.MJS)
      .test(/\.mjs$/)
      .type('javascript/esm');
    chain.module
      .rule(STRICT_ESM_RULES.MODULE_PACKAGE_JS)
      .test(/\.js$/)
      .descriptionData({ type: 'module' })
      .type('javascript/esm');
  });
};
