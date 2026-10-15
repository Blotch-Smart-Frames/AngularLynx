import {
  cpSync,
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
import { infoPlistEntries, iosGenerator, xcconfig } from './project.ts';

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
      ].join('\n'),
    );
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
    expect(iosGenerator.bundleDir(dir)).toBe(path.join(dir, 'LynxBundle'));
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
