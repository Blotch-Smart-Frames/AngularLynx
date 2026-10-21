import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxGlobalExposure } from './global-exposure';
import { globalExposureBatches } from './global-exposure-bridge';

/**
 * Creates the service in an injection context, as the app's root injector
 * does, so the test can also destroy that injector.
 */
const create = (): { service: LynxGlobalExposure; injector: Injector } => {
  const injector = Injector.create({ providers: [] });
  return {
    service: runInInjectionContext(injector, () => new LynxGlobalExposure()),
    injector,
  };
};

describe('LynxGlobalExposure', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('when lynx is not defined', () => {
    it('initializes the signals to their defaults', () => {
      const { service } = create();

      expect(service.exposures()).toEqual([]);
      expect(service.disexposures()).toEqual([]);
      expect(service.active()).toBe(true);
    });

    it('does not throw when calling stopExposure', () => {
      expect(() => create().service.stopExposure()).not.toThrow();
    });

    it('does not throw when calling resumeExposure', () => {
      expect(() => create().service.resumeExposure()).not.toThrow();
    });

    it('does not throw when calling setObserverFrameRate', () => {
      expect(() => create().service.setObserverFrameRate()).not.toThrow();
    });
  });

  describe('exposure batches', () => {
    it('sets exposures from an exposure batch', () => {
      const { service } = create();
      const events = [{ 'exposure-id': 'a', 'exposure-scene': 's1' }];

      globalExposureBatches.next({ type: 'exposure', events } as any);

      expect(service.exposures()).toEqual(events);
      expect(service.disexposures()).toEqual([]);
    });

    it('sets disexposures from a disexposure batch', () => {
      const { service } = create();
      const events = [{ 'exposure-id': 'b', 'exposure-scene': 's2' }];

      globalExposureBatches.next({ type: 'disexposure', events } as any);

      expect(service.disexposures()).toEqual(events);
      expect(service.exposures()).toEqual([]);
    });

    it('replaces exposures with each new batch', () => {
      const { service } = create();

      globalExposureBatches.next({
        type: 'exposure',
        events: [{ 'exposure-id': 'a' }],
      } as any);
      globalExposureBatches.next({
        type: 'exposure',
        events: [{ 'exposure-id': 'b' }],
      } as any);

      expect(service.exposures()).toEqual([{ 'exposure-id': 'b' }]);
    });

    it('stops listening when its injector is destroyed', () => {
      const { service, injector } = create();

      (injector as unknown as { destroy(): void }).destroy();
      globalExposureBatches.next({
        type: 'exposure',
        events: [{ 'exposure-id': 'a' }],
      } as any);

      expect(service.exposures()).toEqual([]);
    });
  });

  describe('when lynx is defined', () => {
    let stopExposureMock: ReturnType<typeof vi.fn>;
    let resumeExposureMock: ReturnType<typeof vi.fn>;
    let setObserverFrameRateMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      stopExposureMock = vi.fn();
      resumeExposureMock = vi.fn();
      setObserverFrameRateMock = vi.fn();
      (globalThis as any).lynx = {
        stopExposure: stopExposureMock,
        resumeExposure: resumeExposureMock,
        setObserverFrameRate: setObserverFrameRateMock,
      };
    });

    it('stopExposure calls lynx.stopExposure with options', () => {
      create().service.stopExposure({ sendEvent: true });

      expect(stopExposureMock).toHaveBeenCalledWith({ sendEvent: true });
    });

    it('stopExposure sets active to false', () => {
      const { service } = create();

      service.stopExposure();

      expect(service.active()).toBe(false);
    });

    it('resumeExposure calls lynx.resumeExposure', () => {
      create().service.resumeExposure();

      expect(resumeExposureMock).toHaveBeenCalledOnce();
    });

    it('resumeExposure sets active to true', () => {
      const { service } = create();
      service.stopExposure();

      service.resumeExposure();

      expect(service.active()).toBe(true);
    });

    it('setObserverFrameRate calls lynx.setObserverFrameRate with options', () => {
      create().service.setObserverFrameRate({ forExposureCheck: 30 });

      expect(setObserverFrameRateMock).toHaveBeenCalledWith({
        forExposureCheck: 30,
      });
    });
  });
});
