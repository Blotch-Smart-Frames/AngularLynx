import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Where `ng build --platform` keeps the generated Xcode and Gradle projects,
 * their build state and the logs: the project's folder in Angular's build
 * cache, `.angular/cache/<Angular version>/<project>/lynx-native` by default.
 *
 * Inside Angular's cache rather than a folder of our own at the project
 * root, so a Lynx app's root looks like any Angular app's: `ng new` already
 * git-ignores the cache, `ng cache clean` clears it, and `cli.cache.path`
 * moves it.
 *
 * The version folder isn't optional. Angular's application and dev-server
 * builders delete every folder in the cache except the current version's,
 * so a `lynx-native` folder beside it would be deleted by the next Angular
 * build. Under it, an Angular update clears the native projects too, which
 * costs one regeneration.
 *
 * Angular shares one cache between a repository's linked checkouts, using
 * the main checkout's. This stays in the current checkout instead: two
 * checkouts building at once would overwrite each other's generated
 * project. And it's used even when `cli.cache.enabled` is
 * false, because the native build needs a working folder either way.
 */
export const nativeCacheDir = ({
  metadata,
  workspaceRoot,
  projectRoot,
  projectName,
}: {
  /** The project's metadata, which includes the workspace's `cli` options. */
  readonly metadata: Record<string, unknown>;
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly projectName: string;
}): string =>
  path.join(
    path.resolve(workspaceRoot, cachePath(metadata)),
    angularBuildVersion(projectRoot),
    projectName,
    'lynx-native',
  );

/**
 * angular.json's `cli.cache.path`, defaulting as Angular does.
 */
const cachePath = (metadata: Record<string, unknown>): string => {
  const cli = metadata['cli'] as { cache?: { path?: unknown } } | undefined;
  const value = cli?.cache?.path;
  return typeof value === 'string' ? value : '.angular/cache';
};

/**
 * The version Angular names its cache folder after: @angular/build's, which
 * this package needs as a peer dependency (`ng new` installs it).
 */
const angularBuildVersion = (projectRoot: string): string => {
  const require = createRequire(path.join(projectRoot, 'package.json'));
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve('@angular/build/package.json');
  } catch {
    throw new Error(
      '@angular/build is not installed. Run `npm install --save-dev @angular/build` (`ng new` adds it).',
    );
  }
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
};
