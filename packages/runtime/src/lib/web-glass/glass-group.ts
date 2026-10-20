import { observeBackdrop } from './backdrop-observer';
import { snapshotBackdrop, type BackdropSnapshot } from './backdrop-snapshot';
import { drawnScale } from './drawn-scale';
import { GlassRenderer, type GlassFrame } from './glass-renderer';
import { pressOf } from './glass-press';
import { containerShapes, readShape } from './glass-shapes';

// The lens samples up to about half a shape's radius past its edge, so the
// captured region reaches this far beyond the group.
const CAPTURE_MARGIN = 48;
// Captures run on the main thread, so they're spaced out: at least this many
// milliseconds apart, and four times as long as the last one took.
const MIN_CAPTURE_INTERVAL = 100;
// Sharper than 2x costs memory and capture time for no visible gain.
const MAX_SCALE = 2;
// Backdrops darker than this get the dark material, like iOS in dark mode.
const DARK_LUMINANCE = 0.4;

/**
 * Draws one group of Liquid Glass on Lynx for Web: a `glass-container` and the
 * glass shapes directly inside it, or a lone `glass` element.
 *
 * A canvas in the root's shadow root, stacked under its children, draws every
 * shape refracting an image of the backdrop: the root's parent, captured up to
 * the root. The image is captured again when anything in the backdrop (other
 * than the glass itself) changes, resizes or scrolls.
 */
export class GlassGroup {
  readonly root: HTMLElement;
  readonly container: boolean;
  readonly #win: Window;
  readonly #canvas: HTMLCanvasElement;
  readonly #renderer: GlassRenderer | null;
  readonly #backdrop: HTMLElement | null;
  #stopObserving: (() => void) | null = null;
  #snapshot: BackdropSnapshot | null = null;
  #stale = true;
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
    // Fades in over the frosted fallback once the first frame is drawn.
    this.#canvas.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:-1;opacity:0;transition:opacity 0.2s';
    const shadow = root.shadowRoot;
    shadow?.insertBefore(this.#canvas, shadow.querySelector('slot'));
    this.#renderer = shadow ? GlassRenderer.create(this.#canvas) : null;
    this.#backdrop = root.parentElement;
    if (this.#renderer && this.#backdrop) {
      this.#stopObserving = observeBackdrop(this.#backdrop, root, () => {
        this.#stale = true;
      });
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
   * True when the GPU dropped the context; the group must be rebuilt.
   */
  get lost(): boolean {
    return this.#renderer?.lost ?? false;
  }

  /**
   * Draws a frame if anything changed; `elapsed` is in milliseconds.
   */
  frame(elapsed: number): void {
    const renderer = this.#renderer;
    const backdrop = this.#backdrop;
    if (!renderer || !backdrop || this.#failed) return;
    // Boxes are measured in screen pixels, and the frame is drawn in CSS
    // pixels, which differ when the page is drawn scaled (see drawn-scale.ts).
    const origin = this.#canvas.getBoundingClientRect();
    const area = backdrop.getBoundingClientRect();
    const zoom = drawnScale(backdrop);
    if (this.#needsCapture(origin, area, zoom)) {
      this.#capture(backdrop, origin, zoom);
    }
    const snapshot = this.#snapshot;
    if (!snapshot) return;

    // Device pixels per CSS pixel, so the canvas stays sharp at any zoom.
    const scale = Math.min(this.#win.devicePixelRatio || 1, MAX_SCALE) * zoom;
    const elements = this.shapes;
    const shapes = elements.map((element) =>
      readShape(element, origin, zoom, elapsed, this.container),
    );
    // The press glow follows whichever shape is pressed the most.
    let pointer: [number, number, number] = [0, 0, 0];
    elements.forEach((element, i) => {
      const value = shapes[i]!.press;
      if (value > pointer[2]) {
        const { x, y } = pressOf(element)!;
        pointer = [(x - origin.left) / zoom, (y - origin.top) / zoom, value];
      }
    });
    const spacing = parseFloat(this.root.getAttribute('spacing') ?? '') || 0;
    const frame: GlassFrame = {
      scale,
      width: origin.width / zoom,
      height: origin.height / zoom,
      offsetX: (origin.left - area.left) / zoom - snapshot.x,
      offsetY: (origin.top - area.top) / zoom - snapshot.y,
      // Twice the spacing: the smooth union only bridges a gap up to half its
      // radius, and iOS merges shapes closer than `spacing`.
      smoothing: this.container ? spacing * 2 : 0,
      dark: this.#dark(snapshot),
      // Outside its shapes a container's canvas is empty space for a shadow;
      // a lone shape's canvas is its own box, where it would darken the corners.
      shadow: this.container ? 1 : 0,
      shapes,
      pointer,
    };
    const key = JSON.stringify(frame);
    if (key === this.#drawn) return;
    const width = Math.max(1, Math.round(frame.width * scale));
    const height = Math.max(1, Math.round(frame.height * scale));
    // Assigning a canvas size reallocates it even when the size is unchanged.
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;
    renderer.draw(frame);
    this.#drawn = key;
    this.#canvas.style.opacity = '1';
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopObserving?.();
    this.#renderer?.dispose();
    this.#canvas.remove();
  }

  #dark(snapshot: BackdropSnapshot): number {
    const forced = this.root.getAttribute('ios-user-interface-style');
    if (forced) return forced === 'dark' ? 1 : 0;
    return snapshot.luminance < DARK_LUMINANCE ? 1 : 0;
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
    // The glass and everything after it paints on top of the glass, not
    // behind it.
    const above = new Set<Element>();
    for (
      let node: Element | null = this.root;
      node;
      node = node.nextElementSibling
    ) {
      above.add(node);
    }
    // The region is in screen pixels, and the margin in CSS pixels.
    const margin = CAPTURE_MARGIN * zoom;
    snapshotBackdrop(backdrop, {
      exclude: (element) => above.has(element),
      region: {
        left: origin.left - margin,
        top: origin.top - margin,
        right: origin.right + margin,
        bottom: origin.bottom + margin,
      },
      scale: Math.min(win.devicePixelRatio || 1, MAX_SCALE) * zoom,
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
