import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PlatformGenerator } from '../generate.ts';
import {
  type Orientation,
  type ResolvedApp,
  shortcutIdentifier,
} from '../options.ts';
import { PERMISSION_MAP } from '../permissions.ts';
import { writeAndroidIcon } from './icon.ts';
import { escapeXml, replaceMarker } from '../xml.ts';

const MANIFEST = 'app/src/main/AndroidManifest.xml';
const RESOURCES = 'app/src/main/res';

const SCREEN_ORIENTATIONS: Record<Orientation, string> = {
  portrait: 'portrait',
  landscape: 'sensorLandscape',
  all: 'unspecified',
};

/**
 * Writes the app options into the Android template: identity goes in
 * angular-lynx.properties (which app/build.gradle.kts reads), and permissions,
 * deep links and the apps canOpenURL can see go between the manifest's
 * `angular-lynx:*` markers, the icon options become the launcher icon's
 * resources, and the shortcuts become the static shortcuts' resources.
 */
export const androidGenerator: PlatformGenerator = {
  configure: (dir, app, projectRoot) => {
    // npm keeps file modes when it packs, but a copy through another tool
    // (or a Windows checkout) may not, and Gradle can't start without it.
    chmodSync(path.join(dir, 'gradlew'), 0o755);
    writeFileSync(path.join(dir, 'angular-lynx.properties'), properties(app));

    const manifestPath = path.join(dir, MANIFEST);
    let manifest = readFileSync(manifestPath, 'utf8');
    manifest = replaceMarker(manifest, 'permissions', permissionEntries(app));
    manifest = replaceMarker(manifest, 'deep-links', deepLinkEntries(app));
    manifest = replaceMarker(manifest, 'queries', queriesEntries(app));
    writeFileSync(manifestPath, manifest);

    // The template's shortcuts.xml is an empty list, which an app without
    // shortcuts keeps.
    if (app.shortcuts.length > 0) {
      writeFileSync(
        path.join(dir, RESOURCES, 'xml/shortcuts.xml'),
        shortcutsXml(app),
      );
      writeFileSync(
        path.join(dir, RESOURCES, 'values/shortcuts.xml'),
        shortcutStringsXml(app),
      );
    }

    writeAndroidIcon(dir, app, projectRoot);
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
    `edgeToEdge=${app.edgeToEdge}`,
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

/**
 * The apps LinkingModule's canOpenURL can see from Android 11: those that
 * open a URL with one of the schemes. resolveActivity() finds no other app,
 * though startActivity() still opens one.
 */
export const queriesEntries = (app: ResolvedApp): string =>
  [
    '<queries>',
    ...app.canOpenURLSchemes.flatMap((scheme) => [
      '    <intent>',
      '        <action android:name="android.intent.action.VIEW" />',
      `        <data android:scheme="${escapeXml(scheme)}" />`,
      '    </intent>',
    ]),
    '</queries>',
  ].join('\n');

/**
 * The string resource holding a shortcut's label.
 */
const shortcutLabel = (id: string) => `shortcut_${shortcutIdentifier(id)}`;

/**
 * res/xml/shortcuts.xml: angular.json's `shortcuts` as the app's static
 * shortcuts, the ones in the menu a long press on the app's icon opens.
 * They're there from the moment the app is installed, which the ones an app
 * adds while it runs aren't.
 *
 * Each starts ShortcutActivity with its ID and route, which hands them to
 * MainActivity (see ShortcutActivity.kt for why not directly). A shortcut's
 * intent names its activity in full, with the applicationId as the package,
 * since the manifest's placeholders don't reach other resources.
 */
export const shortcutsXml = (app: ResolvedApp): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!--',
    '  Written by @blotch/angular-lynx-native from the shortcuts in',
    "  angular.json's builder options on every build. Edits here are",
    '  overwritten; change angular.json instead (or eject).',
    '-->',
    '<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">',
    ...app.shortcuts.flatMap((shortcut) => [
      '    <shortcut',
      `        android:shortcutId="${escapeXml(shortcut.id)}"`,
      '        android:enabled="true"',
      // A shortcut without an icon gets an empty circle in the launcher's
      // menu, so each takes the app's.
      '        android:icon="@mipmap/ic_launcher"',
      `        android:shortcutShortLabel="@string/${shortcutLabel(shortcut.id)}">`,
      '        <intent',
      '            android:action="android.intent.action.VIEW"',
      `            android:targetPackage="${escapeXml(app.id)}"`,
      '            android:targetClass="dev.angularlynx.shell.ShortcutActivity">',
      `            <extra android:name="angularLynxShortcutId" android:value="${escapeXml(shortcut.id)}" />`,
      ...(shortcut.route === undefined
        ? []
        : [
            `            <extra android:name="angularLynxShortcutRoute" android:value="${escapeXml(shortcut.route)}" />`,
          ]),
      '        </intent>',
      '    </shortcut>',
    ]),
    '</shortcuts>',
    '',
  ].join('\n');

/**
 * Text as an Android string resource. Besides XML's own characters, a
 * resource reads `'` and `"` as quoting, a backslash as an escape, and a
 * leading `@` or `?` as a reference to another resource.
 */
export const stringResource = (text: string): string =>
  text
    .replace(/[\\'"]/g, '\\$&')
    .replace(/^[@?]/, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * res/values/shortcuts.xml: each shortcut's title, which a shortcut can only
 * take from a string resource.
 */
export const shortcutStringsXml = (app: ResolvedApp): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Written from angular.json's shortcuts (see xml/shortcuts.xml). -->",
    '<resources>',
    ...app.shortcuts.map(
      (shortcut) =>
        `    <string name="${shortcutLabel(shortcut.id)}">${stringResource(shortcut.title)}</string>`,
    ),
    '</resources>',
    '',
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
