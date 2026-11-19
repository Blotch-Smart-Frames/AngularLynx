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
import { FlingGesture } from './fling-gesture';
import { RotationGesture } from './rotation-gesture';
import { FlingDirection, GestureType } from './types';

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

    it('sends { enabled: true } for a gesture with no options of its own', () => {
      // PinchGesture seeds no defaults of its own, but every gesture starts
      // from BaseGesture's, so a config is always sent.
      const g = new PinchGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      expect(config.config).toEqual({ enabled: true });
    });

    it('sends a fling option together with the defaults', () => {
      const g = new FlingGesture().direction(FlingDirection.LEFT);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      expect(config.config).toEqual({
        enabled: true,
        direction: FlingDirection.LEFT,
      });
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

    it('populates the simultaneous and continueWith arrays with dependency ids', () => {
      // Every branch of the relation-map .map() needs to iterate a non-empty
      // dependency list at least once so branch coverage flips on for
      // simultaneousWith and continueWith too.
      const g1 = new TapGesture();
      const g2 = new PanGesture();
      const g3 = new TapGesture();
      g1.simultaneousWith(g2);
      g1.continueWith(g3);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g1);

      const [, , , , relationMap] = setGestureDetector.mock.calls[0];
      expect(relationMap.simultaneous).toEqual([g2.id]);
      expect(relationMap.continueWith).toEqual([g3.id]);
    });

    it('marks the element non-flatten when it is created, before any gesture is bound', () => {
      // Android only gives an element a View of its own when it first draws
      // it, so a routed component's gesture, bound after that, never fired.
      createDirective(nativeEl);

      expect(setAttribute).toHaveBeenCalledWith(fakeRef, 'flatten', false);
      expect(setGestureDetector).not.toHaveBeenCalled();
    });

    it('marks nothing on an element with no native handle', () => {
      createDirective({});

      expect(setAttribute).not.toHaveBeenCalled();
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

    it('forwards non-start/end callbacks (onBegin) when the discrete gesture also has onEnd', () => {
      // In the discrete-gesture branch the special-case loop skips onStart/onEnd
      // and passes every other callback through the wrap() path. Cover both the
      // pass-through push and its downstream invocation.
      const g = new TapGesture();
      const onBegin = vi.fn();
      const onEnd = vi.fn();
      g.onBegin(onBegin).onEnd(onEnd);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      const [, , , config] = setGestureDetector.mock.calls[0];
      const names: string[] = config.callbacks.map(
        (c: { name: string }) => c.name,
      );
      expect(names).toContain('onBegin');

      fnFor('onBegin')({ params: {} });
      expect(onBegin).toHaveBeenCalledOnce();
    });
  });

  describe('onBegin for continuous gestures', () => {
    /**
     * The callback names sent in the most recent __SetGestureDetector call.
     */
    const registeredNames = (): string[] => {
      const [, , , config] = setGestureDetector.mock.lastCall!;
      return config.callbacks.map((c: { name: string }) => c.name);
    };

    /**
     * Fetches the wrapped native `_fn` for a callback by name from the most
     * recent __SetGestureDetector call.
     */
    const fnFor = (name: string): ((event: unknown) => void) => {
      const [, , , config] = setGestureDetector.mock.lastCall!;
      return config.callbacks.find((c: { name: string }) => c.name === name)
        .callback._fn;
    };

    it.each([
      ['pan', () => new PanGesture()],
      ['fling', () => new FlingGesture()],
      ['pinch', () => new PinchGesture()],
      ['rotation', () => new RotationGesture()],
    ])(
      'registers an empty onBegin on a %s that has none, so Lynx fires onStart and onEnd',
      (_name, create) => {
        const g = create().onStart(vi.fn()).onEnd(vi.fn());
        const directive = createDirective(nativeEl);

        applyGesture(directive, g);

        expect(registeredNames().sort()).toEqual([
          'onBegin',
          'onEnd',
          'onStart',
        ]);
        expect(() => fnFor('onBegin')({ params: {} })).not.toThrow();
      },
    );

    it('registers an onEnd on a pan that has none, so the next touch anchors afresh', () => {
      // An outer element's pan that loses the next touch to an inner one gets
      // only onTouchesDown, which anchors only once the last touch has ended.
      const onTouchesDown = vi.fn();
      const g = new PanGesture().onTouchesDown(onTouchesDown);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      expect(registeredNames().sort()).toEqual([
        'onBegin',
        'onEnd',
        'onTouchesDown',
      ]);
      fnFor('onBegin')({ params: { pageX: 10, pageY: 0 } });
      fnFor('onEnd')({ params: { pageX: 10, pageY: 0 } });
      // Measured from this touch, not the last one's x=10.
      fnFor('onTouchesDown')({ params: { pageX: 110, pageY: 0 } });
      expect(onTouchesDown.mock.lastCall![0].translationX).toBe(0);
    });

    it("keeps the user's own onBegin as the only one", () => {
      const onBegin = vi.fn();
      const g = new PanGesture().onBegin(onBegin).onEnd(vi.fn());
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onBegin')({ params: { pageX: 1, pageY: 2 } });

      expect(registeredNames().filter((n) => n === 'onBegin')).toHaveLength(1);
      expect(onBegin).toHaveBeenCalledOnce();
    });

    it('adds none to a discrete gesture, whose onStart and onEnd fire without it', () => {
      const g = new TapGesture().onStart(vi.fn());
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);

      expect(registeredNames()).toEqual(['onStart']);
    });

    it('measures translation from the touch-down, not from activation', () => {
      // Without a user onBegin, the translation used to anchor at onStart,
      // dropping the distance a pan with minDistance moves before activating.
      const onUpdate = vi.fn();
      const g = new PanGesture()
        .minDistance(20)
        .onStart(vi.fn())
        .onUpdate(onUpdate);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onBegin')({ params: { pageX: 10, pageY: 10 } });
      fnFor('onStart')({ params: { pageX: 31, pageY: 10 } });
      fnFor('onUpdate')({ params: { pageX: 50, pageY: 14 } });

      const [event] = onUpdate.mock.lastCall!;
      expect(event.translationX).toBe(40);
      expect(event.translationY).toBe(4);
    });

    it('measures each touch from its own start when no onEnd is registered', () => {
      // The origin used to reset only in a registered onEnd, so the next drag
      // was measured from the previous drag's start.
      const onUpdate = vi.fn();
      const g = new PanGesture().onUpdate(onUpdate);
      const directive = createDirective(nativeEl);

      applyGesture(directive, g);
      fnFor('onBegin')({ params: { pageX: 0, pageY: 0 } });
      fnFor('onUpdate')({ params: { pageX: 100, pageY: 0 } });
      fnFor('onBegin')({ params: { pageX: 500, pageY: 0 } });
      fnFor('onUpdate')({ params: { pageX: 510, pageY: 0 } });

      const [event] = onUpdate.mock.lastCall!;
      expect(event.translationX).toBe(10);
    });
  });

  describe('enabled and options set after binding', () => {
    const fnFor = (name: string): ((event: unknown) => void) => {
      const [, , , config] = setGestureDetector.mock.lastCall!;
      return config.callbacks.find((c: { name: string }) => c.name === name)
        .callback._fn;
    };

    it("doesn't register a disabled gesture, so it can't take a touch", () => {
      const pan = new PanGesture().enabled(false).onUpdate(vi.fn());
      const tap = new TapGesture();
      const directive = createDirective(nativeEl);

      applyGesture(directive, Gesture.Race(pan, tap));

      expect(setGestureDetector).toHaveBeenCalledOnce();
      expect(setGestureDetector.mock.lastCall![1]).toBe(tap.id);
    });

    it('unregisters a bound gesture when it is disabled, and registers it again when enabled', () => {
      const onUpdate = vi.fn();
      const pan = new PanGesture().onUpdate(onUpdate);
      const directive = createDirective(nativeEl);
      applyGesture(directive, pan);

      pan.enabled(false);

      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, pan.id);
      expect(setGestureDetector).toHaveBeenCalledOnce();

      pan.enabled(true);

      expect(setGestureDetector).toHaveBeenCalledTimes(2);
      expect(removeGestureDetector).toHaveBeenCalledOnce();
      fnFor('onUpdate')({ params: { pageX: 1, pageY: 1 } });
      expect(onUpdate).toHaveBeenCalledOnce();
    });

    it('runs nothing for events Lynx sent before it heard the gesture was disabled', () => {
      const onUpdate = vi.fn();
      const pan = new PanGesture().onUpdate(onUpdate);
      const directive = createDirective(nativeEl);
      applyGesture(directive, pan);
      const inFlight = fnFor('onUpdate');

      pan.enabled(false);
      inFlight({ params: { pageX: 1, pageY: 1 } });

      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('can be disabled from its own callback', () => {
      const pan = new PanGesture();
      pan.onEnd(() => pan.enabled(false));
      const directive = createDirective(nativeEl);
      applyGesture(directive, pan);

      fnFor('onEnd')({ params: {} });

      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, pan.id);
    });

    it('registers a gesture again, with the new option, when one changes after binding', () => {
      const tap = new TapGesture();
      const directive = createDirective(nativeEl);
      applyGesture(directive, tap);

      tap.maxDuration(900);

      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, tap.id);
      expect(setGestureDetector).toHaveBeenCalledTimes(2);
      expect(setGestureDetector.mock.lastCall![3].config).toMatchObject({
        maxDuration: 900,
      });
    });

    it('runs nothing for events Lynx sent to a registration an option change replaced', () => {
      const onStart = vi.fn();
      const tap = new TapGesture().onStart(onStart);
      const directive = createDirective(nativeEl);
      applyGesture(directive, tap);
      const stale = fnFor('onStart');

      tap.numberOfTaps(2);
      stale({ params: {} });

      expect(onStart).not.toHaveBeenCalled();
    });

    it("stops an event's remaining callbacks once one disables the gesture", () => {
      const onUpdate = vi.fn();
      const pan = new PanGesture().activeOffsetX(10).onUpdate(onUpdate);
      pan.onStart(() => pan.enabled(false));
      const directive = createDirective(nativeEl);
      applyGesture(directive, pan);

      fnFor('onBegin')({ params: { pageX: 0, pageY: 0 } });
      // Passes the active offset: routes onStart, then onUpdate.
      fnFor('onUpdate')({ params: { pageX: 11, pageY: 0 } });

      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, pan.id);
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('runs nothing for events Lynx sent before the gesture was unbound', () => {
      const onUpdate = vi.fn();
      const pan = new PanGesture().onUpdate(onUpdate);
      const directive = createDirective(nativeEl);
      applyGesture(directive, pan);
      const stale = fnFor('onUpdate');

      directive.ngOnDestroy();
      stale({ params: { pageX: 1, pageY: 1 } });

      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('registers a gesture on every element it is bound to', () => {
      const pan = new PanGesture();
      const otherRef = { _isRef: 'other' };
      applyGesture(createDirective(nativeEl), pan);
      applyGesture(createDirective({ element: otherRef }), pan);

      pan.minDistance(5);

      expect(removeGestureDetector).toHaveBeenCalledWith(fakeRef, pan.id);
      expect(removeGestureDetector).toHaveBeenCalledWith(otherRef, pan.id);
      expect(setGestureDetector).toHaveBeenCalledTimes(4);
    });

    it('stops following the options of a gesture it no longer binds', () => {
      const pan = new PanGesture();
      const directive = createDirective(nativeEl);
      applyGesture(directive, pan);
      applyGesture(directive, []);
      setGestureDetector.mockClear();
      removeGestureDetector.mockClear();

      pan.enabled(false).enabled(true);

      expect(setGestureDetector).not.toHaveBeenCalled();
      expect(removeGestureDetector).not.toHaveBeenCalled();
    });

    it("doesn't remove a disabled gesture again when unbound", () => {
      const pan = new PanGesture().enabled(false);
      const directive = createDirective(nativeEl);
      applyGesture(directive, pan);

      directive.ngOnDestroy();

      expect(removeGestureDetector).not.toHaveBeenCalled();
    });
  });

  describe("options Lynx doesn't read", () => {
    const registeredNames = (): string[] => {
      const [, , , config] = setGestureDetector.mock.lastCall!;
      return config.callbacks.map((c: { name: string }) => c.name);
    };

    const fnFor = (name: string): ((event: unknown) => void) => {
      const [, , , config] = setGestureDetector.mock.lastCall!;
      return config.callbacks.find((c: { name: string }) => c.name === name)
        .callback._fn;
    };

    it("registers the callbacks a pan's active offset needs, and starts it past the offset", () => {
      // Lynx's own fail(), through the state manager.
      const setGestureState = vi.fn();
      (globalThis as any).__SetGestureState = setGestureState;
      const onStart = vi.fn();
      const pan = new PanGesture()
        .activeOffsetX([-20, 20])
        .failOffsetY([-10, 10])
        .onStart(onStart);
      const directive = createDirective(nativeEl);

      applyGesture(directive, pan);

      expect(registeredNames().sort()).toEqual([
        'onBegin',
        'onEnd',
        'onStart',
        'onTouchesCancel',
        'onTouchesDown',
        'onTouchesUp',
        'onUpdate',
      ]);
      fnFor('onBegin')({ params: { pageX: 100, pageY: 100 } });
      fnFor('onStart')({ params: { pageX: 101, pageY: 100 } });
      expect(onStart).not.toHaveBeenCalled();
      fnFor('onUpdate')({ params: { pageX: 121, pageY: 100 } });
      expect(onStart).toHaveBeenCalledOnce();
      expect(onStart.mock.lastCall![0].translationX).toBe(21);

      // The next touch moves down first, and fails.
      fnFor('onBegin')({ params: { pageX: 0, pageY: 0 } });
      fnFor('onUpdate')({ params: { pageX: 0, pageY: 11 } });
      expect(setGestureState).toHaveBeenCalledWith(fakeRef, pan.id, 2);
      delete (globalThis as any).__SetGestureState;
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
