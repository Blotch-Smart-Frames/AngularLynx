import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { devBuildKey, recordDevBuild, reusableDevBuild } from './dev-build.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-dev-build-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('reusableDevBuild', () => {
  const app = () => {
    const file = path.join(dir, 'MyApp-simulator.app');
    mkdirSync(file);
    return file;
  };

  it('reuses the app built from the same project for the same device', () => {
    const artifacts = [app()];
    recordDevBuild(dir, devBuildKey('hash', 'SIM-UDID'), artifacts);
    expect(reusableDevBuild(dir, devBuildKey('hash', 'SIM-UDID'))).toEqual(
      artifacts,
    );
  });

  it('builds again for a changed project, another device, or a missing app', () => {
    const artifacts = [app()];
    recordDevBuild(dir, devBuildKey('hash', 'SIM-UDID'), artifacts);
    expect(reusableDevBuild(dir, devBuildKey('other', 'SIM-UDID'))).toBe(
      undefined,
    );
    expect(reusableDevBuild(dir, devBuildKey('hash', 'PHONE'))).toBe(undefined);
    rmSync(artifacts[0]!, { recursive: true });
    expect(reusableDevBuild(dir, devBuildKey('hash', 'SIM-UDID'))).toBe(
      undefined,
    );
  });

  it('builds when nothing was built, or the record lists nothing', () => {
    expect(reusableDevBuild(dir, devBuildKey('hash', ''))).toBe(undefined);
    writeFileSync(
      path.join(dir, '.angular-lynx-build'),
      devBuildKey('hash', ''),
    );
    expect(reusableDevBuild(dir, devBuildKey('hash', ''))).toBe(undefined);
  });
});
