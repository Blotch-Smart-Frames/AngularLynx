import { GlassGroup } from './glass-group';
import { applyHostStyle } from './glass-host-style';
import { trackPress } from './glass-press';
import { glassRole } from './glass-shapes';

// The attributes that change what a `<blur-view>` looks like as glass.
const GLASS_ATTRIBUTES = [
  'blur-effect',
  'blur-radius',
  'glass-style',
  'glass-tint-color',
  'glass-interactive',
  'spacing',
  'ios-user-interface-style',
];

// How often removed `<blur-view>`s are checked for being put back.
const DETACHED_POLL_MS = 1000;
// Caps a frame's elapsed time, so a tab returning from the background doesn't
// jump its press animations.
const MAX_ELAPSED_MS = 100;

// The page's window, as `Document.defaultView` types it: with constructors
// such as IntersectionObserver, which `Window` alone doesn't declare.
type PageWindow = Window & typeof globalThis;

const managers = new WeakMap<PageWindow, GlassManager>();

/**
 * Looks after every `<blur-view>` of one page on Lynx for Web. It tracks which
 * are on screen, builds a `GlassGroup` for each visible container or lone
 * glass element, and runs their frames while any is visible. Each element's
 * shadow-root style follows: frosted CSS until WebGL draws it, then none.
 */
export class GlassManager {
  readonly #win: PageWindow;
  readonly #visible = new Set<HTMLElement>();
  readonly #groups = new Map<HTMLElement, GlassGroup>();
  readonly #detached = new Set<WeakRef<HTMLElement>>();
  readonly #intersection: IntersectionObserver;
  readonly #attributes: MutationObserver;
  #frame = 0;
  #poll = 0;
  #last = 0;

  /**
   * Use `GlassManager.for`, which keeps one manager per page.
   */
  constructor(win: PageWindow) {
    this.#win = win;
    this.#intersection = new win.IntersectionObserver((entries) =>
      this.#onIntersection(entries),
    );
    this.#attributes = new win.MutationObserver(() => this.#wake());
  }

  static for(win: PageWindow): GlassManager {
    let manager = managers.get(win);
    if (!manager) {
      manager = new GlassManager(win);
      managers.set(win, manager);
    }
    return manager;
  }

  register(element: HTMLElement): void {
    this.#intersection.observe(element);
    this.#attributes.observe(element, {
      attributes: true,
      attributeFilter: GLASS_ATTRIBUTES,
    });
    trackPress(element);
  }

  #onIntersection(entries: IntersectionObserverEntry[]): void {
    for (const { target, isIntersecting } of entries) {
      const element = target as HTMLElement;
      if (isIntersecting) {
        this.#visible.add(element);
        continue;
      }
      this.#visible.delete(element);
      // Observing a removed element would keep it alive after Lynx drops it.
      // Hold it weakly instead, in case it's put back (a detached view).
      if (!element.isConnected) {
        this.#intersection.unobserve(element);
        this.#detached.add(new WeakRef(element));
        if (!this.#poll) {
          this.#poll = this.#win.setInterval(
            () => this.#checkDetached(),
            DETACHED_POLL_MS,
          );
        }
      }
    }
    this.#wake();
  }

  #checkDetached(): void {
    for (const ref of this.#detached) {
      const element = ref.deref();
      // Still removed, and not yet garbage collected: keep checking.
      if (element && !element.isConnected) continue;
      if (element) this.#intersection.observe(element);
      this.#detached.delete(ref);
    }
    if (!this.#detached.size) {
      this.#win.clearInterval(this.#poll);
      this.#poll = 0;
    }
  }

  #wake(): void {
    if (this.#frame) return;
    this.#frame = this.#win.requestAnimationFrame((now) => this.#tick(now));
  }

  #tick(now: number): void {
    this.#frame = 0;
    const elapsed = this.#last ? Math.min(now - this.#last, MAX_ELAPSED_MS) : 0;
    this.#last = now;

    const roots = new Map<HTMLElement, boolean>();
    for (const element of this.#visible) {
      const role = glassRole(element);
      if (role === 'container' || role === 'standalone') {
        roots.set(element, role === 'container');
      }
    }
    for (const [root, group] of this.#groups) {
      if (roots.get(root) !== group.container || group.lost) {
        group.dispose();
        this.#groups.delete(root);
      }
    }
    for (const [root, container] of roots) {
      if (!this.#groups.has(root)) {
        this.#groups.set(root, new GlassGroup(root, container));
      }
    }

    const styled = new Set(this.#visible);
    const rendered = new Set<HTMLElement>();
    for (const group of this.#groups.values()) {
      group.frame(elapsed);
      for (const shape of group.shapes) {
        styled.add(shape);
        if (group.active) rendered.add(shape);
      }
    }
    for (const element of styled) {
      applyHostStyle(element, {
        hostsCanvas: this.#groups.get(element)?.active ?? false,
        rendered: rendered.has(element),
        fallback:
          element.getAttribute('blur-effect') === 'glass' &&
          !rendered.has(element),
      });
    }

    // Keep drawing while glass is on screen: shapes can move every frame
    // (dragged, animated) without any event this code would hear about.
    if (this.#groups.size) this.#wake();
    else this.#last = 0;
  }
}
