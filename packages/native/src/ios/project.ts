import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { removeMarkedLines, removeTemplateFiles } from '../features.ts';
import type { PlatformGenerator } from '../generate.ts';
import { ANGLE_IOS_FRAMEWORKS } from './frameworks.ts';
import { readPngSize } from '../png.ts';
import {
  APP_NAME_PLACEHOLDER,
  type Orientation,
  type ResolvedApp,
  shortcutIdentifier,
} from '../options.ts';
import { PERMISSION_MAP } from '../permissions.ts';
import { IOS_IMAGE_SET, writeIosSplash } from '../splash.ts';
import { escapeXml, replaceMarker } from '../xml.ts';

const ORIENTATIONS: Record<Orientation, readonly string[]> = {
  portrait: ['UIInterfaceOrientationPortrait'],
  landscape: [
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ],
  all: [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ],
};

/**
 * Writes the app options into the iOS template: build settings go in
 * Config/App.xcconfig (which App.xcodeproj reads), Info.plist entries go
 * between the template's `angular-lynx:info` markers, the shortcuts
 * become App/AppShortcuts.swift, the app link domains become
 * Config/App.entitlements, and the icon and the splash go in the asset
 * catalog. The Bluetooth module stays only in an app with the `bluetooth`
 * permission.
 */
export const iosGenerator: PlatformGenerator = {
  configure: (dir, app, projectRoot, development = false) => {
    writeFileSync(path.join(dir, 'Config/App.xcconfig'), xcconfig(app));

    const plistPath = path.join(dir, 'App/Info.plist');
    writeFileSync(
      plistPath,
      replaceMarker(
        readFileSync(plistPath, 'utf8'),
        'info',
        infoPlistEntries(app, { development }),
      ),
    );

    // The project compiles every Swift file in App/, so the file only has to
    // be there. An app without shortcuts gets none, and declares no intents.
    if (app.shortcuts.length > 0) {
      writeFileSync(
        path.join(dir, 'App/AppShortcuts.swift'),
        appShortcutsSwift(app),
      );
    }

    // App Store Connect flags an app whose code uses CoreBluetooth without
    // NSBluetoothAlwaysUsageDescription (ITMS-90683), which only the
    // `bluetooth` permission writes. So an app that doesn't ask for Bluetooth
    // leaves the module out, and ships no Bluetooth code at all, on Android
    // as well (see androidGenerator). LynxViewController registers the module
    // by name only when it's compiled in.
    if (!app.permissions.bluetooth) {
      rmSync(path.join(dir, 'App/BluetoothModule.swift'), { force: true });
    }

    // In Config/, beside the xcconfig that points the target at it, rather
    // than in App/: Xcode would copy a file in that synchronized folder into
    // the app as a resource. An app without app links signs with no
    // entitlements, as the template does.
    if (app.appLinkDomains.length > 0) {
      writeFileSync(path.join(dir, ENTITLEMENTS), entitlementsPlist(app));
    }

    if (app.icon) {
      const icon = path.resolve(projectRoot, app.icon);
      const size = readPngSize(icon);
      if (size.width !== 1024 || size.height !== 1024) {
        throw new Error(
          `${app.icon} is ${size.width}×${size.height}. The app icon must be a 1024×1024 PNG.`,
        );
      }
      copyFileSync(
        icon,
        path.join(dir, 'App/Assets.xcassets/AppIcon.appiconset/AppIcon.png'),
      );
    }

    writeIosSplash(dir, app, projectRoot);
  },
  leaveOut: (dir, features, app) => {
    // Face ID, Touch ID and the Keychain items behind them are only for an
    // app that says why it uses them: without NSFaceIDUsageDescription Face
    // ID fails, and App Review asks about LocalAuthentication code an app
    // gives no reason for. LynxViewController registers the module by name,
    // so the shell builds without it.
    if (!app.permissions.biometrics) {
      removeTemplateFiles(dir, IOS_BIOMETRICS_SOURCES);
    }
    if (features.webgl) return;
    if (features.canvas) {
      // A 2D canvas keeps the module and the canvas's view, without the
      // WebGL2 context and the module's lines that make one.
      removeTemplateFiles(dir, IOS_WEBGL_SOURCES);
      for (const file of IOS_WEBGL_MARKED) {
        removeMarkedLines(path.join(dir, file), 'webgl');
      }
    } else {
      removeTemplateFiles(dir, IOS_CANVAS_SOURCES);
    }
    // Only the WebGL2 context draws with ANGLE. The canvas's view is still
    // a CAMetalLayer, which is QuartzCore's: a 2D context shows its bitmap
    // in a CALayer over it.
    const projectFile = path.join(dir, PROJECT_FILE);
    writeFileSync(
      projectFile,
      withoutFrameworks(
        readFileSync(projectFile, 'utf8'),
        ANGLE_IOS_FRAMEWORKS,
      ),
    );
  },
  bundleDir: (dir) => path.join(dir, 'LynxBundle'),
};

/**
 * The shell's biometrics module, `AngularLynxBiometrics` (LynxBiometrics, and
 * the values LynxSecureStorage keeps behind Face ID or Touch ID), which only
 * an app with `permissions.biometrics` keeps.
 */
export const IOS_BIOMETRICS_SOURCES = ['App/BiometricsModule.swift'] as const;

/**
 * The shell's `<canvas>`, its `AngularLynxWebGL` module and its contexts, and
 * `<video>`'s readable frames: about 176 kB of the executable. Swift reaches
 * them only by name (NSClassFromString in LynxViewController and
 * XElementRegistry), so without them the shell registers no canvas, keeps
 * XElement's own `<video>`, and still builds: App/ is a synchronized folder,
 * which compiles what's in it.
 */
export const IOS_CANVAS_SOURCES = [
  'App/AngularLynxBitmapRendererContext.m',
  'App/AngularLynxCanvas2DContext.m',
  'App/AngularLynxCanvas2DOps.h',
  'App/AngularLynxVideo.h',
  'App/AngularLynxVideo.m',
  'App/AngularLynxWebGL.h',
  'App/AngularLynxWebGL.m',
  'App/AngularLynxWebGLContext.m',
  'App/AngularLynxWebGLOps.h',
] as const;

/**
 * The WebGL2 context, which an app that draws only in 2D leaves out with
 * ANGLE (issue #847).
 */
export const IOS_WEBGL_SOURCES = [
  'App/AngularLynxWebGLContext.m',
  'App/AngularLynxWebGLOps.h',
] as const;

/**
 * The files whose lines between `// angular-lynx:webgl` markers name the
 * WebGL2 context, and go with it: the class's declaration, and the module's
 * methods that make and run one. Nothing else names it.
 */
const IOS_WEBGL_MARKED = [
  'App/AngularLynxWebGL.h',
  'App/AngularLynxWebGL.m',
] as const;

const PROJECT_FILE = 'App.xcodeproj/project.pbxproj';

/**
 * The project without the XCFrameworks named, which it then neither links
 * nor embeds: ANGLE's, about 6 MB of an app, are only for WebGL. Each
 * reference to a framework is one line of the project (its file, its build
 * files, and their places in the group, the link phase and the embed phase).
 */
export const withoutFrameworks = (
  project: string,
  frameworks: readonly string[],
): string => {
  const names = frameworks.map((name) => `${name}.xcframework`);
  // A renamed framework would otherwise stay in every app unnoticed.
  for (const name of names) {
    if (!project.includes(name)) {
      throw new Error(`The project has no ${name} to leave out.`);
    }
  }
  return project
    .split('\n')
    .filter((line) => !names.some((name) => line.includes(name)))
    .join('\n');
};

/** The app's entitlements, from the project folder (see xcconfig). */
const ENTITLEMENTS = 'Config/App.entitlements';

/**
 * xcconfig values can't be quoted; `$` and `//` would start a variable or a comment.
 */
const xcconfigValue = (value: string) =>
  value.replace(/\$/g, '$$$$').replace(/\/\//g, '/$()/');

export const xcconfig = (app: ResolvedApp): string =>
  [
    '// Written by @blotch/angular-lynx-native from the builder options in',
    '// angular.json on every build. Edits here are overwritten; change',
    '// angular.json instead (or eject).',
    `ANGULAR_LYNX_PRODUCT_NAME = ${app.productName}`,
    `ANGULAR_LYNX_DISPLAY_NAME = ${xcconfigValue(app.name)}`,
    `PRODUCT_BUNDLE_IDENTIFIER = ${app.id}`,
    `MARKETING_VERSION = ${app.version}`,
    `CURRENT_PROJECT_VERSION = ${app.buildNumber}`,
    `DEVELOPMENT_TEAM = ${app.ios.teamId ?? ''}`,
    // Only with app links: the only entitlement the generator writes.
    ...(app.appLinkDomains.length > 0
      ? [`CODE_SIGN_ENTITLEMENTS = ${ENTITLEMENTS}`]
      : []),
    '',
  ].join('\n');

/**
 * Config/App.entitlements: the Associated Domains entitlement, which has iOS
 * open the app for an https link to one of the domains (a Universal Link),
 * once the domain's apple-app-site-association names the app (see
 * appLinkFiles). iOS fetches that file through Apple's CDN when the app is
 * installed.
 *
 * Signing it needs a team in the paid Apple Developer Program: a free
 * Personal Team can't sign Associated Domains. The simulator app needs no
 * team.
 */
export const entitlementsPlist = (app: ResolvedApp): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<!-- Written by @blotch/angular-lynx-native from appLinkDomains in angular.json. -->',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>com.apple.developer.associated-domains</key>',
    '\t<array>',
    ...app.appLinkDomains.map(
      (domain) => `\t\t<string>applinks:${escapeXml(domain)}</string>`,
    ),
    '\t</array>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

/** What iOS shows the first time someone taps Save Image, without `savePhotos`. */
export const DEFAULT_SAVE_PHOTOS_REASON =
  'Saves the images you choose to your photo library.';

/**
 * What iOS shows the first time the development app connects to the dev
 * server, on a real iPhone. The simulator never asks.
 */
export const LOCAL_NETWORK_REASON =
  'Loads the app from ng serve on your computer while you develop it.';

export const infoPlistEntries = (
  app: ResolvedApp,
  { development = false }: { readonly development?: boolean } = {},
): string => {
  const lines: string[] = [];
  const array = (key: string, values: readonly string[]) => {
    lines.push(`<key>${key}</key>`, '<array>');
    values.forEach((value) =>
      lines.push(`\t<string>${escapeXml(value)}</string>`),
    );
    lines.push('</array>');
  };

  // The launch screen: angular.json's splash, its color (LaunchBackground,
  // white by default) and its image, if it has one, centered on the whole
  // screen. LynxViewController draws the same over the app until the app
  // hides it (SplashScreen.swift).
  lines.push(
    '<key>UILaunchScreen</key>',
    '<dict>',
    '\t<key>UIColorName</key>',
    '\t<string>LaunchBackground</string>',
    ...(app.splash.light.image
      ? ['\t<key>UIImageName</key>', `\t<string>${IOS_IMAGE_SET}</string>`]
      : []),
    '</dict>',
  );
  array('UISupportedInterfaceOrientations', ORIENTATIONS[app.orientation]);
  // Read by LynxViewController, which lays the LynxView out over the whole
  // screen or inside the safe area.
  lines.push(
    '<key>AngularLynxEdgeToEdge</key>',
    app.edgeToEdge ? '<true/>' : '<false/>',
  );
  // Read by LynxViewController, which sets the LynxView's font scale from
  // Dynamic Type, capped at the max, or keeps it at 1.
  lines.push(
    '<key>AngularLynxTextScaling</key>',
    app.textScaling.enabled ? '<true/>' : '<false/>',
  );
  if (app.textScaling.max !== undefined) {
    lines.push(
      '<key>AngularLynxMaxTextScale</key>',
      `<real>${app.textScaling.max}</real>`,
    );
  }

  // The share sheet LynxShare opens has Save Image for an image, which adds
  // it to the photo library, and iOS ends an app that does so without a
  // reason in Info.plist. So every app has one, which `savePhotos` changes.
  const permissions = {
    savePhotos: DEFAULT_SAVE_PHOTOS_REASON,
    ...app.permissions,
  };
  for (const [permission, reason] of Object.entries(permissions)) {
    for (const key of PERMISSION_MAP[permission as keyof typeof PERMISSION_MAP]
      .ios) {
      lines.push(`<key>${key}</key>`, `<string>${escapeXml(reason!)}</string>`);
    }
  }

  // `ng serve --platform ios`'s development app loads from the dev server at
  // the Mac's address on the local network, which iOS (14 and later) lets an
  // app reach only once the person allows it. iOS asks the first time, with
  // this reason. Only the development app has it, unless the app asks for
  // `localNetwork` itself: the app for the stores loads its own bundle, and
  // App Review asks about any reason it doesn't need.
  // An app that asks for `localNetwork` already has the key, with its own
  // reason, which also covers the dev server.
  if (development && !app.permissions.localNetwork) {
    lines.push(
      '<key>NSLocalNetworkUsageDescription</key>',
      `<string>${escapeXml(LOCAL_NETWORK_REASON)}</string>`,
    );
  }

  // The schemes LinkingModule's canOpenURL can ask about: iOS answers false
  // for any other. UIApplication.open needs none of them.
  array('LSApplicationQueriesSchemes', app.canOpenURLSchemes);

  if (app.deepLinkSchemes.length > 0) {
    lines.push(
      '<key>CFBundleURLTypes</key>',
      '<array>',
      '\t<dict>',
      '\t\t<key>CFBundleURLName</key>',
      `\t\t<string>${escapeXml(app.id)}</string>`,
      '\t\t<key>CFBundleURLSchemes</key>',
      '\t\t<array>',
      ...app.deepLinkSchemes.map(
        (scheme) => `\t\t\t<string>${escapeXml(scheme)}</string>`,
      ),
      '\t\t</array>',
      '\t</dict>',
      '</array>',
    );
  }
  return lines.join('\n');
};

/**
 * Text as the inside of a Swift string literal.
 */
const swiftString = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * A shortcut's phrase as a Swift string literal, with the app's name as the
 * interpolation App Intents reads it from: Siri then hears the name the
 * person knows the app by, and the names in Info.plist's
 * INAlternativeAppNames.
 */
const swiftPhrase = (phrase: string): string =>
  `"${phrase
    .split(APP_NAME_PLACEHOLDER)
    .map(swiftString)
    .join('\\(.applicationName)')}"`;

/**
 * App/AppShortcuts.swift: angular.json's `shortcuts` as App Intents, which is
 * how iOS offers an app's actions to Siri, Spotlight and the Shortcuts app.
 *
 * It's written as source, not read from a file when the app starts, because
 * Xcode's App Intents step reads the titles and phrases out of the compiled
 * code at build time, and takes only literals. Each intent opens the app
 * and leaves its shortcut with ShortcutCenter (ShortcutsModule.swift), where
 * the runtime's LynxShortcuts takes it.
 *
 * The intents are iOS 16's, which is when App Shortcuts arrived, and the
 * shell runs on iOS 15, which gets none. An intent's type name is what iOS
 * stores a saved shortcut under, so it comes from the ID alone.
 */
export const appShortcutsSwift = (app: ResolvedApp): string => {
  const intents = app.shortcuts.map((shortcut) => {
    const route =
      shortcut.route === undefined
        ? ''
        : `, route: "${swiftString(shortcut.route)}"`;
    return [
      '@available(iOS 16.0, *)',
      `struct Shortcut_${shortcutIdentifier(shortcut.id)}: AppIntent {`,
      `  static let title: LocalizedStringResource = "${swiftString(shortcut.title)}"`,
      '  // The app handles it, so it comes to the front: iOS 26 and later read',
      '  // supportedModes, and earlier ones openAppWhenRun.',
      '  static let openAppWhenRun = true',
      '  @available(iOS 26.0, *)',
      '  static var supportedModes: IntentModes { .foreground }',
      '',
      '  func perform() async throws -> some IntentResult {',
      `    ShortcutCenter.shared.run(id: "${swiftString(shortcut.id)}"${route})`,
      '    return .result()',
      '  }',
      '}',
    ].join('\n');
  });

  const shortcuts = app.shortcuts.map((shortcut) =>
    [
      '    AppShortcut(',
      `      intent: Shortcut_${shortcutIdentifier(shortcut.id)}(),`,
      '      phrases: [',
      ...shortcut.phrases.map((phrase) => `        ${swiftPhrase(phrase)},`),
      '      ],',
      `      shortTitle: "${swiftString(shortcut.title)}"${shortcut.symbol === undefined ? '' : ','}`,
      ...(shortcut.symbol === undefined
        ? []
        : [`      systemImageName: "${shortcut.symbol}"`]),
      '    )',
    ].join('\n'),
  );

  return [
    '// Written by @blotch/angular-lynx-native from the shortcuts in',
    "// angular.json's builder options on every build. Edits here are",
    '// overwritten; change angular.json instead (or eject).',
    'import AppIntents',
    '',
    intents.join('\n\n'),
    '',
    "/// What iOS reads the app's shortcuts from: there is one provider per app.",
    '@available(iOS 16.0, *)',
    'struct AngularLynxAppShortcuts: AppShortcutsProvider {',
    '  static var appShortcuts: [AppShortcut] {',
    shortcuts.join('\n'),
    '  }',
    '}',
    '',
  ].join('\n');
};
