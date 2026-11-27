import { afterEach, describe, expect, it, vi } from 'vitest';
import { callOnBackground } from '../background-call';
import { bytesToBase64 } from './base64';
import { relayFetch } from './fetch';
import { isRelative, nextRelayId, relayBytes } from './relay';
import { toWords } from './words';

vi.mock('../background-call', () => ({ callOnBackground: vi.fn() }));

const call = vi.mocked(callOnBackground);

afterEach(() => {
  call.mockReset();
  vi.unstubAllGlobals();
});

const response = (status: number, body: unknown = null) => ({
  status,
  statusText: '',
  url: 'https://example.com/a.png',
  redirected: false,
  headers: [],
  body,
});

describe('relayBytes', () => {
  it('reads a file the app bundles, for a relative URL', async () => {
    const invoke = vi.fn(() => toWords(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('lynx', { module: () => ({ invoke }) });
    expect(await relayBytes('/static/a.png')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(invoke).toHaveBeenCalledWith('read', '/static/a.png');
    expect(call).not.toHaveBeenCalled();
  });

  it('rejects for a relative URL the app bundles no file at', async () => {
    vi.stubGlobal('lynx', undefined);
    await expect(relayBytes('a.png')).rejects.toThrow(TypeError);
  });

  it('GETs any other URL with the background thread’s fetch, as the main thread’s fetch does', async () => {
    call.mockResolvedValueOnce(
      response(200, { base64: bytesToBase64(new Uint8Array([9, 8])) }) as never,
    );
    expect(await relayBytes('https://example.com/a.png')).toEqual(
      new Uint8Array([9, 8]),
    );
    expect(call).toHaveBeenCalledWith('fetch', expect.any(Number), {
      url: 'https://example.com/a.png',
      method: 'GET',
      headers: [],
      body: null,
      options: {},
    });

    // An SVG comes as text.
    call.mockResolvedValueOnce(response(200, { text: '<svg/>é' }) as never);
    expect(await relayBytes('https://example.com/a.svg')).toEqual(
      new TextEncoder().encode('<svg/>é'),
    );
    call.mockResolvedValueOnce(response(204) as never);
    expect(await relayBytes('https://example.com/empty')).toEqual(
      new Uint8Array(0),
    );
  });

  it('rejects for a status other than 2xx, or a request that fails', async () => {
    call.mockResolvedValueOnce(response(404) as never);
    await expect(relayBytes('https://example.com/a.png')).rejects.toThrow(
      'Failed to load https://example.com/a.png: 404',
    );
    call.mockResolvedValueOnce(response(199) as never);
    await expect(relayBytes('https://example.com/a.png')).rejects.toThrow(
      /199/,
    );
    call.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(relayBytes('https://example.com/a.png')).rejects.toThrow(
      'Network request failed',
    );
  });

  it('takes its request ID from the same count as fetch, so the background thread can tell them apart', async () => {
    call.mockResolvedValue(response(200) as never);
    await relayBytes('https://example.com/a.png');
    await relayFetch('https://example.com/b.json');
    const [first, second] = call.mock.calls.map((args) => args[1]);
    expect(second).toBe((first as number) + 1);
    expect(nextRelayId()).toBe((second as number) + 1);
  });
});

describe('isRelative', () => {
  it('is a URL with no scheme', () => {
    expect(isRelative('/a.png')).toBe(true);
    expect(isRelative('a.png')).toBe(true);
    expect(isRelative('https://example.com/a.png')).toBe(false);
    expect(isRelative('blob:x')).toBe(false);
  });
});
