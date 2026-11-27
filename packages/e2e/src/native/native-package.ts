import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type * as Native from '@blotch/angular-lynx-native';

export type Platform = 'ios' | 'android';

export type AngularJson = {
  projects: Record<
    string,
    {
      root?: string;
      architect: {
        build: {
          options: { appId: string } & Record<string, unknown>;
          configurations?: Record<string, Record<string, unknown>>;
          defaultConfiguration?: string;
        };
      };
    }
  >;
};

export const readAngularJson = (appDir: string): AngularJson =>
  JSON.parse(readFileSync(path.join(appDir, 'angular.json'), 'utf8'));

/**
 * Loads the native builder in `nativeDir`, an unpacked or installed
 * @blotch/angular-lynx-native: the tested package, not the workspace's
 * source.
 */
export const loadNativePackage = async (
  nativeDir: string,
): Promise<typeof Native> =>
  (await import(
    pathToFileURL(path.join(nativeDir, 'dist/index.js')).href
  )) as typeof Native;

/**
 * Builds the app's binary from the bundle in `bundleDir` with the native
 * builder `native`, calling it as `ng build --platform` does: with the
 * build target's options, the default configuration's on top, which is what
 * Angular CLI hands the builder for a plain `ng build`. For an app copied
 * without node_modules.
 *
 * Returns the binaries it wrote to `outputDir`, and the generated project.
 */
export const buildFromBundle = async ({
  native,
  platform,
  appDir,
  bundleDir,
  workDir,
  outputDir,
  log,
}: {
  native: typeof Native;
  platform: Platform;
  appDir: string;
  bundleDir: string;
  /** Where the builder generates the project and keeps its build state. */
  workDir: string;
  outputDir: string;
  log: (message: string) => void;
}) => {
  const [projectName, project] = Object.entries(
    readAngularJson(appDir).projects,
  )[0]!;
  const { build } = project.architect;
  const options = {
    ...build.options,
    ...(build.defaultConfiguration
      ? build.configurations?.[build.defaultConfiguration]
      : {}),
  };
  return native.buildNativeApp({
    platform,
    projectRoot: path.join(appDir, project.root ?? ''),
    workDir,
    projectName,
    packageVersion: JSON.parse(
      readFileSync(path.join(appDir, 'package.json'), 'utf8'),
    ).version,
    bundleDir,
    outputDir,
    app: options,
    log,
  });
};
