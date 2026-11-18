import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  apkSignerFingerprints,
  appleAppSiteAssociation,
  assetLinks,
  writeAppLinkFile,
} from './app-links.ts';
import { resolveAppOptions } from './options.ts';

const app = (options = {}) =>
  resolveAppOptions(
    { appId: 'com.example.app', ...options },
    { projectName: 'my-app' },
  );

const DIGEST = '3b9f0a'.padEnd(64, '0');
const FINGERPRINT = DIGEST.toUpperCase().match(/../g)!.join(':');

let dir: string;
let originalAndroidHome: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-app-links-'));
  originalAndroidHome = process.env['ANDROID_HOME'];
});
afterEach(() => {
  if (originalAndroidHome === undefined) delete process.env['ANDROID_HOME'];
  else process.env['ANDROID_HOME'] = originalAndroidHome;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * An SDK whose build tools' apksigner prints what the real one does for an
 * APK signed by one certificate, recording which one ran.
 */
const sdkWithApksigner = (versions: readonly string[]) => {
  const sdk = path.join(dir, 'sdk');
  for (const version of versions) {
    const file = path.join(sdk, 'build-tools', version, 'apksigner');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `#!/bin/sh
echo "${version}" > "${dir}/ran"
[ "$1 $2" = "verify --print-certs" ] || exit 1
echo "Signer #1 certificate DN: CN=Android Debug, O=Android, C=US"
echo "Signer #1 certificate SHA-256 digest: ${DIGEST}"
echo "Signer #1 certificate SHA-1 digest: ${'1'.repeat(40)}"
`,
    );
    chmodSync(file, 0o755);
  }
  return sdk;
};

describe('appleAppSiteAssociation', () => {
  it('opens every path in the app its team signs', () => {
    expect(
      JSON.parse(
        appleAppSiteAssociation(app({ ios: { teamId: 'ABCDE12345' } })),
      ),
    ).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['ABCDE12345.com.example.app'],
            components: [{ '/': '*' }],
          },
        ],
      },
    });
  });
});

describe('assetLinks', () => {
  it('lets the app signed with the certificates handle every link', () => {
    expect(JSON.parse(assetLinks(app(), [FINGERPRINT]))).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.example.app',
          sha256_cert_fingerprints: [FINGERPRINT],
        },
      },
    ]);
  });
});

describe('apkSignerFingerprints', () => {
  it("reads the signing certificate with the newest build tools' apksigner", async () => {
    const sdk = sdkWithApksigner(['9.0.0', '34.0.0', '30.0.3']);
    expect(await apkSignerFingerprints('app.apk', sdk)).toEqual([FINGERPRINT]);
    expect(readFileSync(path.join(dir, 'ran'), 'utf8').trim()).toBe('34.0.0');
  });

  it('finds none without the build tools, or when apksigner fails', async () => {
    expect(await apkSignerFingerprints('app.apk', undefined)).toEqual([]);
    expect(await apkSignerFingerprints('app.apk', dir)).toEqual([]);
    const empty = path.join(dir, 'empty');
    mkdirSync(path.join(empty, 'build-tools/34.0.0'), { recursive: true });
    expect(await apkSignerFingerprints('app.apk', empty)).toEqual([]);
    const sdk = sdkWithApksigner(['34.0.0']);
    writeFileSync(
      path.join(sdk, 'build-tools/34.0.0/apksigner'),
      '#!/bin/sh\nexit 1\n',
    );
    expect(await apkSignerFingerprints('app.apk', sdk)).toEqual([]);
  });
});

describe('writeAppLinkFile', () => {
  const write = async (
    platform: 'ios' | 'android',
    options: object,
    apk?: string,
  ) => {
    const messages: string[] = [];
    const warnings: string[] = [];
    const file = await writeAppLinkFile({
      platform,
      app: app(options),
      outputDir: path.join(dir, 'dist'),
      apk,
      log: (message) => messages.push(message),
      warn: (message) => warnings.push(message),
    });
    return { file, messages, warnings };
  };

  it('writes nothing for an app without app links', async () => {
    expect((await write('ios', {})).file).toBeUndefined();
  });

  it("writes iOS's file, and says where it goes", async () => {
    const { file, messages, warnings } = await write('ios', {
      appLinkDomains: ['example.com', '*.example.com', 'shop.example.org'],
      ios: { teamId: 'ABCDE12345' },
    });
    expect(file).toBe(
      path.join(dir, 'dist/.well-known/apple-app-site-association'),
    );
    expect(readFileSync(file!, 'utf8')).toContain(
      '"ABCDE12345.com.example.app"',
    );
    expect(warnings).toEqual([]);
    expect(messages).toEqual([
      `Wrote ${file}. Serve it at https://example.com/.well-known/apple-app-site-association and https://shop.example.org/.well-known/apple-app-site-association, as application/json with no redirect, so the phone opens the app for those links.`,
    ]);
  });

  it('leaves a placeholder for the team, and says so, without ios.teamId', async () => {
    const { file, warnings } = await write('ios', {
      appLinkDomains: ['example.com'],
    });
    expect(readFileSync(file!, 'utf8')).toContain('"TEAM_ID.com.example.app"');
    expect(warnings).toEqual([
      ".well-known/apple-app-site-association names the app as TEAM_ID.com.example.app: set ios.teamId in angular.json, or put the team's ID in its place, before uploading it.",
    ]);
  });

  it("writes Android's file with the APK's signing certificate", async () => {
    process.env['ANDROID_HOME'] = sdkWithApksigner(['34.0.0']);
    const { file, messages, warnings } = await write(
      'android',
      { appLinkDomains: ['example.com'] },
      'app.apk',
    );
    expect(file).toBe(path.join(dir, 'dist/.well-known/assetlinks.json'));
    expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual(
      JSON.parse(assetLinks(app(), [FINGERPRINT])),
    );
    expect(warnings).toEqual([]);
    expect(messages[1]).toBe(
      "For an app installed from Google Play, add its app signing key's SHA-256 fingerprint to .well-known/assetlinks.json too: Play Console → Test and release → App integrity → App signing.",
    );
  });

  it("leaves a placeholder for the fingerprint, and says so, when it can't read it", async () => {
    process.env['ANDROID_HOME'] = path.join(dir, 'no-sdk');
    const { file, warnings } = await write('android', {
      appLinkDomains: ['example.com'],
    });
    expect(readFileSync(file!, 'utf8')).toContain('"SHA256_FINGERPRINT"');
    expect(warnings).toEqual([
      "Couldn't read the certificate that signed the app with the Android SDK's apksigner: put its SHA-256 fingerprint in .well-known/assetlinks.json in place of SHA256_FINGERPRINT before uploading it (keytool -list -v -keystore <keystore> prints it).",
    ]);
  });
});
