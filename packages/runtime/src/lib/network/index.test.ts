import { describe, expect, it } from 'vitest';
import {
  installNetworkGlobals,
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

describe('installNetworkGlobals', () => {
  it("installs the network APIs where the runtime has none (Lynx's main thread)", () => {
    const target: Record<string, unknown> = {};
    installNetworkGlobals(target);

    expect(target).toEqual({
      TextEncoder: LynxTextEncoder,
      TextDecoder: LynxTextDecoder,
      atob: lynxAtob,
      btoa: lynxBtoa,
      DOMException: LynxDOMException,
      ReadableStream: LynxReadableStream,
      fetch: relayFetch,
      Headers: LynxHeaders,
      Request: LynxRequest,
      Response: LynxResponse,
      XMLHttpRequest: LynxXMLHttpRequest,
    });
  });

  it("keeps the runtime's own, and its Fetch classes along with its fetch (the web preview)", () => {
    const own = () => {};
    const target: Record<string, unknown> = {
      TextEncoder: own,
      TextDecoder: own,
      atob: own,
      btoa: own,
      DOMException: own,
      ReadableStream: own,
      fetch: own,
      XMLHttpRequest: own,
    };
    installNetworkGlobals(target);

    expect(target).toEqual({
      TextEncoder: own,
      TextDecoder: own,
      atob: own,
      btoa: own,
      DOMException: own,
      ReadableStream: own,
      fetch: own,
      XMLHttpRequest: own,
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
