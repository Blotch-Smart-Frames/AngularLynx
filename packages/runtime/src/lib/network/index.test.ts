import { describe, expect, it } from 'vitest';
import {
  installBase64Globals,
  createObjectURL,
  installFetch,
  installNetworkGlobals,
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
  revokeObjectURL,
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

describe('installNetworkGlobals', () => {
  it("installs the body and encoding APIs where the runtime has none (Lynx's main thread)", () => {
    const target: Record<string, unknown> = {};
    installNetworkGlobals(target);

    // fetch and XMLHttpRequest come only to the apps that use them.
    expect(target).toEqual({
      TextEncoder: LynxTextEncoder,
      TextDecoder: LynxTextDecoder,
      ReadableStream: LynxReadableStream,
      Blob: LynxBlob,
    });
  });

  it('gives URL object URLs, unless it has them', () => {
    const LynxURLLike = class {};
    const target: Record<string, unknown> = { URL: LynxURLLike };
    installNetworkGlobals(target);
    expect((LynxURLLike as any).createObjectURL).toBe(createObjectURL);
    expect((LynxURLLike as any).revokeObjectURL).toBe(revokeObjectURL);

    const own = () => '';
    const BrowserURL = class {
      static createObjectURL = own;
    };
    installNetworkGlobals({ URL: BrowserURL });
    expect(BrowserURL.createObjectURL).toBe(own);
  });

  it("keeps the runtime's own (the web preview)", () => {
    const own = () => {};
    const target: Record<string, unknown> = {
      TextEncoder: own,
      TextDecoder: own,
      ReadableStream: own,
      Blob: own,
    };
    installNetworkGlobals(target);

    expect(target).toEqual({
      TextEncoder: own,
      TextDecoder: own,
      ReadableStream: own,
      Blob: own,
    });
  });
});

describe('installFetch', () => {
  it('installs fetch with its classes where the runtime has none', () => {
    const target: Record<string, unknown> = {};
    installFetch(target);
    expect(target).toEqual({
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
