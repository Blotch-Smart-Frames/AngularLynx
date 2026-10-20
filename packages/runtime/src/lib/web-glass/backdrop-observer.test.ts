// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeBackdrop } from './backdrop-observer';

// jsdom has MutationObserver but no ResizeObserver, matchMedia or fonts.
const resize = { observe: vi.fn(), disconnect: vi.fn() };
let onResize: () => void;
const scheme = { addEventListener: vi.fn(), removeEventListener: vi.fn() };

const flush = () => new Promise((resolve) => setTimeout(resolve));

const setup = () => {
  const backdrop = document.createElement('x-view');
  const text = document.createElement('x-text');
  const glass = document.createElement('x-blur-view');
  const blob = document.createElement('x-blur-view');
  glass.append(blob);
  backdrop.append(text, glass);
  document.body.append(backdrop);
  const onChange = vi.fn();
  const stop = observeBackdrop(backdrop, glass, onChange);
  return { backdrop, text, glass, blob, onChange, stop };
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = resize.observe;
      disconnect = resize.disconnect;
    },
  );
  vi.stubGlobal('matchMedia', () => scheme);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('observeBackdrop', () => {
  it('reports once web fonts are ready', async () => {
    const { onChange } = setup();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reports changes behind the glass but not inside it', async () => {
    const { text, blob, onChange } = setup();
    await flush();
    onChange.mockClear();

    blob.setAttribute('style', 'left: 10px');
    await flush();
    expect(onChange).not.toHaveBeenCalled();

    text.textContent = 'changed';
    await flush();
    expect(onChange).toHaveBeenCalled();
  });

  it('reports resizes, scrolls, loads and color scheme changes', async () => {
    const { backdrop, text, onChange } = setup();
    await flush();
    onChange.mockClear();

    expect(resize.observe).toHaveBeenCalledWith(backdrop);
    onResize();
    // Neither event bubbles; the listener captures them on the way down.
    text.dispatchEvent(new Event('scroll'));
    text.dispatchEvent(new Event('load'));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(scheme.addEventListener).toHaveBeenCalledWith('change', onChange);
  });

  it('stops observing', async () => {
    const { text, onChange, stop } = setup();
    await flush();
    onChange.mockClear();
    stop();

    text.textContent = 'changed';
    text.dispatchEvent(new Event('scroll'));
    text.dispatchEvent(new Event('load'));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(resize.disconnect).toHaveBeenCalled();
    expect(scheme.removeEventListener).toHaveBeenCalledWith('change', onChange);
  });
});
