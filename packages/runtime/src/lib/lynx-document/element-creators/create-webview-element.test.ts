import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWebViewInIsolatedPage } from '../web-webview';
import { createWebViewElement } from './create-webview-element';

vi.mock('../web-webview', () => ({ loadWebViewInIsolatedPage: vi.fn() }));

const ref = { tag: 'webview' };

beforeEach(() => {
  vi.stubGlobal(
    '__CreateElement',
    vi.fn(() => ref),
  );
  vi.stubGlobal('__WEB__', true);
  vi.stubGlobal('__MAIN_THREAD__', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('createWebViewElement', () => {
  it('creates the native web view', () => {
    expect(createWebViewElement(3)).toBe(ref);
    expect(__CreateElement).toHaveBeenCalledWith('webview', 3);
  });

  it("lets a web view's frame load in an isolated page on the web", () => {
    expect(createWebViewElement(3)).toBe(ref);
    expect(loadWebViewInIsolatedPage).toHaveBeenCalledWith(ref);
  });

  it('leaves a native web view to the platform', () => {
    vi.stubGlobal('__WEB__', false);
    createWebViewElement(3);
    expect(loadWebViewInIsolatedPage).not.toHaveBeenCalled();
  });

  it("doesn't touch the background thread's stand-in elements", () => {
    vi.stubGlobal('__MAIN_THREAD__', false);
    createWebViewElement(3);
    expect(loadWebViewInIsolatedPage).not.toHaveBeenCalled();
  });
});
