import '@angular/compiler';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LynxLocationStrategy } from './lynx-location-strategy';

describe('LynxLocationStrategy', () => {
  let strategy: LynxLocationStrategy;

  beforeEach(() => {
    strategy = new LynxLocationStrategy();
  });

  describe('initial state', () => {
    it('returns "/" as the initial path', () => {
      expect(strategy.path()).toBe('/');
    });

    it('returns "/" as the base href', () => {
      expect(strategy.getBaseHref()).toBe('/');
    });

    it('returns null as the initial state', () => {
      expect(strategy.getState()).toBeNull();
    });
  });

  describe('prepareExternalUrl', () => {
    it('returns the internal url unchanged', () => {
      expect(strategy.prepareExternalUrl('/foo/bar')).toBe('/foo/bar');
    });
  });

  describe('pushState', () => {
    it('updates the current path', () => {
      strategy.pushState({}, '', '/home', '');
      expect(strategy.path()).toBe('/home');
    });

    it('appends query params to the path', () => {
      strategy.pushState({}, '', '/search', 'q=angular');
      expect(strategy.path()).toBe('/search?q=angular');
    });

    it('stores the pushed state', () => {
      strategy.pushState({ id: 42 }, '', '/detail', '');
      expect(strategy.getState()).toEqual({ id: 42 });
    });

    it('discards forward history when pushing after going back', () => {
      strategy.pushState({}, '', '/a', '');
      strategy.pushState({}, '', '/b', '');
      strategy.back();
      strategy.pushState({}, '', '/c', '');
      // Forward should now be a no-op since /b was discarded
      strategy.forward();
      expect(strategy.path()).toBe('/c');
    });
  });

  describe('replaceState', () => {
    it('replaces the current path without adding a history entry', () => {
      strategy.pushState({}, '', '/original', '');
      strategy.replaceState({}, '', '/replaced', '');
      expect(strategy.path()).toBe('/replaced');
      // Going back should return to the initial '/', not '/original'
      strategy.back();
      expect(strategy.path()).toBe('/');
    });

    it('appends query params to the replaced path', () => {
      strategy.replaceState({}, '', '/page', 'tab=2');
      expect(strategy.path()).toBe('/page?tab=2');
    });

    it('replaces the state object', () => {
      strategy.pushState({ old: true }, '', '/page', '');
      strategy.replaceState({ new: true }, '', '/page', '');
      expect(strategy.getState()).toEqual({ new: true });
    });
  });

  describe('back', () => {
    it('navigates to the previous history entry', () => {
      strategy.pushState({}, '', '/a', '');
      strategy.pushState({}, '', '/b', '');
      strategy.back();
      expect(strategy.path()).toBe('/a');
    });

    it('does nothing when already at the beginning of history', () => {
      strategy.back();
      expect(strategy.path()).toBe('/');
    });
  });

  describe('forward', () => {
    it('navigates to the next history entry', () => {
      strategy.pushState({}, '', '/a', '');
      strategy.back();
      strategy.forward();
      expect(strategy.path()).toBe('/a');
    });

    it('does nothing when already at the end of history', () => {
      strategy.pushState({}, '', '/a', '');
      strategy.forward();
      expect(strategy.path()).toBe('/a');
    });
  });

  describe('historyGo', () => {
    it('navigates by a relative position', () => {
      strategy.pushState({}, '', '/a', '');
      strategy.pushState({}, '', '/b', '');
      strategy.pushState({}, '', '/c', '');
      strategy.historyGo(-2);
      expect(strategy.path()).toBe('/a');
    });

    it('does nothing when target index is out of bounds (negative)', () => {
      strategy.historyGo(-5);
      expect(strategy.path()).toBe('/');
    });

    it('does nothing when target index is out of bounds (positive)', () => {
      strategy.historyGo(5);
      expect(strategy.path()).toBe('/');
    });

    it('does nothing when relativePosition is 0', () => {
      strategy.pushState({}, '', '/a', '');
      strategy.historyGo(0);
      expect(strategy.path()).toBe('/a');
    });

    it('notifies listeners with popstate event', () => {
      strategy.pushState({ step: 1 }, '', '/a', '');
      strategy.pushState({ step: 2 }, '', '/b', '');
      const listener = vi.fn();
      strategy.onPopState(listener);

      strategy.historyGo(-1);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({
        type: 'popstate',
        state: { step: 1 },
      });
    });
  });

  describe('onPopState', () => {
    it('fires listener when navigating back', () => {
      strategy.pushState({}, '', '/a', '');
      const listener = vi.fn();
      strategy.onPopState(listener);

      strategy.back();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ type: 'popstate', state: null });
    });

    it('fires listener when navigating forward', () => {
      strategy.pushState({ step: 1 }, '', '/a', '');
      strategy.back();
      const listener = vi.fn();
      strategy.onPopState(listener);

      strategy.forward();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({
        type: 'popstate',
        state: { step: 1 },
      });
    });

    it('supports multiple listeners', () => {
      strategy.pushState({}, '', '/a', '');
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      strategy.onPopState(listener1);
      strategy.onPopState(listener2);

      strategy.back();

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
    });

    it('does not fire listener after unsubscribing', () => {
      strategy.pushState({}, '', '/a', '');
      const listener = vi.fn();
      const unsubscribe = strategy.onPopState(listener);

      unsubscribe();
      strategy.back();

      expect(listener).not.toHaveBeenCalled();
    });

    it('returns a function that removes only the specific listener', () => {
      strategy.pushState({}, '', '/a', '');
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsubscribe1 = strategy.onPopState(listener1);
      strategy.onPopState(listener2);

      unsubscribe1();
      strategy.back();

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledOnce();
    });

    it('does not fire listeners on pushState', () => {
      const listener = vi.fn();
      strategy.onPopState(listener);

      strategy.pushState({}, '', '/a', '');

      expect(listener).not.toHaveBeenCalled();
    });

    it('does not fire listeners on replaceState', () => {
      const listener = vi.fn();
      strategy.onPopState(listener);

      strategy.replaceState({}, '', '/a', '');

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
