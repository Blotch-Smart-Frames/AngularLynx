import {
  cpSync,
  mkdirSync,
  mkdtempSync,
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
  androidGenerator,
  deepLinkEntries,
  findAndroidSdk,
  permissionEntries,
  properties,
  propertyValue,
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
      ].join('\n'),
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
    expect(statSync(path.join(dir, 'gradlew')).mode & 0o111).not.toBe(0);
    expect(androidGenerator.bundleDir(dir)).toBe(
      path.join(dir, 'app/src/main/assets'),
    );
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
