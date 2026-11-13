// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHostStyle } from './glass-host-style';
import { GlassManager } from './glass-manager';
import { pressOf } from './glass-press';

type FakeGroup = {
  root: HTMLElement;
  container: boolean;
  active: boolean;
  lost: boolean;
  shapes: HTMLElement[];
  look: { dark: boolean; luminance: number };
  frame: ReturnType<typeof vi.fn>;
  shows: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const groups = vi.hoisted(() => [] as FakeGroup[]);

vi.mock('./glass-group', () => ({
  GlassGroup: class {
    active = false;
    lost = false;
    shapes: HTMLElement[];
    look = { dark: false, luminance: 0.8 };
    // Whether the frame drew anything.
    frame = vi.fn(() => false);
    shows = vi.fn(() => false);
    invalidate = vi.fn();
    dispose = vi.fn();
    constructor(
      readonly root: HTMLElement,
      readonly container: boolean,
    ) {
      this.shapes = container
        ? (Array.from(root.children) as HTMLElement[])
        : [root];
      groups.push(this as unknown as FakeGroup);
    }
  },
}));
vi.mock('./glass-host-style', () => ({ applyHostStyle: vi.fn() }));

type Entry = { target: Element; isIntersecting: boolean };

/**
 * A window whose observers, frames and timers the test drives by hand.
 */
const fakeWindow = () => {
  const frames: FrameRequestCallback[] = [];
  let intervals: (() => void)[] = [];
  let onIntersection: (entries: Entry[]) => void = () => {};
  let onMutation: () => void = () => {};
  const intersection = { observe: vi.fn(), unobserve: vi.fn() };
  const attributes = { observe: vi.fn() };
  const win = {
    IntersectionObserver: class {
      constructor(callback: (entries: Entry[]) => void) {
        onIntersection = callback;
      }
      observe = intersection.observe;
      unobserve = intersection.unobserve;
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        onMutation = callback;
      }
      observe = attributes.observe;
    },
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) =>
      frames.push(callback),
    ),
    setInterval: vi.fn((callback: () => void) => {
      intervals.push(callback);
      return 7;
    }),
    clearInterval: vi.fn(() => {
      intervals = [];
    }),
  };
  return {
    manager: GlassManager.for(win as unknown as Window & typeof globalThis),
    win,
    intersection,
    attributes,
    show: (...targets: Element[]) =>
      onIntersection(
        targets.map((target) => ({ target, isIntersecting: true })),
      ),
    hide: (...targets: Element[]) =>
      onIntersection(
        targets.map((target) => ({ target, isIntersecting: false })),
      ),
    mutate: () => onMutation(),
    /** Runs the pending frame callbacks, at `time`. */
    frame: (time: number) => {
      for (const callback of frames.splice(0)) callback(time);
    },
    pendingFrames: () => frames.length,
    poll: () => intervals.forEach((callback) => callback()),
  };
};

const blurView = (effect: string, ...children: HTMLElement[]) => {
  const element = document.createElement('x-blur-view');
  element.setAttribute('blur-effect', effect);
  element.append(...children);
  return element;
};

const styleOf = (element: HTMLElement) =>
  vi
    .mocked(applyHostStyle)
    .mock.calls.filter(([target]) => target === element)
    .at(-1)?.[1];

beforeEach(() => {
  groups.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('GlassManager', () => {
  it('keeps one manager per window', () => {
    const win = fakeWindow().win as unknown as Window & typeof globalThis;
    expect(GlassManager.for(win)).toBe(GlassManager.for(win));
  });

  it('watches a registered element’s visibility, glass attributes and presses', () => {
    const { manager, intersection, attributes } = fakeWindow();
    const element = blurView('glass');
    manager.register(element);
    expect(intersection.observe).toHaveBeenCalledWith(element);
    expect(attributes.observe).toHaveBeenCalledWith(element, {
      attributes: true,
      attributeFilter: expect.arrayContaining(['blur-effect', 'spacing']),
    });
    expect(pressOf(element)).toBeDefined();
  });

  it('builds a group for each visible container and lone glass element', () => {
    const { manager, show, frame } = fakeWindow();
    const member = blurView('glass');
    const container = blurView('glass-container', member);
    const lone = blurView('glass');
    const plain = blurView('light');
    document.body.append(container, lone, plain);
    for (const element of [container, member, lone, plain]) {
      manager.register(element);
    }

    show(container, member, lone, plain);
    frame(1000);
    expect(groups.map((g) => [g.root, g.container])).toEqual([
      [container, true],
      [lone, false],
    ]);
    expect(groups[0]!.frame).toHaveBeenCalledWith(0);
  });

  it('styles glass with CSS until its group draws it', () => {
    const { manager, show, frame } = fakeWindow();
    const member = blurView('glass');
    const container = blurView('glass-container', member);
    const plain = blurView('light');
    document.body.append(container, plain);
    show(container, plain);
    manager.register(container);

    frame(1000);
    // The fallback casts its own shadow; the container's canvas isn't up.
    // The member takes the look of the container's group.
    expect(styleOf(member)).toEqual({
      dark: false,
      luminance: 0.8,
      hostsCanvas: false,
      rendered: false,
      fallback: true,
      shadow: true,
      scale: 1,
      press: 0,
    });
    expect(styleOf(plain)).toEqual({
      dark: false,
      luminance: 1,
      hostsCanvas: false,
      rendered: false,
      fallback: false,
      shadow: false,
      scale: 1,
      press: 0,
    });

    groups[0]!.active = true;
    frame(1016);
    expect(styleOf(member)).toEqual({
      dark: false,
      luminance: 0.8,
      hostsCanvas: false,
      rendered: true,
      fallback: false,
      shadow: false,
      scale: 1,
      press: 0,
    });
    expect(styleOf(container)).toMatchObject({ hostsCanvas: true });
  });

  it('styles a shape with its group’s look, or else the one it asks for', () => {
    const { show, frame } = fakeWindow();
    const lone = blurView('glass');
    // No group yet: its parent container hasn't come on screen.
    const waiting = blurView('glass');
    waiting.setAttribute('ios-user-interface-style', 'dark');
    document.body.append(lone, blurView('glass-container', waiting));
    show(lone, waiting);
    frame(1000);
    groups[0]!.look = { dark: true, luminance: 0.2 };
    frame(1016);

    expect(styleOf(lone)).toMatchObject({ dark: true, luminance: 0.2 });
    // Over a backdrop it knows nothing of yet, which counts as white.
    expect(styleOf(waiting)).toMatchObject({ dark: true, luminance: 1 });
  });

  it('gives a lone shape a CSS shadow, and swells and washes any pressed shape', () => {
    const { manager, show, frame } = fakeWindow();
    const member = blurView('glass');
    const container = blurView('glass-container', member);
    const lone = blurView('glass');
    const plain = blurView('light');
    document.body.append(container, lone, plain);
    Object.defineProperty(member, 'offsetWidth', { value: 60 });
    Object.defineProperty(lone, 'offsetWidth', { value: 300 });
    for (const element of [member, lone, plain]) manager.register(element);
    show(container, lone, plain);
    frame(1000);
    for (const group of groups) group.active = true;
    pressOf(member)!.value = 1;
    pressOf(lone)!.value = 0.5;
    pressOf(plain)!.value = 1;
    frame(1016);

    // The longer side grows by 15px when fully pressed: half of that here.
    expect(styleOf(lone)).toEqual({
      dark: false,
      luminance: 0.8,
      hostsCanvas: true,
      rendered: true,
      fallback: false,
      shadow: true,
      scale: 1.025,
      press: 0.5,
    });
    // The container draws its shapes' shadow on its canvas, but a pressed
    // shape of its swells and washes out as a lone one does.
    expect(styleOf(member)).toMatchObject({
      shadow: false,
      scale: 1.25,
      press: 1,
    });
    // A blur view that isn't glass doesn't react.
    expect(styleOf(plain)).toMatchObject({ scale: 1, press: 0 });
  });

  it('has the glass above a redrawn group capture again', () => {
    const { show, frame } = fakeWindow();
    const [button, sheet, other] = [
      blurView('glass'),
      blurView('glass'),
      blurView('glass'),
    ];
    document.body.append(button, sheet, other);
    show(button, sheet, other);
    frame(1000);
    const [below, above, apart] = groups;
    // The sheet floats over the button, and shows it; the third is elsewhere.
    above!.shows.mockImplementation((root) => root === button);
    below!.frame.mockReturnValue(true);
    frame(1016);

    expect(above!.shows).toHaveBeenCalledWith(button);
    expect(above!.invalidate).toHaveBeenCalledTimes(1);
    expect(apart!.invalidate).not.toHaveBeenCalled();
    expect(below!.invalidate).not.toHaveBeenCalled();
  });

  it('tells neither of two groups that each count the other as behind them', () => {
    const { show, frame } = fakeWindow();
    const first = blurView('glass');
    const second = blurView('glass');
    document.body.append(first, second);
    show(first, second);
    frame(1000);
    // A stacking read wrong: left alone, they'd keep each other capturing.
    for (const group of groups) {
      group.shows.mockReturnValue(true);
      group.frame.mockReturnValue(true);
    }
    frame(1016);

    expect(groups[0]!.invalidate).not.toHaveBeenCalled();
    expect(groups[1]!.invalidate).not.toHaveBeenCalled();
  });

  it('runs frames while glass is visible, with capped elapsed times', () => {
    const { show, hide, frame, pendingFrames } = fakeWindow();
    const lone = blurView('glass');
    document.body.append(lone);

    show(lone);
    expect(pendingFrames()).toBe(1);
    frame(1000);
    frame(1016);
    frame(2000);
    expect(groups[0]!.frame.mock.calls).toEqual([[0], [16], [100]]);
    expect(pendingFrames()).toBe(1);

    // Off screen: the group goes, and so does the loop.
    hide(lone);
    frame(2016);
    expect(groups[0]!.dispose).toHaveBeenCalled();
    expect(pendingFrames()).toBe(0);

    // Back on screen, timing starts over.
    show(lone);
    frame(9000);
    expect(groups[1]!.frame).toHaveBeenCalledWith(0);
  });

  it('asks for one frame at a time', () => {
    const { show, mutate, pendingFrames } = fakeWindow();
    const lone = blurView('glass');
    document.body.append(lone);
    show(lone);
    mutate();
    expect(pendingFrames()).toBe(1);
  });

  it('rebuilds a group when its role changes or its context is lost', () => {
    const { show, mutate, frame } = fakeWindow();
    const container = blurView('glass-container');
    document.body.append(container);
    show(container);
    frame(1000);

    container.setAttribute('blur-effect', 'glass');
    mutate();
    frame(1016);
    expect(groups[0]!.dispose).toHaveBeenCalled();
    expect(groups[1]).toMatchObject({ root: container, container: false });

    groups[1]!.lost = true;
    frame(1032);
    expect(groups[1]!.dispose).toHaveBeenCalled();
    expect(groups[2]).toMatchObject({ root: container, container: false });
  });

  describe('removed elements', () => {
    it('keeps observing an element that is only scrolled away', () => {
      const { show, hide, intersection, win } = fakeWindow();
      const lone = blurView('glass');
      document.body.append(lone);
      show(lone);
      hide(lone);
      expect(intersection.unobserve).not.toHaveBeenCalled();
      expect(win.setInterval).not.toHaveBeenCalled();
    });

    it('lets go of removed elements, and takes them back when reattached', () => {
      const { show, hide, poll, intersection, win } = fakeWindow();
      const first = blurView('glass');
      const second = blurView('glass');
      document.body.append(first, second);
      show(first, second);
      first.remove();
      second.remove();
      hide(first, second);

      expect(intersection.unobserve).toHaveBeenCalledWith(first);
      expect(intersection.unobserve).toHaveBeenCalledWith(second);
      expect(win.setInterval).toHaveBeenCalledTimes(1);

      poll();
      expect(intersection.observe).not.toHaveBeenCalled();

      document.body.append(first);
      poll();
      expect(intersection.observe).toHaveBeenCalledWith(first);
      expect(win.clearInterval).not.toHaveBeenCalled();

      document.body.append(second);
      poll();
      expect(win.clearInterval).toHaveBeenCalledWith(7);
    });

    it('forgets removed elements once they are garbage collected', () => {
      const collected = new Set<object>();
      vi.stubGlobal(
        'WeakRef',
        class {
          constructor(readonly value: object) {}
          deref() {
            return collected.has(this.value) ? undefined : this.value;
          }
        },
      );
      const { show, hide, poll, intersection, win } = fakeWindow();
      const lone = blurView('glass');
      document.body.append(lone);
      show(lone);
      lone.remove();
      hide(lone);

      collected.add(lone);
      poll();
      expect(intersection.observe).not.toHaveBeenCalled();
      expect(win.clearInterval).toHaveBeenCalled();
    });
  });
});
