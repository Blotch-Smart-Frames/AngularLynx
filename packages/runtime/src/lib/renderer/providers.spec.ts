import '@angular/compiler';
import { APP_BASE_HREF, IMAGE_CONFIG } from '@angular/common';
import {
  DOCUMENT,
  ErrorHandler,
  inject,
  Injector,
  RendererFactory2,
  runInInjectionContext,
} from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxErrorHandler } from '../error-handler/lynx-error-handler';
import { LynxBackgroundDocument, LynxDocument } from '../lynx-document';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { provideRenderer } from './providers';
import { LYNX_DOCUMENT } from './token';

const createInjector = () =>
  Injector.create({ providers: [provideRenderer()] });

describe('provideRenderer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('LYNX_DOCUMENT', () => {
    it('provides LynxDocument on the main thread', () => {
      vi.stubGlobal('__MAIN_THREAD__', true);
      const injector = createInjector();

      const doc = injector.get(LYNX_DOCUMENT);

      expect(doc).toBeInstanceOf(LynxDocument);
    });

    it('provides LynxBackgroundDocument on the background thread', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const doc = injector.get(LYNX_DOCUMENT);

      expect(doc).toBeInstanceOf(LynxBackgroundDocument);
    });
  });

  describe('DOCUMENT', () => {
    it('provides an empty object as DOCUMENT', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const doc = injector.get(DOCUMENT);

      expect(doc).toEqual({});
    });
  });

  describe('APP_BASE_HREF', () => {
    it('provides "/" as APP_BASE_HREF', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const baseHref = injector.get(APP_BASE_HREF);

      expect(baseHref).toBe('/');
    });
  });

  describe('IMAGE_CONFIG', () => {
    it('disables both image performance warnings so ImagePerformanceWarning.start() never reaches getDocument()', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const config = injector.get(IMAGE_CONFIG);

      // Both must be true: ImagePerformanceWarning only early-returns when
      // disableImageSizeWarning AND disableImageLazyLoadWarning are set.
      expect(config.disableImageSizeWarning).toBe(true);
      expect(config.disableImageLazyLoadWarning).toBe(true);
    });
  });

  describe('RendererFactory2', () => {
    it('provides LynxRendererFactory2 as RendererFactory2', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const factory = injector.get(RendererFactory2);

      expect(factory).toBeInstanceOf(LynxRendererFactory2);
    });

    it('RendererFactory2 and LynxRendererFactory2 tokens resolve to the same instance', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const viaToken = injector.get(RendererFactory2);
      const viaClass = runInInjectionContext(injector, () =>
        inject(LynxRendererFactory2),
      );

      expect(viaToken).toBe(viaClass);
    });
  });

  describe('ErrorHandler', () => {
    it('provides LynxErrorHandler as ErrorHandler', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const handler = injector.get(ErrorHandler);

      expect(handler).toBeInstanceOf(LynxErrorHandler);
    });
  });
});
