import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxGlobalExposure } from './global-exposure';

describe('LynxGlobalExposure', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
    (globalThis as any).__MAIN_THREAD__ = false;
  });

  describe('when lynx is not defined', () => {
    it('initializes exposures to an empty array', () => {
      const service = new LynxGlobalExposure();

      expect(service.exposures()).toEqual([]);
    });

    it('initializes disexposures to an empty array', () => {
      const service = new LynxGlobalExposure();

      expect(service.disexposures()).toEqual([]);
    });

    it('initializes active to true', () => {
      const service = new LynxGlobalExposure();

      expect(service.active()).toBe(true);
    });

    it('does not throw when constructing without a lynx global', () => {
      expect(() => new LynxGlobalExposure()).not.toThrow();
    });

    it('does not throw when calling stopExposure', () => {
      const service = new LynxGlobalExposure();

      expect(() => service.stopExposure()).not.toThrow();
    });

    it('does not throw when calling resumeExposure', () => {
      const service = new LynxGlobalExposure();

      expect(() => service.resumeExposure()).not.toThrow();
    });

    it('does not throw when calling setObserverFrameRate', () => {
      const service = new LynxGlobalExposure();

      expect(() => service.setObserverFrameRate()).not.toThrow();
    });
  });

  describe('on the main thread (__MAIN_THREAD__ = true)', () => {
    beforeEach(() => {
      (globalThis as any).__MAIN_THREAD__ = true;
      (globalThis as any).lynx = {
        getJSModule: vi.fn().mockReturnValue({ addListener: vi.fn() }),
        stopExposure: vi.fn(),
        resumeExposure: vi.fn(),
        setObserverFrameRate: vi.fn(),
      };
    });

    it('does not register GlobalEventEmitter listeners', () => {
      const service = new LynxGlobalExposure();

      expect((globalThis as any).lynx.getJSModule).not.toHaveBeenCalled();
      expect(service.exposures()).toEqual([]);
    });
  });

  describe('when lynx is defined but GlobalEventEmitter is not available', () => {
    beforeEach(() => {
      (globalThis as any).lynx = {
        getJSModule: vi.fn().mockReturnValue(null),
        stopExposure: vi.fn(),
        resumeExposure: vi.fn(),
        setObserverFrameRate: vi.fn(),
      };
    });

    it('does not throw when getJSModule returns null', () => {
      expect(() => new LynxGlobalExposure()).not.toThrow();
    });

    it('initializes signals to defaults', () => {
      const service = new LynxGlobalExposure();

      expect(service.exposures()).toEqual([]);
      expect(service.disexposures()).toEqual([]);
      expect(service.active()).toBe(true);
    });
  });

  describe('when lynx is defined (background thread)', () => {
    let addListener: ReturnType<typeof vi.fn>;
    let getJSModule: ReturnType<typeof vi.fn>;
    let stopExposureMock: ReturnType<typeof vi.fn>;
    let resumeExposureMock: ReturnType<typeof vi.fn>;
    let setObserverFrameRateMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      (globalThis as any).__MAIN_THREAD__ = false;
      addListener = vi.fn();
      getJSModule = vi.fn().mockReturnValue({ addListener });
      stopExposureMock = vi.fn();
      resumeExposureMock = vi.fn();
      setObserverFrameRateMock = vi.fn();
      (globalThis as any).lynx = {
        getJSModule,
        stopExposure: stopExposureMock,
        resumeExposure: resumeExposureMock,
        setObserverFrameRate: setObserverFrameRateMock,
      };
    });

    it('calls getJSModule with "GlobalEventEmitter"', () => {
      new LynxGlobalExposure();

      expect(getJSModule).toHaveBeenCalledWith('GlobalEventEmitter');
    });

    it('registers a listener for the "exposure" event', () => {
      new LynxGlobalExposure();

      expect(addListener).toHaveBeenCalledWith(
        'exposure',
        expect.any(Function),
      );
    });

    it('registers a listener for the "disexposure" event', () => {
      new LynxGlobalExposure();

      expect(addListener).toHaveBeenCalledWith(
        'disexposure',
        expect.any(Function),
      );
    });

    it('updates exposures signal when the exposure listener fires', () => {
      const service = new LynxGlobalExposure();
      const exposureListener = addListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'exposure',
      )![1] as (...args: unknown[]) => void;
      const batch = [{ 'exposure-id': 'a', 'exposure-scene': 's1' }];

      exposureListener(batch);

      expect(service.exposures()).toEqual(batch);
    });

    it('updates disexposures signal when the disexposure listener fires', () => {
      const service = new LynxGlobalExposure();
      const disexposureListener = addListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'disexposure',
      )![1] as (...args: unknown[]) => void;
      const batch = [{ 'exposure-id': 'b', 'exposure-scene': 's2' }];

      disexposureListener(batch);

      expect(service.disexposures()).toEqual(batch);
    });

    it('replaces exposures entirely on each successive update', () => {
      const service = new LynxGlobalExposure();
      const listener = addListener.mock.calls.find(
        (c: unknown[]) => c[0] === 'exposure',
      )![1] as (...args: unknown[]) => void;

      listener([{ 'exposure-id': 'a' }]);
      listener([{ 'exposure-id': 'b' }]);

      expect(service.exposures()).toEqual([{ 'exposure-id': 'b' }]);
    });

    it('stopExposure calls lynx.stopExposure with options', () => {
      const service = new LynxGlobalExposure();

      service.stopExposure({ sendEvent: true });

      expect(stopExposureMock).toHaveBeenCalledWith({ sendEvent: true });
    });

    it('stopExposure sets active to false', () => {
      const service = new LynxGlobalExposure();

      service.stopExposure();

      expect(service.active()).toBe(false);
    });

    it('resumeExposure calls lynx.resumeExposure', () => {
      const service = new LynxGlobalExposure();

      service.resumeExposure();

      expect(resumeExposureMock).toHaveBeenCalledOnce();
    });

    it('resumeExposure sets active to true', () => {
      const service = new LynxGlobalExposure();
      service.stopExposure();

      service.resumeExposure();

      expect(service.active()).toBe(true);
    });

    it('setObserverFrameRate calls lynx.setObserverFrameRate with options', () => {
      const service = new LynxGlobalExposure();

      service.setObserverFrameRate({ forExposureCheck: 30 });

      expect(setObserverFrameRateMock).toHaveBeenCalledWith({
        forExposureCheck: 30,
      });
    });
  });
});
