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
import { buildIos, missingTeamMessage, signingTeams } from './ios/build.ts';
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
  delete process.env['XCODEBUILD_FAILS'];
  delete process.env['XCODEBUILD_FAILS_ON'];
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
[ -n "$XCODEBUILD_FAILS" ] && [ "\${XCODEBUILD_FAILS_ON:-$1}" = "$1" ] && { echo "$XCODEBUILD_FAILS" >&2; exit 65; }
dd=""; archive=""; export_path=""; sdk=""; configuration=""; prev=""
for arg in "$@"; do
  case "$prev" in
    -derivedDataPath) dd="$arg" ;;
    -sdk) sdk="$arg" ;;
    -configuration) configuration="$arg" ;;
    -archivePath) archive="$arg" ;;
    -exportPath) export_path="$arg" ;;
  esac
  prev="$arg"
done
case "$1" in
  build) mkdir -p "$dd/Build/Products/$configuration-$sdk/MyApp.app" && echo "$configuration $sdk" > "$dd/Build/Products/$configuration-$sdk/MyApp.app/MyApp" ;;
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
    ).toBe('Release iphonesimulator\n');
    const link = path.join(options.project.dir, 'Frameworks');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(options.frameworksDir);
    expect(readFileSync(calls, 'utf8')).toContain(
      `build -project App.xcodeproj -scheme App -configuration Release -sdk iphonesimulator -destination generic/platform=iOS Simulator -derivedDataPath ${options.buildDir}`,
    );
    expect(messages).toContain(
      'Skipping the .ipa: set ios.teamId and ios.signing in angular.json to build one.',
    );
  });

  it("builds `ng serve --platform`'s development app in Debug, for its simulator alone, and never an .ipa", async () => {
    const options = setup();
    const artifacts = await buildIos({
      ...options,
      app: app({ ios: { teamId: 'TEAM123', export: 'release-testing' } }),
      signing: { teamId: 'TEAM123', export: 'release-testing' },
      development: true,
      simulator: { udid: 'SIM-UDID' },
    });
    expect(artifacts).toEqual([path.join(dir, 'dist/ios/MyApp-simulator.app')]);
    expect(readFileSync(path.join(artifacts[0]!, 'MyApp'), 'utf8')).toBe(
      'Debug iphonesimulator\n',
    );
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
      `build -project App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination id=SIM-UDID -derivedDataPath ${options.buildDir}`,
    ]);
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
    const messages: string[] = [];
    const artifacts = await buildIos({
      ...options,
      app: app(),
      signing: {
        teamId: 'TEAM',
        apiKey: { keyPath: '/k.p8', keyId: 'KID', issuerId: 'ISS' },
        export: 'app-store-connect',
      },
      log: (message) => messages.push(message),
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
    const plist = readFileSync(
      path.join(options.buildDir, 'ExportOptions.plist'),
      'utf8',
    );
    expect(plist).toContain('<string>TEAM</string>');
    expect(plist).toContain('<string>app-store-connect</string>');
    expect(messages).toContain('Archiving the iOS app for the App Store');
  });

  it('exports an ad hoc .ipa with the Apple ID signed in to Xcode', async () => {
    const options = setup();
    const messages: string[] = [];
    const artifacts = await buildIos({
      ...options,
      app: app(),
      signing: { teamId: 'TEAM', export: 'release-testing' },
      log: (message) => messages.push(message),
    });
    expect(artifacts.at(-1)).toBe(path.join(dir, 'dist/ios/MyApp.ipa'));
    const log = readFileSync(calls, 'utf8');
    expect(log).toContain('-allowProvisioningUpdates DEVELOPMENT_TEAM=TEAM');
    expect(log).not.toContain('-authenticationKeyPath');
    expect(
      readFileSync(path.join(options.buildDir, 'ExportOptions.plist'), 'utf8'),
    ).toContain('<string>release-testing</string>');
    expect(messages).toContain(
      "Archiving the iOS app for the team's registered iPhones",
    );
  });

  it('builds no .ipa for a team alone, and says what would build one', async () => {
    const options = setup();
    const messages: string[] = [];
    const artifacts = await buildIos({
      ...options,
      app: app(),
      signing: { teamId: 'TEAM' },
      log: (message) => messages.push(message),
    });
    expect(artifacts).toEqual([path.join(dir, 'dist/ios/MyApp-simulator.app')]);
    expect(messages).toContain(
      'Skipping the .ipa: set ios.signing (an App Store Connect API key) or ios.export in angular.json to build one.',
    );
  });

  describe('for an iPhone', () => {
    const device = { udid: '00008120-0001', name: 'Dolan’s iPhone' };

    it('builds only a development-signed app for the device, registering it with the team', async () => {
      const options = setup();
      const messages: string[] = [];
      const artifacts = await buildIos({
        ...options,
        app: app(),
        signing: { teamId: 'TEAM', export: 'app-store-connect' },
        device,
        log: (message) => messages.push(message),
      });
      expect(artifacts).toEqual([path.join(dir, 'dist/ios/MyApp-device.app')]);
      expect(readFileSync(path.join(artifacts[0]!, 'MyApp'), 'utf8')).toBe(
        'Release iphoneos\n',
      );
      expect(readFileSync(calls, 'utf8')).toBe(
        `build -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos -destination id=00008120-0001 -derivedDataPath ${options.buildDir} -allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM=TEAM\n`,
      );
      expect(messages).toEqual(['Building the iOS app for Dolan’s iPhone']);
    });

    it('builds the development app for it in Debug', async () => {
      const options = setup();
      const artifacts = await buildIos({
        ...options,
        app: app(),
        signing: { teamId: 'TEAM' },
        device,
        development: true,
      });
      expect(readFileSync(path.join(artifacts[0]!, 'MyApp'), 'utf8')).toBe(
        'Debug iphoneos\n',
      );
      expect(readFileSync(calls, 'utf8')).toContain(
        '-configuration Debug -sdk iphoneos -destination id=00008120-0001',
      );
    });

    it('signs with the API key when there is one', async () => {
      const options = setup();
      await buildIos({
        ...options,
        app: app(),
        signing: {
          teamId: 'TEAM',
          apiKey: { keyPath: '/k.p8', keyId: 'KID', issuerId: 'ISS' },
        },
        device,
      });
      expect(readFileSync(calls, 'utf8')).toContain(
        '-allowProvisioningUpdates -authenticationKeyPath /k.p8 -authenticationKeyID KID -authenticationKeyIssuerID ISS -allowProvisioningDeviceRegistration',
      );
    });

    it('needs a team', async () => {
      const options = setup();
      await expect(
        buildIos({ ...options, app: app(), signing: undefined, device }),
      ).rejects.toThrow(
        /^Running the app on Dolan’s iPhone needs ios\.teamId in angular\.json/,
      );
    });

    it("explains xcodebuild's errors about the phone and signing", async () => {
      const options = setup();
      const build = () =>
        buildIos({
          ...options,
          app: app(),
          signing: { teamId: 'TEAM' },
          device,
        });
      process.env['XCODEBUILD_FAILS'] =
        'error: No Account for Team "TEAM". Add a new account in Accounts settings.';
      await expect(build()).rejects.toThrow(
        /^Xcode has no signed-in account for team TEAM\. Sign in to Xcode[\s\S]*No Account for Team/,
      );
      process.env['XCODEBUILD_FAILS'] =
        "error: No profiles for 'com.example.myapp' were found";
      await expect(build()).rejects.toThrow(
        /^Xcode couldn't make a provisioning profile for team TEAM/,
      );
      process.env['XCODEBUILD_FAILS'] =
        'xcodebuild: error: Timed out waiting for all destinations matching the provided destination specifier to become available\n{ platform:iOS, name:Dolan’s iPhone, error:Dolan’s iPhone needs to be unlocked to enable development services Please unlock the device. }';
      await expect(build()).rejects.toThrow(
        /^Dolan’s iPhone is locked\. Unlock it, keep it unlocked until the app opens, and build again\./,
      );
      process.env['XCODEBUILD_FAILS'] =
        'xcodebuild: error: Timed out waiting for all destinations matching the provided destination specifier to become available';
      await expect(build()).rejects.toThrow(
        /^xcodebuild couldn't reach Dolan’s iPhone\./,
      );
      process.env['XCODEBUILD_FAILS'] = 'error: Something else';
      await expect(build()).rejects.toThrow(
        /^xcodebuild build failed \(exit code 65\)/,
      );
    });
  });

  it('explains a signing error while archiving', async () => {
    const options = setup();
    process.env['XCODEBUILD_FAILS'] = 'error: No Accounts';
    process.env['XCODEBUILD_FAILS_ON'] = 'archive';
    await expect(
      buildIos({
        ...options,
        app: app(),
        signing: { teamId: 'TEAM', export: 'release-testing' },
      }),
    ).rejects.toThrow(/^Xcode has no signed-in account for team TEAM/);
  });
});

/**
 * A self-signed certificate with the subject of an Apple Development one:
 * `OU=ABCDE12345, O=Jane Doe`.
 */
const DEVELOPMENT_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICHzCCAcagAwIBAgIUMh7cHzXtkcMIbJpd/aGoeSIujn0wCgYIKoZIzj0EAwIw
djETMBEGCgmSJomT8ixkAQEMA0FCQzEqMCgGA1UEAwwhQXBwbGUgRGV2ZWxvcG1l
bnQ6IEphbmUgRG9lIChYWVopMRMwEQYDVQQLDApBQkNERTEyMzQ1MREwDwYDVQQK
DAhKYW5lIERvZTELMAkGA1UEBhMCVVMwHhcNMjYxMTEwMDEzOTE1WhcNMzYxMTA3
MDEzOTE1WjB2MRMwEQYKCZImiZPyLGQBAQwDQUJDMSowKAYDVQQDDCFBcHBsZSBE
ZXZlbG9wbWVudDogSmFuZSBEb2UgKFhZWikxEzARBgNVBAsMCkFCQ0RFMTIzNDUx
ETAPBgNVBAoMCEphbmUgRG9lMQswCQYDVQQGEwJVUzBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABAgg2nRvxow1WwwCoCmBSCoj/3z0RlRSsBCVNEb7QwIWkNxi6L0a
MTfyTdDICGcn25cu5gd1Ej/RAzKhB81HI6mjMjAwMB0GA1UdDgQWBBR7vsgevmqw
g8iSxCQfuohv3Htn8jAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQC
IBHBCxXGxuGndDaboI/F5MMuySWm3o3C9i63J8tYRL76AiA9uPHzgBe1EMvhCTqN
pNVEHI9o5e0Twpd94DbgJrEong==
-----END CERTIFICATE-----`;

describe('signingTeams', () => {
  const fakeTools = ({
    preferences,
    certificates,
  }: {
    preferences?: Record<string, unknown>;
    certificates?: string;
  }) => {
    const bin = path.join(dir, 'bin');
    // plutil prints the key it's asked for from preferences.json as JSON,
    // or fails as it does for a missing key.
    writeFileSync(
      path.join(dir, 'preferences.json'),
      JSON.stringify(preferences ?? {}),
    );
    script(
      path.join(bin, 'plutil'),
      `node -e 'const value = require(process.argv[1])[process.argv[2]]; if (value === undefined) process.exit(1); console.log(JSON.stringify(value))' "${dir}/preferences.json" "$2"`,
    );
    writeFileSync(path.join(dir, 'certificates.pem'), certificates ?? '');
    script(path.join(bin, 'security'), `cat "${dir}/certificates.pem"`);
    process.env['PATH'] = `${bin}:${originalPath}`;
  };

  it("lists the teams of Xcode's accounts, then of the keychain's development certificates", async () => {
    fakeTools({
      preferences: {
        IDEProvisioningTeamByIdentifier: {
          'account-1': [
            {
              teamID: 'PERSONAL01',
              teamName: 'Jane Doe',
              isFreeProvisioningTeam: true,
            },
            { teamID: 'ABCDE12345', teamName: 'Acme Inc' },
            { teamName: 'No ID' },
          ],
        },
        IDEProvisioningTeams: {
          'jane@example.com': [{ teamID: '1234567890' }],
        },
      },
      certificates: `${DEVELOPMENT_CERTIFICATE}\n-----BEGIN CERTIFICATE-----\nbroken\n-----END CERTIFICATE-----\n${DEVELOPMENT_CERTIFICATE.replace('ABCDE12345', 'x')}`,
    });
    expect(
      await signingTeams({ preferences: path.join(dir, 'Xcode.plist') }),
    ).toEqual([
      { id: 'PERSONAL01', name: 'Jane Doe, Personal Team' },
      { id: 'ABCDE12345', name: 'Acme Inc' },
      { id: '1234567890', name: '1234567890' },
    ]);
  });

  it('reads a certificate team when Xcode has no account', async () => {
    fakeTools({
      preferences: { IDEProvisioningTeams: 'not a dictionary of arrays' },
      certificates: DEVELOPMENT_CERTIFICATE,
    });
    expect(await signingTeams()).toEqual([
      { id: 'ABCDE12345', name: 'Jane Doe' },
    ]);
    expect(await missingTeamMessage('Phone')).toContain(
      'Set it to one of your teams: ABCDE12345 (Jane Doe).',
    );
  });

  it('says to sign in to Xcode when there is no team at all', async () => {
    fakeTools({});
    expect(await signingTeams()).toEqual([]);
    expect(await missingTeamMessage('Phone')).toBe(
      "Running the app on Phone needs ios.teamId in angular.json: iOS only runs apps signed by an Apple Developer team. Sign in to Xcode with your Apple ID (Xcode → Settings → Accounts) and build again, and this message lists your teams. A free Apple ID's Personal Team works, but its apps stop opening after 7 days; the paid Apple Developer Program's team keeps them working for a year.",
    );
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
mkdir -p app/build/outputs/apk/release app/build/outputs/bundle/release app/build/outputs/apk/debug
echo apk > app/build/outputs/apk/release/app-release.apk
echo aab > app/build/outputs/bundle/release/app-release.aab
echo debug > app/build/outputs/apk/debug/app-debug.apk`,
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

  it("builds `ng serve --platform`'s development app as the debug build type's apk alone", async () => {
    const options = setup();
    const messages: string[] = [];
    const artifacts = await buildAndroid({
      ...options,
      app: app(),
      signing: undefined,
      development: true,
      log: (message) => messages.push(message),
    });
    expect(artifacts).toEqual([path.join(dir, 'dist/android/my-app-dev.apk')]);
    expect(readFileSync(artifacts[0]!, 'utf8')).toBe('debug\n');
    expect(readFileSync(calls, 'utf8')).toBe(
      ':app:assembleDebug --console=plain\n',
    );
    // The debug key is the debug build type's, not a missing upload key.
    expect(messages).toEqual(['Building the Android app']);
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
