import '@angular/compiler';
import { LocationStrategy } from '@angular/common';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  carryOverLocation,
  historyEntryAt,
  LynxLocationStrategy,
  restoreHistory,
  rewindHistory,
} from './lynx-location-strategy';

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

  describe('canGoBack', () => {
    it('is false on the first entry', () => {
      expect(strategy.canGoBack()).toBe(false);
    });

    it('is true after a push, and false again back on the first entry', () => {
      strategy.pushState({}, '', '/a', '');
      strategy.pushState({}, '', '/b', '');
      expect(strategy.canGoBack()).toBe(true);

      strategy.back();
      expect(strategy.canGoBack()).toBe(true);

      strategy.back();
      expect(strategy.canGoBack()).toBe(false);

      strategy.forward();
      expect(strategy.canGoBack()).toBe(true);
    });

    it('stays false after a replace', () => {
      strategy.replaceState({}, '', '/a', '');
      expect(strategy.canGoBack()).toBe(false);
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

// A hot update that re-bootstraps the app hands the old strategy's history to
// the new app's (see bootstrapApplication).
describe('carryOverLocation', () => {
  const injectorWith = (strategy: LocationStrategy): Injector =>
    Injector.create({
      providers: [{ provide: LocationStrategy, useValue: strategy }],
    });

  it('starts the next strategy on the current screen, with its history', () => {
    const old = new LynxLocationStrategy();
    old.pushState({ a: 1 }, '', '/list', '');
    old.pushState({ b: 2 }, '', '/detail', 'id=3');
    old.back();

    carryOverLocation(injectorWith(old));
    const next = new LynxLocationStrategy();

    expect(next.path()).toBe('/list');
    expect(next.getState()).toEqual({ a: 1 });
    expect(next.canGoBack()).toBe(true);
    next.forward();
    expect(next.path()).toBe('/detail?id=3');
  });

  it("hands the history over once, and doesn't share it", () => {
    const old = new LynxLocationStrategy();
    old.pushState(null, '', '/list', '');

    carryOverLocation(injectorWith(old));
    const next = new LynxLocationStrategy();
    next.replaceState(null, '', '/changed', '');

    expect(old.path()).toBe('/list');
    expect(new LynxLocationStrategy().path()).toBe('/');
  });

  it('keeps Back off on the first screen', () => {
    carryOverLocation(injectorWith(new LynxLocationStrategy()));

    expect(new LynxLocationStrategy().canGoBack()).toBe(false);
  });

  it('does nothing for an app without the router or with another strategy', () => {
    carryOverLocation(undefined);
    carryOverLocation(Injector.create({ providers: [] }));
    carryOverLocation(
      injectorWith({ path: () => '/other' } as unknown as LocationStrategy),
    );

    expect(new LynxLocationStrategy().path()).toBe('/');
  });
});

describe('rewindHistory', () => {
  let strategy: LynxLocationStrategy;

  beforeEach(() => {
    strategy = new LynxLocationStrategy();
    strategy.replaceState({ id: 0 }, '', '/a', '');
    strategy.pushState({ id: 1 }, '', '/b', '');
    strategy.pushState({ id: 2 }, '', '/c', '');
    strategy.pushState({ id: 3 }, '', '/b', 'tab=2');
  });

  it('moves the current entry back, dropping the entries between', () => {
    const listener = vi.fn();
    strategy.onPopState(listener);

    rewindHistory(strategy, 1);

    expect(strategy.historyIndex).toBe(1);
    expect(strategy.path()).toBe('/b?tab=2');
    expect(strategy.getState()).toEqual({ id: 3 });
    // It isn't a navigation: the app is where it was.
    expect(listener).not.toHaveBeenCalled();
    strategy.back();
    expect(strategy.path()).toBe('/a');
    // Nothing is left ahead of it.
    strategy.historyGo(2);
    expect(strategy.path()).toBe('/a');
  });

  it('turns Back off when it goes back to the first entry', () => {
    rewindHistory(strategy, 0);

    expect(strategy.canGoBack()).toBe(false);
    expect(strategy.path()).toBe('/b?tab=2');
  });

  it('does nothing for the current entry, one after it, or none', () => {
    for (const index of [3, 4, -1]) rewindHistory(strategy, index);

    expect(strategy.historyIndex).toBe(3);
    strategy.back();
    expect(strategy.path()).toBe('/c');
  });

  it("renumbers the router's entry, and leaves other states alone", () => {
    strategy.replaceState({ navigationId: 7, ɵrouterPageId: 3 }, '', '/b', '');
    rewindHistory(strategy, 1);
    expect(strategy.getState()).toEqual({ navigationId: 7, ɵrouterPageId: 1 });

    for (const state of [null, 'saved', { ɵrouterPageId: 'x' }]) {
      strategy.pushState(state, '', '/c', '');
      rewindHistory(strategy, 1);
      expect(strategy.getState()).toBe(state);
    }
  });
});

describe('historyEntryAt', () => {
  it('reads an entry, and nothing outside the history', () => {
    const strategy = new LynxLocationStrategy();
    strategy.pushState({ id: 1 }, '', '/a', 'q=1');

    expect(historyEntryAt(strategy, 1)).toEqual({
      state: { id: 1 },
      url: '/a?q=1',
    });
    for (const index of [-1, 2]) {
      expect(historyEntryAt(strategy, index)).toBeUndefined();
    }
  });
});

describe('restoreHistory', () => {
  let strategy: LynxLocationStrategy;

  beforeEach(() => {
    strategy = new LynxLocationStrategy();
    strategy.replaceState({ ɵrouterPageId: 0 }, '', '/home', '');
    strategy.pushState({ ɵrouterPageId: 1 }, '', '/pages', '');
    strategy.pushState({ ɵrouterPageId: 2 }, '', '/home/3', '');
  });

  it('puts entries in before the current one, without a navigation', () => {
    const listener = vi.fn();
    strategy.onPopState(listener);

    restoreHistory(strategy, [
      { state: { ɵrouterPageId: 0, id: 'home' }, url: '/home' },
      { state: null, url: '/home/2' },
    ]);

    expect(listener).not.toHaveBeenCalled();
    expect(strategy.historyIndex).toBe(4);
    expect(strategy.path()).toBe('/home/3');
    // The router's numbers move with the entries, and other states stay.
    expect(strategy.getState()).toEqual({ ɵrouterPageId: 4 });
    expect(historyEntryAt(strategy, 2)).toEqual({
      state: { ɵrouterPageId: 2, id: 'home' },
      url: '/home',
    });
    strategy.back();
    expect(strategy.path()).toBe('/home/2');
    expect(strategy.getState()).toBeNull();
    strategy.back();
    expect(strategy.path()).toBe('/home');
    strategy.back();
    expect(strategy.path()).toBe('/pages');
  });

  it('turns Back on in front of the first entry, and does nothing for none', () => {
    const first = new LynxLocationStrategy();
    restoreHistory(first, []);
    expect(first.canGoBack()).toBe(false);
    expect(first.historyIndex).toBe(0);

    restoreHistory(first, [{ state: null, url: '/before' }]);
    expect(first.canGoBack()).toBe(true);
    expect(first.historyIndex).toBe(1);
    expect(first.path()).toBe('/');
  });
});
