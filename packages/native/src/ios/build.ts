import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import type { PreparedProject } from '../generate.ts';
import type { IosExportMethod, ResolvedApp } from '../options.ts';
import { NativeBuildError, capture, run } from '../process.ts';
import { escapeXml } from '../xml.ts';

export type IosSigning = {
  readonly teamId: string;
  /**
   * An App Store Connect API key, which signs without anyone signed in to
   * Xcode, e.g. on CI. Without it, xcodebuild signs with the Apple ID signed
   * in to Xcode's Accounts settings.
   */
  readonly apiKey?: {
    readonly keyPath: string;
    readonly keyId: string;
    readonly issuerId: string;
  };
  /** How to sign the `.ipa`, or undefined to build none. */
  readonly export?: IosExportMethod;
};

/**
 * Reads the signing options, and the App Store Connect API key from the
 * environment variables they name. Returns undefined when signing isn't
 * configured at all, so a build without credentials still produces the
 * simulator app, and throws when it's configured halfway, which is always a
 * mistake.
 *
 * `teamId` alone signs only the development builds `--run` installs on a
 * phone: an `.ipa` takes `signing` (an API key) or `export`, so a Personal
 * Team, which can't export one, never fails a plain build.
 */
export const resolveIosSigning = (
  app: ResolvedApp,
  env: NodeJS.ProcessEnv = process.env,
): IosSigning | undefined => {
  const { signing, teamId, export: exportMethod } = app.ios;
  if (!signing && !teamId && !exportMethod) {
    return undefined;
  }
  if (!teamId) {
    throw new Error(
      `ios.${signing ? 'signing' : 'export'} is set, but ios.teamId is not.`,
    );
  }
  if (!signing) {
    return { teamId, ...(exportMethod && { export: exportMethod }) };
  }
  const read = (option: string, name: string | undefined) => {
    if (!name) {
      throw new Error(
        `ios.signing.${option} must name the environment variable that holds it.`,
      );
    }
    const value = env[name];
    if (!value) {
      throw new Error(
        `ios.signing.${option} names ${name}, which isn't set in the environment.`,
      );
    }
    return value;
  };
  const keyPath = read('keyPathEnv', signing.keyPathEnv);
  if (!existsSync(keyPath)) {
    throw new Error(`The App Store Connect key ${keyPath} doesn't exist.`);
  }
  return {
    teamId,
    apiKey: {
      keyPath,
      keyId: read('keyIdEnv', signing.keyIdEnv),
      issuerId: read('issuerIdEnv', signing.issuerIdEnv),
    },
    export: exportMethod ?? 'app-store-connect',
  };
};

/**
 * Builds the iOS shell: a simulator `.app`, plus an `.ipa` when signing
 * says how to export one. With `device`, only a development-signed `.app` for
 * that iPhone instead, which is all `--run` installs there: the simulator app
 * would be thrown away, and archiving the `.ipa` takes minutes a Personal
 * Team's run would spend failing. Returns the artifacts' paths.
 */
export const buildIos = async ({
  project,
  app,
  frameworksDir,
  buildDir,
  outputDir,
  logFile,
  log,
  signing,
  device,
  development = false,
  simulator,
}: {
  readonly project: PreparedProject;
  readonly app: ResolvedApp;
  readonly frameworksDir: string;
  /** Xcode's derived data, kept between builds for incremental builds. */
  readonly buildDir: string;
  readonly outputDir: string;
  readonly logFile: string;
  readonly log: (message: string) => void;
  readonly signing: IosSigning | undefined;
  /** The iPhone `--run` installs the app on, when it's one. */
  readonly device?: { readonly udid: string; readonly name: string };
  /**
   * `ng serve --platform ios`'s development app: the Debug configuration,
   * which compiles the shell's dev server support in (DevServer.swift) and
   * builds for one architecture, and no `.ipa`.
   */
  readonly development?: boolean;
  /**
   * The simulator the development app runs on. The Debug configuration builds
   * only its architecture, so it builds for that simulator rather than any.
   */
  readonly simulator?: { readonly udid: string };
}): Promise<string[]> => {
  const configuration = development ? 'Debug' : 'Release';
  linkFrameworks(project.dir, frameworksDir);
  const xcodebuild = (args: readonly string[]) =>
    run('xcodebuild', args, { cwd: project.dir, logFile });
  const common = ['-project', 'App.xcodeproj', '-scheme', 'App'];
  mkdirSync(outputDir, { recursive: true });

  /**
   * -allowProvisioningUpdates lets xcodebuild create the certificate and the
   * provisioning profile itself, so nobody opens Xcode: with the API key
   * when there is one, else with the Apple ID signed in to Xcode.
   */
  const auth = (apiKey: IosSigning['apiKey']) => [
    '-allowProvisioningUpdates',
    ...(apiKey
      ? [
          '-authenticationKeyPath',
          apiKey.keyPath,
          '-authenticationKeyID',
          apiKey.keyId,
          '-authenticationKeyIssuerID',
          apiKey.issuerId,
        ]
      : []),
  ];

  if (device) {
    if (!signing) {
      throw new NativeBuildError(await missingTeamMessage(device.name));
    }
    log(`Building the iOS app for ${device.name}`);
    await xcodebuild([
      'build',
      ...common,
      '-configuration',
      configuration,
      '-sdk',
      'iphoneos',
      // The phone itself rather than generic/platform=iOS, so automatic
      // signing knows which device the development profile must list, and
      // -allowProvisioningDeviceRegistration adds it to the team if it's new.
      '-destination',
      `id=${device.udid}`,
      '-derivedDataPath',
      buildDir,
      ...auth(signing.apiKey),
      '-allowProvisioningDeviceRegistration',
      `DEVELOPMENT_TEAM=${signing.teamId}`,
    ]).catch((error: Error) => {
      throw explainDeviceBuildFailure(error, device.name, signing.teamId);
    });
    const deviceApp = path.join(outputDir, `${app.productName}-device.app`);
    rmSync(deviceApp, { recursive: true, force: true });
    cpSync(
      path.join(
        buildDir,
        `Build/Products/${configuration}-iphoneos`,
        `${app.productName}.app`,
      ),
      deviceApp,
      { recursive: true, verbatimSymlinks: true },
    );
    return [deviceApp];
  }

  const artifacts: string[] = [];
  log('Building the iOS Simulator app');
  await xcodebuild([
    'build',
    ...common,
    '-configuration',
    configuration,
    '-sdk',
    'iphonesimulator',
    '-destination',
    simulator ? `id=${simulator.udid}` : 'generic/platform=iOS Simulator',
    '-derivedDataPath',
    buildDir,
  ]);
  const simulatorApp = path.join(outputDir, `${app.productName}-simulator.app`);
  rmSync(simulatorApp, { recursive: true, force: true });
  cpSync(
    path.join(
      buildDir,
      `Build/Products/${configuration}-iphonesimulator`,
      `${app.productName}.app`,
    ),
    simulatorApp,
    { recursive: true, verbatimSymlinks: true },
  );
  artifacts.push(simulatorApp);

  if (development) {
    return artifacts;
  }
  if (!signing?.export) {
    log(
      signing
        ? 'Skipping the .ipa: set ios.signing (an App Store Connect API key) or ios.export in angular.json to build one.'
        : 'Skipping the .ipa: set ios.teamId and ios.signing in angular.json to build one.',
    );
    return artifacts;
  }

  const archive = path.join(buildDir, `${app.productName}.xcarchive`);
  log(
    signing.export === 'release-testing'
      ? "Archiving the iOS app for the team's registered iPhones"
      : 'Archiving the iOS app for the App Store',
  );
  await xcodebuild([
    'archive',
    ...common,
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=iOS',
    '-archivePath',
    archive,
    '-derivedDataPath',
    buildDir,
    ...auth(signing.apiKey),
    `DEVELOPMENT_TEAM=${signing.teamId}`,
  ]).catch((error: Error) => {
    throw explainSigningFailure(error, signing.teamId);
  });

  const exportOptions = path.join(buildDir, 'ExportOptions.plist');
  writeFileSync(
    exportOptions,
    exportOptionsPlist(signing.teamId, signing.export),
  );
  const exportDir = path.join(buildDir, 'export');
  rmSync(exportDir, { recursive: true, force: true });
  log(`Exporting the .ipa (${signing.export})`);
  await xcodebuild([
    '-exportArchive',
    '-archivePath',
    archive,
    '-exportPath',
    exportDir,
    '-exportOptionsPlist',
    exportOptions,
    ...auth(signing.apiKey),
  ]);
  const ipa = path.join(outputDir, `${app.productName}.ipa`);
  cpSync(path.join(exportDir, `${app.productName}.ipa`), ipa);
  artifacts.push(ipa);
  return artifacts;
};

/**
 * What to do when `--run` targets an iPhone but nothing says who signs the
 * app. iOS runs only signed apps, and a free Apple ID is enough for one's
 * own phone, so the message says so rather than pointing at the paid program.
 * Xcode doesn't show a team's ID anywhere obvious, so the message lists the
 * teams it can find on this Mac.
 */
export const missingTeamMessage = async (
  deviceName: string,
): Promise<string> => {
  const teams = await signingTeams();
  return (
    `Running the app on ${deviceName} needs ios.teamId in angular.json: iOS only runs apps signed by an Apple Developer team. ` +
    (teams.length > 0
      ? `Set it to one of your teams: ${teams.map((team) => `${team.id} (${team.name})`).join(', ')}.`
      : 'Sign in to Xcode with your Apple ID (Xcode → Settings → Accounts) and build again, and this message lists your teams.') +
    " A free Apple ID's Personal Team works, but its apps stop opening after 7 days; the paid Apple Developer Program's team keeps them working for a year."
  );
};

export type SigningTeam = { readonly id: string; readonly name: string };

/**
 * The teams this Mac can sign for: those of the accounts signed in to Xcode,
 * which Xcode keeps in its preferences, and those of the Apple Development
 * certificates in the keychain, whose subject holds the team's ID as OU and
 * its name as O.
 */
export const signingTeams = async ({
  preferences = path.join(
    os.homedir(),
    'Library/Preferences/com.apple.dt.Xcode.plist',
  ),
}: { readonly preferences?: string } = {}): Promise<readonly SigningTeam[]> => {
  const teams = new Map<string, string>();
  // IDEProvisioningTeamByIdentifier in Xcode 15 and later,
  // IDEProvisioningTeams before: each maps an account to its teams.
  for (const key of [
    'IDEProvisioningTeamByIdentifier',
    'IDEProvisioningTeams',
  ]) {
    const json = await capture('plutil', [
      '-extract',
      key,
      'json',
      '-o',
      '-',
      preferences,
    ]);
    try {
      const accounts = JSON.parse(json ?? '{}') as Record<
        string,
        readonly {
          readonly teamID?: string;
          readonly teamName?: string;
          readonly isFreeProvisioningTeam?: boolean;
        }[]
      >;
      for (const team of Object.values(accounts).flat()) {
        if (team.teamID) {
          teams.set(
            team.teamID,
            `${team.teamName ?? team.teamID}${team.isFreeProvisioningTeam ? ', Personal Team' : ''}`,
          );
        }
      }
    } catch {
      // Preferences in a shape this doesn't know suggest no team.
    }
  }
  const certificates =
    (await capture('security', [
      'find-certificate',
      '-a',
      '-c',
      'Apple Development',
      '-p',
    ])) ?? '';
  for (const pem of certificates.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  ) ?? []) {
    try {
      const subject = new X509Certificate(pem).subject;
      const id = /^OU=(.+)$/m.exec(subject)?.[1];
      if (id && !teams.has(id)) {
        teams.set(id, /^O=(.+)$/m.exec(subject)?.[1] ?? id);
      }
    } catch {
      // A certificate Node can't parse names no team to suggest.
    }
  }
  return [...teams].map(([id, name]) => ({ id, name }));
};

/**
 * Building for a particular iPhone needs the phone itself: xcodebuild asks
 * it for its development services before compiling, waits a minute for a
 * locked or unreachable phone, then fails with the reason at the end of a
 * long log. This puts the reason first, as the install step's does.
 */
const explainDeviceBuildFailure = (
  error: Error,
  deviceName: string,
  teamId: string,
): Error => {
  if (/needs to be unlocked/i.test(error.message)) {
    return new NativeBuildError(
      `${deviceName} is locked. Unlock it, keep it unlocked until the app opens, and build again.\n\n${error.message}`,
    );
  }
  if (/Timed out waiting for all destinations/i.test(error.message)) {
    return new NativeBuildError(
      `xcodebuild couldn't reach ${deviceName}. Connect it with a USB cable, or put it on this Mac's Wi-Fi network, unlock it, and build again.\n\n${error.message}`,
    );
  }
  return explainSigningFailure(error, teamId);
};

/**
 * Adds what to do to xcodebuild's signing errors, which name the missing
 * account or profile but not where to fix it. Other failures pass through.
 */
const explainSigningFailure = (error: Error, teamId: string): Error => {
  if (/No Accounts?\b|No account for team/i.test(error.message)) {
    return new NativeBuildError(
      `Xcode has no signed-in account for team ${teamId}. Sign in to Xcode with the Apple ID of that team (Xcode → Settings → Accounts), or set ios.signing to an App Store Connect API key, then build again.\n\n${error.message}`,
    );
  }
  // Apple refuses to register one more device, and xcodebuild then also
  // reports "No profiles for", which alone would point at the wrong fix.
  if (/maximum number of registered \w+ devices/i.test(error.message)) {
    return new NativeBuildError(
      `Team ${teamId} can't register this device: it has as many as Apple allows. A paid team can remove the devices it no longer uses at the start of its membership year (developer.apple.com → Certificates, IDs & Profiles → Devices). A free Personal Team can't remove them, so set ios.teamId to another team, such as the Personal Team of another Apple ID signed in to Xcode.\n\n${error.message}`,
    );
  }
  if (/requires a development team|No profiles for/i.test(error.message)) {
    return new NativeBuildError(
      `Xcode couldn't make a provisioning profile for team ${teamId}. Check that ios.teamId is a team your Apple ID in Xcode → Settings → Accounts belongs to, and for an .ipa that the team is in the paid Apple Developer Program.\n\n${error.message}`,
    );
  }
  return error;
};

/**
 * Points the project's `Frameworks` folder at the cached XCFrameworks. A
 * symlink, so the ~100 MB of frameworks aren't copied into every project. An
 * ejected project that vendors its own Frameworks folder keeps it.
 */
const linkFrameworks = (projectDir: string, frameworksDir: string) => {
  const link = path.join(projectDir, 'Frameworks');
  if (existsSync(link) && !lstatSync(link).isSymbolicLink()) {
    return;
  }
  rmSync(link, { force: true });
  symlinkSync(frameworksDir, link, 'dir');
};

export const exportOptionsPlist = (
  teamId: string,
  method: IosExportMethod,
): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>${method}</string>
	<key>destination</key>
	<string>export</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${escapeXml(teamId)}</string>
${
  // App Store Connect's own settings, which ad hoc exports don't take.
  method === 'app-store-connect'
    ? `	<key>uploadSymbols</key>
	<true/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
`
    : ''
}</dict>
</plist>
`;
