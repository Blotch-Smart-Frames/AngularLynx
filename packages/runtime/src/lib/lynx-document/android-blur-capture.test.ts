import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAndroid } from './android-blur-capture';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isAndroid', () => {
  it('reads lynx.SystemInfo, all the native main thread has', () => {
    vi.stubGlobal('lynx', { SystemInfo: { platform: 'Android' } });
    expect(isAndroid()).toBe(true);
    vi.stubGlobal('lynx', { SystemInfo: { platform: 'iOS' } });
    expect(isAndroid()).toBe(false);
  });

  it('falls back to the global SystemInfo', () => {
    vi.stubGlobal('lynx', {});
    vi.stubGlobal('SystemInfo', { platform: 'Android' });
    expect(isAndroid()).toBe(true);
  });

  it('is false where neither exists', () => {
    vi.stubGlobal('lynx', undefined);
    vi.stubGlobal('SystemInfo', undefined);
    expect(isAndroid()).toBe(false);
  });
});
