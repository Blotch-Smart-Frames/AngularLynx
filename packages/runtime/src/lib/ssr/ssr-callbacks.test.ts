import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { setPageElementRef } from '../lynx-document/page-ref';
import { ssrEncode, ssrHydrate } from './ssr-callbacks';

// serialize-tree + build-element-queue have their own specs; mock them here so
// these tests focus on the callback orchestration (guard throws + wiring)
// without standing up the full native PAPI surface they walk.
vi.mock('./serialize-tree', () => ({
  serializeElementTree: vi.fn((_root: ElementRef, recorder: any) => {
    recorder.begin('0', 'view');
    recorder.end();
  }),
}));

vi.mock('./build-element-queue', () => ({
  buildElementQueueFromOpcodes: vi.fn(() => ['queued-element']),
}));

describe('ssr-callbacks', () => {
  afterEach(() => {
    setPageElementRef(null);
    vi.unstubAllGlobals();
    delete (globalThis as any).__LYNX_IS_HYDRATING__;
    delete (globalThis as any).__LYNX_HYDRATE_PAGE__;
    delete (globalThis as any).__LYNX_HYDRATE_QUEUE__;
  });

  describe('ssrEncode', () => {
    it('throws when called before the page element exists', () => {
      setPageElementRef(null);
      expect(() => ssrEncode()).toThrow(
        /ssrEncode called before Angular rendered the page element/,
      );
    });

    it('serializes the page tree into a JSON opcode snapshot', () => {
      setPageElementRef({ _page: true } as unknown as ElementRef);
      const result = JSON.parse(ssrEncode());
      // The mocked serializer emits a begin/end pair for a single <view>.
      expect(result.__opcodes).toEqual([0, '0', 'view', 1]);
    });
  });

  describe('ssrHydrate', () => {
    beforeEach(() => {
      vi.stubGlobal(
        '__GetTemplateParts',
        vi.fn(() => ({ '0': {} })),
      );
    });

    it('throws when the snapshot has no page element', () => {
      vi.stubGlobal(
        '__GetPageElement',
        vi.fn(() => null),
      );
      expect(() => ssrHydrate('{"__opcodes":[]}')).toThrow(
        /SSR hydration failed: no page element from snapshot/,
      );
    });

    it('stashes hydration state on globals for the document to consume', () => {
      const nativePage = { _native: true };
      vi.stubGlobal(
        '__GetPageElement',
        vi.fn(() => nativePage),
      );

      ssrHydrate('{"__opcodes":[0,"0","view",1]}');

      expect((globalThis as any).__LYNX_IS_HYDRATING__).toBe(true);
      expect((globalThis as any).__LYNX_HYDRATE_PAGE__).toBe(nativePage);
      expect((globalThis as any).__LYNX_HYDRATE_QUEUE__).toEqual([
        'queued-element',
      ]);
    });
  });
});
