import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBundledAsset, typeOfAsset } from './bundled-asset';
import { toWords } from './words';

describe('readBundledAsset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the file through the shell’s module', () => {
    const invoke = vi.fn(() => toWords(new Uint8Array([1, 2, 3])));
    const module = vi.fn(() => ({ invoke }));
    vi.stubGlobal('lynx', { module });
    expect(readBundledAsset('/static/model.glb')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(module).toHaveBeenCalledWith('AngularLynxAssets');
    expect(invoke).toHaveBeenCalledWith('read', '/static/model.glb');
  });

  it('answers null for a file the app doesn’t bundle, or without the module', () => {
    vi.stubGlobal('lynx', { module: () => ({ invoke: () => null }) });
    expect(readBundledAsset('/missing.png')).toBeNull();
    vi.stubGlobal('lynx', { module: () => undefined });
    expect(readBundledAsset('/missing.png')).toBeNull();
    vi.stubGlobal('lynx', {
      module: () => {
        throw new Error('no such module');
      },
    });
    expect(readBundledAsset('/missing.png')).toBeNull();
    vi.stubGlobal('lynx', {});
    expect(readBundledAsset('/missing.png')).toBeNull();
    vi.stubGlobal('lynx', undefined);
    expect(readBundledAsset('/missing.png')).toBeNull();
  });
});

describe('typeOfAsset', () => {
  it.each([
    ['/static/a.PNG', 'image/png'],
    ['/static/a.jpg?v=1', 'image/jpeg'],
    ['/static/a.glb#x', 'model/gltf-binary'],
    ['/static/a.gltf', 'model/gltf+json'],
    ['/static/a', 'application/octet-stream'],
    ['/static/a.xyz', 'application/octet-stream'],
  ])('%s is %s', (url, type) => {
    expect(typeOfAsset(url)).toBe(type);
  });
});
