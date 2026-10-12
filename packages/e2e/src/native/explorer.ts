import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { check, run, step } from '../process.ts';

/**
 * Lynx Explorer, the prebuilt host app each Lynx release publishes. Layer 6
 * opens the generated app's bundle in it.
 *
 * Pinned on purpose: it's a binary we run in CI, so it's checked against the
 * SHA-256 digest GitHub records for the release asset. Bump it together with
 * the Lynx toolchain (@lynx-js/rspeedy), and re-check the deep link format
 * (see openUrl in ios.ts) when you do.
 */
export const EXPLORER = {
  version: '4.1.0',
  ios: {
    // Apple silicon simulators, which GitHub's macOS runners and current
    // Macs run.
    asset: 'LynxExplorer-arm64.app.tar.gz',
    sha256: '7b10e34ac2a0b1c3f6cd1003f68243a5565078304ebd4760b363557778ee4968',
    bundleId: 'com.lynx.LynxExplorer',
  },
  android: {
    asset: 'LynxExplorer-noasan-release.apk',
    sha256: '6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6',
    packageName: 'com.lynx.explorer',
  },
} as const;

const cacheDir = () =>
  path.join(os.homedir(), '.cache/angular-lynx-e2e/explorer', EXPLORER.version);

/** Downloads (or reuses the cached) Explorer and returns its local path. */
export const getExplorer = async (
  platform: 'ios' | 'android',
  logFile: string,
): Promise<string> => {
  const { asset, sha256 } = EXPLORER[platform];
  const dir = cacheDir();
  const download = path.join(dir, asset);
  mkdirSync(dir, { recursive: true });

  const digest = (file: string) =>
    createHash('sha256').update(readFileSync(file)).digest('hex');
  if (!existsSync(download) || digest(download) !== sha256) {
    step(`Downloading Lynx Explorer ${EXPLORER.version} (${asset})`);
    const url = `https://github.com/lynx-family/lynx/releases/download/${EXPLORER.version}/${asset}`;
    const response = await fetch(url);
    check(
      response.ok,
      `Downloading ${url} failed with HTTP ${response.status}.`,
    );
    writeFileSync(download, Buffer.from(await response.arrayBuffer()));
    const actual = digest(download);
    if (actual !== sha256) {
      rmSync(download);
      check(
        false,
        `${asset} has SHA-256 ${actual}, not the pinned ${sha256}. The release asset changed; don't run it until you know why.`,
      );
    }
  }

  if (platform === 'android') {
    return download;
  }
  // The iOS tarball holds the app bundle's contents without the enclosing
  // LynxExplorer.app folder, so extract into one.
  const app = path.join(dir, 'LynxExplorer.app');
  if (!existsSync(path.join(app, 'Info.plist'))) {
    rmSync(app, { recursive: true, force: true });
    mkdirSync(app);
    await run('tar', ['-xzf', download, '-C', app], {
      cwd: dir,
      logFile,
      echo: false,
    });
  }
  return app;
};
