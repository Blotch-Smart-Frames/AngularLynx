import { describe, expect, it } from 'vitest';
import {
  installBase64Globals,
  installBlob,
  installFetch,
  installReadableStream,
  installTextDecoder,
  installTextEncoder,
  installXMLHttpRequest,
  LynxBlob,
  lynxAtob,
  lynxBtoa,
  LynxDOMException,
  LynxHeaders,
  LynxReadableStream,
  LynxRequest,
  LynxResponse,
  LynxTextDecoder,
  LynxTextEncoder,
  LynxXMLHttpRequest,
  relayFetch,
} from './index';

describe('installBase64Globals', () => {
  it("installs atob, btoa and DOMException where the runtime has none (either of Lynx's threads)", () => {
    const target: Record<string, unknown> = {};
    installBase64Globals(target);

    expect(target).toEqual({
      DOMException: LynxDOMException,
      atob: lynxAtob,
      btoa: lynxBtoa,
    });
  });

  it("keeps the runtime's own (the web preview's frame and Web Worker)", () => {
    const own = () => {};
    const target: Record<string, unknown> = {
      DOMException: own,
      atob: own,
      btoa: own,
    };
    installBase64Globals(target);

    expect(target).toEqual({ DOMException: own, atob: own, btoa: own });
  });
});

describe.each([
  ['installTextEncoder', installTextEncoder, 'TextEncoder', LynxTextEncoder],
  ['installTextDecoder', installTextDecoder, 'TextDecoder', LynxTextDecoder],
  [
    'installReadableStream',
    installReadableStream,
    'ReadableStream',
    LynxReadableStream,
  ],
  ['installBlob', installBlob, 'Blob', LynxBlob],
] as const)('%s', (_name, install, global, value) => {
  it("installs only its global where the runtime has none (Lynx's main thread)", () => {
    const target: Record<string, unknown> = {};
    install(target);
    expect(target).toEqual({ [global]: value });
  });

  it("keeps the runtime's own (the web preview)", () => {
    const own = () => {};
    const target: Record<string, unknown> = { [global]: own };
    install(target);
    expect(target).toEqual({ [global]: own });
  });
});

describe('installFetch', () => {
  it('installs fetch with its classes and the body APIs where the runtime has none', () => {
    const target: Record<string, unknown> = {};
    installFetch(target);
    // With what a response is read with, which code that fetches uses
    // without naming it.
    expect(target).toEqual({
      TextEncoder: LynxTextEncoder,
      TextDecoder: LynxTextDecoder,
      ReadableStream: LynxReadableStream,
      Blob: LynxBlob,
      fetch: relayFetch,
      Headers: LynxHeaders,
      Request: LynxRequest,
      Response: LynxResponse,
    });
  });

  it("keeps the runtime's fetch, and its classes along with it (the web preview)", () => {
    const own = () => {};
    const target: Record<string, unknown> = { fetch: own };
    installFetch(target);
    expect(target).toEqual({ fetch: own });
  });

  it('keeps Fetch classes the runtime has when it installs fetch', () => {
    const OwnHeaders = class {};
    const target: Record<string, unknown> = { Headers: OwnHeaders };
    installFetch(target);
    expect(target['fetch']).toBe(relayFetch);
    expect(target['Headers']).toBe(OwnHeaders);
  });
});

describe('installXMLHttpRequest', () => {
  it('installs XMLHttpRequest, and the fetch it sends requests through', () => {
    const target: Record<string, unknown> = {};
    installXMLHttpRequest(target);
    expect(target).toEqual({
      TextEncoder: LynxTextEncoder,
      TextDecoder: LynxTextDecoder,
      ReadableStream: LynxReadableStream,
      Blob: LynxBlob,
      fetch: relayFetch,
      Headers: LynxHeaders,
      Request: LynxRequest,
      Response: LynxResponse,
      XMLHttpRequest: LynxXMLHttpRequest,
    });
  });

  it("keeps the runtime's own", () => {
    const own = () => {};
    const target: Record<string, unknown> = { fetch: own, XMLHttpRequest: own };
    installXMLHttpRequest(target);
    expect(target).toEqual({ fetch: own, XMLHttpRequest: own });
  });
});
