import fs from 'node:fs';
import path from 'node:path';
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

/** Each folder's nearest `package.json` `"type"`, as the build looks it up. */
const packageTypes = new Map<string, unknown>();

/**
 * The `"type"` of the `package.json` nearest to a folder, which rspack's
 * `descriptionData` matches against (the MODULE_PACKAGE_JS rule).
 *
 * @param dir - The folder.
 */
const packageType = (dir: string): unknown => {
  if (packageTypes.has(dir)) return packageTypes.get(dir);
  const file = path.join(dir, 'package.json');
  let type: unknown;
  if (fs.existsSync(file)) {
    try {
      type = (JSON.parse(fs.readFileSync(file, 'utf8')) as { type?: unknown })
        .type;
    } catch {
      // A package.json the build can't read sets no type, as for rspack.
    }
  } else {
    const parent = path.dirname(dir);
    type = parent === dir ? undefined : packageType(parent);
  }
  packageTypes.set(dir, type);
  return type;
};

/**
 * Whether the build makes a file a strict ES module (applyStrictEsm()): an
 * `.mjs` file, or a `.js` file in a package whose `package.json` has
 * `"type": "module"`. Such a module has no `require`, even with no import or
 * export of its own. So does an `.mts` file.
 *
 * @param filename - The module's path.
 */
export const isStrictEsmFile = (filename: string): boolean =>
  /\.m[jt]s$/.test(filename) ||
  (filename.endsWith('.js') &&
    packageType(path.dirname(filename)) === 'module');
