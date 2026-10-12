import { describe, expect, it } from 'vitest';
import { installUrl, LynxURL, LynxURLSearchParams } from './index';

describe('installUrl', () => {
  it('installs URL and URLSearchParams where the runtime has neither (Lynx main thread)', () => {
    const target: { URL?: unknown; URLSearchParams?: unknown } = {};
    installUrl(target);

    expect(target.URL).toBe(LynxURL);
    expect(target.URLSearchParams).toBe(LynxURLSearchParams);
    // The call Angular's Router makes for every URL it serializes. Without a
    // URL global it threw, and every navigation was skipped.
    const url = new (target.URL as typeof LynxURL)('/lazy', 'http://fake');
    expect(url.origin).toBe('http://fake');
    expect(url.pathname).toBe('/lazy');
  });

  it('keeps implementations the runtime already has', () => {
    const NativeURL = class {};
    const NativeURLSearchParams = class {};
    const target = { URL: NativeURL, URLSearchParams: NativeURLSearchParams };
    installUrl(target);

    expect(target.URL).toBe(NativeURL);
    expect(target.URLSearchParams).toBe(NativeURLSearchParams);
  });
});
