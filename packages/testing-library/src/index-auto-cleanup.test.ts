/**
 * Branch coverage for the module-load auto-cleanup guard in index.ts.
 *
 * The guard registers a global `afterEach(cleanup)` unless opted out. Its three
 * decision points only run at import time, so each case re-imports the module
 * (via vi.resetModules) after stubbing the relevant globals/env:
 *   1. `typeof process === 'undefined'` — a non-Node runner (no `process`)
 *   2. `ATL_SKIP_AUTO_CLEANUP === 'true'` — the documented opt-out
 *   3. `afterEach` is not a function — a runner without a global afterEach
 *
 * Each re-import replaces ./render.js with a stub. The real one imports
 * @blotch/angular-lynx, which vitest.config.ts aliases to the runtime's source,
 * so re-importing it re-evaluated the whole runtime inside the test body, where
 * the 5 s test timeout applies. That took about 0.5 s alone and about 1 s with
 * every core busy, and it timed out during a parallel `turbo run test`. The
 * guard only needs a `cleanup` to register, so the stub keeps each re-import
 * down to index.ts itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const cleanup = vi.fn();

/** Re-imports index.ts, with a stub ./render.js, after the globals are set. */
const importIndex = async (): Promise<unknown> => {
  vi.resetModules();
  vi.doMock('./render.js', () => ({
    render: vi.fn(),
    cleanup,
    waitForUpdate: vi.fn(),
  }));
  return import('./index.js');
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('./render.js');
  vi.resetModules();
  cleanup.mockClear();
});

describe('auto-cleanup registration', () => {
  it('registers afterEach(cleanup) by default', async () => {
    const spy = vi.fn();
    vi.stubGlobal('afterEach', spy);
    await importIndex();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('the registered hook cleans up and resets the Lynx testing environment', async () => {
    const spy = vi.fn();
    const reset = vi.fn();
    vi.stubGlobal('afterEach', spy);
    vi.stubGlobal('lynxTestingEnv', { reset });
    await importIndex();

    spy.mock.calls[0]![0]();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('skips registration when ATL_SKIP_AUTO_CLEANUP=true', async () => {
    vi.stubEnv('ATL_SKIP_AUTO_CLEANUP', 'true');
    const spy = vi.fn();
    vi.stubGlobal('afterEach', spy);
    await importIndex();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not throw when no global afterEach exists', async () => {
    vi.stubGlobal('afterEach', undefined);
    await expect(importIndex()).resolves.toBeDefined();
  });
});
