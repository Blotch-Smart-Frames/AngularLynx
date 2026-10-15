import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PlatformGenerator } from '../generate.ts';
import type { Orientation, ResolvedApp } from '../options.ts';
import { PERMISSION_MAP } from '../permissions.ts';
import { escapeXml, replaceMarker } from '../xml.ts';

const MANIFEST = 'app/src/main/AndroidManifest.xml';

const SCREEN_ORIENTATIONS: Record<Orientation, string> = {
  portrait: 'portrait',
  landscape: 'sensorLandscape',
  all: 'unspecified',
};

/**
 * Writes the app options into the Android template: identity goes in
 * angular-lynx.properties (which app/build.gradle.kts reads), and permissions
 * and deep links go between the manifest's `angular-lynx:*` markers.
 */
export const androidGenerator: PlatformGenerator = {
  configure: (dir, app) => {
    // npm keeps file modes when it packs, but a copy through another tool
    // (or a Windows checkout) may not, and Gradle can't start without it.
    chmodSync(path.join(dir, 'gradlew'), 0o755);
    writeFileSync(path.join(dir, 'angular-lynx.properties'), properties(app));

    const manifestPath = path.join(dir, MANIFEST);
    let manifest = readFileSync(manifestPath, 'utf8');
    manifest = replaceMarker(manifest, 'permissions', permissionEntries(app));
    manifest = replaceMarker(manifest, 'deep-links', deepLinkEntries(app));
    writeFileSync(manifestPath, manifest);
  },
  bundleDir: (dir) => path.join(dir, 'app/src/main/assets'),
};

/**
 * Escapes a value for a Java properties file. `Properties.load` reads the
 * file as ISO-8859-1, so anything outside ASCII (an app named "Café" or
 * "日記") must be written as `\uXXXX` or Gradle reads mojibake.
 */
export const propertyValue = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(
      /[^\x20-\x7e]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );

export const properties = (app: ResolvedApp): string =>
  [
    '# Written by @blotch/angular-lynx-native from the builder options in',
    '# angular.json on every build. Edits here are overwritten; change',
    '# angular.json instead (or eject).',
    `applicationId=${app.id}`,
    `versionName=${app.version}`,
    `versionCode=${app.buildNumber}`,
    `appName=${propertyValue(app.name)}`,
    `screenOrientation=${SCREEN_ORIENTATIONS[app.orientation]}`,
    '',
  ].join('\n');

export const permissionEntries = (app: ResolvedApp): string => {
  const entries = Object.keys(app.permissions).map(
    (permission) => PERMISSION_MAP[permission as keyof typeof PERMISSION_MAP],
  );
  const permissions = [...new Set(entries.flatMap((entry) => entry.android))];
  const features = [
    ...new Set(entries.flatMap((entry) => entry.androidFeatures ?? [])),
  ];
  return [
    ...permissions.map(
      (name) => `<uses-permission android:name="${escapeXml(name)}" />`,
    ),
    ...features.map(
      (name) =>
        `<uses-feature android:name="${escapeXml(name)}" android:required="false" />`,
    ),
  ].join('\n');
};

export const deepLinkEntries = (app: ResolvedApp): string =>
  app.deepLinkSchemes.length === 0
    ? ''
    : [
        '<intent-filter>',
        '    <action android:name="android.intent.action.VIEW" />',
        '    <category android:name="android.intent.category.DEFAULT" />',
        '    <category android:name="android.intent.category.BROWSABLE" />',
        ...app.deepLinkSchemes.map(
          (scheme) => `    <data android:scheme="${escapeXml(scheme)}" />`,
        ),
        '</intent-filter>',
      ].join('\n');

/** The Android SDK, from the environment or the Android Studio default. */
export const findAndroidSdk = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  const candidates = [
    env['ANDROID_HOME'],
    env['ANDROID_SDK_ROOT'],
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Android/sdk')
      : process.platform === 'win32'
        ? path.join(env['LOCALAPPDATA'] ?? '', 'Android/Sdk')
        : path.join(os.homedir(), 'Android/Sdk'),
  ];
  return candidates.find(
    (candidate): candidate is string => !!candidate && existsSync(candidate),
  );
};
