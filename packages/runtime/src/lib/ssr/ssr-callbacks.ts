import { __pageElementRef } from '../lynx-document';
import { buildElementQueueFromOpcodes } from './build-element-queue';
import { OpcodeRecorder } from './opcodes';
import { serializeElementTree } from './serialize-tree';

/**
 * SSR (Instant First-Frame Rendering) engine callbacks.
 *
 * Kept as plain exported functions — separate from the `if (__ENABLE_SSR__)`
 * registration in global-callbacks.ts — so the orchestration logic (the guard
 * throws + snapshot wiring) is unit-testable without flipping the compile-time
 * `__ENABLE_SSR__` define. The Lynx engine calls these by name (via the globals
 * global-callbacks installs) to snapshot the element tree after the first render
 * (encode) and to reconnect Angular to pre-existing native elements on
 * subsequent loads (hydrate).
 */

/**
 * Walk the native element tree Angular just rendered and return an opcode-stream
 * snapshot the engine can persist. Throws if called before the page element
 * exists — the engine must only invoke this after the first render.
 */
export const ssrEncode = (): string => {
  if (!__pageElementRef) {
    throw new Error('ssrEncode called before Angular rendered the page element');
  }
  const recorder = new OpcodeRecorder();
  serializeElementTree(__pageElementRef, recorder);
  return JSON.stringify({ __opcodes: recorder.opcodes });
};

/**
 * Rebuild the ElementRef queue from a persisted snapshot and stash it (plus the
 * hydrating flag + page element) on globals for LynxHydrateDocument to consume
 * during Angular's bootstrap. Cleared automatically once hydration completes.
 */
export const ssrHydrate = (info: string): void => {
  const nativePage = __GetPageElement();
  if (!nativePage) {
    throw new Error('SSR hydration failed: no page element from snapshot');
  }
  const refsMap = __GetTemplateParts(nativePage);
  const { __opcodes } = JSON.parse(info) as { __opcodes: unknown[] };
  const elementQueue = buildElementQueueFromOpcodes(__opcodes, refsMap);

  (globalThis as any).__LYNX_IS_HYDRATING__ = true;
  (globalThis as any).__LYNX_HYDRATE_PAGE__ = nativePage;
  (globalThis as any).__LYNX_HYDRATE_QUEUE__ = elementQueue;
};
