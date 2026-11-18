import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { findAndroidSdk } from './android/project.ts';
import type { ResolvedApp } from './options.ts';
import { capture } from './process.ts';

/**
 * The files each of `appLinkDomains` serves so its https links open the app.
 * The phone opens a domain's links in the app only once the domain says the
 * app is its own: iOS reads `/.well-known/apple-app-site-association`, through
 * Apple's CDN, and Android checks `/.well-known/assetlinks.json` when the app
 * is installed. The build can't put them on the site, so it writes them
 * beside the app, ready to upload.
 *
 * Each goes at the root of each domain, over https, as `application/json`
 * and with no redirect. A `*.example.com` domain's file goes on
 * `example.com`.
 */

/** What iOS asks for and Android verifies, under the domain's root. */
export const APPLE_APP_SITE_ASSOCIATION =
  '.well-known/apple-app-site-association';
export const ASSET_LINKS = '.well-known/assetlinks.json';

/** In the iOS file where a build without `ios.teamId` knows no team. */
export const TEAM_ID_PLACEHOLDER = 'TEAM_ID';
/** In the Android file where the build couldn't read the signing key. */
export const FINGERPRINT_PLACEHOLDER = 'SHA256_FINGERPRINT';

/**
 * apple-app-site-association: every path on the domain opens the app, whose
 * ID iOS knows by its team. Narrow `components` on the site to leave some
 * paths to the browser; a link the app doesn't route can also go elsewhere
 * with `provideDeepLinkRoute()`.
 */
export const appleAppSiteAssociation = (app: ResolvedApp): string =>
  `${JSON.stringify(
    {
      applinks: {
        details: [
          {
            appIDs: [`${app.ios.teamId ?? TEAM_ID_PLACEHOLDER}.${app.id}`],
            components: [{ '/': '*' }],
          },
        ],
      },
    },
    null,
    2,
  )}\n`;

/**
 * assetlinks.json: the app, by its applicationId and the SHA-256 fingerprints
 * of the certificates that sign it, may handle all of the domain's links.
 */
export const assetLinks = (
  app: ResolvedApp,
  fingerprints: readonly string[],
): string =>
  `${JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: app.id,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    null,
    2,
  )}\n`;

/**
 * The SHA-256 fingerprints of the certificates that signed the APK, as
 * assetlinks.json writes them (`AB:CD:…`), from the newest build tools'
 * apksigner. Empty when there's no apksigner, or it can't read the APK.
 */
export const apkSignerFingerprints = async (
  apk: string,
  sdk = findAndroidSdk(),
): Promise<string[]> => {
  const apksigner = findApksigner(sdk);
  if (!apksigner) return [];
  const output = await capture(apksigner, ['verify', '--print-certs', apk]);
  return [
    ...(output ?? '').matchAll(
      /^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$/gim,
    ),
  ].map(([, digest]) => digest!.toUpperCase().match(/../g)!.join(':'));
};

/**
 * apksigner in the SDK's newest build tools, if it has any.
 */
const findApksigner = (sdk: string | undefined): string | undefined => {
  const buildTools = sdk && path.join(sdk, 'build-tools');
  if (!buildTools || !existsSync(buildTools)) return undefined;
  const name = process.platform === 'win32' ? 'apksigner.bat' : 'apksigner';
  return readdirSync(buildTools)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((version) => path.join(buildTools, version, name))
    .find((file) => existsSync(file));
};

/**
 * Writes the platform's file for the app link domains into `outputDir`, and
 * says where it goes. Returns its path, or undefined for an app without app
 * links.
 */
export const writeAppLinkFile = async ({
  platform,
  app,
  outputDir,
  apk,
  log,
  warn,
}: {
  readonly platform: 'ios' | 'android';
  readonly app: ResolvedApp;
  readonly outputDir: string;
  /** The APK the Android build signed, whose certificates the file names. */
  readonly apk?: string;
  readonly log: (message: string) => void;
  readonly warn: (message: string) => void;
}): Promise<string | undefined> => {
  if (app.appLinkDomains.length === 0) return undefined;
  const relative =
    platform === 'ios' ? APPLE_APP_SITE_ASSOCIATION : ASSET_LINKS;
  const file = path.join(outputDir, relative);
  mkdirSync(path.dirname(file), { recursive: true });

  if (platform === 'ios') {
    if (!app.ios.teamId) {
      warn(
        `${relative} names the app as ${TEAM_ID_PLACEHOLDER}.${app.id}: set ios.teamId in angular.json, or put the team's ID in its place, before uploading it.`,
      );
    }
    writeFileSync(file, appleAppSiteAssociation(app));
  } else {
    const fingerprints = apk ? await apkSignerFingerprints(apk) : [];
    if (fingerprints.length === 0) {
      warn(
        `Couldn't read the certificate that signed the app with the Android SDK's apksigner: put its SHA-256 fingerprint in ${relative} in place of ${FINGERPRINT_PLACEHOLDER} before uploading it (keytool -list -v -keystore <keystore> prints it).`,
      );
    }
    writeFileSync(
      file,
      assetLinks(
        app,
        fingerprints.length > 0 ? fingerprints : [FINGERPRINT_PLACEHOLDER],
      ),
    );
  }

  const roots = [
    ...new Set(app.appLinkDomains.map((domain) => domain.replace(/^\*\./, ''))),
  ];
  log(
    `Wrote ${file}. Serve it at ${roots.map((root) => `https://${root}/${relative}`).join(' and ')}, as application/json with no redirect, so the phone opens the app for those links.`,
  );
  // Google Play signs the app it installs with its own key (Play App
  // Signing), not the upload key that signed this build.
  if (platform === 'android') {
    log(
      `For an app installed from Google Play, add its app signing key's SHA-256 fingerprint to ${relative} too: Play Console → Test and release → App integrity → App signing.`,
    );
  }
  return file;
};
