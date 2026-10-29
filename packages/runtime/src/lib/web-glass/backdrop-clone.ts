import { parseNormalizedColor, type Rgba } from './css-color';
import { drawnScale } from './drawn-scale';

/** A rectangle in viewport (client) coordinates. */
export type Region = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CloneOptions = {
  /** Leaves an element, and everything inside it, out of the copy. */
  exclude: (element: Element) => boolean;
  /**
   * The part of the page the glass can show. A clipping element wholly
   * outside it is copied empty, which keeps long lists cheap to capture.
   */
  region: Region;
};

type Context = {
  doc: Document;
  win: Window;
  defaults: Map<string, string>;
} & CloneOptions;

// Properties that can't change a still image, or that would start animating
// inside it. Custom properties are already resolved into the real ones.
const SKIPPED_PROPERTY =
  /^(--|transition|animation|will-change|cursor|pointer-events|user-select|-webkit-user-)/;
// Widths whose computed value matches a plain div's only because that div has
// no border or outline: `0px` comes from `border-style: none`. Lynx for Web
// gives every element `border-style: solid`, so leaving the width out would
// draw a 3px (`medium`) black border in the copy.
const ALWAYS_INLINED =
  /^(border-(top|right|bottom|left)-width|outline-width|column-rule-width)$/;
const SKIPPED_TAGS = new Set(['style', 'script', 'template', 'link', 'meta']);

// Node types, spelled out: on Lynx for Web the main thread runs in an iframe's
// realm while the elements belong to the page, so `instanceof` checks against
// this realm's DOM classes would always fail.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const defaultsByDocument = new WeakMap<Document, Map<string, string>>();

/**
 * A plain div's computed style, as the copy's image draws it: anything
 * matching it needn't be inlined. The image has the browser's own styles
 * and no others, so the div is probed in a shadow root of its own, reset
 * with `all: initial`. Probed in the page, it took the page's styles too:
 * the docs site makes every element `border-box`, which was then left out,
 * and in the image a padded card grew by its padding and pushed what's in
 * it down.
 */
const defaultStyle = (doc: Document, win: Window): Map<string, string> => {
  let defaults = defaultsByDocument.get(doc);
  if (!defaults) {
    const host = doc.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const reset = doc.createElement('style');
    reset.textContent = ':host{all:initial}';
    const probe = doc.createElement('div');
    root.append(reset, probe);
    doc.documentElement.appendChild(host);
    const style = win.getComputedStyle(probe);
    defaults = new Map(
      Array.from(style, (name) => [name, style.getPropertyValue(name)]),
    );
    host.remove();
    defaultsByDocument.set(doc, defaults);
  }
  return defaults;
};

/**
 * Inlines a computed style, keeping each property that differs from a plain
 * div or from the parent. The parent check matters for inherited properties:
 * a black heading inside white text matches the default but would inherit
 * white in the copy if it were left out.
 */
const inlineStyle = (
  style: CSSStyleDeclaration,
  parent: CSSStyleDeclaration | null,
  defaults: Map<string, string>,
): string => {
  let css = '';
  for (const name of Array.from(style)) {
    if (SKIPPED_PROPERTY.test(name)) continue;
    const value = style.getPropertyValue(name);
    if (
      ALWAYS_INLINED.test(name) ||
      value !== defaults.get(name) ||
      (parent && value !== parent.getPropertyValue(name))
    ) {
      css += `${name}:${value};`;
    }
  }
  return css;
};

/**
 * Children as they render: a shadow root's children instead of the light
 * ones, with each `<slot>` replaced by what's assigned to it. Every Lynx for
 * Web element is a custom element that draws its children through a slot.
 */
const renderedChildren = (element: Element): Node[] =>
  Array.from(element.shadowRoot?.childNodes ?? element.childNodes).flatMap(
    (child) =>
      (child as Element).localName === 'slot'
        ? (child as HTMLSlotElement).assignedNodes({ flatten: true })
        : [child],
  );

/**
 * Moves a child of a scrolled element by the scroll offset, so the copy shows
 * what's scrolled into view rather than the top of the content.
 */
const scrollShift = (
  style: CSSStyleDeclaration,
  [x, y]: readonly [number, number],
): string => {
  if (!x && !y) return '';
  if (style.position === 'fixed' || style.position === 'sticky') return '';
  if (style.position === 'static') {
    return `position:relative;left:${-x}px;top:${-y}px;`;
  }
  const left = (parseFloat(style.left) || 0) - x;
  const top = (parseFloat(style.top) || 0) - y;
  return `left:${left}px;top:${top}px;`;
};

/**
 * Inlines an image as a data URL: an SVG image can't load anything external.
 * A cross-origin image without CORS taints the canvas and is left blank.
 */
const mediaSource = (element: Element, doc: Document): string => {
  try {
    if (element.localName === 'canvas') {
      return (element as HTMLCanvasElement).toDataURL();
    }
    const image = element as HTMLImageElement;
    if (!image.complete || !image.naturalWidth) return '';
    const canvas = doc.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas.toDataURL();
  } catch {
    return '';
  }
};

const outside = (rect: DOMRect, region: Region): boolean =>
  rect.right <= region.left ||
  rect.left >= region.right ||
  rect.bottom <= region.top ||
  rect.top >= region.bottom;

const cloneNode = (
  node: Node,
  context: Context,
  parent: CSSStyleDeclaration | null,
  scroll: readonly [number, number],
): Node | null => {
  if (node.nodeType === TEXT_NODE) {
    return context.doc.createTextNode((node as Text).data);
  }
  if (node.nodeType !== ELEMENT_NODE) return null;
  const element = node as Element;
  if (SKIPPED_TAGS.has(element.localName) || context.exclude(element)) {
    return null;
  }
  const style = context.win.getComputedStyle(element);
  if (style.display === 'none') return null;

  const media = element.localName === 'img' || element.localName === 'canvas';
  const clone = context.doc.createElement(media ? 'img' : 'div');
  clone.setAttribute(
    'style',
    inlineStyle(style, parent, context.defaults) + scrollShift(style, scroll),
  );
  if (media) {
    const source = mediaSource(element, context.doc);
    if (source) clone.setAttribute('src', source);
    return clone;
  }
  const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
  if (clips && outside(element.getBoundingClientRect(), context.region)) {
    return clone;
  }
  const childScroll = [element.scrollLeft, element.scrollTop] as const;
  for (const child of renderedChildren(element)) {
    const copy = cloneNode(child, context, style, childScroll);
    if (copy) clone.appendChild(copy);
  }
  return clone;
};

/**
 * The color behind an element: its own background, or the first ancestor's
 * that isn't transparent, crossing shadow roots. White when nothing paints.
 */
export const effectiveBackground = (element: Element): Rgba => {
  const win = element.ownerDocument.defaultView!;
  let node: Element | null = element;
  while (node) {
    const color = parseNormalizedColor(
      win.getComputedStyle(node).backgroundColor,
    );
    if (color[3] > 0) return color;
    node =
      node.parentElement ??
      ((node.getRootNode() as Partial<ShadowRoot>).host as Element | null) ??
      null;
  }
  return [1, 1, 1, 1];
};

/**
 * Copies `root` into plain divs with inlined styles, ready to rasterize inside
 * an SVG `<foreignObject>`. The copy is pinned to the top-left of a frame the
 * size of `root`, painted with the color behind it, so transparent areas show
 * what the page shows there instead of nothing.
 *
 * The frame is rounded up to whole CSS pixels. The browser paints it in whole
 * pixels, so a fractional size would leave its last row or column part
 * transparent, and the glass shows a transparent image edge as a dark band.
 */
export const cloneBackdrop = (
  root: HTMLElement,
  options: CloneOptions,
): HTMLElement => {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  // The root's size in CSS pixels, which its copied contents lay out in,
  // rather than its scaled size when the page is drawn scaled.
  const bounds = root.getBoundingClientRect();
  const zoom = drawnScale(root);
  const width = bounds.width / zoom;
  const height = bounds.height / zoom;
  const [r, g, b, a] = effectiveBackground(root);
  const frame = doc.createElement('div');
  frame.setAttribute(
    'style',
    `width:${Math.ceil(width)}px;height:${Math.ceil(height)}px;` +
      `overflow:hidden;` +
      `background:rgba(${r * 255},${g * 255},${b * 255},${a});`,
  );
  const context = { ...options, doc, win, defaults: defaultStyle(doc, win) };
  const clone = cloneNode(root, context, null, [0, 0]) as HTMLElement | null;
  if (clone) {
    // Whatever placed the root in the page (margins, offsets, transforms)
    // isn't part of the picture.
    clone.style.cssText +=
      `margin:0;position:relative;left:0;top:0;right:auto;bottom:auto;` +
      `transform:none;width:${width}px;height:${height}px;`;
    frame.appendChild(clone);
  }
  return frame;
};
