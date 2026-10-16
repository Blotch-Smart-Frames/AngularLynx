import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { androidGenerator } from './android/project.ts';
import { buildAndroid, resolveAndroidSigning } from './android/build.ts';
import {
  type Platform,
  prepareProject,
  removeLegacyWorkDir,
} from './generate.ts';
import { buildIos, resolveIosSigning } from './ios/build.ts';
import { resolveLynxFrameworks } from './ios/frameworks.ts';
import { iosGenerator } from './ios/project.ts';
import { type NativeAppOptions, resolveAppOptions } from './options.ts';

export type { Platform } from './generate.ts';
export { EJECT_MARKER, copyBundle, prepareProject } from './generate.ts';
export { renderEjectedProject } from './eject.ts';
export { LYNX_IOS, FRAMEWORKS_ENV } from './ios/frameworks.ts';
export type {
  AndroidOptions,
  IosOptions,
  NativeAppOptions,
  Orientation,
  Permission,
  ResolvedApp,
} from './options.ts';
export { NativeConfigError, resolveAppOptions } from './options.ts';
export { NativeBuildError } from './process.ts';

export const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

export type BuildNativeAppOptions = {
  readonly platform: Platform;
  /** The Angular project's root folder (where lynx.config.ts is). */
  readonly projectRoot: string;
  /**
   * Where the generated native projects, their build state and the build
   * logs go. The builder passes the project's folder in Angular's cache, so
   * nothing is added to the project root and `ng cache clean` clears it.
   */
  readonly workDir: string;
  /** The project name, the default app name. */
  readonly projectName: string;
  /** The project's package.json version, the default app version. */
  readonly packageVersion?: string;
  /** The rspeedy output folder holding main.lynx.bundle. */
  readonly bundleDir: string;
  /** Where the binaries go, e.g. dist/ios. */
  readonly outputDir: string;
  readonly app: NativeAppOptions;
  readonly log: (message: string) => void;
};

/**
 * Turns a built Lynx bundle into native binaries: generates (or reuses) the
 * shell project, copies the bundle in, and runs xcodebuild or Gradle.
 * Returns the paths of the binaries it wrote to `outputDir`.
 */
export const buildNativeApp = async (
  options: BuildNativeAppOptions,
): Promise<{
  readonly artifacts: readonly string[];
  readonly projectDir: string;
}> => {
  const { platform, projectRoot, workDir, log } = options;
  if (platform === 'ios' && process.platform !== 'darwin') {
    throw new Error(
      'Building for iOS needs macOS with Xcode installed: Apple only ships its build tools for macOS.',
    );
  }
  const app = resolveAppOptions(options.app, {
    projectName: options.projectName,
    packageVersion: options.packageVersion,
  });
  // Resolved before generating anything, so a missing secret fails in
  // milliseconds rather than after a native build.
  const iosSigning = platform === 'ios' ? resolveIosSigning(app) : undefined;
  const androidSigning =
    platform === 'android' ? resolveAndroidSigning(app) : undefined;

  removeLegacyWorkDir(projectRoot, log);
  const logFile = path.join(workDir, 'logs', `${platform}.log`);
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, '');

  const project = prepareProject({
    platform,
    generator: platform === 'ios' ? iosGenerator : androidGenerator,
    projectRoot,
    workDir,
    app,
    bundleDir: options.bundleDir,
    packageVersion: PACKAGE_VERSION,
  });
  log(
    project.ejected
      ? `Using the ejected ${platform}/ project`
      : project.regenerated
        ? `Generated the ${platform} project`
        : `Reusing the generated ${platform} project (no config changes)`,
  );

  const artifacts =
    platform === 'ios'
      ? await buildIos({
          project,
          app,
          frameworksDir: await resolveLynxFrameworks(logFile, log),
          buildDir: path.join(workDir, 'build', 'ios'),
          outputDir: options.outputDir,
          logFile,
          log,
          signing: iosSigning,
        })
      : await buildAndroid({
          project,
          app,
          outputDir: options.outputDir,
          logFile,
          log,
          signing: androidSigning,
        });
  return { artifacts, projectDir: project.dir };
};
