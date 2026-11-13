import {
  cpSync,
  existsSync,
  mkdtempSync,
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
  infoPlistEntries,
  iosGenerator,
  LOCAL_NETWORK_REASON,
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

describe('infoPlistEntries', () => {
  it('lists the orientations', () => {
    expect(infoPlistEntries(app({ orientation: 'landscape' }))).toBe(
      [
        '<key>UISupportedInterfaceOrientations</key>',
        '<array>',
        '\t<string>UIInterfaceOrientationLandscapeLeft</string>',
        '\t<string>UIInterfaceOrientationLandscapeRight</string>',
        '</array>',
        '<key>AngularLynxEdgeToEdge</key>',
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

  it('tells the shell to keep the page inside the safe area', () => {
    expect(infoPlistEntries(app({ edgeToEdge: false }))).toContain(
      '<key>AngularLynxEdgeToEdge</key>\n<false/>',
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
    expect(plist).toContain('<key>LSApplicationQueriesSchemes</key>');
    expect(iosGenerator.bundleDir(dir)).toBe(path.join(dir, 'LynxBundle'));
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
