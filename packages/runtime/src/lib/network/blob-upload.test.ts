import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { callOnBackground } from '../background-call';
import { fetchForMainThread, type RelayedRequest } from './background-fetch';
import { installNetworkGlobals } from './index';

vi.mock('../background-call', () => ({ callOnBackground: vi.fn() }));

/**
 * A Blob upload from Lynx's main thread, the way Firebase Storage's
 * `uploadBytes` sends a picked photo (LynxImagePicker): through
 * `XMLHttpRequest`, whose request goes through the main thread's `fetch`, as
 * JSON to the background thread, and out through that thread's `fetch`, here
 * Node's, to a real HTTP server that records what arrives.
 */

type Recorded = { method: string; headers: IncomingHttpHeaders; body: Buffer };

let server: Server;
let origin: string;
const requests: Recorded[] = [];

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method!,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"name":"users/ada/profile-picture/raw.jpg"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** The main thread's globals, as installNetworkGlobals() puts them on Lynx's. */
let main: Record<string, any>;

beforeEach(() => {
  requests.length = 0;
  main = {};
  installNetworkGlobals(main);
  const nodeFetch = globalThis.fetch;
  // XHR calls `globalThis.fetch`, which is the relayed one on the main thread.
  vi.stubGlobal('fetch', main['fetch']);
  vi.mocked(callOnBackground).mockImplementation(((
    _name: string,
    id: number,
    request: RelayedRequest,
  ) => {
    // The background thread's own fetch, only while it starts the request.
    vi.stubGlobal('fetch', nodeFetch);
    try {
      return fetchForMainThread(id, copy(request)).then(copy);
    } finally {
      vi.stubGlobal('fetch', main['fetch']);
    }
  }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Sends `body` with the main thread's XMLHttpRequest, as an upload library
 * does.
 */
const send = (
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; uploaded: number[] }> =>
  new Promise((resolve, reject) => {
    const xhr = new main['XMLHttpRequest']();
    const uploaded: number[] = [];
    xhr.upload.addEventListener('progress', (event: { loaded: number }) =>
      uploaded.push(event.loaded),
    );
    xhr.addEventListener('load', () =>
      resolve({ status: xhr.status, uploaded }),
    );
    xhr.addEventListener('error', () => reject(new Error('XHR failed')));
    xhr.open('POST', `${origin}/upload`);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(body);
  });

describe('a Blob sent with XMLHttpRequest from the main thread', () => {
  it('arrives with its bytes, and its type as the Content-Type', async () => {
    const bytes = new Uint8Array(70_000).map((_, index) => (index * 31) & 0xff);
    const blob = new main['Blob']([bytes], { type: 'image/jpeg' });

    const { status, uploaded } = await send(blob);

    expect(status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers['content-type']).toBe('image/jpeg');
    expect(requests[0]!.headers['content-length']).toBe('70000');
    expect(requests[0]!.body.equals(Buffer.from(bytes))).toBe(true);
    // Upload libraries report their progress from these.
    expect(uploaded).toEqual([70_000]);
  });

  it('keeps a Content-Type the request sets, as Firebase’s multipart upload does', async () => {
    // Firebase Storage's multipart upload: the metadata and the file joined
    // into one Blob with no type, and the boundary in the request's header.
    const photo = new main['Blob']([new Uint8Array([0xff, 0xd8, 0xff])], {
      type: 'image/jpeg',
    });
    const body = new main['Blob']([
      '--b\r\nContent-Type: application/json\r\n\r\n{}\r\n--b\r\nContent-Type: image/jpeg\r\n\r\n',
      photo,
      '\r\n--b--',
    ]);

    await send(body, { 'Content-Type': 'multipart/related; boundary=b' });

    expect(requests[0]!.headers['content-type']).toBe(
      'multipart/related; boundary=b',
    );
    expect(requests[0]!.body.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(
      true,
    );
    expect(requests[0]!.body.toString('latin1')).toMatch(/^--b\r\n.*--b--$/s);
  });

  it('sends a Blob with no type without a Content-Type of its own', async () => {
    await send(new main['Blob'](['raw']));

    expect(requests[0]!.body.toString()).toBe('raw');
    expect(requests[0]!.headers['content-type']).toBeUndefined();
  });
});
