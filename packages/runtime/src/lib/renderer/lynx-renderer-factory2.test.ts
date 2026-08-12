import {
  type RendererType2,
  Injector,
  runInInjectionContext,
  ViewEncapsulation,
} from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxBackgroundDocument } from '../lynx-document';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import { EmulatedLynxRenderer } from './emulated-lynx-renderer';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LynxRenderer } from './renderer';
import { LYNX_DOCUMENT } from './token';

const createFactory = () => {
  const injector = Injector.create({
    providers: [
      {
        provide: LYNX_DOCUMENT,
        useFactory: () => new LynxBackgroundDocument(),
      },
    ],
  });
  return runInInjectionContext(injector, () => new LynxRendererFactory2());
};

describe('LynxRendererFactory2', () => {
  it('returns LynxRenderer when type is null', () => {
    const factory = createFactory();
    const renderer = factory.createRenderer(null, null);

    expect(renderer).toBeInstanceOf(LynxRenderer);
  });

  it('returns LynxRenderer for ViewEncapsulation.None', () => {
    const factory = createFactory();
    const type: RendererType2 = {
      id: 'comp1',
      encapsulation: ViewEncapsulation.None,
      styles: [],
      data: {},
    };
    const renderer = factory.createRenderer(null, type);

    expect(renderer).toBeInstanceOf(LynxRenderer);
    expect(renderer).not.toBeInstanceOf(EmulatedLynxRenderer);
  });

  it('returns EmulatedLynxRenderer for ViewEncapsulation.Emulated', () => {
    const factory = createFactory();
    const type: RendererType2 = {
      id: 'comp1',
      encapsulation: ViewEncapsulation.Emulated,
      styles: [],
      data: {},
    };
    const renderer = factory.createRenderer(null, type);

    expect(renderer).toBeInstanceOf(EmulatedLynxRenderer);
  });

  it('caches default renderer across calls', () => {
    const factory = createFactory();
    const r1 = factory.createRenderer(null, null);
    const r2 = factory.createRenderer(null, null);

    expect(r1).toBe(r2);
  });

  it('caches emulated renderers by component ID', () => {
    const factory = createFactory();
    const type: RendererType2 = {
      id: 'comp1',
      encapsulation: ViewEncapsulation.Emulated,
      styles: [],
      data: {},
    };
    const r1 = factory.createRenderer(null, type);
    const r2 = factory.createRenderer(null, type);

    expect(r1).toBe(r2);
  });

  it('returns different emulated renderers for different component IDs', () => {
    const factory = createFactory();
    const type1: RendererType2 = {
      id: 'comp1',
      encapsulation: ViewEncapsulation.Emulated,
      styles: [],
      data: {},
    };
    const type2: RendererType2 = {
      id: 'comp2',
      encapsulation: ViewEncapsulation.Emulated,
      styles: [],
      data: {},
    };
    const r1 = factory.createRenderer(null, type1);
    const r2 = factory.createRenderer(null, type2);

    expect(r1).not.toBe(r2);
    expect(r1).toBeInstanceOf(EmulatedLynxRenderer);
    expect(r2).toBeInstanceOf(EmulatedLynxRenderer);
  });

  it('returns default renderer for ViewEncapsulation.ShadowDom with warning', () => {
    const factory = createFactory();
    const type: RendererType2 = {
      id: 'comp1',
      encapsulation: ViewEncapsulation.ShadowDom,
      styles: [],
      data: {},
    };
    const renderer = factory.createRenderer(null, type);

    expect(renderer).toBeInstanceOf(LynxRenderer);
    expect(renderer).not.toBeInstanceOf(EmulatedLynxRenderer);
  });

  it('reuses the cached default renderer for repeated ShadowDom requests', () => {
    // The ShadowDom fallback path also gates on `!this.#defaultRenderer`; the
    // second call must reuse the cached instance rather than construct a new
    // one (covers the else branch of that guard).
    const factory = createFactory();
    const type: RendererType2 = {
      id: 'shadow',
      encapsulation: ViewEncapsulation.ShadowDom,
      styles: [],
      data: {},
    };
    const r1 = factory.createRenderer(null, type);
    const r2 = factory.createRenderer(null, type);

    expect(r1).toBe(r2);
  });

  it('reuses the same default renderer across None → ShadowDom → None calls', () => {
    // The two `if (!this.#defaultRenderer)` gates funnel to one shared cache, so
    // switching encapsulation mode must not mint a second default renderer.
    const factory = createFactory();
    const none: RendererType2 = {
      id: 'none',
      encapsulation: ViewEncapsulation.None,
      styles: [],
      data: {},
    };
    const shadow: RendererType2 = {
      id: 'shadow',
      encapsulation: ViewEncapsulation.ShadowDom,
      styles: [],
      data: {},
    };
    const rNone1 = factory.createRenderer(null, none);
    const rShadow = factory.createRenderer(null, shadow);
    const rNone2 = factory.createRenderer(null, none);

    expect(rNone1).toBe(rShadow);
    expect(rNone1).toBe(rNone2);
  });

  describe('end() lifecycle', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('is a no-op on the background thread (no native flush)', () => {
      // The whole __MAIN_THREAD__ block is skipped when the renderer runs on
      // the background thread — no removals commit, no flush, no list-info
      // update. Covers the else path of the outer main-thread guard.
      vi.stubGlobal('__MAIN_THREAD__', false);
      vi.stubGlobal('__FlushElementTree', vi.fn());

      const factory = createFactory();
      expect(() => factory.end?.()).not.toThrow();
      expect(globalThis.__FlushElementTree).not.toHaveBeenCalled();
    });

    it('flushes the element tree when the first render has completed', () => {
      // Steady-state main-thread path: __FlushElementTree is called after the
      // removal / normalization drains.
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('__FlushElementTree', vi.fn());
      // First-render latch is module-scoped in lynx-render-lifecycle; this
      // spec never bootstraps, so flip it manually to enter the steady-state
      // branch.
      markFirstRenderComplete();

      const factory = createFactory();
      factory.end?.();

      expect(globalThis.__FlushElementTree).toHaveBeenCalledTimes(1);
    });

    it('skips the flush while the first render is still pending', async () => {
      // First-render window: driving __FlushElementTree here would re-enter
      // native from inside the still-unwinding renderPage() call. The guard
      // in end() drains removals/text normalization directly (mutating native
      // elements) but does not call the flush; native performs its own once
      // renderPage returns.
      vi.resetModules();
      vi.stubGlobal('__MAIN_THREAD__', true);
      vi.stubGlobal('__FlushElementTree', vi.fn());
      const { LynxRendererFactory2: FreshFactory } = await import(
        './lynx-renderer-factory2'
      );
      const { LynxBackgroundDocument: FreshDoc } = await import(
        '../lynx-document'
      );
      const { LYNX_DOCUMENT: FRESH_LYNX_DOCUMENT } = await import('./token');

      const injector = Injector.create({
        providers: [
          {
            provide: FRESH_LYNX_DOCUMENT,
            useFactory: () => new FreshDoc(),
          },
        ],
      });
      const factory = runInInjectionContext(
        injector,
        () => new FreshFactory(),
      );
      factory.end?.();

      expect(globalThis.__FlushElementTree).not.toHaveBeenCalled();
    });
  });
});
