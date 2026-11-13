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
  // The glass, and whatever it holds, is in front: nothing behind it.
  const inFront = vi.fn((node: Node) => glass.contains(node));
  const stop = observeBackdrop(backdrop, inFront, onChange);
  return { backdrop, text, glass, blob, onChange, inFront, stop };
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

  it('reports changes behind the glass but not in front of it', async () => {
    const { text, blob, onChange, inFront } = setup();
    await flush();
    onChange.mockClear();

    blob.setAttribute('style', 'left: 10px');
    await flush();
    expect(inFront).toHaveBeenCalledWith(blob);
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

  it('reports a transition or an animation ending behind the glass', async () => {
    const { text, onChange } = setup();
    await flush();
    onChange.mockClear();

    // A dimming layer that finished fading in looks different from the
    // picture taken while it faded.
    text.dispatchEvent(new Event('transitionend', { bubbles: true }));
    text.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ignores events from in front of the glass', async () => {
    const { blob, onChange } = setup();
    await flush();
    onChange.mockClear();

    // A sheet's own list scrolling, or its row's highlight fading.
    blob.dispatchEvent(new Event('scroll'));
    blob.dispatchEvent(new Event('transitionend', { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops observing', async () => {
    const { text, onChange, stop } = setup();
    await flush();
    onChange.mockClear();
    stop();

    text.textContent = 'changed';
    text.dispatchEvent(new Event('scroll'));
    text.dispatchEvent(new Event('load'));
    text.dispatchEvent(new Event('transitionend', { bubbles: true }));
    text.dispatchEvent(new Event('animationend', { bubbles: true }));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(resize.disconnect).toHaveBeenCalled();
    expect(scheme.removeEventListener).toHaveBeenCalledWith('change', onChange);
  });
});
