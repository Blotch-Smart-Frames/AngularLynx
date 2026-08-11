import {
  type RendererType2,
  Injector,
  runInInjectionContext,
  ViewEncapsulation,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { LynxBackgroundDocument } from '../lynx-document';
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
});
