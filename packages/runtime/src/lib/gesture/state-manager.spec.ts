import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureStateManager } from './state-manager';

describe('GestureStateManager', () => {
  const fakeElement = {} as any;
  const gestureId = 42;
  let setGestureState: ReturnType<typeof vi.fn>;
  let consumeGesture: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setGestureState = vi.fn();
    consumeGesture = vi.fn();
    (globalThis as any).__SetGestureState = setGestureState;
    (globalThis as any).__ConsumeGesture = consumeGesture;
  });

  afterEach(() => {
    delete (globalThis as any).__SetGestureState;
    delete (globalThis as any).__ConsumeGesture;
  });

  describe('fail()', () => {
    it('calls __SetGestureState with state code 2', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.fail();

      expect(setGestureState).toHaveBeenCalledWith(fakeElement, gestureId, 2);
    });
  });

  describe('activate()', () => {
    it('calls __SetGestureState with state code 1', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.activate();

      expect(setGestureState).toHaveBeenCalledWith(fakeElement, gestureId, 1);
    });
  });

  describe('end()', () => {
    it('calls __SetGestureState with state code 3', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.end();

      expect(setGestureState).toHaveBeenCalledWith(fakeElement, gestureId, 3);
    });
  });

  describe('consumeGesture()', () => {
    it('defaults consume to true', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.consumeGesture();

      expect(consumeGesture).toHaveBeenCalledWith(fakeElement, gestureId, {
        consume: true,
      });
    });

    it('passes consume: true when called with true', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.consumeGesture(true);

      expect(consumeGesture).toHaveBeenCalledWith(fakeElement, gestureId, {
        consume: true,
      });
    });

    it('passes consume: false when called with false', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.consumeGesture(false);

      expect(consumeGesture).toHaveBeenCalledWith(fakeElement, gestureId, {
        consume: false,
      });
    });
  });

  describe('interceptGesture()', () => {
    it('defaults inner to true', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.interceptGesture();

      expect(consumeGesture).toHaveBeenCalledWith(fakeElement, gestureId, {
        inner: true,
      });
    });

    it('passes inner: true when called with true', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.interceptGesture(true);

      expect(consumeGesture).toHaveBeenCalledWith(fakeElement, gestureId, {
        inner: true,
      });
    });

    it('passes inner: false when called with false', () => {
      const manager = new GestureStateManager(fakeElement, gestureId);

      manager.interceptGesture(false);

      expect(consumeGesture).toHaveBeenCalledWith(fakeElement, gestureId, {
        inner: false,
      });
    });
  });

  it('uses the element and gestureId passed to the constructor for every call', () => {
    const el1 = { ref: 'a' } as any;
    const el2 = { ref: 'b' } as any;
    const m1 = new GestureStateManager(el1, 1);
    const m2 = new GestureStateManager(el2, 2);

    m1.fail();
    m2.activate();

    expect(setGestureState).toHaveBeenCalledWith(el1, 1, 2);
    expect(setGestureState).toHaveBeenCalledWith(el2, 2, 1);
  });
});
