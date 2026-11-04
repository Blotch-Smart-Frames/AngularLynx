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
import { LynxDocument } from '../lynx-document';
import { ɵDomRendererFactory2 } from '@angular/platform-browser';
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
    it('provides LynxDocument', () => {
      const injector = createInjector();

      const doc = injector.get(LYNX_DOCUMENT);

      expect(doc).toBeInstanceOf(LynxDocument);
    });
  });

  describe('DOCUMENT', () => {
    it('provides a stub DOCUMENT that has no elements to look up', () => {
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();

      const doc = injector.get(DOCUMENT);

      // TransferState's factory looks up Angular SSR's `<script id="ng-state">`
      // via getElementById; Lynx never has one, so it must exist and say so.
      expect(Object.keys(doc)).toEqual(['getElementById', 'defaultView']);
      expect(doc.getElementById('ng-state')).toBeNull();
      // The window, where code that measures elements (ngxtension's resize
      // directive, which angular-three sizes its canvas with) looks for
      // ResizeObserver.
      expect(doc.defaultView).toBe(globalThis);
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

  describe('ɵDomRendererFactory2', () => {
    it('is the Lynx factory, for libraries that wrap the DOM renderer', () => {
      // angular-three's provideNgtRenderer() wraps whatever this resolves to.
      vi.stubGlobal('__MAIN_THREAD__', false);
      const injector = createInjector();
      expect(injector.get(ɵDomRendererFactory2)).toBe(
        injector.get(LynxRendererFactory2),
      );
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
