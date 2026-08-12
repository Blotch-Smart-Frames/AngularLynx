import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * env.ts evaluates the env vars at module load time, so each test resets
 * the module registry before setting the env var and re-importing.
 */
const importEnv = () => import('./env');

describe('maxWorkers', () => {
  const originalEnv = process.env.NG_BUILD_MAX_WORKERS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NG_BUILD_MAX_WORKERS;
    } else {
      process.env.NG_BUILD_MAX_WORKERS = originalEnv;
    }
  });

  it('uses NG_BUILD_MAX_WORKERS when set to a numeric string', async () => {
    process.env.NG_BUILD_MAX_WORKERS = '8';
    const { maxWorkers } = await importEnv();

    expect(maxWorkers).toBe(8);
  });

  it('falls back to a CPU-based default when unset', async () => {
    delete process.env.NG_BUILD_MAX_WORKERS;
    const { maxWorkers } = await importEnv();

    expect(maxWorkers).toBeGreaterThanOrEqual(1);
    expect(maxWorkers).toBeLessThanOrEqual(4);
  });

  it('falls back to a CPU-based default when set to empty string', async () => {
    process.env.NG_BUILD_MAX_WORKERS = '';
    const { maxWorkers } = await importEnv();

    expect(maxWorkers).toBeGreaterThanOrEqual(1);
    expect(maxWorkers).toBeLessThanOrEqual(4);
  });
});

describe('useTypeChecking', () => {
  const originalEnv = process.env.NG_BUILD_TYPE_CHECK;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NG_BUILD_TYPE_CHECK;
    } else {
      process.env.NG_BUILD_TYPE_CHECK = originalEnv;
    }
  });

  it('defaults to true when NG_BUILD_TYPE_CHECK is unset', async () => {
    delete process.env.NG_BUILD_TYPE_CHECK;
    const { useTypeChecking } = await importEnv();

    expect(useTypeChecking).toBe(true);
  });

  it('defaults to true when NG_BUILD_TYPE_CHECK is empty string', async () => {
    process.env.NG_BUILD_TYPE_CHECK = '';
    const { useTypeChecking } = await importEnv();

    expect(useTypeChecking).toBe(true);
  });

  it('returns false when set to "0"', async () => {
    process.env.NG_BUILD_TYPE_CHECK = '0';
    const { useTypeChecking } = await importEnv();

    expect(useTypeChecking).toBe(false);
  });

  it('returns false when set to "false"', async () => {
    process.env.NG_BUILD_TYPE_CHECK = 'false';
    const { useTypeChecking } = await importEnv();

    expect(useTypeChecking).toBe(false);
  });

  it('returns false when set to "FALSE" (case-insensitive)', async () => {
    process.env.NG_BUILD_TYPE_CHECK = 'FALSE';
    const { useTypeChecking } = await importEnv();

    expect(useTypeChecking).toBe(false);
  });

  it('returns true when set to "1"', async () => {
    process.env.NG_BUILD_TYPE_CHECK = '1';
    const { useTypeChecking } = await importEnv();

    expect(useTypeChecking).toBe(true);
  });

  it('returns true when set to "true"', async () => {
    process.env.NG_BUILD_TYPE_CHECK = 'true';
    const { useTypeChecking } = await importEnv();

    expect(useTypeChecking).toBe(true);
  });
});
