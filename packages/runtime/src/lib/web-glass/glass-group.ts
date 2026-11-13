import { observeBackdrop } from './backdrop-observer';
import { snapshotBackdrop, type BackdropSnapshot } from './backdrop-snapshot';
import { parseNormalizedColor } from './css-color';
import { drawnScale } from './drawn-scale';
import { GlassRenderer, type GlassFrame } from './glass-renderer';
import { containerShapes, readShape } from './glass-shapes';

// The glass blurs what's around it into itself, by about 12px and a little
// from much further, so the captured region reaches this far beyond the
// group. Past it, the blur reads the image's edge.
const CAPTURE_MARGIN = 48;
// How far a container's canvas reaches past its box: room for its shapes'
// shadow, which fades out before the canvas's edge, the line down their
// sides, and a pressed shape's swell. A container hugs its shapes, so with
// no margin they were cut off in a straight line at its edge.
const CONTAINER_MARGIN = 32;
// Captures run on the main thread, so they're spaced out: at least this many
// milliseconds apart, and four times as long as the last one took.
const MIN_CAPTURE_INTERVAL = 100;
// Capturing the backdrop sharper than 2x costs memory and capture time for no
// visible gain: the glass blurs it, or shows it through a lens.
const MAX_CAPTURE_SCALE = 2;
// The glass itself is drawn up to 3x: its edge is lines two thirds of a pixel
// wide, which a phone's screen shows crisply and a 2x canvas smears.
const MAX_SCALE = 3;
// How long a group's canvas stays put, in milliseconds, before it counts as
// having come to rest (see #settle).
const SETTLE_MS = 150;
// Backdrops darker than this get the dark material, like iOS in dark mode.
const DARK_LUMINANCE = 0.4;

/** What a glass group refracts (see backdropOf). */
export type Backdrop = {
  /** The element whose drawing the glass refracts. */
  readonly element: HTMLElement;
  /**
   * The fixed-position element the glass is in, or is, such as a Lynx
   * overlay on the web: it paints above the page wherever it sits in the
   * DOM. Null when the glass is in the page's flow.
   */
  readonly layer: HTMLElement | null;
};

const isFixed = (win: Window, element: Element) =>
  win.getComputedStyle(element).position === 'fixed';

/**
 * What a glass group refracts: the nearest ancestor that paints over
 * everything behind it, with an opaque background color or a background
 * image, or else the topmost one, the page. The glass's own parent is often a
 * row or a wrapper that draws nothing, while what the glass floats over
 * belongs to an ancestor: a card's gradient, or the screen's content. iOS's
 * glass shows whatever is on screen behind it.
 *
 * Glass that's fixed, or in something fixed below that ancestor, refracts
 * the page instead: a menu's overlay sits in the DOM beside the button that
 * opened it, often in a row or a card, but it's drawn over the whole screen.
 */
export const backdropOf = (root: HTMLElement): Backdrop | null => {
  const win = root.ownerDocument.defaultView!;
  let layer = isFixed(win, root) ? root : null;
  let element = root.parentElement;
  while (element?.parentElement) {
    if (!layer) {
      const style = win.getComputedStyle(element);
      if (
        (style.backgroundImage && style.backgroundImage !== 'none') ||
        parseNormalizedColor(style.backgroundColor)[3] >= 1
      ) {
        return { element, layer };
      }
      if (style.position === 'fixed') layer = element;
    }
    element = element.parentElement;
  }
  return element && { element, layer };
};

/**
 * Whether `element` is drawn above the glass, and so left out of what it
 * refracts: the glass, and everything after it and after each of its
 * ancestors, since later content paints on top. In the page's flow that's up
 * to the backdrop. A fixed layer paints above the content around it, so
 * there it's up to the layer.
 *
 * Fixed elements stacked above the glass count too, wherever they are in the
 * document: an open sheet's overlay over a button in the page, or a second
 * menu over the first. That's a higher `z-index` than the layer's (than
 * none, for glass in the page's flow), or the same one and later in the
 * page.
 *
 * What the glass's own layer holds under it stays in: the dimming layer of a
 * sheet or an alert is the overlay's own background, or a view before the
 * glass, and UIKit's glass shows the screen through it, dimmed.
 */
const drawnAbove = (
  root: HTMLElement,
  { element: backdrop, layer }: Backdrop,
): ((element: Element) => boolean) => {
  const win = root.ownerDocument.defaultView!;
  const above = new Set<Element>([root]);
  for (
    let node: Element | null = root;
    node && node !== backdrop && node !== layer;
    node = node.parentElement
  ) {
    for (
      let sibling = node.nextElementSibling;
      sibling;
      sibling = sibling.nextElementSibling
    ) {
      above.add(sibling);
    }
  }
  const zIndex = (element: Element) =>
    parseInt(win.getComputedStyle(element).zIndex, 10) || 0;
  // What the fixed elements are measured against: the layer, or the glass.
  const reference = layer ?? root;
  const referenceZ = layer ? zIndex(layer) : 0;
  return (element) => {
    if (above.has(element)) return true;
    if (
      element === reference ||
      element.contains(reference) ||
      reference.contains(element) ||
      !isFixed(win, element)
    ) {
      return false;
    }
    const z = zIndex(element);
    return (
      z > referenceZ ||
      (z === referenceZ &&
        // Node.DOCUMENT_POSITION_FOLLOWING, spelled out: the elements
        // belong to the page, not to the main thread's realm.
        (reference.compareDocumentPosition(element) & 4) !== 0)
    );
  };
};

/**
 * Whether `node` is the glass, or in something drawn above it: a change
 * there changes nothing behind the glass.
 */
const inFront = (
  node: Node,
  backdrop: Element,
  above: (element: Element) => boolean,
): boolean => {
  // Node.ELEMENT_NODE, spelled out (see drawnAbove).
  let element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  for (; element && element !== backdrop; element = element.parentElement) {
    if (above(element)) return true;
  }
  return false;
};

/**
 * Draws one group of Liquid Glass on Lynx for Web: a `glass-container` and the
 * glass shapes directly inside it, or a lone `glass` element.
 *
 * A canvas in the root's shadow root, stacked under its children, draws every
 * shape refracting an image of the backdrop (see backdropOf), captured up to
 * the root. The image is captured again when anything in the backdrop (other
 * than the glass itself) changes, resizes or scrolls.
 */
export class GlassGroup {
  readonly root: HTMLElement;
  readonly container: boolean;
  readonly #win: Window;
  readonly #canvas: HTMLCanvasElement;
  readonly #renderer: GlassRenderer | null;
  readonly #backdrop: Backdrop | null;
  readonly #margin: number;
  #stopObserving: (() => void) | null = null;
  #snapshot: BackdropSnapshot | null = null;
  #stale = true;
  /** When the group's canvas last moved or resized, or 0 once it settled. */
  #moved = 0;
  #where = '';
  #capturing = false;
  #failed = false;
  #disposed = false;
  #nextCapture = 0;
  #drawn = '';

  constructor(root: HTMLElement, container: boolean) {
    this.root = root;
    this.container = container;
    const doc = root.ownerDocument;
    this.#win = doc.defaultView!;
    this.#canvas = doc.createElement('canvas');
    this.#canvas.setAttribute('aria-hidden', 'true');
    // A container's canvas reaches past it (see CONTAINER_MARGIN), and the
    // container doesn't clip it (see glass-host-style.ts). A lone shape's is
    // its own box: its shadow is CSS, and it swells as a whole element. It's
    // sized with width and height, not by insets: a canvas is a replaced
    // element, which insets place but don't stretch. It fades in over the
    // frosted fallback once the first frame is drawn.
    this.#margin = container ? CONTAINER_MARGIN : 0;
    const size = `calc(100% + ${2 * this.#margin}px)`;
    this.#canvas.style.cssText =
      `position:absolute;left:${-this.#margin}px;top:${-this.#margin}px;` +
      `width:${size};height:${size};` +
      'pointer-events:none;z-index:-1;opacity:0;transition:opacity 0.2s';
    const shadow = root.shadowRoot;
    shadow?.insertBefore(this.#canvas, shadow.querySelector('slot'));
    this.#renderer = shadow ? GlassRenderer.create(this.#canvas) : null;
    this.#backdrop = backdropOf(root);
    if (this.#renderer && this.#backdrop) {
      // Changes inside the glass, or in what's drawn above it, don't change
      // what's behind it: a sheet's own content, which follows its glass,
      // would otherwise have it capture the page again at every keystroke.
      const backdrop = this.#backdrop;
      const above = drawnAbove(root, backdrop);
      this.#stopObserving = observeBackdrop(
        backdrop.element,
        (node) => inFront(node, backdrop.element, above),
        () => {
          this.#stale = true;
        },
      );
    }
  }

  /**
   * The glass elements this group draws.
   */
  get shapes(): HTMLElement[] {
    return this.container ? containerShapes(this.root) : [this.root];
  }

  /**
   * True once WebGL has drawn the glass, so the CSS fallback can go.
   */
  get active(): boolean {
    return this.#drawn !== '' && !this.#failed;
  }

  /**
   * The material the group draws and how bright its backdrop is, for the CSS
   * that draws a lone shape's shadow and edge lines. Before the first
   * capture, the backdrop counts as white.
   */
  get look(): { dark: boolean; luminance: number } {
    const snapshot = this.#snapshot;
    return {
      dark: this.#dark(snapshot) === 1,
      // In tenths, so a backdrop that fades doesn't rewrite the style on
      // every frame.
      luminance: snapshot ? Math.round(snapshot.brightness * 10) / 10 : 1,
    };
  }

  /**
   * True when the GPU dropped the context; the group must be rebuilt.
   */
  get lost(): boolean {
    return this.#renderer?.lost ?? false;
  }

  /**
   * Whether `element` is part of what this group refracts: inside its
   * backdrop, and not drawn above it. Other glass that is shows through this
   * glass, so the manager has this group capture again when that glass
   * changes (see invalidate).
   */
  shows(element: Element): boolean {
    const backdrop = this.#backdrop;
    return (
      !!backdrop &&
      backdrop.element.contains(element) &&
      !inFront(element, backdrop.element, drawnAbove(this.root, backdrop))
    );
  }

  /**
   * Has the group capture its backdrop again: something behind it changed
   * that the page's own changes don't announce, such as other glass
   * redrawing its canvas.
   */
  invalidate(): void {
    this.#stale = true;
  }

  /**
   * Draws a frame if anything changed, and says whether it did; `elapsed` is
   * in milliseconds.
   */
  frame(elapsed: number): boolean {
    const renderer = this.#renderer;
    const backdrop = this.#backdrop?.element;
    if (!renderer || !backdrop || this.#failed) return false;
    // Boxes are measured in screen pixels, and the frame is drawn in CSS
    // pixels, which differ when the page is drawn scaled (see drawn-scale.ts).
    const origin = this.#canvas.getBoundingClientRect();
    const area = backdrop.getBoundingClientRect();
    const zoom = drawnScale(backdrop);
    this.#settle(origin);
    if (this.#needsCapture(origin, area, zoom)) {
      this.#capture(backdrop, origin, zoom);
    }
    const snapshot = this.#snapshot;
    if (!snapshot) return false;

    // Device pixels per CSS pixel, so the canvas stays sharp at any zoom.
    const scale = Math.min(this.#win.devicePixelRatio || 1, MAX_SCALE) * zoom;
    const elements = this.shapes;
    const read = elements.map((element) =>
      readShape(element, origin, zoom, elapsed),
    );
    // A shape with no width or height draws nothing on iOS, but its distance
    // field is a line, which the smooth union bulges into the shapes beside
    // it: the search field's cancel button, collapsed beside the field.
    const shapes = read.filter(
      (shape) => shape.halfWidth >= 0.5 && shape.halfHeight >= 0.5,
    );
    const spacing = parseFloat(this.root.getAttribute('spacing') ?? '') || 0;
    const frame: GlassFrame = {
      scale,
      width: origin.width / zoom,
      height: origin.height / zoom,
      offsetX: (origin.left - area.left) / zoom - snapshot.x,
      offsetY: (origin.top - area.top) / zoom - snapshot.y,
      // The radius of the smooth union: it bridges a gap of up to half of it,
      // which is where UIKit's container starts to join two shapes too.
      smoothing: this.container ? spacing : 0,
      dark: this.#dark(snapshot),
      // Outside its shapes a container's canvas is empty space, for their
      // shadow and the line down their sides. A lone shape's canvas is its
      // own box, so its CSS draws them (see glass-host-style.ts).
      outside: this.container ? 1 : 0,
      luminance: snapshot.brightness,
      // Without the press each carries: the frame is compared with the last
      // one drawn, and a press changes it through the shape's size alone.
      shapes: shapes.map(({ press: _press, ...shape }) => shape),
    };
    const key = JSON.stringify(frame);
    if (key === this.#drawn) return false;
    const width = Math.max(1, Math.round(frame.width * scale));
    const height = Math.max(1, Math.round(frame.height * scale));
    // Assigning a canvas size reallocates it even when the size is unchanged.
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;
    renderer.draw(frame);
    this.#drawn = key;
    this.#canvas.style.opacity = '1';
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopObserving?.();
    this.#renderer?.dispose();
    this.#canvas.remove();
  }

  /**
   * 1 for the dark material. `ios-user-interface-style` picks it, as on iOS:
   * the group's own, or else its first shape's, since a container draws
   * nothing itself and is often given none (a `ui-glass-group`). With
   * neither, it follows the backdrop, as UIKit's glass adapts to what's
   * behind it.
   */
  #dark(snapshot: BackdropSnapshot | null): number {
    const forced =
      this.root.getAttribute('ios-user-interface-style') ??
      (this.container
        ? this.shapes[0]?.getAttribute('ios-user-interface-style')
        : null);
    if (forced) return forced === 'dark' ? 1 : 0;
    return snapshot && snapshot.luminance < DARK_LUMINANCE ? 1 : 0;
  }

  /**
   * Captures once more when the glass comes to rest after moving: a sheet
   * sliding up while its dimming layer fades in, or a menu growing open. The
   * picture taken on the way caught what's behind it mid-change, and an
   * animation ending is no change to the page that the observer hears of.
   */
  #settle(origin: DOMRect): void {
    const now = this.#win.performance.now();
    const where = `${origin.left},${origin.top},${origin.width},${origin.height}`;
    if (where !== this.#where) {
      // The first frame places the glass; it didn't move there.
      if (this.#where) this.#moved = now;
      this.#where = where;
    } else if (this.#moved && now - this.#moved > SETTLE_MS) {
      this.#moved = 0;
      this.#stale = true;
    }
  }

  #needsCapture(origin: DOMRect, area: DOMRect, zoom: number): boolean {
    if (this.#capturing) return false;
    const snapshot = this.#snapshot;
    if (snapshot) {
      // Moving the whole group (not just its shapes) past the captured region
      // would refract the image's clamped edge, so capture around it again.
      const left = (Math.max(origin.left, area.left) - area.left) / zoom;
      const top = (Math.max(origin.top, area.top) - area.top) / zoom;
      const right = (Math.min(origin.right, area.right) - area.left) / zoom;
      const bottom = (Math.min(origin.bottom, area.bottom) - area.top) / zoom;
      if (
        left < snapshot.x - 1 ||
        top < snapshot.y - 1 ||
        right > snapshot.x + snapshot.width + 1 ||
        bottom > snapshot.y + snapshot.height + 1
      ) {
        this.#stale = true;
      }
    }
    return this.#stale && this.#win.performance.now() >= this.#nextCapture;
  }

  #capture(backdrop: HTMLElement, origin: DOMRect, zoom: number): void {
    const win = this.#win;
    this.#capturing = true;
    this.#stale = false;
    const started = win.performance.now();
    // The region is in screen pixels, and the margins in CSS pixels. It's
    // measured from the root, which a container's canvas reaches past: the
    // shapes inside it are what sample the image.
    const margin = (CAPTURE_MARGIN - this.#margin) * zoom;
    snapshotBackdrop(backdrop, {
      exclude: drawnAbove(this.root, this.#backdrop!),
      region: {
        left: origin.left - margin,
        top: origin.top - margin,
        right: origin.right + margin,
        bottom: origin.bottom + margin,
      },
      scale: Math.min(win.devicePixelRatio || 1, MAX_CAPTURE_SCALE) * zoom,
    })
      .then((snapshot) => {
        if (this.#disposed || !snapshot) return;
        this.#renderer!.setBackdrop(
          snapshot.image,
          snapshot.width,
          snapshot.height,
        );
        this.#snapshot = snapshot;
        this.#drawn = '';
      })
      .catch(() => {
        // The image wouldn't decode, or it tainted the canvas (Safari can
        // treat any <foreignObject> as cross-origin): keep the CSS fallback.
        this.#failed = true;
      })
      .finally(() => {
        this.#capturing = false;
        const now = win.performance.now();
        this.#nextCapture =
          now + Math.max(MIN_CAPTURE_INTERVAL, (now - started) * 4);
      });
  }
}
