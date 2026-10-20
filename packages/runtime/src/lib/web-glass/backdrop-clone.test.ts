// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneBackdrop, effectiveBackground } from './backdrop-clone';

// jsdom computes almost no styles, so each element gets the computed style a
// test assigns it, over these plain-div defaults.
const DEFAULTS: Record<string, string> = {
  display: 'block',
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'border-top-width': '0px',
  position: 'static',
  left: 'auto',
  top: 'auto',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  transition: 'all',
};
const styles = new Map<Element, Record<string, string>>();

const camel = (name: string) =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const computed = (element: Element) => {
  const values = { ...DEFAULTS, ...styles.get(element) };
  const names = Object.keys(values);
  const style: Record<string | number | symbol, unknown> = {
    length: names.length,
    [Symbol.iterator]: () => names[Symbol.iterator](),
    getPropertyValue: (name: string) => values[name] ?? '',
  };
  names.forEach((name, i) => {
    style[i] = name;
    style[camel(name)] = values[name];
  });
  return style as unknown as CSSStyleDeclaration;
};

const element = (
  tag: string,
  style: Record<string, string> = {},
  ...children: (Node | string)[]
) => {
  const node = document.createElement(tag);
  styles.set(node, style);
  node.append(...children);
  return node;
};

const at = (node: Element, left: number, top: number, size = 10) =>
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    right: left + size,
    bottom: top + size,
    width: size,
    height: size,
  } as DOMRect);

const EVERYWHERE = { left: -1e4, top: -1e4, right: 1e4, bottom: 1e4 };

const clone = (
  root: HTMLElement,
  exclude: (e: Element) => boolean = () => false,
) =>
  cloneBackdrop(root, { exclude, region: EVERYWHERE })
    .firstElementChild as HTMLElement | null;

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(computed);
});

afterEach(() => {
  vi.restoreAllMocks();
  styles.clear();
});

describe('cloneBackdrop', () => {
  it('inlines only what a plain div or the parent would not give', () => {
    const child = element('x-text', { color: 'rgb(0, 0, 0)' });
    const root = element(
      'x-view',
      { color: 'rgb(255, 0, 0)', transition: 'none', '--tw-ring': '1px' },
      child,
    );
    const copy = clone(root)!;
    const { style } = copy;

    expect(style.color).toBe('rgb(255, 0, 0)');
    expect(style.getPropertyValue('transition')).toBe('');
    expect(style.getPropertyValue('--tw-ring')).toBe('');
    expect(style.display).toBe('');
    // Lynx for Web draws solid borders, so their width always goes along.
    expect(style.borderTopWidth).toBe('0px');
    // Black matches the default, but the parent is red: it must be kept.
    expect(copy.firstElementChild!.getAttribute('style')).toContain(
      'color:rgb(0, 0, 0)',
    );
  });

  it('copies custom elements as plain divs, keeping their text', () => {
    const copy = clone(element('x-view', {}, element('x-text', {}, 'Liquid')))!;
    expect(copy.localName).toBe('div');
    expect(copy.firstElementChild!.localName).toBe('div');
    expect(copy.textContent).toBe('Liquid');
  });

  it('renders shadow roots, with each slot replaced by its content', () => {
    const host = element('x-text', {}, 'slotted');
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = element('span', {}, 'before ');
    shadow.append(
      element('style', {}, ':host{}'),
      inner,
      document.createElement('slot'),
    );
    const copy = clone(element('x-view', {}, host))!;
    expect(copy.textContent).toBe('before slotted');
  });

  it('leaves out excluded and hidden elements, styles and comments', () => {
    const glass = element('x-blur-view', {}, 'glass');
    const root = element(
      'x-view',
      {},
      element('x-view', { display: 'none' }, 'hidden'),
      element('script', {}, 'code'),
      document.createComment('comment'),
      glass,
      'kept',
    );
    expect(clone(root, (e) => e === glass)!.textContent).toBe('kept');
  });

  it('shifts the children of a scrolled element by its scroll offset', () => {
    const children = {
      static: element('x-view'),
      relative: element('x-view', { position: 'relative', top: '4px' }),
      absolute: element('x-view', { position: 'absolute' }),
      fixed: element('x-view', { position: 'fixed' }),
      sticky: element('x-view', { position: 'sticky' }),
    };
    const scroller = element('scroll-view', {}, ...Object.values(children));
    Object.defineProperties(scroller, {
      scrollLeft: { value: 5 },
      scrollTop: { value: 10 },
    });
    const [still, relative, absolute, fixed, sticky] = Array.from(
      clone(element('x-view', {}, scroller))!.firstElementChild!.children,
      (child) => child.getAttribute('style')!,
    );
    expect(still).toContain('position:relative;left:-5px;top:-10px;');
    expect(relative).toContain('left:-5px;top:-6px;');
    expect(absolute).toContain('left:-5px;top:-10px;');
    expect(fixed).not.toContain('top:');
    expect(sticky).not.toContain('top:');
  });

  it('copies a clipping element wholly outside the region empty', () => {
    const clipped = (left: number, top: number) => {
      const node = element('x-view', { 'overflow-x': 'hidden' }, 'clipped');
      at(node, left, top);
      return node;
    };
    const spilling = element('x-view', { 'overflow-y': 'visible' }, 'spills ');
    at(spilling, 5000, 5000);
    const inside = element('x-view', { 'overflow-x': 'hidden' }, 'inside');
    at(inside, 50, 50);
    const root = element(
      'x-view',
      {},
      clipped(-50, 50), // left of the region
      clipped(150, 50), // right of it
      clipped(50, -50), // above it
      clipped(50, 150), // below it
      spilling,
      inside,
    );
    const copy = cloneBackdrop(root, {
      exclude: () => false,
      region: { left: 0, top: 0, right: 100, bottom: 100 },
    });
    expect(copy.textContent).toBe('spills inside');
  });

  describe('images', () => {
    beforeEach(() => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/png;base64,AAAA',
      );
    });

    const loaded = (image: HTMLImageElement) =>
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 4 },
        naturalHeight: { value: 2 },
      });

    it('inlines loaded images and canvases as data URLs', () => {
      const image = loaded(element('img') as HTMLImageElement);
      const canvas = element('canvas');
      const [copiedImage, copiedCanvas] = clone(
        element('x-view', {}, image, canvas),
      )!.children;
      expect(copiedImage!.localName).toBe('img');
      expect(copiedImage!.getAttribute('src')).toBe(
        'data:image/png;base64,AAAA',
      );
      expect(copiedCanvas!.localName).toBe('img');
      expect(copiedCanvas!.getAttribute('src')).toBe(
        'data:image/png;base64,AAAA',
      );
    });

    it('leaves out images that have not loaded or taint the canvas', () => {
      const pending = element('img');
      const tainted = loaded(element('img') as HTMLImageElement);
      vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(
        () => {
          throw new DOMException('tainted', 'SecurityError');
        },
      );
      const copies = clone(element('x-view', {}, pending, tainted))!.children;
      expect(copies[0]!.hasAttribute('src')).toBe(false);
      expect(copies[1]!.hasAttribute('src')).toBe(false);
    });
  });

  it('pins the copy to the top-left of a frame painted with the background', () => {
    const root = element('x-view', { margin: '20px' });
    at(root, 40, 60, 100);
    const frame = cloneBackdrop(root, {
      exclude: () => false,
      region: EVERYWHERE,
    });
    expect(frame.getAttribute('style')).toBe(
      'width:100px;height:100px;overflow:hidden;background:rgba(255,255,255,1);',
    );
    const copy = frame.firstElementChild as HTMLElement;
    expect(copy.style.margin).toBe('0px');
    expect(copy.style.position).toBe('relative');
    expect(copy.style.width).toBe('100px');
  });

  it('is an empty frame when the root itself is hidden', () => {
    const frame = cloneBackdrop(element('x-view', { display: 'none' }), {
      exclude: () => false,
      region: EVERYWHERE,
    });
    expect(frame.childNodes).toHaveLength(0);
  });
});

describe('effectiveBackground', () => {
  it('uses the element’s own background', () => {
    const node = element('x-view', { 'background-color': 'rgb(0, 0, 255)' });
    expect(effectiveBackground(node)).toEqual([0, 0, 1, 1]);
  });

  it('looks through transparent ancestors and out of shadow roots', () => {
    const host = element('x-view', {
      'background-color': 'rgba(255, 0, 0, 0.5)',
    });
    const inner = element('div');
    host.attachShadow({ mode: 'open' }).append(inner);
    document.body.append(host);
    expect(effectiveBackground(inner)).toEqual([1, 0, 0, 0.5]);
    host.remove();
  });

  it('is white when nothing paints', () => {
    const node = element('x-view');
    document.body.append(node);
    expect(effectiveBackground(node)).toEqual([1, 1, 1, 1]);
    node.remove();
  });
});
