import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeCacheOptions } from './normalize-cache';

describe('normalizeCacheOptions', () => {
  const originalCI = process.env.CI;

  afterEach(() => {
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  it('returns default options when metadata has no cli.cache', () => {
    delete process.env.CI;
    const result = normalizeCacheOptions({}, '/workspace');

    expect(result.enabled).toBe(true);
    expect(result.basePath).toBe(path.resolve('/workspace', '.angular/cache'));
    expect(result.path).toContain('.angular/cache');
  });

  it('environment "ci" with CI=1 enables cache', () => {
    process.env.CI = '1';
    const metadata = { cli: { cache: { environment: 'ci' as const } } };

    const result = normalizeCacheOptions(metadata, '/workspace');

    expect(result.enabled).toBe(true);
  });

  it('environment "ci" without CI env disables cache', () => {
    delete process.env.CI;
    const metadata = { cli: { cache: { environment: 'ci' as const } } };

    const result = normalizeCacheOptions(metadata, '/workspace');

    expect(result.enabled).toBe(false);
  });

  it('environment "local" with CI=true disables cache', () => {
    process.env.CI = 'true';
    const metadata = { cli: { cache: { environment: 'local' as const } } };

    const result = normalizeCacheOptions(metadata, '/workspace');

    expect(result.enabled).toBe(false);
  });

  it('environment "local" without CI enables cache', () => {
    delete process.env.CI;
    const metadata = { cli: { cache: { environment: 'local' as const } } };

    const result = normalizeCacheOptions(metadata, '/workspace');

    expect(result.enabled).toBe(true);
  });

  it('environment "all" always enables cache', () => {
    process.env.CI = '1';
    const metadata = { cli: { cache: { environment: 'all' as const } } };

    const result = normalizeCacheOptions(metadata, '/workspace');

    expect(result.enabled).toBe(true);
  });

  it('enabled false stays false regardless of environment', () => {
    delete process.env.CI;
    const metadata = {
      cli: { cache: { enabled: false, environment: 'all' as const } },
    };

    const result = normalizeCacheOptions(metadata, '/workspace');

    expect(result.enabled).toBe(false);
  });

  it('path appends VERSION placeholder to basePath', () => {
    const result = normalizeCacheOptions({}, '/workspace');

    // path should be basePath + VERSION
    expect(result.path).toBe(path.join(result.basePath, '0.0.0-PLACEHOLDER'));
  });

  describe('hasCacheMetadata type guard (tested indirectly)', () => {
    it('rejects null', () => {
      const result = normalizeCacheOptions(null, '/workspace');
      expect(result.enabled).toBe(true); // falls back to defaults
    });

    it('rejects undefined', () => {
      const result = normalizeCacheOptions(undefined, '/workspace');
      expect(result.enabled).toBe(true);
    });

    it('rejects objects without cli', () => {
      const result = normalizeCacheOptions({ foo: 'bar' }, '/workspace');
      expect(result.enabled).toBe(true);
    });

    it('rejects objects without cli.cache', () => {
      const result = normalizeCacheOptions({ cli: {} }, '/workspace');
      expect(result.enabled).toBe(true);
    });
  });
});
