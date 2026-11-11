import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { androidGenerator } from './android/project.ts';
import { buildAndroid, resolveAndroidSigning } from './android/build.ts';
import { startAndroidDevice } from './android/run.ts';
import { devBuildKey, recordDevBuild, reusableDevBuild } from './dev-build.ts';
import {
  type Platform,
  prepareProject,
  removeLegacyWorkDir,
} from './generate.ts';
import {
  buildIos,
  missingTeamMessage,
  resolveIosSigning,
} from './ios/build.ts';
import { resolveLynxFrameworks } from './ios/frameworks.ts';
import { iosGenerator } from './ios/project.ts';
import { startIosTarget } from './ios/run.ts';
import { type NativeAppOptions, resolveAppOptions } from './options.ts';
import { NativeBuildError } from './process.ts';
import type { DevServerOptions, RunOptions } from './run.ts';

export type { Platform } from './generate.ts';
export { EJECT_MARKER, copyBundle, prepareProject } from './generate.ts';
export { renderEjectedProject } from './eject.ts';
export { LYNX_IOS, FRAMEWORKS_ENV } from './ios/frameworks.ts';
export type {
  AndroidOptions,
  IosExportMethod,
  IosOptions,
  NativeAppOptions,
  Orientation,
  Permission,
  ResolvedApp,
} from './options.ts';
export { NativeConfigError, resolveAppOptions } from './options.ts';
export { NativeBuildError } from './process.ts';
export type { DevServerOptions, RunOptions } from './run.ts';

/**
 * The shell file that loads the app from the dev server in the development
 * build, which a project ejected before `ng serve --platform` lacks.
 */
const DEV_SERVER_SOURCE: Record<Platform, string> = {
  ios: 'App/DevServer.swift',
  android: 'app/src/debug/java/dev/angularlynx/shell/DevServer.kt',
};

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
  /**
   * The rspeedy output folder holding main.lynx.bundle. Unused with
   * `devServer`: the development app loads the bundle from the server.
   */
  readonly bundleDir: string;
  /** Where the binaries go, e.g. dist/ios. Emptied before they're written. */
  readonly outputDir: string;
  readonly app: NativeAppOptions;
  /**
   * Install the app on a simulator, emulator or phone and open it once it's
   * built: `ng build --platform <platform> --run`.
   */
  readonly run?: RunOptions;
  /**
   * `ng serve --platform <platform>`: build the development app, which loads
   * its bundle from this dev server and reloads on every edit, and open it
   * where `run` says. Needs `run`.
   */
  readonly devServer?: DevServerOptions;
  readonly log: (message: string) => void;
};

/**
 * Turns a built Lynx bundle into native binaries: generates (or reuses) the
 * shell project, copies the bundle in, and runs xcodebuild or Gradle. With
 * `run`, then installs the app on a device and opens it.
 * Returns the paths of the binaries it wrote to `outputDir`.
 */
export const buildNativeApp = async (
  options: BuildNativeAppOptions,
): Promise<{
  readonly artifacts: readonly string[];
  readonly projectDir: string;
}> => {
  const { platform, projectRoot, workDir, log, devServer } = options;
  if (devServer && !options.run) {
    throw new Error(
      'The development app is built to run on a device: pass `run` with `devServer`.',
    );
  }
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
  // milliseconds rather than after a native build. The development app is
  // signed only as far as a device needs: an iPhone takes the team's
  // development signing, never an .ipa's export, and Android's debug build
  // type always uses the debug key, so its upload key isn't read.
  const iosSigning =
    platform === 'ios'
      ? withoutExport(resolveIosSigning(app), devServer)
      : undefined;
  const androidSigning =
    platform === 'android' && !devServer
      ? resolveAndroidSigning(app)
      : undefined;

  removeLegacyWorkDir(projectRoot, log);
  const logFile = path.join(
    workDir,
    'logs',
    `${platform}${devServer ? '-dev' : ''}.log`,
  );
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, '');

  const target = !options.run
    ? undefined
    : platform === 'ios'
      ? await startIosTarget({ device: options.run.device, logFile, log })
      : await startAndroidDevice({ device: options.run.device, logFile, log });
  // An iPhone only runs a signed app, so a run without a team stops here,
  // before the project is generated and built.
  if (target?.iPhone && !iosSigning) {
    throw new NativeBuildError(await missingTeamMessage(target.iPhone.name));
  }

  const project = prepareProject({
    platform,
    generator: platform === 'ios' ? iosGenerator : androidGenerator,
    projectRoot,
    workDir,
    app,
    bundleDir: devServer ? undefined : options.bundleDir,
    packageVersion: PACKAGE_VERSION,
    development: !!devServer,
  });
  if (
    devServer &&
    project.ejected &&
    !existsSync(path.join(project.dir, DEV_SERVER_SOURCE[platform]))
  ) {
    throw new NativeBuildError(
      `The ejected ${platform}/ project has no ${DEV_SERVER_SOURCE[platform]}: it was ejected before \`ng serve --platform\` existed, so it can't load the app from the dev server. Eject again into a new folder (move ${platform}/ aside and run \`ng generate @blotch/angular-lynx:eject --platform ${platform}\`), then carry your changes over to it.`,
    );
  }
  log(
    project.ejected
      ? `Using the ejected ${platform}/ project`
      : project.regenerated
        ? `Generated the ${platform} project`
        : `Reusing the generated ${platform} project (no config changes)`,
  );

  // Where the app was built for, which a development build for a simulator
  // or a phone depends on as much as on the project.
  const destination = target?.iPhone?.udid ?? target?.simulator?.udid ?? '';
  // An ejected project is the user's own, whose native code may have changed
  // without anything here knowing, so it's always built.
  const devKey =
    devServer && project.hash
      ? devBuildKey(project.hash, destination)
      : undefined;
  const builtArtifacts = devKey && reusableDevBuild(options.outputDir, devKey);
  if (builtArtifacts) {
    log(`Reusing the development ${platform} app (no native changes)`);
    await target!.launch(builtArtifacts[0]!, app, devServer);
    return { artifacts: builtArtifacts, projectDir: project.dir };
  }

  // rspeedy's clean leaves dist/ios and dist/android alone, so building one
  // platform doesn't delete the other's app. Emptying this platform's folder
  // here keeps what an earlier build wrote from outliving it: an .ipa from a
  // signed build, or the app under its old name after a rename.
  rmSync(options.outputDir, { recursive: true, force: true });

  const artifacts =
    platform === 'ios'
      ? await buildIos({
          project,
          app,
          frameworksDir: await resolveLynxFrameworks(logFile, log),
          // Apart from the release build's, so switching between `ng serve`
          // and `ng build` leaves both incremental.
          buildDir: path.join(workDir, 'build', devServer ? 'ios-dev' : 'ios'),
          outputDir: options.outputDir,
          logFile,
          log,
          signing: iosSigning,
          device: target?.iPhone,
          development: !!devServer,
          // A release build is for any simulator: it's an artifact in dist/.
          simulator: devServer ? target?.simulator : undefined,
        })
      : await buildAndroid({
          project,
          app,
          outputDir: options.outputDir,
          logFile,
          log,
          signing: androidSigning,
          development: !!devServer,
        });
  if (devKey) recordDevBuild(options.outputDir, devKey, artifacts);
  await target?.launch(
    // The simulator's or the iPhone's .app or the .apk, not the .ipa or .aab
    // for the stores.
    artifacts.find((artifact) =>
      artifact.endsWith(platform === 'ios' ? '.app' : '.apk'),
    )!,
    app,
    devServer,
  );
  return { artifacts, projectDir: project.dir };
};

/**
 * The development app never exports an .ipa, so its signing has no export.
 */
const withoutExport = (
  signing: ReturnType<typeof resolveIosSigning>,
  devServer: DevServerOptions | undefined,
): ReturnType<typeof resolveIosSigning> => {
  if (!signing || !devServer || !signing.export) return signing;
  const { export: _, ...rest } = signing;
  return rest;
};
