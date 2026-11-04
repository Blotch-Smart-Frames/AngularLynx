import { describe, expect, it } from 'vitest';
import {
  installBase64Globals,
  createObjectURL,
  installNetworkGlobals,
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
  it("installs the network APIs where the runtime has none (Lynx's main thread)", () => {
    const target: Record<string, unknown> = {};
    installNetworkGlobals(target);

    expect(target).toEqual({
      TextEncoder: LynxTextEncoder,
      TextDecoder: LynxTextDecoder,
      ReadableStream: LynxReadableStream,
      fetch: relayFetch,
      Headers: LynxHeaders,
      Request: LynxRequest,
      Response: LynxResponse,
      XMLHttpRequest: LynxXMLHttpRequest,
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

  it("keeps the runtime's own, and its Fetch classes along with its fetch (the web preview)", () => {
    const own = () => {};
    const target: Record<string, unknown> = {
      TextEncoder: own,
      TextDecoder: own,
      ReadableStream: own,
      fetch: own,
      XMLHttpRequest: own,
      Blob: own,
    };
    installNetworkGlobals(target);

    expect(target).toEqual({
      TextEncoder: own,
      TextDecoder: own,
      ReadableStream: own,
      fetch: own,
      XMLHttpRequest: own,
      Blob: own,
    });
  });

  it('keeps Fetch classes the runtime has when it installs fetch', () => {
    const OwnHeaders = class {};
    const target: Record<string, unknown> = { Headers: OwnHeaders };
    installNetworkGlobals(target);
    expect(target['fetch']).toBe(relayFetch);
    expect(target['Headers']).toBe(OwnHeaders);
  });
});
