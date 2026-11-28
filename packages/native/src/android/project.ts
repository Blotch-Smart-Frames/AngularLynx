import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type NativeFeatures,
  removeMarkedLines,
  removeTemplateFiles,
} from '../features.ts';
import type { PlatformGenerator } from '../generate.ts';
import {
  type Orientation,
  type ResolvedApp,
  shortcutIdentifier,
} from '../options.ts';
import { PERMISSION_MAP } from '../permissions.ts';
import { writeAndroidSplash } from '../splash.ts';
import { writeAndroidIcon } from './icon.ts';
import { escapeXml, replaceMarker } from '../xml.ts';

const MANIFEST = 'app/src/main/AndroidManifest.xml';
const RESOURCES = 'app/src/main/res';
const APP_BUILD_FILE = 'app/build.gradle.kts';
const BARCODE_SCANNER_MARKER = '// angular-lynx:barcode-scanner';

/** LynxBarcodeScanner's module, which needs the `camera` permission. */
export const ANDROID_BARCODE_SCANNER_SOURCE =
  'app/src/main/java/dev/angularlynx/shell/BarcodeScannerModule.kt';

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
 * resources, the shortcuts become the static shortcuts' resources, and the
 * splash becomes the splash theme's color and image. The barcode scanner's
 * module and the library behind it stay only in an app with the `camera`
 * permission. The store review module stays only in an app with
 * `storeReview`, and the motion module only in an app with `motion`.
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

    // As on iOS (see iosGenerator), an app that doesn't ask for the camera
    // ships no scanner: neither the module nor Google's code scanner, which
    // brings Play services' libraries. MainActivity registers the module
    // only when its class is there.
    if (!app.permissions.camera) {
      rmSync(path.join(dir, ANDROID_BARCODE_SCANNER_SOURCE), { force: true });
      const buildFile = path.join(dir, APP_BUILD_FILE);
      // Configuring the same copy twice finds the lines already gone.
      if (readFileSync(buildFile, 'utf8').includes(BARCODE_SCANNER_MARKER)) {
        removeMarkedLines(buildFile, 'barcode-scanner');
      }
    }

    writeAndroidIcon(dir, app, projectRoot);
    writeAndroidSplash(dir, app, projectRoot);

    // The prompt's subtitle when the app gives none, as iOS shows
    // NSFaceIDUsageDescription. leaveOut deletes the file without it.
    const reason = app.permissions.biometrics;
    if (reason) {
      writeFileSync(
        path.join(dir, BIOMETRICS_STRINGS),
        biometricsStringsXml(reason),
      );
    }
  },
  leaveOut: (dir, features, app) => {
    // The biometrics module, AndroidX Biometric and the lines that register
    // it are only for an app that asks for biometrics.
    if (!app.permissions.biometrics) {
      removeTemplateFiles(dir, [
        ...ANDROID_BIOMETRICS_SOURCES.map((file) =>
          path.join(SHELL_SOURCES, file),
        ),
        BIOMETRICS_STRINGS,
      ]);
      for (const file of ANDROID_BIOMETRICS_MARKED) {
        removeMarkedLines(path.join(dir, file), 'biometrics');
      }
    }
    // As on iOS, an app that doesn't ask for ratings in the app leaves the
    // module out, with the lines that register it and Google Play's review
    // library (`// angular-lynx:store-review`), so its APK carries none of
    // Play's review code.
    if (!app.storeReview) {
      removeTemplateFiles(dir, [ANDROID_STORE_REVIEW_SOURCE]);
      for (const file of ANDROID_STORE_REVIEW_MARKED) {
        removeMarkedLines(path.join(dir, file), 'store-review');
      }
    }
    // As on iOS, an app that doesn't read the motion sensors leaves the
    // module out, with the lines in MainActivity that register it
    // (`// angular-lynx:motion`).
    if (!app.motion) {
      removeTemplateFiles(dir, [ANDROID_MOTION_SOURCE]);
      removeMarkedLines(
        path.join(dir, SHELL_SOURCES, 'MainActivity.kt'),
        'motion',
      );
    }
    leaveOutCanvas(dir, features);
  },
  bundleDir: (dir) => path.join(dir, 'app/src/main/assets'),
};

/**
 * Takes out the canvas code the bundle doesn't use (see NativeFeatures).
 */
const leaveOutCanvas = (dir: string, features: NativeFeatures): void => {
  if (features.webgl) return;
  if (features.canvas) {
    // A 2D canvas keeps the module, without the WebGL2 context and the
    // module's lines that make one (`// angular-lynx:webgl`).
    removeTemplateFiles(
      dir,
      ANDROID_WEBGL_SOURCES.map((file) => path.join(SHELL_SOURCES, file)),
    );
    removeMarkedLines(path.join(dir, SHELL_SOURCES, 'WebGLModule.kt'), 'webgl');
    return;
  }
  removeTemplateFiles(
    dir,
    ANDROID_CANVAS_SOURCES.map((file) => path.join(SHELL_SOURCES, file)),
  );
  // The lines that register them (`// angular-lynx:canvas`).
  removeMarkedLines(path.join(dir, SHELL_SOURCES, 'MainActivity.kt'), 'canvas');
};

const SHELL_SOURCES = 'app/src/main/java/dev/angularlynx/shell';

/** The module behind `LynxStoreReview`, which only `storeReview` keeps. */
export const ANDROID_STORE_REVIEW_SOURCE = `${SHELL_SOURCES}/StoreReviewModule.kt`;

/**
 * The files with lines for the store review module: MainActivity registers
 * it, and app/build.gradle.kts adds Google Play's review library.
 */
const ANDROID_STORE_REVIEW_MARKED = [
  `${SHELL_SOURCES}/MainActivity.kt`,
  'app/build.gradle.kts',
];

/** The module behind `LynxMotion`, which only `motion` keeps. */
export const ANDROID_MOTION_SOURCE = `${SHELL_SOURCES}/MotionModule.kt`;

/**
 * The shell's biometrics module, `AngularLynxBiometrics` (LynxBiometrics, and
 * the values LynxSecureStorage keeps behind a fingerprint or a face), which
 * only an app with `permissions.biometrics` keeps.
 */
export const ANDROID_BIOMETRICS_SOURCES = ['BiometricsModule.kt'] as const;

/** The prompt's default reason, from `permissions.biometrics`. */
const BIOMETRICS_STRINGS = `${RESOURCES}/values/biometrics.xml`;

/**
 * The files whose lines between `// angular-lynx:biometrics` markers name
 * the module or AndroidX Biometric: MainActivity's registration and the
 * Gradle dependency.
 */
const ANDROID_BIOMETRICS_MARKED = [
  'app/build.gradle.kts',
  `${SHELL_SOURCES}/MainActivity.kt`,
] as const;

/**
 * res/values/biometrics.xml: the reason a biometric prompt shows when the
 * app gives none, angular.json's `permissions.biometrics`.
 */
export const biometricsStringsXml = (reason: string): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Written from angular.json's permissions.biometrics on every build. -->",
    '<resources>',
    `    <string name="angular_lynx_biometrics_reason">${stringResource(reason)}</string>`,
    '</resources>',
    '',
  ].join('\n');

/**
 * The shell's `<canvas>`, its `AngularLynxWebGL` module and its contexts, and
 * `<video>`'s readable frames, which only MainActivity's marked lines reach.
 * R8 can't drop them while those lines register them, so they go with the
 * lines.
 */
export const ANDROID_CANVAS_SOURCES = [
  'BitmapPresenter.kt',
  'BitmapRendererContext.kt',
  'Canvas2DContext.kt',
  'Canvas2DOps.kt',
  'CanvasFilter.kt',
  'CanvasUI.kt',
  'VideoFrameTarget.kt',
  'VideoUI.kt',
  'WebGLContext.kt',
  'WebGLModule.kt',
  'WebGLOps.kt',
] as const;

/**
 * The WebGL2 context, which an app that draws only in 2D leaves out, and
 * `WebGLModule.kt`'s lines that make one (issue #847). `VideoFrameTarget.kt`
 * reads a video's frames with an EGL context of its own, for the 2D
 * context's `drawImage()` too, so it stays.
 */
export const ANDROID_WEBGL_SOURCES = [
  'WebGLContext.kt',
  'WebGLOps.kt',
] as const;

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
    // MainActivity's font scale: the system's, capped at the max (0 for
    // none), or 1 when it's off.
    `textScaling=${app.textScaling.enabled}`,
    `maxTextScale=${app.textScaling.max ?? 0}`,
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

/**
 * The intent filters for the links that open the app: one for the
 * `deepLinkSchemes`, and one for https links to the `appLinkDomains`.
 *
 * The second is an App Link: `autoVerify` has Android check, when the app is
 * installed, that each domain's assetlinks.json names the app and its
 * signing key (see appLinkFiles), and then open its links in the app with
 * no chooser. Android 12 and later open an unverified domain's links in the
 * browser. The `<data>` elements of one filter combine, so the scheme goes
 * with every host.
 */
export const deepLinkEntries = (app: ResolvedApp): string =>
  [
    ...(app.deepLinkSchemes.length === 0
      ? []
      : [
          '<intent-filter>',
          ...VIEW_INTENT,
          ...app.deepLinkSchemes.map(
            (scheme) => `    <data android:scheme="${escapeXml(scheme)}" />`,
          ),
          '</intent-filter>',
        ]),
    ...(app.appLinkDomains.length === 0
      ? []
      : [
          '<intent-filter android:autoVerify="true">',
          ...VIEW_INTENT,
          '    <data android:scheme="https" />',
          ...app.appLinkDomains.map(
            (domain) => `    <data android:host="${escapeXml(domain)}" />`,
          ),
          '</intent-filter>',
        ]),
  ].join('\n');

/** What an intent filter for links a browser can follow opens on. */
const VIEW_INTENT = [
  '    <action android:name="android.intent.action.VIEW" />',
  '    <category android:name="android.intent.category.DEFAULT" />',
  '    <category android:name="android.intent.category.BROWSABLE" />',
];

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
