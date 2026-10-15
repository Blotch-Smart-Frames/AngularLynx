import { chmodSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { PreparedProject } from '../generate.ts';
import type { ResolvedApp } from '../options.ts';
import { capture, run } from '../process.ts';
import { findAndroidSdk } from './project.ts';

export type AndroidSigning = {
  readonly storeFile: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
};

/**
 * Reads the upload key from the environment variables the options name.
 * Returns undefined when signing isn't configured, in which case the release
 * build is signed with the debug key: installable for testing, but not
 * accepted by Google Play.
 */
export const resolveAndroidSigning = (
  app: ResolvedApp,
  env: NodeJS.ProcessEnv = process.env,
): AndroidSigning | undefined => {
  const signing = app.android.signing;
  if (!signing) {
    return undefined;
  }
  const read = (option: string, name: string | undefined) => {
    if (!name) {
      throw new Error(
        `android.signing.${option} must name the environment variable that holds it.`,
      );
    }
    const value = env[name];
    if (!value) {
      throw new Error(
        `android.signing.${option} names ${name}, which isn't set in the environment.`,
      );
    }
    return value;
  };
  if (!signing.keyAlias) {
    throw new Error('android.signing.keyAlias must be set.');
  }
  const storeFile = path.resolve(read('storeFileEnv', signing.storeFileEnv));
  if (!existsSync(storeFile)) {
    throw new Error(`The upload keystore ${storeFile} doesn't exist.`);
  }
  return {
    storeFile,
    storePassword: read('storePasswordEnv', signing.storePasswordEnv),
    keyAlias: signing.keyAlias,
    keyPassword: read('keyPasswordEnv', signing.keyPasswordEnv),
  };
};

/**
 * Builds the Android shell into a release `.apk` (for emulators and
 * sideloading) and `.aab` (for Google Play). Returns the artifacts' paths.
 */
export const buildAndroid = async ({
  project,
  app,
  outputDir,
  logFile,
  log,
  signing,
}: {
  readonly project: PreparedProject;
  readonly app: ResolvedApp;
  readonly outputDir: string;
  readonly logFile: string;
  readonly log: (message: string) => void;
  readonly signing: AndroidSigning | undefined;
}): Promise<string[]> => {
  // Signing values reach Gradle as project properties through
  // ORG_GRADLE_PROJECT_* environment variables: never on the command line,
  // which the process list and our build log would show, and never in a file
  // in the project.
  // Gradle finds the SDK through ANDROID_HOME (or local.properties, which an
  // ejected project may have). Passing it here keeps machine paths out of
  // the project, so an ejected one can be committed and built anywhere.
  const sdk = findAndroidSdk();
  if (!sdk && !existsSync(path.join(project.dir, 'local.properties'))) {
    throw new Error(
      'The Android SDK was not found. Install Android Studio (which installs the SDK), or set ANDROID_HOME to an existing SDK.',
    );
  }
  const env = {
    ...process.env,
    ...(sdk && { ANDROID_HOME: sdk }),
    ...(await javaEnv()),
    ...(signing && {
      'ORG_GRADLE_PROJECT_angularLynx.storeFile': signing.storeFile,
      'ORG_GRADLE_PROJECT_angularLynx.storePassword': signing.storePassword,
      'ORG_GRADLE_PROJECT_angularLynx.keyAlias': signing.keyAlias,
      'ORG_GRADLE_PROJECT_angularLynx.keyPassword': signing.keyPassword,
    }),
  };
  if (!signing) {
    log(
      'Signing the release build with the debug key: set android.signing in angular.json for a Google Play upload.',
    );
  }

  log('Building the Android app');
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  if (process.platform !== 'win32') {
    // Angular schematics can't set file modes, so an ejected project's
    // gradlew arrives without its executable bit.
    chmodSync(path.join(project.dir, 'gradlew'), 0o755);
  }
  await run(
    gradlew,
    [':app:assembleRelease', ':app:bundleRelease', '--console=plain'],
    { cwd: project.dir, logFile, env },
  );

  mkdirSync(outputDir, { recursive: true });
  const outputs = path.join(project.dir, 'app/build/outputs');
  const apk = path.join(outputDir, `${app.artifactName}.apk`);
  const aab = path.join(outputDir, `${app.artifactName}.aab`);
  cpSync(path.join(outputs, 'apk/release/app-release.apk'), apk);
  cpSync(path.join(outputs, 'bundle/release/app-release.aab'), aab);
  return [apk, aab];
};

/**
 * Android Gradle Plugin 8 needs JDK 17 or newer. When JAVA_HOME isn't set on
 * macOS, ask java_home for one rather than whatever `java` is on the PATH.
 */
const javaEnv = async (): Promise<NodeJS.ProcessEnv> => {
  if (process.env['JAVA_HOME'] || process.platform !== 'darwin') {
    return {};
  }
  const home = (await capture('/usr/libexec/java_home', ['-v', '17+']))?.trim();
  return home ? { JAVA_HOME: home } : {};
};
