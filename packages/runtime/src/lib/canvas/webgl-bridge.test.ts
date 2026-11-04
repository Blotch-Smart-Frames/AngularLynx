import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bridge is looked up once per page, so each test loads a fresh copy.
 */
const load = async () => {
  vi.resetModules();
  return import('./webgl-bridge');
};

describe('getWebGLBridge', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is null without main-thread modules (the web preview, tests)', async () => {
    const { getWebGLBridge } = await load();
    vi.stubGlobal('lynx', undefined);
    expect(getWebGLBridge()).toBeNull();
  });

  it('is null when the host has no such module', async () => {
    vi.stubGlobal('lynx', { module: () => undefined });
    expect((await load()).getWebGLBridge()).toBeNull();
    vi.stubGlobal('lynx', { module: () => ({}) });
    expect((await load()).getWebGLBridge()).toBeNull();
    vi.stubGlobal('lynx', {
      module: () => {
        throw new Error('no module');
      },
    });
    expect((await load()).getWebGLBridge()).toBeNull();
  });

  it('calls the shell’s module, and is the same bridge each time', async () => {
    const invoke = vi.fn((method: string) =>
      method === 'create'
        ? { ok: true }
        : method === 'run'
          ? [1]
          : method === 'decodeImage'
            ? { width: 2, height: 3 }
            : undefined,
    );
    const module = vi.fn(() => ({ invoke }));
    vi.stubGlobal('lynx', { module });
    const { getWebGLBridge, WEBGL_MODULE_NAME } = await load();
    const bridge = getWebGLBridge()!;
    expect(getWebGLBridge()).toBe(bridge);
    expect(module).toHaveBeenCalledOnce();
    expect(module).toHaveBeenCalledWith(WEBGL_MODULE_NAME);
    expect(bridge.create(1, 'c-1', { alpha: true })).toEqual({ ok: true });
    expect(bridge.run(1, [OP_CLEAR])).toEqual([1]);
    bridge.destroy(1);
    expect(bridge.decodeImage(2, [0, 0], {})).toEqual({ width: 2, height: 3 });
    bridge.releaseImage(2);
    expect(invoke.mock.calls).toEqual([
      ['create', 1, 'c-1', { alpha: true }],
      ['run', 1, [OP_CLEAR]],
      ['destroy', 1],
      ['decodeImage', 2, [0, 0], {}],
      ['releaseImage', 2],
    ]);
  });

  it('answers for a module that answers nothing', async () => {
    vi.stubGlobal('lynx', { module: () => ({ invoke: () => undefined }) });
    const bridge = (await load()).getWebGLBridge()!;
    expect(bridge.create(1, 'c', {})).toMatchObject({
      ok: false,
      error: expect.stringMatching(/isn't registered/),
    });
    expect(bridge.run(1, [])).toEqual([]);
    expect(bridge.decodeImage(1, [], {})).toMatchObject({
      width: 0,
      error: expect.stringMatching(/isn't registered/),
    });
  });

  it('can be replaced, and restored, for tests', async () => {
    const { getWebGLBridge, setWebGLBridgeForTesting } = await load();
    vi.stubGlobal('lynx', undefined);
    const fake = {} as never;
    setWebGLBridgeForTesting(fake);
    expect(getWebGLBridge()).toBe(fake);
    setWebGLBridgeForTesting(null);
    expect(getWebGLBridge()).toBeNull();
    setWebGLBridgeForTesting(undefined);
    expect(getWebGLBridge()).toBeNull();
  });
});

describe('bytesOf', () => {
  it('views the bytes of a buffer or a typed array, by element', async () => {
    const { bytesOf } = await load();
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(bytesOf(buffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(bytesOf(buffer, 2, 3)).toEqual(new Uint8Array([3, 4, 5]));
    expect(bytesOf(buffer, 6)).toEqual(new Uint8Array([7, 8]));
    const shorts = new Uint16Array(buffer, 2, 3);
    expect(bytesOf(shorts, 1, 1)).toEqual(new Uint8Array([5, 6]));
    expect(bytesOf(shorts, 1)).toEqual(new Uint8Array([5, 6, 7, 8]));
    expect(bytesOf(new DataView(buffer, 1, 2))).toEqual(new Uint8Array([2, 3]));
  });
});

const OP_CLEAR = 23;
