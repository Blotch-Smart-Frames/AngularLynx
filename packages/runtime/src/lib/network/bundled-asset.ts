import { fromWords } from './words';

/**
 * A file the app bundles, for the main thread's `fetch` (fetch.ts): a
 * texture or glTF model the app imports, whose URL is relative to the app
 * (`/static/...`). In an app built with `ng build --platform ios|android`,
 * the app's files are inside the app, not on a server, so the request can't
 * go to the network; the shell's `AngularLynxAssets` module reads the file,
 * from the main thread, synchronously.
 *
 * `ng serve` gives assets absolute URLs on the dev server, and a host without
 * the module (Lynx Explorer) answers null: the request fails as before.
 *
 * @returns The bytes, or null when no bundled file has the path.
 */
export const readBundledAsset = (url: string): Uint8Array | null => {
  const lynxGlobal = (globalThis as { lynx?: { module?: unknown } }).lynx;
  if (typeof lynxGlobal?.module !== 'function') return null;
  try {
    const module = (
      lynxGlobal.module as (
        name: string,
      ) => { invoke(method: string, ...args: unknown[]): unknown } | undefined
    )('AngularLynxAssets');
    const words = module?.invoke('read', url);
    return words ? fromWords(words) : null;
  } catch {
    return null;
  }
};

const TYPES: Record<string, string> = {
  bin: 'application/octet-stream',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  ktx2: 'image/ktx2',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
};

/** A bundled file's Content-Type, from its extension. */
export const typeOfAsset = (url: string): string => {
  const path = url.split(/[?#]/)[0];
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return TYPES[extension] ?? 'application/octet-stream';
};
