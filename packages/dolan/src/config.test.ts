import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, type Fixture } from './test-utils';
import { getConfigPath, configExists, readConfig, writeConfig } from './config';

let fixture: Fixture;

afterEach(() => {
  fixture?.cleanup();
  vi.restoreAllMocks();
});

describe('getConfigPath', () => {
  it('resolves dolan.config.json relative to cwd', () => {
    fixture = createFixture();
    expect(getConfigPath(fixture.dir)).toBe(
      join(fixture.dir, 'dolan.config.json'),
    );
  });
});

describe('configExists', () => {
  it('returns false when no config file is present', () => {
    fixture = createFixture();
    expect(configExists(fixture.dir)).toBe(false);
  });

  it('returns true once a config file has been written', () => {
    fixture = createFixture();
    writeConfig(fixture.dir, {
      aliases: { components: 'src/components/ui', theme: 'src/styles' },
    });
    expect(configExists(fixture.dir)).toBe(true);
  });
});

describe('writeConfig / readConfig', () => {
  it('round-trips a config through disk as pretty-printed JSON', () => {
    fixture = createFixture();
    const config = {
      aliases: {
        components: 'src/components/ui',
        theme: 'src/styles',
        utils: 'src/lib/utils',
      },
    };

    writeConfig(fixture.dir, config);

    // Pin the on-disk format (indented, trailing newline) since other tooling
    // (editors, git diffs) benefits from a stable, human-readable file.
    const raw = readFileSync(getConfigPath(fixture.dir), 'utf-8');
    expect(raw).toBe(JSON.stringify(config, null, 2) + '\n');

    expect(readConfig(fixture.dir)).toEqual(config);
  });
});
