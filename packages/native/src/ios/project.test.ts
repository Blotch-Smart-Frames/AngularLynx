import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TEMPLATES_DIR } from '../generate.ts';
import { resolveAppOptions } from '../options.ts';
import {
  appShortcutsSwift,
  entitlementsPlist,
  infoPlistEntries,
  IOS_BIOMETRICS_SOURCES,
  IOS_FILE_PICKER_SOURCES,
  IOS_BARCODE_SCANNER_SOURCE,
  IOS_CANVAS_SOURCES,
  IOS_STORE_REVIEW_SOURCE,
  IOS_CALENDAR_SOURCE,
  IOS_WEBGL_SOURCES,
  iosGenerator,
  LOCAL_NETWORK_REASON,
  withoutFrameworks,
  xcconfig,
} from './project.ts';

const app = (options = {}) =>
  resolveAppOptions(options, { projectName: 'my-app' });

/**
 * A solid-color PNG of the given size (just the header matters here).
 */
const png = (width: number, height: number) => {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    deflateSync(Buffer.alloc(0)),
  ]);
};

describe('xcconfig', () => {
  it('writes the identity Xcode reads', () => {
    expect(
      xcconfig(
        app({
          appName: 'My $App // 2',
          appId: 'com.example.app',
          version: '1.2.0',
          buildNumber: 42,
          ios: { teamId: 'ABCDE12345' },
        }),
      ),
    ).toContain(
      [
        'ANGULAR_LYNX_PRODUCT_NAME = MyApp2',
        // `$` and `//` would otherwise start a variable and a comment.
        'ANGULAR_LYNX_DISPLAY_NAME = My $$App /$()/ 2',
        'PRODUCT_BUNDLE_IDENTIFIER = com.example.app',
        'MARKETING_VERSION = 1.2.0',
        'CURRENT_PROJECT_VERSION = 42',
        'DEVELOPMENT_TEAM = ABCDE12345',
      ].join('\n'),
    );
  });
});

describe('entitlements', () => {
  it('points the target at them only with app link domains', () => {
    expect(xcconfig(app())).not.toContain('CODE_SIGN_ENTITLEMENTS');
    expect(xcconfig(app({ appLinkDomains: ['example.com'] }))).toContain(
      'CODE_SIGN_ENTITLEMENTS = Config/App.entitlements\n',
    );
  });

  it('associate the app with each domain', () => {
    expect(
      entitlementsPlist(app({ appLinkDomains: ['example.com', '*.a.b'] })),
    ).toContain(
      [
        '\t<key>com.apple.developer.associated-domains</key>',
        '\t<array>',
        '\t\t<string>applinks:example.com</string>',
        '\t\t<string>applinks:*.a.b</string>',
        '\t</array>',
      ].join('\n'),
    );
  });
});

describe('infoPlistEntries', () => {
  it('lists the orientations', () => {
    expect(infoPlistEntries(app({ orientation: 'landscape' }))).toBe(
      [
        '<key>UILaunchScreen</key>',
        '<dict>',
        '\t<key>UIColorName</key>',
        '\t<string>LaunchBackground</string>',
        '</dict>',
        '<key>UISupportedInterfaceOrientations</key>',
        '<array>',
        '\t<string>UIInterfaceOrientationLandscapeLeft</string>',
        '\t<string>UIInterfaceOrientationLandscapeRight</string>',
        '</array>',
        '<key>AngularLynxEdgeToEdge</key>',
        '<true/>',
        '<key>AngularLynxTextScaling</key>',
        '<true/>',
        '<key>NSPhotoLibraryAddUsageDescription</key>',
        '<string>Saves the images you choose to your photo library.</string>',
        '<key>LSApplicationQueriesSchemes</key>',
        '<array>',
        '\t<string>http</string>',
        '\t<string>https</string>',
        '\t<string>mailto</string>',
        '\t<string>tel</string>',
        '\t<string>sms</string>',
        '</array>',
      ].join('\n'),
    );
  });

  it("names the splash image in the launch screen when there's one", () => {
    expect(
      infoPlistEntries(
        app({ splash: { image: 'splash.png', imageWidth: 100 } }),
      ),
    ).toContain(
      [
        '<key>UILaunchScreen</key>',
        '<dict>',
        '\t<key>UIColorName</key>',
        '\t<string>LaunchBackground</string>',
        '\t<key>UIImageName</key>',
        '\t<string>LaunchImage</string>',
        '</dict>',
      ].join('\n'),
    );
  });

  it("gives Save Image a reason, so the share sheet's action doesn't end the app", () => {
    expect(infoPlistEntries(app({}))).toContain(
      '<key>NSPhotoLibraryAddUsageDescription</key>\n<string>Saves the images you choose to your photo library.</string>',
    );
    const entries = infoPlistEntries(
      app({ permissions: { savePhotos: 'Saves your edits' } }),
    );
    expect(entries).toContain(
      '<key>NSPhotoLibraryAddUsageDescription</key>\n<string>Saves your edits</string>',
    );
    expect(entries.match(/NSPhotoLibraryAddUsageDescription/g)).toHaveLength(1);
  });

  it('asks for the local network only in the development app', () => {
    expect(infoPlistEntries(app({}))).not.toContain(
      'NSLocalNetworkUsageDescription',
    );
    expect(infoPlistEntries(app({}), { development: true })).toContain(
      `<key>NSLocalNetworkUsageDescription</key>\n<string>${LOCAL_NETWORK_REASON}</string>`,
    );
  });

  it('asks for the local network with the app’s own reason when it uses it', () => {
    const reason = 'Finds the printers on your network';
    for (const development of [false, true]) {
      const entries = infoPlistEntries(
        app({ permissions: { localNetwork: reason } }),
        { development },
      );
      expect(entries).toContain(
        `<key>NSLocalNetworkUsageDescription</key>\n<string>${reason}</string>`,
      );
      expect(entries.match(/NSLocalNetworkUsageDescription/g)).toHaveLength(1);
    }
  });

  it('tells the shell to keep the page inside the safe area', () => {
    expect(infoPlistEntries(app({ edgeToEdge: false }))).toContain(
      '<key>AngularLynxEdgeToEdge</key>\n<false/>',
    );
  });

  it("tells the shell whether text follows Dynamic Type, and the scale's cap", () => {
    const defaults = infoPlistEntries(app());
    expect(defaults).toContain('<key>AngularLynxTextScaling</key>\n<true/>');
    expect(defaults).not.toContain('AngularLynxMaxTextScale');
    expect(infoPlistEntries(app({ textScaling: { max: 1.6 } }))).toContain(
      '<key>AngularLynxTextScaling</key>\n<true/>\n<key>AngularLynxMaxTextScale</key>\n<real>1.6</real>',
    );
    expect(infoPlistEntries(app({ textScaling: false }))).toContain(
      '<key>AngularLynxTextScaling</key>\n<false/>',
    );
  });

  it('lists the schemes canOpenURL asks about', () => {
    expect(
      infoPlistEntries(app({ canOpenURLSchemes: ['whatsapp'] })),
    ).toContain('<string>sms</string>\n\t<string>whatsapp</string>\n</array>');
  });

  it('adds usage descriptions and URL schemes', () => {
    const entries = infoPlistEntries(
      app({
        permissions: { camera: 'Scan <receipts>', notifications: 'News' },
        deepLinkSchemes: ['myapp'],
        appId: 'com.example.app',
      }),
    );
    expect(entries).toContain(
      '<key>NSCameraUsageDescription</key>\n<string>Scan &lt;receipts&gt;</string>',
    );
    // iOS has no usage string for notifications.
    expect(entries).not.toContain('News');
    expect(entries).toContain('<string>myapp</string>');
    expect(entries).toContain('<key>CFBundleURLName</key>');
  });
});

describe('appShortcutsSwift', () => {
  const swift = appShortcutsSwift(
    app({
      shortcuts: [
        {
          id: 'refresh',
          title: 'Refresh',
          phrases: ['Refresh {appName}', 'Reload {appName} now'],
          symbol: 'arrow.clockwise',
        },
        { id: 'show-photos', title: 'Show photos', route: '/photos' },
      ],
    }),
  );

  it('makes each shortcut an App Intent that opens the app and leaves its ID and route for the runtime', () => {
    expect(swift).toContain(
      [
        '@available(iOS 16.0, *)',
        'struct Shortcut_refresh: AppIntent {',
        '  static let title: LocalizedStringResource = "Refresh"',
      ].join('\n'),
    );
    expect(swift).toContain('ShortcutCenter.shared.run(id: "refresh")\n');
    // A hyphen can't be in a Swift type's name.
    expect(swift).toContain('struct Shortcut_show_photos: AppIntent {');
    expect(swift).toContain(
      'ShortcutCenter.shared.run(id: "show-photos", route: "/photos")',
    );
    expect(swift.match(/static let openAppWhenRun = true/g)).toHaveLength(2);
    expect(swift).toContain(
      'static var supportedModes: IntentModes { .foreground }',
    );
  });

  it("lists them in the app's one shortcuts provider, with the app's name where Siri hears it", () => {
    expect(swift).toContain(
      [
        'struct AngularLynxAppShortcuts: AppShortcutsProvider {',
        '  static var appShortcuts: [AppShortcut] {',
        '    AppShortcut(',
        '      intent: Shortcut_refresh(),',
        '      phrases: [',
        '        "Refresh \\(.applicationName)",',
        '        "Reload \\(.applicationName) now",',
        '      ],',
        '      shortTitle: "Refresh",',
        '      systemImageName: "arrow.clockwise"',
        '    )',
        '    AppShortcut(',
        '      intent: Shortcut_show_photos(),',
        '      phrases: [',
        '        "Show photos in \\(.applicationName)",',
        '      ],',
        // No symbol: the argument is left out, and so is the comma.
        '      shortTitle: "Show photos"',
        '    )',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  it('keeps a quote or a backslash in a title from ending the string or starting an interpolation', () => {
    const escaped = appShortcutsSwift(
      app({
        shortcuts: [
          {
            id: 'quote',
            title: 'Say "hi" \\(now)',
            phrases: ['Say "hi" with {appName}'],
            route: '/say/"hi"',
          },
        ],
      }),
    );
    expect(escaped).toContain('= "Say \\"hi\\" \\\\(now)"');
    expect(escaped).toContain('"Say \\"hi\\" with \\(.applicationName)",');
    expect(escaped).toContain('route: "/say/\\"hi\\"")');
  });
});

describe('iosGenerator', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-ios-'));
    cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('fills the real template', () => {
    iosGenerator.configure(
      dir,
      app({ permissions: { camera: 'Scan' }, orientation: 'all' }),
      dir,
    );
    const plist = readFileSync(path.join(dir, 'App/Info.plist'), 'utf8');
    expect(plist).toContain('<key>NSCameraUsageDescription</key>');
    expect(plist).toContain('UIInterfaceOrientationLandscapeLeft');
    expect(plist.match(/UISupportedInterfaceOrientations/g)).toHaveLength(1);
    expect(plist.match(/UILaunchScreen/g)).toHaveLength(1);
    expect(plist).toContain('<key>LSApplicationQueriesSchemes</key>');
    expect(iosGenerator.bundleDir(dir)).toBe(path.join(dir, 'LynxBundle'));
  });

  it("keeps the barcode scanner's module only with the camera permission", () => {
    const module = path.join(dir, IOS_BARCODE_SCANNER_SOURCE);
    // In the template, so a renamed file can't stay in every app unnoticed.
    expect(existsSync(module)).toBe(true);
    iosGenerator.configure(dir, app({ permissions: { camera: 'Scan' } }), dir);
    expect(existsSync(module)).toBe(true);

    // Without NSCameraUsageDescription, App Store Connect flags an app whose
    // code uses the camera.
    iosGenerator.configure(dir, app({ permissions: { photos: 'x' } }), dir);
    expect(existsSync(module)).toBe(false);
    // LynxViewController registers it by name, so it builds without it.
    const controller = readFileSync(
      path.join(dir, 'App/LynxViewController.swift'),
      'utf8',
    );
    expect(controller).toContain(
      'NSClassFromString("AngularLynxBarcodeScannerModule")',
    );
    expect(controller).not.toContain('BarcodeScannerModule.self');
  });

  it('keeps the store review module only in an app with storeReview', () => {
    /**
     * Generates from a fresh copy of the template, as prepareProject does.
     */
    const generate = (options: object) => {
      rmSync(dir, { recursive: true, force: true });
      cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
      const resolved = app(options);
      iosGenerator.configure(dir, resolved, dir);
      iosGenerator.leaveOut(dir, { canvas: true, webgl: true }, resolved);
      return existsSync(path.join(dir, IOS_STORE_REVIEW_SOURCE));
    };
    expect(generate({ storeReview: true })).toBe(true);
    expect(generate({})).toBe(false);
    // LynxViewController registers it by the name the module gives itself.
    expect(
      readFileSync(
        path.join(TEMPLATES_DIR, 'ios', IOS_STORE_REVIEW_SOURCE),
        'utf8',
      ),
    ).toContain('@objc(AngularLynxStoreReviewModule)');
    expect(
      readFileSync(path.join(dir, 'App/LynxViewController.swift'), 'utf8'),
    ).toContain('NSClassFromString("AngularLynxStoreReviewModule")');
  });

  it('keeps the calendar module only in an app with calendar', () => {
    const generate = (options: object) => {
      rmSync(dir, { recursive: true, force: true });
      cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
      const resolved = app(options);
      iosGenerator.configure(dir, resolved, dir);
      iosGenerator.leaveOut(dir, { canvas: true, webgl: true }, resolved);
      return existsSync(path.join(dir, IOS_CALENDAR_SOURCE));
    };
    expect(generate({ calendar: true })).toBe(true);
    expect(generate({})).toBe(false);
    expect(
      readFileSync(
        path.join(TEMPLATES_DIR, 'ios', IOS_CALENDAR_SOURCE),
        'utf8',
      ),
    ).toContain('@objc(AngularLynxCalendarModule)');
    expect(
      readFileSync(path.join(dir, 'App/LynxViewController.swift'), 'utf8'),
    ).toContain('NSClassFromString("AngularLynxCalendarModule")');
  });

  it('writes the entitlements beside the xcconfig, only with app link domains', () => {
    const entitlements = path.join(dir, 'Config/App.entitlements');
    iosGenerator.configure(dir, app(), dir);
    expect(existsSync(entitlements)).toBe(false);

    iosGenerator.configure(dir, app({ appLinkDomains: ['example.com'] }), dir);
    expect(readFileSync(entitlements, 'utf8')).toContain(
      '<string>applinks:example.com</string>',
    );
    expect(
      readFileSync(path.join(dir, 'Config/App.xcconfig'), 'utf8'),
    ).toContain('CODE_SIGN_ENTITLEMENTS = Config/App.entitlements');
  });

  it('lets the app draw at 120 fps on a ProMotion iPhone', () => {
    iosGenerator.configure(dir, app(), dir);
    // Without it iOS holds the app's CADisplayLink, which Lynx animates
    // through, to 60 fps on an iPhone.
    expect(readFileSync(path.join(dir, 'App/Info.plist'), 'utf8')).toContain(
      '<key>CADisableMinimumFrameDurationOnPhone</key>\n\t<true/>',
    );
  });

  it("asks for 120 fps on Core Animation's transitions before the first LynxView", () => {
    iosGenerator.configure(dir, app(), dir);
    // Lynx's Core Animation transitions ask for no rate, which iOS runs at
    // 60 fps even with the Info.plist key, so the shell asks on each one as
    // it's added, leaving loops that never end at the system's rate.
    const swift = readFileSync(
      path.join(dir, 'App/AnimationFrameRate.swift'),
      'utf8',
    );
    expect(swift).toContain(
      'CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)',
    );
    expect(swift).toContain('#selector(CALayer.add(_:forKey:))');
    const delegate = readFileSync(
      path.join(dir, 'App/AppDelegate.swift'),
      'utf8',
    );
    expect(delegate.indexOf('AnimationFrameRate.install()')).toBeGreaterThan(
      -1,
    );
    expect(delegate.indexOf('AnimationFrameRate.install()')).toBeLessThan(
      delegate.indexOf('LynxEnv.sharedInstance().prepareConfig'),
    );
  });

  it("leaves Lynx's INFO lines out of a release build's log, before Lynx starts", () => {
    iosGenerator.configure(dir, app(), dir);
    // Lynx's release frameworks log every touch move, flush, layout and
    // module call at INFO, each with a synchronous NSLog on the engine or UI
    // thread. The Debug configuration `ng serve --platform ios` builds
    // defines DEBUG, so it keeps them.
    const delegate = readFileSync(
      path.join(dir, 'App/AppDelegate.swift'),
      'utf8',
    );
    const gate =
      /#if !DEBUG\s+SetMinimumLoggingLevel\(\.warning\)\s+#endif/.exec(
        delegate,
      );
    expect(gate).not.toBeNull();
    // The launch's first statement, so Lynx's own start is left out too:
    // only comments come before it.
    const launch = delegate.indexOf('-> Bool {') + '-> Bool {'.length;
    const before = delegate
      .slice(launch, gate!.index)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'));
    expect(before).toEqual([]);
    expect(gate!.index).toBeLessThan(
      delegate.indexOf('XElementRegistry.register()'),
    );
  });

  it("asks for Lynx's own animator's rate from the main thread while it runs", () => {
    iosGenerator.configure(dir, app(), dir);
    // Lynx's animator asks for 120 fps from a display link on the engine
    // thread, which iOS doesn't raise the display's rate for, so the shell
    // asks again from the main thread for each frame Lynx's link is asked for.
    const swift = readFileSync(
      path.join(dir, 'App/AnimationFrameRate.swift'),
      'utf8',
    );
    expect(swift).toContain('NSClassFromString("LynxVSyncPulse")');
    expect(swift).toContain('NSSelectorFromString("requestPulse")');
    // Installed with the Core Animation hook, before the first LynxView.
    const install = swift.slice(swift.indexOf('static func install()'));
    expect(install.slice(0, install.indexOf('}'))).toContain(
      'LynxAnimatorFrameRate.install()',
    );
  });

  it("writes the shortcuts' App Intents where Xcode compiles them, and none for an app without shortcuts", () => {
    const file = path.join(dir, 'App/AppShortcuts.swift');
    iosGenerator.configure(dir, app(), dir);
    expect(existsSync(file)).toBe(false);

    iosGenerator.configure(
      dir,
      app({ shortcuts: [{ id: 'refresh', title: 'Refresh' }] }),
      dir,
    );
    expect(readFileSync(file, 'utf8')).toContain(
      'struct Shortcut_refresh: AppIntent {',
    );
    // What the intents hand their shortcut to, and what takes it from there.
    const center = readFileSync(
      path.join(dir, 'App/ShortcutsModule.swift'),
      'utf8',
    );
    expect(center).toContain('func run(id: String, route: String? = nil)');
    expect(
      readFileSync(path.join(dir, 'App/LynxViewController.swift'), 'utf8'),
    ).toContain('config.register(ShortcutsModule.self)');
  });

  it('gives the development app the local network reason', () => {
    iosGenerator.configure(dir, app({}), dir, true);
    expect(readFileSync(path.join(dir, 'App/Info.plist'), 'utf8')).toContain(
      '<key>NSLocalNetworkUsageDescription</key>',
    );
  });

  it('uses a 1024×1024 icon and rejects other sizes', () => {
    writeFileSync(path.join(dir, 'icon.png'), png(1024, 1024));
    writeFileSync(path.join(dir, 'small.png'), png(512, 512));
    iosGenerator.configure(dir, app({ icon: 'icon.png' }), dir);
    expect(
      readFileSync(
        path.join(dir, 'App/Assets.xcassets/AppIcon.appiconset/AppIcon.png'),
      ),
    ).toEqual(png(1024, 1024));
    expect(() =>
      iosGenerator.configure(dir, app({ icon: 'small.png' }), dir),
    ).toThrow('small.png is 512×512. The app icon must be a 1024×1024 PNG.');
  });

  it('rejects an icon that is not a PNG', () => {
    writeFileSync(path.join(dir, 'icon.jpg'), 'not a png at all, honestly');
    expect(() =>
      iosGenerator.configure(dir, app({ icon: 'icon.jpg' }), dir),
    ).toThrow(/is not a PNG file/);
  });
});

describe('iosGenerator and biometrics', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-ios-'));
    cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps the module, and gives Face ID the reason', () => {
    const withBiometrics = app({
      permissions: { biometrics: 'Unlock your notes' },
    });
    iosGenerator.configure(dir, withBiometrics, dir);
    iosGenerator.leaveOut(dir, { canvas: true, webgl: true }, withBiometrics);
    for (const file of IOS_BIOMETRICS_SOURCES) {
      expect(existsSync(path.join(dir, file))).toBe(true);
    }
    expect(readFileSync(path.join(dir, 'App/Info.plist'), 'utf8')).toMatch(
      /<key>NSFaceIDUsageDescription<\/key>\s*<string>Unlock your notes<\/string>/,
    );
  });

  it('takes the module out of an app without biometrics, which names it only by name', () => {
    iosGenerator.configure(dir, app(), dir);
    iosGenerator.leaveOut(dir, { canvas: true, webgl: true }, app());
    for (const file of IOS_BIOMETRICS_SOURCES) {
      expect(existsSync(path.join(dir, file))).toBe(false);
    }
    expect(
      readFileSync(path.join(dir, 'App/Info.plist'), 'utf8'),
    ).not.toContain('NSFaceIDUsageDescription');
    const app_ = path.join(dir, 'App');
    for (const file of readdirSync(app_).filter((f) => f.endsWith('.swift'))) {
      // What a comment names isn't code.
      const source = readFileSync(path.join(app_, file), 'utf8').replace(
        /\/\/.*$/gm,
        '',
      );
      expect(source, file).not.toMatch(
        /\bBiometricsModule\b|import LocalAuthentication/,
      );
    }
  });
});

describe('iosGenerator and the file picker', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-ios-'));
    cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps the module in an app with filePicker, registered by its own name', () => {
    const withFiles = app({ filePicker: true });
    iosGenerator.configure(dir, withFiles, dir);
    iosGenerator.leaveOut(dir, { canvas: true, webgl: true }, withFiles);
    for (const file of IOS_FILE_PICKER_SOURCES) {
      expect(readFileSync(path.join(dir, file), 'utf8')).toContain(
        '@objc(AngularLynxFilePickerModule)',
      );
    }
    expect(
      readFileSync(path.join(dir, 'App/LynxViewController.swift'), 'utf8'),
    ).toContain('NSClassFromString("AngularLynxFilePickerModule")');
  });

  it('takes the module out of an app without filePicker, which names it only by name', () => {
    iosGenerator.configure(dir, app(), dir);
    iosGenerator.leaveOut(dir, { canvas: true, webgl: true }, app());
    for (const file of IOS_FILE_PICKER_SOURCES) {
      expect(existsSync(path.join(dir, file))).toBe(false);
    }
    const app_ = path.join(dir, 'App');
    for (const file of readdirSync(app_).filter((f) => f.endsWith('.swift'))) {
      // What a comment names isn't code.
      const source = readFileSync(path.join(app_, file), 'utf8').replace(
        /\/\/.*$/gm,
        '',
      );
      expect(source, file).not.toMatch(/\bFilePickerModule\b/);
    }
  });

  it("lists the app's Documents folder in Files only with fileSharing", () => {
    const keys =
      '<key>UIFileSharingEnabled</key>\n<true/>\n<key>LSSupportsOpeningDocumentsInPlace</key>\n<true/>';
    expect(infoPlistEntries(app({ fileSharing: true }))).toContain(keys);
    expect(infoPlistEntries(app())).not.toContain('UIFileSharingEnabled');
  });
});

describe('iosGenerator.leaveOut', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-ios-'));
    cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const project = () =>
    readFileSync(path.join(dir, 'App.xcodeproj/project.pbxproj'), 'utf8');

  it('keeps everything for an app that draws', () => {
    const before = project();
    iosGenerator.leaveOut(dir, { canvas: true, webgl: true }, app());
    expect(project()).toBe(before);
    for (const file of IOS_CANVAS_SOURCES) {
      expect(existsSync(path.join(dir, file))).toBe(true);
    }
  });

  it('takes out the canvas sources and ANGLE for an app that never draws', () => {
    expect(project()).toContain('libEGL.xcframework');
    iosGenerator.leaveOut(dir, { canvas: false, webgl: false }, app());
    for (const file of IOS_CANVAS_SOURCES) {
      expect(existsSync(path.join(dir, file))).toBe(false);
    }
    expect(project()).not.toMatch(/libEGL|libGLESv2/);
    // The rest of the frameworks are still linked and embedded.
    expect(project()).toContain('Lynx.xcframework in Embed Frameworks');
  });

  it('leaves no file that needs what it took out', () => {
    // Swift reaches the canvas classes only by name (NSClassFromString), so
    // no file left may import their headers, or the shell wouldn't build.
    iosGenerator.leaveOut(dir, { canvas: false, webgl: false }, app());
    const appDir = path.join(dir, 'App');
    for (const file of readdirSync(appDir).filter((f) =>
      /\.(swift|m|h)$/.test(f),
    )) {
      const source = readFileSync(path.join(appDir, file), 'utf8');
      expect(source, file).not.toMatch(/#import "AngularLynx/);
      expect(source, file).not.toMatch(
        /\bAngularLynx(WebGL|Canvas|Video)\w*\.(self|alloc)\b/,
      );
    }
  });
});

describe('iosGenerator.leaveOut for an app that draws only in 2D', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-ios-'));
    cpSync(path.join(TEMPLATES_DIR, 'ios'), dir, { recursive: true });
    iosGenerator.leaveOut(dir, { canvas: true, webgl: false }, app());
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const project = () =>
    readFileSync(path.join(dir, 'App.xcodeproj/project.pbxproj'), 'utf8');
  const module = () =>
    readFileSync(path.join(dir, 'App/AngularLynxWebGL.m'), 'utf8');

  it('takes out the WebGL2 context and ANGLE, and keeps the rest of the canvas', () => {
    for (const file of IOS_WEBGL_SOURCES) {
      expect(existsSync(path.join(dir, file)), file).toBe(false);
    }
    for (const file of IOS_CANVAS_SOURCES.filter(
      (file) => !(IOS_WEBGL_SOURCES as readonly string[]).includes(file),
    )) {
      expect(existsSync(path.join(dir, file)), file).toBe(true);
    }
    expect(project()).not.toMatch(/libEGL|libGLESv2/);
    expect(project()).toContain('Lynx.xcframework in Embed Frameworks');
  });

  it("takes the module's WebGL2 methods out, and keeps its 2D and image methods", () => {
    const source = module();
    expect(source).not.toMatch(/^\s*\/\/ \/?angular-lynx:webgl$/m);
    expect(source).not.toContain('@"create" :');
    expect(source).not.toContain('@"encodeImage" :');
    expect(source).not.toContain('- (NSDictionary *)create:');
    expect(source).toContain('@"create2D" :');
    expect(source).toContain('- (NSDictionary *)create2D:');
    expect(source).toContain('@"decodeImage" :');
    expect(source).toContain('@"videoSize" :');
  });

  it('leaves no file that calls a function only the WebGL2 context defined', () => {
    // A C function the files taken out define, outside a static: the 2D and
    // bitmaprenderer contexts encoded with AngularLynxEncodeImage() from
    // AngularLynxWebGLContext.m, and failed to link without it. The template
    // is read from TEMPLATES_DIR, as the beforeEach already took them out.
    const defined = new Set<string>();
    for (const file of IOS_WEBGL_SOURCES) {
      const source = readFileSync(
        path.join(TEMPLATES_DIR, 'ios', file),
        'utf8',
      );
      for (const [, name] of source.matchAll(
        /^(?!static\b|typedef\b)[A-Za-z_][\w\s*]*?\b(\w+)\([^;]*?\)\s*\{/gm,
      )) {
        defined.add(name!);
      }
    }
    const app = path.join(dir, 'App');
    for (const file of readdirSync(app).filter((f) => /\.(m|swift)$/.test(f))) {
      const source = readFileSync(path.join(app, file), 'utf8');
      for (const name of defined) {
        expect(source, `${file} calls ${name}()`).not.toMatch(
          new RegExp(`\\b${name}\\(`),
        );
      }
    }
  });

  it('leaves no code that needs the WebGL2 context or ANGLE', () => {
    const app = path.join(dir, 'App');
    for (const file of readdirSync(app).filter((f) =>
      /\.(swift|m|h)$/.test(f),
    )) {
      const source = readFileSync(path.join(app, file), 'utf8')
        // What a comment names isn't code.
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, file).not.toMatch(
        /\bAngularLynxWebGLContext\b|AngularLynxWebGLOps|<(EGL|GLES\d?)\//,
      );
    }
  });
});

describe('withoutFrameworks', () => {
  it('fails for a framework the project doesn’t have', () => {
    expect(() => withoutFrameworks('a\nb', ['libEGL'])).toThrow(
      'The project has no libEGL.xcframework to leave out.',
    );
  });
});
