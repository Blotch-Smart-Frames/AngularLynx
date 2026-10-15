import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { PreparedProject } from '../generate.ts';
import type { ResolvedApp } from '../options.ts';
import { run } from '../process.ts';
import { escapeXml } from '../xml.ts';

export type IosSigning = {
  readonly teamId: string;
  readonly keyPath: string;
  readonly keyId: string;
  readonly issuerId: string;
};

/**
 * Reads the App Store Connect API key from the environment variables the
 * options name. Returns undefined when signing isn't configured at all, so a
 * build without credentials still produces the simulator app, and throws when
 * it's configured halfway, which is always a mistake.
 */
export const resolveIosSigning = (
  app: ResolvedApp,
  env: NodeJS.ProcessEnv = process.env,
): IosSigning | undefined => {
  const signing = app.ios.signing;
  if (!signing && !app.ios.teamId) {
    return undefined;
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
  if (!app.ios.teamId) {
    throw new Error('ios.signing is set, but ios.teamId is not.');
  }
  const keyPath = read('keyPathEnv', signing?.keyPathEnv);
  if (!existsSync(keyPath)) {
    throw new Error(`The App Store Connect key ${keyPath} doesn't exist.`);
  }
  return {
    teamId: app.ios.teamId,
    keyPath,
    keyId: read('keyIdEnv', signing?.keyIdEnv),
    issuerId: read('issuerIdEnv', signing?.issuerIdEnv),
  };
};

/**
 * Builds the iOS shell: always a simulator `.app`, plus an App Store `.ipa`
 * when signing is configured. Returns the artifacts' paths.
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
}): Promise<string[]> => {
  linkFrameworks(project.dir, frameworksDir);
  const xcodebuild = (args: readonly string[]) =>
    run('xcodebuild', args, { cwd: project.dir, logFile });
  const common = ['-project', 'App.xcodeproj', '-scheme', 'App'];
  const artifacts: string[] = [];
  mkdirSync(outputDir, { recursive: true });

  log('Building the iOS Simulator app');
  await xcodebuild([
    'build',
    ...common,
    '-configuration',
    'Release',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    buildDir,
  ]);
  const simulatorApp = path.join(outputDir, `${app.productName}-simulator.app`);
  rmSync(simulatorApp, { recursive: true, force: true });
  cpSync(
    path.join(
      buildDir,
      'Build/Products/Release-iphonesimulator',
      `${app.productName}.app`,
    ),
    simulatorApp,
    { recursive: true, verbatimSymlinks: true },
  );
  artifacts.push(simulatorApp);

  if (!signing) {
    log(
      'Skipping the App Store .ipa: set ios.teamId and ios.signing in angular.json to build one.',
    );
    return artifacts;
  }

  // Headless signing: the API key lets xcodebuild create and download the
  // certificate and provisioning profile itself, so nobody opens Xcode.
  const auth = [
    '-allowProvisioningUpdates',
    '-authenticationKeyPath',
    signing.keyPath,
    '-authenticationKeyID',
    signing.keyId,
    '-authenticationKeyIssuerID',
    signing.issuerId,
  ];
  const archive = path.join(buildDir, `${app.productName}.xcarchive`);
  log('Archiving the iOS app for the App Store');
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
    ...auth,
    `DEVELOPMENT_TEAM=${signing.teamId}`,
  ]);

  const exportOptions = path.join(buildDir, 'ExportOptions.plist');
  writeFileSync(exportOptions, exportOptionsPlist(signing.teamId));
  const exportDir = path.join(buildDir, 'export');
  rmSync(exportDir, { recursive: true, force: true });
  log('Exporting the .ipa');
  await xcodebuild([
    '-exportArchive',
    '-archivePath',
    archive,
    '-exportPath',
    exportDir,
    '-exportOptionsPlist',
    exportOptions,
    ...auth,
  ]);
  const ipa = path.join(outputDir, `${app.productName}.ipa`);
  cpSync(path.join(exportDir, `${app.productName}.ipa`), ipa);
  artifacts.push(ipa);
  return artifacts;
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
): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>export</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${escapeXml(teamId)}</string>
	<key>uploadSymbols</key>
	<true/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
`;
