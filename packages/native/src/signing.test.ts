import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveAndroidSigning } from './android/build.ts';
import { exportOptionsPlist, resolveIosSigning } from './ios/build.ts';
import { resolveAppOptions } from './options.ts';

let dir: string;
let keyFile: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-signing-'));
  keyFile = path.join(dir, 'key');
  writeFileSync(keyFile, '');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const app = (options = {}) =>
  resolveAppOptions(options, { projectName: 'my-app' });

describe('resolveIosSigning', () => {
  const ios = {
    teamId: 'TEAM',
    signing: { keyIdEnv: 'KEY_ID', issuerIdEnv: 'ISSUER', keyPathEnv: 'KEY' },
  };

  it('is undefined when nothing is configured', () => {
    expect(resolveIosSigning(app(), {})).toBeUndefined();
  });

  it('reads the API key from the named environment variables', () => {
    expect(
      resolveIosSigning(app({ ios }), {
        KEY_ID: 'id',
        ISSUER: 'issuer',
        KEY: keyFile,
      }),
    ).toEqual({
      teamId: 'TEAM',
      keyPath: keyFile,
      keyId: 'id',
      issuerId: 'issuer',
    });
  });

  it('explains each way the configuration can be incomplete', () => {
    expect(() =>
      resolveIosSigning(app({ ios: { signing: ios.signing } }), {}),
    ).toThrow('ios.signing is set, but ios.teamId is not.');
    expect(() =>
      resolveIosSigning(app({ ios: { teamId: 'TEAM' } }), {}),
    ).toThrow(
      'ios.signing.keyPathEnv must name the environment variable that holds it.',
    );
    expect(() => resolveIosSigning(app({ ios }), {})).toThrow(
      "ios.signing.keyPathEnv names KEY, which isn't set in the environment.",
    );
    expect(() =>
      resolveIosSigning(app({ ios }), { KEY: path.join(dir, 'missing') }),
    ).toThrow(/doesn't exist/);
  });
});

describe('exportOptionsPlist', () => {
  it('exports for App Store Connect with automatic signing', () => {
    const plist = exportOptionsPlist('TEAM&1');
    expect(plist).toContain('<string>app-store-connect</string>');
    expect(plist).toContain('<string>TEAM&amp;1</string>');
  });
});

describe('resolveAndroidSigning', () => {
  const android = {
    signing: {
      storeFileEnv: 'STORE',
      storePasswordEnv: 'STORE_PASSWORD',
      keyAlias: 'upload',
      keyPasswordEnv: 'KEY_PASSWORD',
    },
  };

  it('is undefined when nothing is configured', () => {
    expect(resolveAndroidSigning(app(), {})).toBeUndefined();
  });

  it('reads the upload key from the named environment variables', () => {
    expect(
      resolveAndroidSigning(app({ android }), {
        STORE: keyFile,
        STORE_PASSWORD: 'a',
        KEY_PASSWORD: 'b',
      }),
    ).toEqual({
      storeFile: keyFile,
      storePassword: 'a',
      keyAlias: 'upload',
      keyPassword: 'b',
    });
  });

  it('explains each way the configuration can be incomplete', () => {
    expect(() =>
      resolveAndroidSigning(
        app({
          android: { signing: { ...android.signing, keyAlias: undefined } },
        }),
        {},
      ),
    ).toThrow('android.signing.keyAlias must be set.');
    expect(() => resolveAndroidSigning(app({ android }), {})).toThrow(
      "android.signing.storeFileEnv names STORE, which isn't set in the environment.",
    );
    expect(() =>
      resolveAndroidSigning(
        app({ android: { signing: { keyAlias: 'upload' } } }),
        {},
      ),
    ).toThrow(
      'android.signing.storeFileEnv must name the environment variable that holds it.',
    );
    expect(() =>
      resolveAndroidSigning(app({ android }), {
        STORE: path.join(dir, 'missing'),
      }),
    ).toThrow(/doesn't exist/);
  });
});
