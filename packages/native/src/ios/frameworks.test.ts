import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FRAMEWORKS_ENV,
  LYNX_IOS,
  LYNX_IOS_FRAMEWORKS,
  readFrameworksVersion,
  resolveLynxFrameworks,
} from './frameworks.ts';

let dir: string;
const env = { ...process.env };
const pinnedSha256 = LYNX_IOS.sha256;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-frameworks-'));
  process.env['XDG_CACHE_HOME'] = path.join(dir, 'cache');
  delete process.env[FRAMEWORKS_ENV];
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
  (LYNX_IOS as { sha256?: string }).sha256 = pinnedSha256;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A folder of empty-but-valid-looking XCFrameworks.
 */
const fakeFrameworks = (folder: string) => {
  for (const name of LYNX_IOS_FRAMEWORKS) {
    mkdirSync(path.join(folder, `${name}.xcframework`), { recursive: true });
    writeFileSync(path.join(folder, `${name}.xcframework/Info.plist`), '');
  }
  writeFileSync(path.join(folder, 'VERSIONS'), 'lynx=4.1.0\nprimjs=4.1.1\n');
  return folder;
};

const log = path.join(dir ?? os.tmpdir(), 'log');

describe('resolveLynxFrameworks', () => {
  it('uses the folder the environment variable names', async () => {
    const folder = fakeFrameworks(path.join(dir, 'local'));
    process.env[FRAMEWORKS_ENV] = folder;
    expect(await resolveLynxFrameworks(log, () => {})).toBe(folder);
  });

  it('says which frameworks an override folder lacks', async () => {
    const folder = fakeFrameworks(path.join(dir, 'local'));
    rmSync(path.join(folder, 'PrimJS.xcframework'), { recursive: true });
    process.env[FRAMEWORKS_ENV] = folder;
    await expect(resolveLynxFrameworks(log, () => {})).rejects.toThrow(
      /is missing PrimJS\.xcframework/,
    );
  });

  it('pins a published zip', () => {
    expect(LYNX_IOS.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('explains how to build the frameworks while none are published', async () => {
    (LYNX_IOS as { sha256?: string }).sha256 = undefined;
    await expect(resolveLynxFrameworks(log, () => {})).rejects.toThrow(
      /aren't published yet/,
    );
  });

  it.runIf(process.platform === 'darwin')(
    'downloads, checks and caches the pinned zip',
    async () => {
      fakeFrameworks(path.join(dir, 'zip/LynxFrameworks'));
      const zipFile = path.join(dir, 'frameworks.zip');
      execFileSync('ditto', ['-c', '-k', 'zip', zipFile], { cwd: dir });
      const zip = readFileSync(zipFile);
      (LYNX_IOS as { sha256?: string }).sha256 = createHash('sha256')
        .update(zip)
        .digest('hex');
      const fetchMock = vi.fn(async () => new Response(zip));
      vi.stubGlobal('fetch', fetchMock);

      const messages: string[] = [];
      const logFile = path.join(dir, 'ios.log');
      const folder = await resolveLynxFrameworks(logFile, (message) =>
        messages.push(message),
      );
      expect(folder).toBe(
        path.join(
          dir,
          'cache/angular-lynx/lynx-ios',
          LYNX_IOS.version,
          'LynxFrameworks',
        ),
      );
      expect(existsSync(path.join(folder, 'Lynx.xcframework/Info.plist'))).toBe(
        true,
      );
      expect(messages).toEqual([
        `Downloading Lynx ${LYNX_IOS.version} for iOS (once per Lynx version)`,
      ]);
      // Cached: the second call doesn't download.
      await resolveLynxFrameworks(logFile, () => {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses a download whose checksum does not match', async () => {
    (LYNX_IOS as { sha256?: string }).sha256 = 'expected';
    vi.stubGlobal('fetch', async () => new Response('tampered'));
    await expect(resolveLynxFrameworks(log, () => {})).rejects.toThrow(
      /not the pinned expected/,
    );
  });

  it('reports a failed download', async () => {
    (LYNX_IOS as { sha256?: string }).sha256 = 'expected';
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(resolveLynxFrameworks(log, () => {})).rejects.toThrow(
      /failed with HTTP 404/,
    );
  });
});

describe('readFrameworksVersion', () => {
  it('reads the Lynx version a frameworks folder was built from', () => {
    expect(readFrameworksVersion(fakeFrameworks(path.join(dir, 'f')))).toBe(
      '4.1.0',
    );
    expect(readFrameworksVersion(dir)).toBeUndefined();
  });
});
