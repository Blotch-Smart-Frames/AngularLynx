import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Imports a package installed in the user's project (rspeedy), not one this
 * package depends on. The project pins its own rspeedy version in
 * package.json, and that is the version `ng build` must run, just as
 * `rspeedy build` would.
 *
 * rspeedy is ESM-only, and its `exports` have no `require` condition, so
 * `require.resolve` can't find its entry point. Its package.json is exported,
 * though: resolve that and read the `import` entry from it.
 */
export const importFromProject = async <T>(
  packageName: string,
  projectRoot: string,
  installHint: string,
): Promise<T> => {
  const require = createRequire(path.join(projectRoot, 'package.json'));
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(`${packageName} is not installed. ${installHint}`);
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const entry = resolveImportEntry(packageJson);
  if (!entry) {
    throw new Error(`${packageName} has no ESM entry point.`);
  }
  return (await import(
    pathToFileURL(path.join(path.dirname(packageJsonPath), entry)).href
  )) as T;
};

type ExportsValue = string | { [condition: string]: ExportsValue } | null;

const resolveImportEntry = (packageJson: {
  exports?: ExportsValue | { '.': ExportsValue };
  module?: string;
  main?: string;
}): string | undefined => {
  const exports = packageJson.exports;
  const root =
    exports && typeof exports === 'object' && '.' in exports
      ? exports['.']
      : exports;
  return pick(root ?? null) ?? packageJson.module ?? packageJson.main;
};

/**
 * Follows `import` (then `default`) conditions down to a file path.
 */
const pick = (value: ExportsValue): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (!value) {
    return undefined;
  }
  for (const condition of ['import', 'node', 'default']) {
    if (condition in value) {
      const found = pick(value[condition]!);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
};
