import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TEMPLATES_DIR } from '../generate.ts';
import { resolveAppOptions } from '../options.ts';
import {
  ANDROID_CANVAS_SOURCES,
  androidGenerator,
  deepLinkEntries,
  findAndroidSdk,
  permissionEntries,
  properties,
  queriesEntries,
  propertyValue,
  shortcutStringsXml,
  shortcutsXml,
  stringResource,
} from './project.ts';

const app = (options = {}) =>
  resolveAppOptions(options, { projectName: 'my-app' });

describe('properties', () => {
  it('writes the identity build.gradle.kts reads', () => {
    expect(
      properties(
        app({
          appId: 'com.example.app',
          version: '1.2.0',
          buildNumber: 42,
          appName: 'My App',
          orientation: 'landscape',
        }),
      ),
    ).toContain(
      [
        'applicationId=com.example.app',
        'versionName=1.2.0',
        'versionCode=42',
        'appName=My App',
        'screenOrientation=sensorLandscape',
        'edgeToEdge=true',
        'textScaling=true',
        'maxTextScale=0',
      ].join('\n'),
    );
  });

  it('tells the shell to keep the page inside the safe area', () => {
    expect(properties(app({ edgeToEdge: false }))).toContain(
      'edgeToEdge=false',
    );
  });

  it("tells the shell the text scale's cap, or that it's off", () => {
    expect(properties(app({ textScaling: { max: 1.6 } }))).toContain(
      'textScaling=true\nmaxTextScale=1.6',
    );
    expect(properties(app({ textScaling: false }))).toContain(
      'textScaling=false\nmaxTextScale=0',
    );
  });

  it('escapes what Properties.load would misread', () => {
    expect(propertyValue('Café 日記 \\ a\nb')).toBe(
      'Caf\\u00e9 \\u65e5\\u8a18 \\\\ a\\nb',
    );
  });
});

describe('permissionEntries', () => {
  it('declares each permission once, and its hardware as optional', () => {
    expect(
      permissionEntries(app({ permissions: { camera: 'x', location: 'y' } })),
    ).toBe(
      [
        '<uses-permission android:name="android.permission.CAMERA" />',
        '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
        '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
        '<uses-feature android:name="android.hardware.camera" android:required="false" />',
        '<uses-feature android:name="android.hardware.location" android:required="false" />',
      ].join('\n'),
    );
    expect(permissionEntries(app())).toBe('');
  });
});

describe('deepLinkEntries', () => {
  it('writes one VIEW intent filter for all schemes', () => {
    expect(deepLinkEntries(app({ deepLinkSchemes: ['a', 'b'] }))).toBe(
      [
        '<intent-filter>',
        '    <action android:name="android.intent.action.VIEW" />',
        '    <category android:name="android.intent.category.DEFAULT" />',
        '    <category android:name="android.intent.category.BROWSABLE" />',
        '    <data android:scheme="a" />',
        '    <data android:scheme="b" />',
        '</intent-filter>',
      ].join('\n'),
    );
    expect(deepLinkEntries(app())).toBe('');
  });

  it('writes a verified https filter for the app link domains', () => {
    expect(
      deepLinkEntries(
        app({
          deepLinkSchemes: ['a'],
          appLinkDomains: ['example.com', '*.example.com'],
        }),
      ),
    ).toBe(
      [
        '<intent-filter>',
        '    <action android:name="android.intent.action.VIEW" />',
        '    <category android:name="android.intent.category.DEFAULT" />',
        '    <category android:name="android.intent.category.BROWSABLE" />',
        '    <data android:scheme="a" />',
        '</intent-filter>',
        '<intent-filter android:autoVerify="true">',
        '    <action android:name="android.intent.action.VIEW" />',
        '    <category android:name="android.intent.category.DEFAULT" />',
        '    <category android:name="android.intent.category.BROWSABLE" />',
        '    <data android:scheme="https" />',
        '    <data android:host="example.com" />',
        '    <data android:host="*.example.com" />',
        '</intent-filter>',
      ].join('\n'),
    );
    // Without schemes, the app links' filter alone.
    expect(
      deepLinkEntries(app({ appLinkDomains: ['example.com'] })).startsWith(
        '<intent-filter android:autoVerify="true">',
      ),
    ).toBe(true);
  });
});

describe('queriesEntries', () => {
  it('asks about the apps that open each scheme', () => {
    const entries = queriesEntries(app({ canOpenURLSchemes: ['whatsapp'] }));
    expect(entries.startsWith('<queries>\n')).toBe(true);
    expect(entries.endsWith('\n</queries>')).toBe(true);
    expect(entries).toContain(
      [
        '    <intent>',
        '        <action android:name="android.intent.action.VIEW" />',
        '        <data android:scheme="whatsapp" />',
        '    </intent>',
      ].join('\n'),
    );
    expect(entries.match(/<intent>/g)).toHaveLength(6);
  });
});

describe('shortcutsXml', () => {
  const shortcuts = app({
    appId: 'com.example.app',
    shortcuts: [
      { id: 'refresh', title: 'Refresh' },
      {
        id: 'show-photos',
        title: 'Show "my" photos',
        route: '/photos?a=1&b=2',
      },
    ],
  });

  it('points each shortcut at the trampoline activity, with its ID and route', () => {
    expect(shortcutsXml(shortcuts)).toContain(
      [
        '    <shortcut',
        '        android:shortcutId="refresh"',
        '        android:enabled="true"',
        '        android:icon="@mipmap/ic_launcher"',
        '        android:shortcutShortLabel="@string/shortcut_refresh">',
        '        <intent',
        '            android:action="android.intent.action.VIEW"',
        '            android:targetPackage="com.example.app"',
        '            android:targetClass="dev.angularlynx.shell.ShortcutActivity">',
        '            <extra android:name="angularLynxShortcutId" android:value="refresh" />',
        '        </intent>',
        '    </shortcut>',
      ].join('\n'),
    );
    expect(shortcutsXml(shortcuts)).toContain(
      [
        // A hyphen can't be in a resource's name.
        '        android:shortcutShortLabel="@string/shortcut_show_photos">',
        '        <intent',
        '            android:action="android.intent.action.VIEW"',
        '            android:targetPackage="com.example.app"',
        '            android:targetClass="dev.angularlynx.shell.ShortcutActivity">',
        '            <extra android:name="angularLynxShortcutId" android:value="show-photos" />',
        '            <extra android:name="angularLynxShortcutRoute" android:value="/photos?a=1&amp;b=2" />',
      ].join('\n'),
    );
  });

  it('keeps each title in a string resource, which is all a shortcut takes', () => {
    expect(shortcutStringsXml(shortcuts)).toContain(
      [
        '<resources>',
        '    <string name="shortcut_refresh">Refresh</string>',
        '    <string name="shortcut_show_photos">Show \\"my\\" photos</string>',
        '</resources>',
      ].join('\n'),
    );
  });
});

describe('stringResource', () => {
  it('escapes what Android would read as quoting, an escape, a reference or markup', () => {
    expect(stringResource(`Don't "go" back\\`)).toBe(
      `Don\\'t \\"go\\" back\\\\`,
    );
    expect(stringResource('@home')).toBe('\\@home');
    expect(stringResource('?why')).toBe('\\?why');
    expect(stringResource('Q&A <now>')).toBe('Q&amp;A &lt;now&gt;');
    expect(stringResource('mail@home?')).toBe('mail@home?');
  });
});

describe('androidGenerator', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-android-'));
    cpSync(path.join(TEMPLATES_DIR, 'android'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('fills the real template', () => {
    androidGenerator.configure(
      dir,
      app({ permissions: { camera: 'x' }, deepLinkSchemes: ['myapp'] }),
      dir,
    );
    const manifest = readFileSync(
      path.join(dir, 'app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android.permission.CAMERA');
    expect(manifest).toContain('<data android:scheme="myapp" />');
    // <queries> belongs to <manifest>, not to <application>.
    expect(manifest.indexOf('<queries>')).toBeLessThan(
      manifest.indexOf('<application'),
    );
    expect(manifest).toContain('<data android:scheme="mailto" />');
    expect(statSync(path.join(dir, 'gradlew')).mode & 0o111).not.toBe(0);
    expect(androidGenerator.bundleDir(dir)).toBe(
      path.join(dir, 'app/src/main/assets'),
    );
  });

  it("writes the shortcuts' resources, which the launcher activity points Android to", () => {
    const xml = path.join(dir, 'app/src/main/res/xml/shortcuts.xml');
    const strings = path.join(dir, 'app/src/main/res/values/shortcuts.xml');
    androidGenerator.configure(dir, app(), dir);
    // The template's empty list, which the manifest still refers to.
    expect(readFileSync(xml, 'utf8')).not.toContain('<shortcut ');
    expect(existsSync(strings)).toBe(false);

    androidGenerator.configure(
      dir,
      app({ shortcuts: [{ id: 'refresh', title: 'Refresh' }] }),
      dir,
    );
    expect(readFileSync(xml, 'utf8')).toContain('android:shortcutId="refresh"');
    expect(readFileSync(strings, 'utf8')).toContain(
      '<string name="shortcut_refresh">Refresh</string>',
    );
    const manifest = readFileSync(
      path.join(dir, 'app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android:resource="@xml/shortcuts"');
    // Its own task, or Android would end the open app to start a shortcut.
    expect(manifest).toMatch(
      /android:name="\.ShortcutActivity"[^>]*android:taskAffinity=""/,
    );
  });

  it("leaves Lynx's INFO lines out of a release build's Android log", () => {
    androidGenerator.configure(dir, app(), dir);
    const application = readFileSync(
      path.join(
        dir,
        'app/src/main/java/dev/angularlynx/shell/ShellApplication.kt',
      ),
      'utf8',
    );
    // Lynx's release libraries log every touch, flush, layout and module
    // call at INFO, each a JNI call into android.util.Log on the engine
    // thread. Only a build that isn't debuggable leaves them out: the debug
    // build `ng serve --platform android` installs keeps them.
    expect(application).toMatch(
      /if \(\(applicationInfo\.flags and ApplicationInfo\.FLAG_DEBUGGABLE\) == 0\) \{\s+LLog\.setMinimumLoggingLevel\(LLog\.WARN\)\s+\}/,
    );
    // After init, which loads Lynx's native library: before it, the call
    // does nothing.
    expect(application.indexOf('LynxEnv.inst().init(')).toBeGreaterThan(-1);
    expect(
      application.indexOf('LLog.setMinimumLoggingLevel(LLog.WARN)'),
    ).toBeGreaterThan(application.indexOf('LynxEnv.inst().init('));
  });

  it("keeps Android's focus highlight off the page", () => {
    androidGenerator.configure(dir, app(), dir);
    const activity = readFileSync(
      path.join(dir, 'app/src/main/java/dev/angularlynx/shell/MainActivity.kt'),
      'utf8',
    );
    // Out of touch mode (after any key press) the focused LynxView would
    // otherwise be drawn under a 12% black, darkening every color (#362).
    expect(activity).toContain('lynxView.defaultFocusHighlightEnabled = false');
  });
});

describe('findAndroidSdk', () => {
  it('prefers ANDROID_HOME, then ANDROID_SDK_ROOT', () => {
    const sdk = mkdtempSync(path.join(os.tmpdir(), 'sdk-'));
    try {
      expect(findAndroidSdk({ ANDROID_HOME: sdk })).toBe(sdk);
      expect(
        findAndroidSdk({ ANDROID_HOME: '/missing', ANDROID_SDK_ROOT: sdk }),
      ).toBe(sdk);
    } finally {
      rmSync(sdk, { recursive: true });
    }
  });

  it('falls back to the Android Studio default location', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const original = process.env['HOME'];
    process.env['HOME'] = home;
    try {
      const studio =
        process.platform === 'darwin'
          ? path.join(home, 'Library/Android/sdk')
          : path.join(home, 'Android/Sdk');
      expect(findAndroidSdk({})).toBeUndefined();
      mkdirSync(studio, { recursive: true });
      expect(findAndroidSdk({})).toBe(studio);
    } finally {
      process.env['HOME'] = original;
      rmSync(home, { recursive: true });
    }
  });
});

describe('androidGenerator.leaveOut', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-android-'));
    cpSync(path.join(TEMPLATES_DIR, 'android'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const shell = (main = 'main') =>
    path.join(dir, `app/src/${main}/java/dev/angularlynx/shell`);
  const mainActivity = () =>
    readFileSync(path.join(shell(), 'MainActivity.kt'), 'utf8');

  it('keeps everything for an app that draws', () => {
    const before = mainActivity();
    androidGenerator.leaveOut(dir, { canvas: true });
    expect(mainActivity()).toBe(before);
    for (const file of ANDROID_CANVAS_SOURCES) {
      expect(existsSync(path.join(shell(), file))).toBe(true);
    }
  });

  it('takes out the canvas sources and the lines that register them', () => {
    androidGenerator.leaveOut(dir, { canvas: false });
    for (const file of ANDROID_CANVAS_SOURCES) {
      expect(existsSync(path.join(shell(), file))).toBe(false);
    }
    expect(mainActivity()).not.toContain('angular-lynx:canvas');
    // The modules and elements around them stay.
    expect(mainActivity()).toContain('registerModule(AssetsModule.NAME');
    expect(mainActivity()).toContain(
      'addBehaviors(XElementBehaviors().create())',
    );
  });

  it('leaves no file that needs what it took out', () => {
    // Every name the files taken out declare at their top level (a class, an
    // object, a function, a value), which another file of the package could
    // use: AssetsModule.kt used WebGLModule.kt's wordsFromBytes() until it
    // moved to ModuleBytes.kt.
    const declared = new Set<string>();
    for (const file of ANDROID_CANVAS_SOURCES) {
      const source = readFileSync(path.join(shell(), file), 'utf8');
      for (const [, name] of source.matchAll(
        /^(?:(?:internal|public|abstract|open|data|sealed|enum|const)\s+)*(?:class|interface|object|fun|val|var)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)/gm,
      )) {
        declared.add(name!);
      }
    }
    expect(declared).toContain('bitmapOf');
    expect(declared).toContain('CanvasRegistry');
    androidGenerator.leaveOut(dir, { canvas: false });
    const names = new RegExp(`\\b(${[...declared].join('|')})\\b`);
    for (const main of ['main', 'debug', 'release']) {
      for (const file of readdirSync(shell(main))) {
        const source = readFileSync(path.join(shell(main), file), 'utf8')
          // What a comment names isn't code.
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        expect(source.match(names)?.[0], file).toBeUndefined();
      }
    }
  });
});
