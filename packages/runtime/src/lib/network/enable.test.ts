import { afterEach, describe, expect, it, vi } from 'vitest';
import { ɵenableFetch, ɵenableXMLHttpRequest } from './enable';
import { relayFetch } from './fetch';
import { LynxHeaders } from './headers';
import { LynxXMLHttpRequest } from './xhr';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Lynx's main thread, which has no fetch or XMLHttpRequest.
 */
const mainThread = (): void => {
  vi.stubGlobal('__MAIN_THREAD__', true);
  vi.stubGlobal('__WEB__', false);
  for (const name of ['fetch', 'Headers', 'Request', 'Response']) {
    vi.stubGlobal(name, undefined);
  }
  vi.stubGlobal('XMLHttpRequest', undefined);
};

describe('ɵenableFetch', () => {
  it('gives the main thread fetch and its classes, once', () => {
    mainThread();
    ɵenableFetch();
    // Each module that names fetch calls it again.
    ɵenableFetch();
    expect(globalThis.fetch).toBe(relayFetch);
    expect(globalThis.Headers).toBe(LynxHeaders);
    expect(globalThis.XMLHttpRequest).toBeUndefined();
  });

  it('leaves the background thread and the web preview their own', () => {
    mainThread();
    vi.stubGlobal('__MAIN_THREAD__', false);
    ɵenableFetch();
    expect(globalThis.fetch).toBeUndefined();
    vi.stubGlobal('__MAIN_THREAD__', true);
    vi.stubGlobal('__WEB__', true);
    ɵenableFetch();
    expect(globalThis.fetch).toBeUndefined();
  });
});

describe('ɵenableXMLHttpRequest', () => {
  it('gives the main thread XMLHttpRequest and the fetch it sends through', () => {
    mainThread();
    ɵenableXMLHttpRequest();
    expect(globalThis.XMLHttpRequest).toBe(LynxXMLHttpRequest);
    expect(globalThis.fetch).toBe(relayFetch);
  });

  it('leaves the background thread and the web preview their own', () => {
    mainThread();
    vi.stubGlobal('__MAIN_THREAD__', false);
    ɵenableXMLHttpRequest();
    expect(globalThis.XMLHttpRequest).toBeUndefined();
    vi.stubGlobal('__MAIN_THREAD__', true);
    vi.stubGlobal('__WEB__', true);
    ɵenableXMLHttpRequest();
    expect(globalThis.XMLHttpRequest).toBeUndefined();
  });
});
