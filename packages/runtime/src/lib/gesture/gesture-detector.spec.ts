import {
  type SimpleChanges,
  ElementRef,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxGestureDetector } from './gesture-detector';
import { Gesture } from './composition';
import { TapGesture } from './tap-gesture';
import { PanGesture } from './pan-gesture';
import { PinchGesture } from './pinch-gesture';
import { LongPressGesture } from './long-press-gesture';
import { GestureType } from './types';

/**
 * Builds a directive instance with a fake element injected via DI.
 */
const createDirective = (nativeElement: object): LynxGestureDetector => {
  const injector = Injector.create({
    providers: [
      { provide: ElementRef, useValue: new ElementRef(nativeElement) },
    ],
  });
  return runInInjectionContext(injector, () => new LynxGestureDetector());
};

/**
 * Simulates Angular's change detection call after an input is set.
 */
const applyGesture = (
  directive: LynxGestureDetector,
  gesture: LynxGestureDetector['lynxGesture'],
): void => {
  directive.lynxGesture = gesture;
  directive.ngOnChanges({} as SimpleChanges);
};

describe('LynxGestureDetector', () => {
  const fakeRef = { _isRef: true };
  let nativeEl: { element: typeof fakeRef };
  let setGestureDetector: ReturnType<typeof vi.fn>;
  let removeGestureDetector: ReturnType<typeof vi.fn>;
  let setAttribute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nativeEl = { element: fakeRef };
    setGestureDetector = vi.fn();
    removeGestureDetector = vi.fn();
    setAttribute = vi.fn();
    (globalThis as any).__SetGestureDetector = setGestureDetector;
    (globalThis as any).__RemoveGestureDetector = removeGestureDetector;
    // The directive sets `flatten: false` so the element gets its own native
    // layer (a flattened view can't receive gestures) — stub it here.
    (globalThis as any).__SetAttribute = setAttribute;
  });

  afterEach(() => {
    delete (globalThis as any).__SetGestureDetector;
    delete (globalThis as any).__RemoveGestureDetector;
    delete (globalThis as any).__SetAttribute;
  });

  describe('resolving gestures', () => {
    it('attaches a single gesture passed directly', () => {
      const g = new TapGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      expect(setGestureDetector).toHaveBeenCalledOnce();
      expect(setGestureDetector).toHaveBeenCalledWith(
        fakeRef,
        g.id,
        GestureType.TAP,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('attaches all gestures passed as an array', () => {
      const g1 = new TapGesture();
      const g2 = new PanGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, [g1, g2]);

      expect(setGestureDetector).toHaveBeenCalledTimes(2);
      expect(setGestureDetector).toHaveBeenCalledWith(
        fakeRef,
        g1.id,
        GestureType.TAP,
        expect.any(Object),
        expect.any(Object),
      );
      expect(setGestureDetector).toHaveBeenCalledWith(
        fakeRef,
        g2.id,
        GestureType.PAN,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('attaches all gestures from a ComposedGesture', () => {
      const g1 = new TapGesture();
      const g2 = new PanGesture();
      const composed = Gesture.Race(g1, g2);
      const directive = createDirective(nativeEl);

      applyGesture(directive, composed);

      expect(setGestureDetector).toHaveBeenCalledTimes(2);
    });

    it('attaches nothing when lynxGesture is falsy', () => {
      const directive = createDirective(nativeEl);

      directive.lynxGesture = null as any;
      directive.ngOnChanges({} as SimpleChanges);

      expect(setGestureDetector).not.toHaveBeenCalled();
    });
  });

  describe('ngOnChanges', () => {
    it('passes the gesture type to __SetGestureDetector', () => {
      const g = new PanGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , type] = setGestureDetector.mock.calls[0];
      expect(type).toBe(GestureType.PAN);
    });

    it('passes callbacks in the config object', () => {
      const g = new TapGesture();
      const cb = vi.fn();
      g.onBegin(cb);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      expect(config.callbacks).toHaveLength(1);
      expect(config.callbacks[0].name).toBe('onBegin');
    });

    it('wraps each callback as a { _fn } object (fiber arch needs lepus_object_)', () => {
      // A raw function callback lands in the native GestureCallback.lepus_function_
      // slot, which fiber-arch dispatch ignores — so the callback MUST be an
      // object. Passing a plain function here is the bug that made every gesture
      // silently no-op.
      const g = new TapGesture();
      g.onBegin(vi.fn());
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      expect(typeof config.callbacks[0].callback).toBe('object');
      expect(typeof config.callbacks[0].callback._fn).toBe('function');
    });

    it('passes a mapped event (with derived translation) and a GestureStateManager', () => {
      const g = new PanGesture();
      const cb = vi.fn();
      g.onUpdate(cb);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      const fire = config.callbacks[0].callback._fn;

      // Native delivers a nested envelope with the finger position under `params`
      // (pageX/pageY). Translation is derived from the first event's origin.
      fire({ params: { pageX: 5, pageY: 6 } }); // anchors the origin
      fire({ params: { pageX: 25, pageY: 16 } }); // moved +20, +10

      expect(cb).toHaveBeenCalledTimes(2);
      const [event, stateManager] = cb.mock.calls[1];
      expect(event.absoluteX).toBe(25);
      expect(event.absoluteY).toBe(16);
      expect(event.translationX).toBe(20);
      expect(event.translationY).toBe(10);
      expect(stateManager).toEqual(expect.any(Object));
    });

    it('passes undefined for config when gesture has no config', () => {
      // PinchGesture seeds no defaults, so its config stays empty — unlike
      // Tap/LongPress/Pan which always carry a full default config.
      const g = new PinchGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      expect(config.config).toBeUndefined();
    });

    it('passes the full config object (defaults merged with overrides)', () => {
      const g = new TapGesture().numberOfTaps(2);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      // Defaults are always present so iOS never reads a missing key as 0.
      expect(config.config).toEqual({
        enabled: true,
        maxDuration: 500,
        maxDistance: 10,
        numberOfTaps: 2,
      });
    });

    it('passes relation map IDs derived from waitFor, simultaneousWith, continueWith', () => {
      const g1 = new TapGesture();
      const g2 = new PanGesture();
      g1.waitFor(g2);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g1);

      const [, , , , relationMap] = setGestureDetector.mock.calls[0];
      expect(relationMap.waitFor).toEqual([g2.id]);
      expect(relationMap.simultaneous).toEqual([]);
      expect(relationMap.continueWith).toEqual([]);
    });

    it('marks the element non-flatten so it can receive gestures', () => {
      const g = new TapGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      expect(setAttribute).toHaveBeenCalledWith(fakeRef, 'flatten', false);
    });

    it('detaches old gestures before attaching new ones on subsequent changes', () => {
      const g1 = new TapGesture();
      const g2 = new PanGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g1);
      applyGesture(directive, g2);

      // g1 should have been removed before g2 was attached
      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, g1.id);
      expect(setGestureDetector).toHaveBeenCalledTimes(2);
    });
  });

  describe('onEnd normalization (discrete gestures)', () => {
    /**
     * Fetches the wrapped native `_fn` for a callback by name from the most
     * recent __SetGestureDetector call.
     */
    const fnFor = (name: string): ((event: unknown) => void) => {
      const [, , , config] = setGestureDetector.mock.calls[0];
      return config.callbacks.find((c: { name: string }) => c.name === name)
        .callback._fn;
    };

    it('suppresses onEnd for a failed tap (onEnd with no preceding onStart)', () => {
      // Lynx fires the native onEnd on failure too; without a prior onStart the
      // tap was never recognized, so the user callback must NOT fire.
      const g = new TapGesture();
      const onEnd = vi.fn();
      g.onEnd(onEnd);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onEnd')({ params: {} });

      expect(onEnd).not.toHaveBeenCalled();
    });

    it('delivers onEnd for a recognized tap (onStart then onEnd)', () => {
      const g = new TapGesture();
      const onEnd = vi.fn();
      g.onEnd(onEnd);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onStart')({ params: {} }); // native reports recognition
      fnFor('onEnd')({ params: {} });

      expect(onEnd).toHaveBeenCalledOnce();
    });

    it('resets recognition between cycles (a later failed tap is suppressed)', () => {
      const g = new TapGesture();
      const onEnd = vi.fn();
      g.onEnd(onEnd);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onStart')({ params: {} });
      fnFor('onEnd')({ params: {} }); // recognized → delivered
      fnFor('onEnd')({ params: {} }); // next cycle, failed → suppressed

      expect(onEnd).toHaveBeenCalledOnce();
    });

    it('registers an onStart observer even when the user only set onEnd', () => {
      const g = new TapGesture();
      g.onEnd(vi.fn());
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      const names = config.callbacks.map((c: { name: string }) => c.name);
      expect(names).toContain('onStart');
      expect(names).toContain('onEnd');
    });

    it('forwards the user onStart while also observing recognition (no duplicate onStart entry)', () => {
      const g = new TapGesture();
      const onStart = vi.fn();
      const onEnd = vi.fn();
      g.onStart(onStart).onEnd(onEnd);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onStart')({ params: {} });
      fnFor('onEnd')({ params: {} });

      expect(onStart).toHaveBeenCalledOnce();
      expect(onEnd).toHaveBeenCalledOnce();
      const [, , , config] = setGestureDetector.mock.calls[0];
      expect(
        config.callbacks.filter((c: { name: string }) => c.name === 'onStart'),
      ).toHaveLength(1);
    });

    it('normalizes long-press too (suppresses onEnd with no onStart)', () => {
      const g = new LongPressGesture();
      const onEnd = vi.fn();
      g.onEnd(onEnd);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onEnd')({ params: {} });

      expect(onEnd).not.toHaveBeenCalled();
    });

    it('does NOT normalize continuous gestures — pan onEnd fires without onStart', () => {
      const g = new PanGesture();
      const onEnd = vi.fn();
      g.onEnd(onEnd);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onEnd')({ params: {} });

      expect(onEnd).toHaveBeenCalledOnce();
    });
  });

  describe('ngOnDestroy', () => {
    it('removes all attached gesture detectors', () => {
      const g1 = new TapGesture();
      const g2 = new PanGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, [g1, g2]);
      directive.ngOnDestroy();

      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, g1.id);
      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, g2.id);
    });

    it('clears the attached ID list so a second destroy is a no-op', () => {
      const g = new TapGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      directive.ngOnDestroy();
      directive.ngOnDestroy();

      // Only called once — the second destroy has nothing to remove.
      expect(removeGestureDetector).toHaveBeenCalledTimes(1);
    });

    it('does not throw when __RemoveGestureDetector throws (element already destroyed)', () => {
      removeGestureDetector.mockImplementation(() => {
        throw new Error('native element gone');
      });
      const g = new TapGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      expect(() => directive.ngOnDestroy()).not.toThrow();
    });
  });

  describe('missing element reference', () => {
    it('skips attachment when nativeElement has no .element property', () => {
      // nativeElement without .element — directive will skip the attach.
      const directive = createDirective({});
      const g = new TapGesture();

      applyGesture(directive, g);

      expect(setGestureDetector).not.toHaveBeenCalled();
    });

    it('skips detach in ngOnDestroy when nativeElement has no .element property', () => {
      const directive = createDirective({});
      const g = new TapGesture();

      applyGesture(directive, g);

      expect(() => directive.ngOnDestroy()).not.toThrow();
      expect(removeGestureDetector).not.toHaveBeenCalled();
    });
  });
});
