import {
  type RendererType2,
  Injector,
  runInInjectionContext,
  ViewEncapsulation,
} from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxElement } from '../lynx-element';
import { InMemoryDocument } from '../testing/in-memory-document';
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
        useFactory: () => new InMemoryDocument(),
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

  it('marks each Emulated component host it is given', () => {
    const factory = createFactory();
    const type: RendererType2 = {
      id: 'comp1',
      encapsulation: ViewEncapsulation.Emulated,
      styles: [],
      data: {},
    };
    const first = new InMemoryDocument().createElement('view');
    const second = new InMemoryDocument().createElement('view');
    const spies = [first, second].map((host) =>
      vi.spyOn(host, 'addScopeClass'),
    );

    // Angular calls createRenderer once per component instance.
    factory.createRenderer(first, type);
    factory.createRenderer(second, type);

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledWith('_nghost-comp1');
    }
  });

  it('treats experimental isolated ShadowDom like ShadowDom', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = createFactory();
    const renderer = factory.createRenderer(null, {
      id: 'comp1',
      // ViewEncapsulation.ExperimentalIsolatedShadowDom
      encapsulation: 4 as ViewEncapsulation,
      styles: [],
      data: {},
    });

    expect(renderer).not.toBeInstanceOf(EmulatedLynxRenderer);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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

    it('flushes the element tree when the first render has completed', () => {
      // Steady-state path: __FlushElementTree is called after the removal /
      // normalization drains.
      vi.stubGlobal('__FlushElementTree', vi.fn());
      // First-render latch is module-scoped in lynx-render-lifecycle; this
      // spec never bootstraps, so flip it manually to enter the steady-state
      // branch.
      markFirstRenderComplete();

      const factory = createFactory();
      factory.end?.();

      expect(globalThis.__FlushElementTree).toHaveBeenCalledTimes(1);
    });

    it("sends the cycle's attribute removals before the flush", () => {
      // Lynx applies a removal after a value set in the same flush, so the
      // elements hold their removals until now (see LynxElement).
      const order: string[] = [];
      vi.stubGlobal(
        '__FlushElementTree',
        vi.fn(() => order.push('flush')),
      );
      const commit = vi
        .spyOn(LynxElement, 'commitPendingAttributeRemovals')
        .mockImplementation(() => {
          order.push('removals');
        });
      markFirstRenderComplete();

      createFactory().end?.();

      expect(order).toEqual(['removals', 'flush']);
      commit.mockRestore();
    });

    it('skips the flush while the first render is still pending', async () => {
      // First-render window: driving __FlushElementTree here would re-enter
      // native from inside the still-unwinding renderPage() call. The guard
      // in end() drains removals/text normalization directly (mutating native
      // elements) but does not call the flush; native performs its own once
      // renderPage returns.
      vi.resetModules();
      vi.stubGlobal('__FlushElementTree', vi.fn());
      const { LynxRendererFactory2: FreshFactory } =
        await import('./lynx-renderer-factory2');
      const { InMemoryDocument: FreshDoc } =
        await import('../testing/in-memory-document');
      const { LYNX_DOCUMENT: FRESH_LYNX_DOCUMENT } = await import('./token');

      const injector = Injector.create({
        providers: [
          {
            provide: FRESH_LYNX_DOCUMENT,
            useFactory: () => new FreshDoc(),
          },
        ],
      });
      const factory = runInInjectionContext(injector, () => new FreshFactory());
      factory.end?.();

      expect(globalThis.__FlushElementTree).not.toHaveBeenCalled();
    });
  });
});
