// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = Symbol.for('@blotch/angular-lynx/global-events');

/**
 * The module fresh, with no hub on the global yet.
 */
const importFresh = async () => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
  vi.resetModules();
  return import('./index');
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe('globalEvents', () => {
  it('is one hub for every copy of the runtime', async () => {
    const first = await importFresh();
    const events = first.globalEvents();
    vi.resetModules();
    const second = await import('./index');

    expect(second.globalEvents()).toBe(events);
    expect(first.globalEvents()).toBe(events);
  });

  it('hears touches through global-bind listeners natively', async () => {
    const { globalEvents } = await importFresh();
    const page = {
      element: {},
      addEventListener: vi.fn(() => () => {}),
      addTrailingEventListener: vi.fn(() => () => {}),
    };
    globalEvents().attach(page, () => undefined);
    globalEvents().document.addEventListener('click', vi.fn());

    expect(page.addEventListener).toHaveBeenCalledWith(
      'global-bindtap',
      expect.any(Function),
    );
  });

  it("hears the browser's events on the web", async () => {
    vi.stubGlobal('__WEB__', true);
    const { globalEvents } = await importFresh();
    const node = document.createElement('div');
    const page = {
      element: node,
      addEventListener: vi.fn(),
      addTrailingEventListener: vi.fn(),
    };
    const add = vi.spyOn(node, 'addEventListener');
    globalEvents().attach(page, () => undefined);
    globalEvents().document.addEventListener('click', vi.fn());

    expect(add).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(page.addEventListener).not.toHaveBeenCalled();
  });
});
