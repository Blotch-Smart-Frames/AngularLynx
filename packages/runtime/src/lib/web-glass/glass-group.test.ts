// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CssColor from './css-color';
import type { BackdropSnapshot } from './backdrop-snapshot';
import { backdropOf, GlassGroup } from './glass-group';
import { pressOf, trackPress } from './glass-press';
import type { GlassFrame } from './glass-renderer';

const mocks = vi.hoisted(() => ({
  renderer: {
    setBackdrop: vi.fn(),
    draw: vi.fn(),
    dispose: vi.fn(),
    lost: false,
  },
  create: vi.fn(),
  snapshot: vi.fn(),
  observe: vi.fn(),
  stopObserving: vi.fn(),
}));

vi.mock('./glass-renderer', () => ({
  GlassRenderer: { create: mocks.create },
}));
vi.mock('./backdrop-snapshot', () => ({ snapshotBackdrop: mocks.snapshot }));
vi.mock('./backdrop-observer', () => ({ observeBackdrop: mocks.observe }));
vi.mock('./css-color', async (importOriginal) => ({
  ...(await importOriginal<typeof CssColor>()),
  // jsdom has no canvas to normalize colors with.
  resolveCssColor: () => [0, 0, 0, 0],
}));

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

const placed = <T extends Element>(element: T, box: DOMRect): T => {
  vi.spyOn(element as Element, 'getBoundingClientRect').mockImplementation(
    () => box,
  );
  return element;
};

const blurView = (attributes: Record<string, string>) => {
  const element = document.createElement('x-blur-view');
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.attachShadow({ mode: 'open' }).innerHTML =
    '<style id="dynamic-style"></style><slot></slot>';
  return element;
};

const SNAPSHOT: BackdropSnapshot = {
  image: { width: 2, height: 2 } as HTMLCanvasElement,
  x: 0,
  y: 0,
  width: 400,
  height: 400,
  luminance: 1,
};

let now = 0;
let canvasBox = rect(10, 20, 200, 100);
let pending: {
  resolve: (s: BackdropSnapshot | null) => void;
  reject: () => void;
};

const flush = () => new Promise((resolve) => setTimeout(resolve));

/**
 * A backdrop holding text, then the glass root, then an overlay above it. Its
 * opaque background makes it the glass's backdrop (see backdropOf).
 */
const scene = (root: HTMLElement) => {
  const backdrop = placed(
    document.createElement('x-view'),
    rect(0, 0, 400, 400),
  );
  backdrop.style.backgroundColor = 'rgb(255, 255, 255)';
  const text = document.createElement('x-text');
  const overlay = document.createElement('x-view');
  backdrop.append(text, root, overlay);
  document.body.append(backdrop);
  return { backdrop, text, overlay };
};

const container = (spacing = '12') => {
  const root = blurView({ 'blur-effect': 'glass-container', spacing });
  const blob = placed(
    blurView({ 'blur-effect': 'glass' }),
    rect(30, 40, 50, 50),
  );
  blob.style.borderTopLeftRadius = '25px';
  root.append(blob, blurView({ 'blur-effect': 'light' }));
  return { root, blob };
};

/**
 * Runs the first frame and lets its capture finish.
 */
const captured = async (group: GlassGroup) => {
  group.frame(16);
  pending.resolve(SNAPSHOT);
  await flush();
};

const lastFrame = () => mocks.renderer.draw.mock.lastCall![0] as GlassFrame;

beforeEach(() => {
  now = 1000;
  canvasBox = rect(10, 20, 200, 100);
  mocks.renderer.lost = false;
  mocks.create.mockImplementation(() => mocks.renderer);
  mocks.observe.mockImplementation(() => mocks.stopObserving);
  mocks.snapshot.mockImplementation(
    () =>
      new Promise<BackdropSnapshot | null>((resolve, reject) => {
        pending = { resolve, reject };
      }),
  );
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect',
  ).mockImplementation(() => canvasBox);
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 3,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('GlassGroup', () => {
  it('stacks a hidden canvas under the root’s children', () => {
    const { root } = container();
    scene(root);
    new GlassGroup(root, true);
    const canvas = root.shadowRoot!.querySelector('canvas')!;
    expect(canvas.nextElementSibling!.localName).toBe('slot');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.style.zIndex).toBe('-1');
    expect(canvas.style.opacity).toBe('0');
  });

  it('stays inert without a shadow root, WebGL or a backdrop', () => {
    const bare = document.createElement('x-blur-view');
    scene(bare);
    const noShadow = new GlassGroup(bare, false);
    noShadow.frame(16);
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.create.mockReturnValue(null);
    const { root } = container();
    scene(root);
    const noWebGL = new GlassGroup(root, true);
    noWebGL.frame(16);
    expect(noWebGL.lost).toBe(false);

    mocks.create.mockReturnValue(mocks.renderer);
    const orphan = new GlassGroup(blurView({ 'blur-effect': 'glass' }), false);
    orphan.frame(16);

    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(noShadow.active || noWebGL.active || orphan.active).toBe(false);
  });

  it('captures the backdrop up to the glass, around the canvas', () => {
    const { root } = container();
    const { backdrop, text, overlay } = scene(root);
    const group = new GlassGroup(root, true);
    expect(mocks.observe).toHaveBeenCalledWith(
      backdrop,
      root,
      expect.any(Function),
    );

    group.frame(16);
    const [target, options] = mocks.snapshot.mock.lastCall!;
    expect(target).toBe(backdrop);
    expect(options.region).toEqual({
      left: -38,
      top: -28,
      right: 258,
      bottom: 168,
    });
    expect(options.scale).toBe(2);
    expect(options.exclude(text)).toBe(false);
    expect(options.exclude(root)).toBe(true);
    expect(options.exclude(overlay)).toBe(true);

    // One capture at a time, and nothing to draw until it lands.
    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.renderer.draw).not.toHaveBeenCalled();
    expect(group.active).toBe(false);
  });

  it('draws the container’s glass shapes once the backdrop arrives', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    await captured(group);
    expect(mocks.renderer.setBackdrop).toHaveBeenCalledWith(
      SNAPSHOT.image,
      400,
      400,
    );

    group.frame(16);
    expect(lastFrame()).toEqual({
      scale: 2,
      width: 200,
      height: 100,
      offsetX: 10,
      offsetY: 20,
      smoothing: 24,
      dark: 0,
      shadow: 1,
      shapes: [
        {
          centerX: 45,
          centerY: 45,
          halfWidth: 25,
          halfHeight: 25,
          radius: 25,
          frost: 1,
          tint: [0, 0, 0, 0],
          press: 0,
        },
      ],
      pointer: [0, 0, 0],
    });
    const canvas = root.shadowRoot!.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
    expect(canvas.style.opacity).toBe('1');
    expect(group.active).toBe(true);
    expect(group.shapes).toHaveLength(1);
  });

  it('draws in CSS pixels when the page is drawn scaled', async () => {
    const { root, blob } = container();
    const { backdrop } = scene(root);
    // The backdrop is laid out 800 CSS pixels wide and drawn 400 wide.
    vi.spyOn(backdrop, 'offsetWidth', 'get').mockReturnValue(800);
    trackPress(blob);
    Object.assign(pressOf(blob)!, { target: 1, value: 1, x: 60, y: 70 });
    const group = new GlassGroup(root, true);

    group.frame(16);
    const [, options] = mocks.snapshot.mock.lastCall!;
    // A 48 CSS pixel margin is 24 screen pixels.
    expect(options.region).toEqual({
      left: -14,
      top: -4,
      right: 234,
      bottom: 144,
    });
    expect(options.scale).toBe(1);

    pending.resolve(SNAPSHOT);
    await flush();
    group.frame(16);
    expect(lastFrame()).toMatchObject({
      scale: 1,
      width: 400,
      height: 200,
      offsetX: 20,
      offsetY: 40,
      pointer: [100, 100, 1],
    });
    expect(lastFrame().shapes[0]).toMatchObject({ centerX: 90, centerY: 90 });
    // Its 25px radius, swollen by the press.
    expect(lastFrame().shapes[0]!.radius).toBeCloseTo(26.5);
    // As many device pixels as when drawn unscaled.
    const canvas = root.shadowRoot!.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
  });

  it('redraws only when something changed', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    await captured(group);
    group.frame(16);
    group.frame(16);
    expect(mocks.renderer.draw).toHaveBeenCalledTimes(1);

    root.setAttribute('spacing', 'wide');
    group.frame(16);
    expect(mocks.renderer.draw).toHaveBeenCalledTimes(2);
    expect(lastFrame().smoothing).toBe(0);
  });

  it('keeps the canvas allocation while its size holds', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    await captured(group);
    group.frame(16);
    const canvas = root.shadowRoot!.querySelector('canvas')!;
    const width = vi.spyOn(canvas, 'width', 'set');
    root.setAttribute('spacing', '20');
    group.frame(16);
    expect(width).not.toHaveBeenCalled();
  });

  it('draws a lone glass element as its own shape, without a shadow', async () => {
    const root = blurView({ 'blur-effect': 'glass' });
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(canvasBox);
    scene(root);
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 0,
    });
    const group = new GlassGroup(root, false);
    await captured(group);
    group.frame(16);
    expect(group.shapes).toEqual([root]);
    expect(lastFrame()).toMatchObject({ scale: 1, smoothing: 0, shadow: 0 });
  });

  it.each([
    ['dark', 1, 1],
    ['light', 0, 0],
    [null, 0.2, 1],
    [null, 0.9, 0],
  ])(
    'picks the material from ios-user-interface-style=%s or luminance %s',
    async (style, luminance, dark) => {
      const { root } = container();
      if (style) root.setAttribute('ios-user-interface-style', style);
      scene(root);
      const group = new GlassGroup(root, true);
      group.frame(16);
      pending.resolve({ ...SNAPSHOT, luminance });
      await flush();
      group.frame(16);
      expect(lastFrame().dark).toBe(dark);
    },
  );

  it('puts the press glow on the most pressed shape', async () => {
    const { root, blob } = container();
    scene(root);
    trackPress(blob);
    Object.assign(pressOf(blob)!, { target: 1, value: 1, x: 60, y: 70 });
    const group = new GlassGroup(root, true);
    await captured(group);
    group.frame(16);
    expect(lastFrame().pointer).toEqual([50, 50, 1]);
    expect(lastFrame().shapes[0]!.halfWidth).toBeCloseTo(26.5);
  });

  it('captures again when the backdrop changes, but not too often', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    await captured(group);
    const markStale = mocks.observe.mock.lastCall![2] as () => void;

    markStale();
    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);

    now += 100;
    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  });

  it('spaces captures out by four times their cost', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    group.frame(16);
    now += 50;
    pending.resolve(SNAPSHOT);
    await flush();
    (mocks.observe.mock.lastCall![2] as () => void)();
    now += 199;
    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    now += 1;
    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['left', rect(20, 60, 200, 100)],
    ['top', rect(60, 20, 200, 100)],
    ['right', rect(120, 60, 200, 100)],
    ['bottom', rect(60, 120, 200, 100)],
  ])('captures again when the group moves out to the %s', async (_, moved) => {
    const { root } = container();
    scene(root);
    canvasBox = rect(60, 60, 200, 100);
    const group = new GlassGroup(root, true);
    group.frame(16);
    pending.resolve({ ...SNAPSHOT, x: 50, y: 50, width: 250, height: 150 });
    await flush();
    now += 1000;

    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    canvasBox = moved;
    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  });

  it('gives up for good when a capture fails', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    group.frame(16);
    pending.reject();
    await flush();
    now += 1000;
    group.frame(16);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.renderer.setBackdrop).not.toHaveBeenCalled();
    expect(group.active).toBe(false);
  });

  it('draws nothing when the capture comes back empty', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    group.frame(16);
    pending.resolve(null);
    await flush();
    group.frame(16);
    expect(mocks.renderer.setBackdrop).not.toHaveBeenCalled();
    expect(mocks.renderer.draw).not.toHaveBeenCalled();
  });

  it('cleans up, and ignores a capture that lands after dispose', async () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    group.frame(16);
    group.dispose();
    pending.resolve(SNAPSHOT);
    await flush();

    expect(mocks.renderer.setBackdrop).not.toHaveBeenCalled();
    expect(mocks.stopObserving).toHaveBeenCalled();
    expect(mocks.renderer.dispose).toHaveBeenCalled();
    expect(root.shadowRoot!.querySelector('canvas')).toBeNull();
  });

  it('reports a lost context', () => {
    const { root } = container();
    scene(root);
    const group = new GlassGroup(root, true);
    expect(group.lost).toBe(false);
    mocks.renderer.lost = true;
    expect(group.lost).toBe(true);
  });
});

describe('backdropOf', () => {
  afterEach(() => document.body.replaceChildren());

  /**
   * A view with an inline style, holding `children`.
   */
  const view = (style: string, ...children: Element[]) => {
    const element = document.createElement('x-view');
    element.setAttribute('style', style);
    element.append(...children);
    return element;
  };

  it("skips wrappers that draw nothing, up to a card's background image", () => {
    const glass = blurView({ 'blur-effect': 'glass' });
    const row = view('', glass);
    const card = view('background-image: linear-gradient(red, blue)', row);
    document.body.append(view('background-color: rgb(0, 0, 0)', card));

    expect(backdropOf(glass)).toBe(card);
  });

  it('looks through a translucent background, such as a dimming layer', () => {
    const glass = blurView({ 'blur-effect': 'glass' });
    const dim = view('background-color: rgba(0, 0, 0, 0.35)', glass);
    const screen = view('background-color: rgb(255, 255, 255)', dim);
    document.body.append(view('background-image: none', screen));

    expect(backdropOf(glass)).toBe(screen);
  });

  it('falls back to the topmost element, the page, when nothing paints', () => {
    const glass = blurView({ 'blur-effect': 'glass' });
    const page = view('', view('', glass));
    // In Lynx for Web, the page is the top of the <lynx-view>'s shadow root.
    document.createElement('div').attachShadow({ mode: 'open' }).append(page);

    expect(backdropOf(glass)).toBe(page);
    expect(backdropOf(blurView({}))).toBeNull();
  });
});

describe('GlassGroup over a deeper backdrop', () => {
  it('leaves out what follows each of the glass’s ancestors', () => {
    const { root } = container();
    const before = document.createElement('x-text');
    const after = document.createElement('x-view');
    const row = document.createElement('x-view');
    const later = document.createElement('x-view');
    row.append(before, root, after);
    const card = placed(document.createElement('x-view'), rect(0, 0, 400, 400));
    card.style.backgroundColor = 'rgb(255, 255, 255)';
    card.append(row, later);
    document.body.append(card);

    new GlassGroup(root, true).frame(16);
    const [target, options] = mocks.snapshot.mock.lastCall!;

    expect(target).toBe(card);
    expect(options.exclude(row)).toBe(false);
    expect(options.exclude(before)).toBe(false);
    expect(options.exclude(root)).toBe(true);
    expect(options.exclude(after)).toBe(true);
    expect(options.exclude(later)).toBe(true);
  });
});
