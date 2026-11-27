// The shells' bitmaprenderer methods on the AngularLynxWebGL module, faked
// for the runtime's ImageBitmapRenderingContext specs: each method records
// its calls, and `encodeBitmapRenderer` answers with a file of bytes 1 and 2.
//
// Not exported from public-api.ts: this is test-only infrastructure, never
// shipped in the published package.
import { vi } from 'vitest';
import type { BitmapRendererBridge } from '../canvas/webgl-bridge';

export type FakeBitmapRendererBridge = {
  createBitmapRenderer: ReturnType<
    typeof vi.fn<BitmapRendererBridge['createBitmapRenderer']>
  >;
  transferToBitmapRenderer: ReturnType<
    typeof vi.fn<BitmapRendererBridge['transferToBitmapRenderer']>
  >;
  destroyBitmapRenderer: ReturnType<
    typeof vi.fn<BitmapRendererBridge['destroyBitmapRenderer']>
  >;
  encodeBitmapRenderer: ReturnType<
    typeof vi.fn<BitmapRendererBridge['encodeBitmapRenderer']>
  >;
} & BitmapRendererBridge;

export const createFakeBitmapRendererBridge = (): FakeBitmapRendererBridge => ({
  createBitmapRenderer: vi.fn(() => ({ ok: true })),
  transferToBitmapRenderer: vi.fn(() => ({ ok: true })),
  destroyBitmapRenderer: vi.fn(),
  encodeBitmapRenderer: vi.fn((_contextId, { type }) => ({
    base64: 'AQI=',
    type,
  })),
});
