// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalEvents } from './global-events';
import { WebScreenSource } from './web-source';

/**
 * A page element in a `<lynx-view>`'s shadow tree, as web-core makes one.
 */
const pageInLynxView = (): HTMLElement => {
  const lynxView = document.createElement('lynx-view');
  document.body.appendChild(lynxView);
  const node = document.createElement('div');
  lynxView.attachShadow({ mode: 'open' }).appendChild(node);
  return node;
};

const lynxViewOf = (node: Node) => (node.getRootNode() as ShadowRoot).host;

/**
 * The page element of a LynxView on the web, a DOM element, with a child to
 * touch, and a ResizeObserver its window can report sizes with.
 */
const setup = () => {
  const node = pageInLynxView();
  const child = document.createElement('div');
  node.appendChild(child);
  let size = { width: 400, height: 800 };
  lynxViewOf(node).getBoundingClientRect = () => ({ ...size }) as DOMRect;
  const observers: { callback: () => void; disconnect: () => void }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.push(this);
      }
      observe = vi.fn(() => this.callback());
      disconnect = vi.fn();
    },
  );
  const events = new GlobalEvents({}, (hub) => new WebScreenSource(hub));
  const page = {
    element: node,
    addEventListener: vi.fn(),
    addTrailingEventListener: vi.fn(),
  };
  events.attach(page, () => undefined);
  return {
    events,
    node,
    child,
    observers,
    resize(width: number, height: number) {
      size = { width, height };
      for (const observer of observers) observer.callback();
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('WebScreenSource', () => {
  it("hears the browser's events inside the LynxView, after the element's own", () => {
    const { events, child } = setup();
    const log: string[] = [];
    events.document.addEventListener('pointermove', (event) =>
      log.push(`document ${event.target === child}`),
    );
    events.document.addEventListener(
      'pointermove',
      () => log.push('capture'),
      true,
    );
    child.addEventListener('pointermove', (event) => {
      log.push('element');
      // The document's listeners don't change what the DOM's see.
      expect(event.currentTarget).toBe(child);
    });

    child.dispatchEvent(new Event('pointermove', { bubbles: true }));

    expect(log).toEqual(['capture', 'element', 'document true']);
  });

  it("runs the document's other listeners on the next timer when an element stopped the event", () => {
    const { events, child } = setup();
    const document = vi.fn();
    events.document.addEventListener('click', document);
    child.addEventListener('click', (event) => event.stopPropagation());

    child.dispatchEvent(new Event('click', { bubbles: true }));
    expect(document).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(document).toHaveBeenCalled();
  });

  it("hears key events on the page's document", () => {
    const { events } = setup();
    const keydown = vi.fn();
    events.window.addEventListener('keydown', keydown);

    document.body.dispatchEvent(new Event('keydown', { bubbles: true }));

    expect(keydown).toHaveBeenCalled();
  });

  it('stops listening when nothing listens', () => {
    const { events, child } = setup();
    const click = vi.fn();
    events.document.addEventListener('click', click);
    const other = vi.fn();
    events.document.addEventListener('pointerdown', other);
    events.document.removeEventListener('click', click);

    child.dispatchEvent(new Event('click', { bubbles: true }));
    vi.runAllTimers();

    expect(click).not.toHaveBeenCalled();
  });

  it("fires resize when the page element's size changes, and reads it at any time", () => {
    const { events, observers, resize } = setup();
    expect(events.viewport).toEqual({ width: 400, height: 800 });
    const listener = vi.fn(() => events.viewport);
    events.window.addEventListener('resize', listener);
    // The size observing started at isn't a change.
    expect(listener).not.toHaveBeenCalled();

    resize(400, 800);
    expect(listener).not.toHaveBeenCalled();
    resize(800, 400);
    expect(listener).toHaveReturnedWith({ width: 800, height: 400 });

    events.window.removeEventListener('resize', listener);
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('moves to the next page, and has no size without one', () => {
    const { events, child } = setup();
    const click = vi.fn();
    events.document.addEventListener('click', click);
    const next = pageInLynxView();

    events.attach(
      {
        element: next,
        addEventListener: vi.fn(),
        addTrailingEventListener: vi.fn(),
      },
      () => undefined,
    );
    child.dispatchEvent(new Event('click', { bubbles: true }));
    next.dispatchEvent(new Event('click', { bubbles: true }));
    vi.runAllTimers();
    expect(click).toHaveBeenCalledTimes(1);

    const source = new WebScreenSource(events);
    expect(source.viewport()).toBeNull();
    source.sync(null, new Set());
  });

  // The main thread's iframe is in the <lynx-view>'s shadow root, before
  // the page is laid out in it.
  it("finds the <lynx-view> from the main thread's iframe", () => {
    const node = pageInLynxView();
    const frame = document.createElement('iframe');
    node.getRootNode().appendChild(frame);
    lynxViewOf(node).getBoundingClientRect = () =>
      ({ width: 402, height: 874 }) as DOMRect;
    vi.stubGlobal('frameElement', frame);

    const events = new GlobalEvents({}, (hub) => new WebScreenSource(hub));
    expect(events.viewport).toEqual({ width: 402, height: 874 });
    events.attach(
      {
        element: document.createElement('div'),
        addEventListener: vi.fn(),
        addTrailingEventListener: vi.fn(),
      },
      () => undefined,
    );
    const click = vi.fn();
    events.document.addEventListener('click', click);
    node.dispatchEvent(new Event('click', { bubbles: true }));

    expect(click).toHaveBeenCalled();
  });
});
