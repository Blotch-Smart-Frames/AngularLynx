/**
 * Branch coverage for the module-load auto-cleanup guard in index.ts.
 *
 * The guard registers a global `afterEach(cleanup)` unless opted out. Its three
 * decision points only run at import time, so each case re-imports the module
 * (via vi.resetModules) after stubbing the relevant globals/env:
 *   1. `typeof process === 'undefined'` — a non-Node runner (no `process`)
 *   2. `ATL_SKIP_AUTO_CLEANUP === 'true'` — the documented opt-out
 *   3. `afterEach` is not a function — a runner without a global afterEach
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('auto-cleanup registration', () => {
  it('registers afterEach(cleanup) by default', async () => {
    vi.resetModules();
    const spy = vi.fn();
    vi.stubGlobal('afterEach', spy);
    await import('./index.js');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('skips registration when ATL_SKIP_AUTO_CLEANUP=true', async () => {
    vi.resetModules();
    vi.stubEnv('ATL_SKIP_AUTO_CLEANUP', 'true');
    const spy = vi.fn();
    vi.stubGlobal('afterEach', spy);
    await import('./index.js');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not throw when no global afterEach exists', async () => {
    vi.resetModules();
    vi.stubGlobal('afterEach', undefined);
    await expect(import('./index.js')).resolves.toBeDefined();
  });
});
