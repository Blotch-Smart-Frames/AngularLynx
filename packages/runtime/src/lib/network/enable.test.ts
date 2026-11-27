import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxBlob } from './blob';
import {
  ɵenableBlob,
  ɵenableFetch,
  ɵenableReadableStream,
  ɵenableTextDecoder,
  ɵenableTextEncoder,
  ɵenableXMLHttpRequest,
} from './enable';
import { relayFetch } from './fetch';
import { LynxHeaders } from './headers';
import { LynxReadableStream } from './readable-stream';
import { LynxTextDecoder, LynxTextEncoder } from './text-codec';
import { LynxXMLHttpRequest } from './xhr';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BODY_APIS = ['TextEncoder', 'TextDecoder', 'ReadableStream', 'Blob'];

/**
 * Lynx's main thread, which has no fetch, XMLHttpRequest or body APIs.
 */
const mainThread = (): void => {
  vi.stubGlobal('__MAIN_THREAD__', true);
  vi.stubGlobal('__WEB__', false);
  for (const name of ['fetch', 'Headers', 'Request', 'Response']) {
    vi.stubGlobal(name, undefined);
  }
  vi.stubGlobal('XMLHttpRequest', undefined);
  for (const name of BODY_APIS) vi.stubGlobal(name, undefined);
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
    // And what a response is read with.
    expect(globalThis.TextDecoder).toBe(LynxTextDecoder);
    expect(globalThis.ReadableStream).toBe(LynxReadableStream);
    expect(globalThis.Blob).toBe(LynxBlob);
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

describe.each([
  ['ɵenableTextEncoder', ɵenableTextEncoder, 'TextEncoder', LynxTextEncoder],
  ['ɵenableTextDecoder', ɵenableTextDecoder, 'TextDecoder', LynxTextDecoder],
  [
    'ɵenableReadableStream',
    ɵenableReadableStream,
    'ReadableStream',
    LynxReadableStream,
  ],
  ['ɵenableBlob', ɵenableBlob, 'Blob', LynxBlob],
] as const)('%s', (_name, enable, global, value) => {
  it('gives the main thread only its global, once', () => {
    mainThread();
    enable();
    enable();
    for (const name of BODY_APIS) {
      expect((globalThis as Record<string, unknown>)[name]).toBe(
        name === global ? value : undefined,
      );
    }
    expect(globalThis.fetch).toBeUndefined();
  });

  it('leaves the background thread and the web preview their own', () => {
    mainThread();
    vi.stubGlobal('__MAIN_THREAD__', false);
    enable();
    expect((globalThis as Record<string, unknown>)[global]).toBeUndefined();
    vi.stubGlobal('__MAIN_THREAD__', true);
    vi.stubGlobal('__WEB__', true);
    enable();
    expect((globalThis as Record<string, unknown>)[global]).toBeUndefined();
  });
});
