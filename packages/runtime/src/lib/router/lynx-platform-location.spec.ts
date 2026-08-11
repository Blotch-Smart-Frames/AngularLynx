import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { LynxPlatformLocation } from './lynx-platform-location';

describe('LynxPlatformLocation', () => {
  it('has initial state at /', () => {
    const loc = new LynxPlatformLocation();

    expect(loc.pathname).toBe('/');
    expect(loc.search).toBe('');
    expect(loc.hash).toBe('');
    expect(loc.protocol).toBe('lynx:');
    expect(loc.hostname).toBe('app');
    expect(loc.port).toBe('');
    expect(loc.getBaseHrefFromDOM()).toBe('/');
    expect(loc.getState()).toBeNull();
  });

  it('pushState updates the current URL', () => {
    const loc = new LynxPlatformLocation();

    loc.pushState({ id: 1 }, 'Page', '/page-one');

    expect(loc.pathname).toBe('/page-one');
    expect(loc.getState()).toEqual({ id: 1 });
  });

  it('replaceState updates in place without adding history', () => {
    const loc = new LynxPlatformLocation();

    loc.replaceState({ id: 2 }, 'Replaced', '/replaced');

    expect(loc.pathname).toBe('/replaced');
    expect(loc.getState()).toEqual({ id: 2 });
  });

  it('back() navigates to the previous entry and fires popState', () => {
    const loc = new LynxPlatformLocation();
    const listener = vi.fn();
    loc.onPopState(listener);

    loc.pushState(null, '', '/a');
    loc.pushState(null, '', '/b');
    loc.back();

    expect(loc.pathname).toBe('/a');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'popstate' }),
    );
  });

  it('forward() navigates to the next entry', () => {
    const loc = new LynxPlatformLocation();

    loc.pushState(null, '', '/a');
    loc.pushState(null, '', '/b');
    loc.back();
    loc.forward();

    expect(loc.pathname).toBe('/b');
  });

  it('historyGo() does nothing for out-of-range positions', () => {
    const loc = new LynxPlatformLocation();
    const listener = vi.fn();
    loc.onPopState(listener);

    loc.historyGo(-5);

    expect(loc.pathname).toBe('/');
    expect(listener).not.toHaveBeenCalled();
  });

  it('pushState discards forward history', () => {
    const loc = new LynxPlatformLocation();

    loc.pushState(null, '', '/a');
    loc.pushState(null, '', '/b');
    loc.back();
    loc.pushState(null, '', '/c');
    loc.forward();

    // /b was discarded, so forward does nothing — still at /c
    expect(loc.pathname).toBe('/c');
  });

  it('onPopState returns a cleanup function', () => {
    const loc = new LynxPlatformLocation();
    const listener = vi.fn();
    const cleanup = loc.onPopState(listener);

    loc.pushState(null, '', '/a');
    cleanup();
    loc.back();

    expect(listener).not.toHaveBeenCalled();
  });

  it('parses search and hash from URL', () => {
    const loc = new LynxPlatformLocation();

    loc.pushState(null, '', '/page?key=value#section');

    expect(loc.pathname).toBe('/page');
    expect(loc.search).toBe('?key=value');
    expect(loc.hash).toBe('#section');
  });

  it('href returns the full URL', () => {
    const loc = new LynxPlatformLocation();

    loc.pushState(null, '', '/page?q=1#top');

    expect(loc.href).toBe('lynx://app/page?q=1#top');
  });
});
