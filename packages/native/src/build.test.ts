import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAndroid } from './android/build.ts';
import { buildIos } from './ios/build.ts';
import { resolveAppOptions } from './options.ts';

/**
 * The native tools are replaced by shell scripts that record their arguments
 * and environment and write the files the real tools would, so these tests
 * check what the builder asks for and collects without Xcode or Gradle.
 */
let dir: string;
let calls: string;
let originalPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-build-'));
  calls = path.join(dir, 'calls.log');
  originalPath = process.env['PATH'];
});
afterEach(() => {
  process.env['PATH'] = originalPath;
  rmSync(dir, { recursive: true, force: true });
});

const script = (file: string, body: string, shell = '/bin/sh') => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!${shell}\n${body}\n`);
  chmodSync(file, 0o755);
};

/**
 * The real gradlew is a /bin/sh script, and on Debian and Ubuntu that is
 * dash, which drops environment variables whose names aren't shell
 * identifiers. Run the fake one with dash where it's installed (macOS has
 * it at /bin/dash, though its /bin/sh is bash), so a dotted variable name
 * fails here too and not only on Linux CI.
 */
const GRADLEW_SHELL = existsSync('/bin/dash') ? '/bin/dash' : '/bin/sh';

const app = (options = {}) =>
  resolveAppOptions(
    { appName: 'My App', ...options },
    { projectName: 'my-app' },
  );

describe('buildIos', () => {
  const setup = () => {
    const bin = path.join(dir, 'bin');
    // Writes what each xcodebuild action produces, under the paths it was
    // given, and records every call.
    script(
      path.join(bin, 'xcodebuild'),
      `echo "$@" >> "${calls}"
dd=""; archive=""; export_path=""; prev=""
for arg in "$@"; do
  case "$prev" in
    -derivedDataPath) dd="$arg" ;;
    -archivePath) archive="$arg" ;;
    -exportPath) export_path="$arg" ;;
  esac
  prev="$arg"
done
case "$1" in
  build) mkdir -p "$dd/Build/Products/Release-iphonesimulator/MyApp.app" && echo app > "$dd/Build/Products/Release-iphonesimulator/MyApp.app/MyApp" ;;
  archive) mkdir -p "$archive" ;;
  -exportArchive) mkdir -p "$export_path" && echo ipa > "$export_path/MyApp.ipa" ;;
esac`,
    );
    process.env['PATH'] = `${bin}:${originalPath}`;
    const projectDir = path.join(dir, 'project');
    mkdirSync(projectDir);
    const frameworks = path.join(dir, 'frameworks');
    mkdirSync(frameworks);
    return {
      project: { dir: projectDir, ejected: false, regenerated: true },
      frameworksDir: frameworks,
      buildDir: path.join(dir, 'dd'),
      outputDir: path.join(dir, 'dist/ios'),
      logFile: path.join(dir, 'ios.log'),
      log: () => {},
    };
  };

  it('builds the simulator app and links the frameworks', async () => {
    const options = setup();
    const messages: string[] = [];
    const artifacts = await buildIos({
      ...options,
      app: app(),
      signing: undefined,
      log: (message) => messages.push(message),
    });
    expect(artifacts).toEqual([path.join(dir, 'dist/ios/MyApp-simulator.app')]);
    expect(
      readFileSync(
        path.join(dir, 'dist/ios/MyApp-simulator.app/MyApp'),
        'utf8',
      ),
    ).toBe('app\n');
    const link = path.join(options.project.dir, 'Frameworks');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(options.frameworksDir);
    expect(readFileSync(calls, 'utf8')).toContain(
      `build -project App.xcodeproj -scheme App -configuration Release -sdk iphonesimulator -destination generic/platform=iOS Simulator -derivedDataPath ${options.buildDir}`,
    );
    expect(messages).toContain(
      'Skipping the App Store .ipa: set ios.teamId and ios.signing in angular.json to build one.',
    );
  });

  it('keeps the Frameworks folder an ejected project vendors', async () => {
    const options = setup();
    mkdirSync(path.join(options.project.dir, 'Frameworks'));
    await buildIos({ ...options, app: app(), signing: undefined });
    expect(
      lstatSync(path.join(options.project.dir, 'Frameworks')).isDirectory(),
    ).toBe(true);
  });

  it('archives and exports a signed .ipa with the API key', async () => {
    const options = setup();
    const artifacts = await buildIos({
      ...options,
      app: app(),
      signing: {
        teamId: 'TEAM',
        keyPath: '/k.p8',
        keyId: 'KID',
        issuerId: 'ISS',
      },
    });
    expect(artifacts).toEqual([
      path.join(dir, 'dist/ios/MyApp-simulator.app'),
      path.join(dir, 'dist/ios/MyApp.ipa'),
    ]);
    const log = readFileSync(calls, 'utf8');
    const auth =
      '-allowProvisioningUpdates -authenticationKeyPath /k.p8 -authenticationKeyID KID -authenticationKeyIssuerID ISS';
    expect(log).toContain(`-destination generic/platform=iOS -archivePath`);
    expect(log).toContain(`${auth} DEVELOPMENT_TEAM=TEAM`);
    expect(log).toMatch(
      /-exportArchive .*-exportOptionsPlist .*ExportOptions\.plist/,
    );
    expect(
      readFileSync(path.join(options.buildDir, 'ExportOptions.plist'), 'utf8'),
    ).toContain('<string>TEAM</string>');
  });
});

describe('buildAndroid', () => {
  const setup = () => {
    const projectDir = path.join(dir, 'project');
    process.env['ANDROID_HOME'] = dir;
    // Records the signing properties Gradle would see, then writes the
    // outputs of assembleRelease and bundleRelease.
    script(
      path.join(projectDir, 'gradlew'),
      `echo "$@" >> "${calls}"
env | grep '^ORG_GRADLE_PROJECT_angularLynx' | sort >> "${calls}"
[ "$ANDROID_HOME" = "${dir}" ] || echo "wrong ANDROID_HOME: $ANDROID_HOME" >> "${calls}"
mkdir -p app/build/outputs/apk/release app/build/outputs/bundle/release
echo apk > app/build/outputs/apk/release/app-release.apk
echo aab > app/build/outputs/bundle/release/app-release.aab`,
      GRADLEW_SHELL,
    );
    return {
      project: { dir: projectDir, ejected: false, regenerated: true },
      outputDir: path.join(dir, 'dist/android'),
      logFile: path.join(dir, 'android.log'),
      log: () => {},
    };
  };

  it('builds the release apk and aab, signed with the debug key by default', async () => {
    const options = setup();
    const messages: string[] = [];
    const artifacts = await buildAndroid({
      ...options,
      app: app(),
      signing: undefined,
      log: (message) => messages.push(message),
    });
    expect(artifacts).toEqual([
      path.join(dir, 'dist/android/my-app.apk'),
      path.join(dir, 'dist/android/my-app.aab'),
    ]);
    expect(readFileSync(artifacts[0]!, 'utf8')).toBe('apk\n');
    expect(readFileSync(calls, 'utf8')).toBe(
      ':app:assembleRelease :app:bundleRelease --console=plain\n',
    );
    expect(messages[0]).toMatch(/debug key/);
  });

  it('passes the upload key through the environment, never the command line', async () => {
    const options = setup();
    await buildAndroid({
      ...options,
      app: app(),
      signing: {
        storeFile: '/upload.jks',
        storePassword: 'secret1',
        keyAlias: 'upload',
        keyPassword: 'secret2',
      },
    });
    expect(readFileSync(calls, 'utf8')).toBe(
      [
        ':app:assembleRelease :app:bundleRelease --console=plain',
        'ORG_GRADLE_PROJECT_angularLynxKeyAlias=upload',
        'ORG_GRADLE_PROJECT_angularLynxKeyPassword=secret2',
        'ORG_GRADLE_PROJECT_angularLynxStoreFile=/upload.jks',
        'ORG_GRADLE_PROJECT_angularLynxStorePassword=secret1',
        '',
      ].join('\n'),
    );
    expect(readFileSync(options.logFile, 'utf8')).not.toContain('secret');
    expect(existsSync(path.join(dir, 'dist/android/my-app.aab'))).toBe(true);
  });

  it('explains a missing Android SDK', async () => {
    const options = setup();
    process.env['ANDROID_HOME'] = path.join(dir, 'missing');
    const home = process.env['HOME'];
    process.env['HOME'] = path.join(dir, 'empty-home');
    try {
      await expect(
        buildAndroid({ ...options, app: app(), signing: undefined }),
      ).rejects.toThrow(/The Android SDK was not found/);
    } finally {
      process.env['HOME'] = home;
      delete process.env['ANDROID_HOME'];
    }
  });

  it('makes gradlew executable, which an ejected project may lack', async () => {
    const options = setup();
    chmodSync(path.join(options.project.dir, 'gradlew'), 0o644);
    await buildAndroid({ ...options, app: app(), signing: undefined });
    expect(existsSync(path.join(dir, 'dist/android/my-app.apk'))).toBe(true);
  });
});
