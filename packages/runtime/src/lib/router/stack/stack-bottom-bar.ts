import {
  type OnDestroy,
  type Signal,
  Directive,
  ElementRef,
  Renderer2,
  computed,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  type CarriedBar,
  type StackBarMotion,
  LynxStackChrome,
  addBar,
} from './stack-chrome';

/** The bar's host: a LynxElement, or a DOM element on the web and in tests. */
type BarElement = {
  getBoundingClientRect(): { readonly top: number; readonly height: number };
};

/**
 * Where a page carries a bar: over the page, along the bottom of its frame,
 * whether or not the bar lies over the screen's bottom in its own place (a
 * floating dock) or under the outlet in the layout (a tab bar). The page's
 * frame fills the outlet, and the outlet runs to the screen's bottom edge
 * while the bar is out of the layout.
 */
const CARRIED: Readonly<Record<string, string>> = {
  position: 'absolute',
  left: '0px',
  right: '0px',
  bottom: '0px',
};

/**
 * Makes an app's bottom bar (a tab bar, a dock or a player bar beside the
 * `<router-outlet>`) part of the page that has it while a
 * `<lynx-stack-outlet>` moves its pages as iOS's do, as UIKit puts its tab bar
 * in the view of the screen that has it while a navigation controller moves
 * (`hidesBottomBarWhenPushed`). A page pushed over that one then covers the
 * bar as it covers the page, rounded corners, shadow and all, the dark over
 * the page under it dims the bar too, and the bar moves with the page under
 * a finger. Without it, a bar outside the stack lies over every page, and the
 * best it can do is cut itself off along the pushed page's edge.
 *
 * Put it on the bar's host, and move the bar away with `progress` and
 * `motion` rather than LynxStackChrome's:
 *
 * ```ts
 * @Component({
 *   selector: 'app-player-bar',
 *   hostDirectives: [LynxStackBottomBar],
 *   host: {
 *     '[style.transform]': 'transform()',
 *     '[style.transition]': 'transition()',
 *   },
 *   template: `…`,
 * })
 * export class PlayerBar {
 *   readonly #bar = inject(LynxStackBottomBar);
 *   protected readonly transform = computed(
 *     () => `translateY(${this.#bar.progress() * 100}%)`,
 *   );
 *   protected readonly transition = computed(() => {
 *     const { duration, easing } = this.#bar.motion();
 *     return duration > 0 ? `transform ${duration}ms ${easing}` : 'none';
 *   });
 * }
 * ```
 *
 * While a page carries the bar, the bar is in the page's frame, along its
 * bottom, so it should look as it does at rest: `progress` is 0 then. The
 * outlet puts it back in its own place once the page that has it is on top
 * again, or the router leaves the stack. Where the stack's pages move as
 * Android's do, or cross-fade under Reduce Motion, no page carries it, and
 * `progress` and `motion` are LynxStackChrome's: the bar slides away on its
 * own.
 *
 * A page carries the bar while it's covered, and the bar sits in its frame at
 * the outlet's bottom edge and across its width, so the outlet should run to
 * the bottom of the screen, as it does beside a floating bar or once a tab
 * bar is out of the layout, and across it. As with CDK's `DomPortal`, a
 * comment keeps the bar's place in its parent meanwhile.
 */
@Directive({
  selector: '[lynxStackBottomBar]',
  exportAs: 'lynxStackBottomBar',
})
export class LynxStackBottomBar implements OnDestroy {
  readonly #chrome = inject(LynxStackChrome);
  readonly #renderer = inject(Renderer2);
  readonly #element: BarElement = inject(ElementRef).nativeElement;
  readonly #frame = signal<unknown>(null);
  /** The comment holding the bar's own place while a page carries it. */
  #place: unknown = null;

  /**
   * Whether a page carries the bar now: it's in the page's frame, at rest,
   * and moves with the page.
   */
  readonly carried: Signal<boolean> = computed(() => this.#frame() !== null);

  /**
   * Whether a page of the stack that's showing has taken the bar away
   * (LynxStackChrome's `bottomBarHidden`). A bar that's away should leave
   * screen readers and taps alone.
   */
  readonly hidden: Signal<boolean> = computed(() =>
    this.#chrome.bottomBarHidden(),
  );

  /**
   * How far to move the bar away, from 0 (in place) to 1 (gone):
   * LynxStackChrome's `bottomBarProgress`, or 0 while a page carries it.
   */
  readonly progress: Signal<number> = computed(() =>
    this.carried() ? 0 : this.#chrome.bottomBarProgress(),
  );

  /**
   * How the bar moves to `progress`: LynxStackChrome's `bottomBarMotion`, or
   * at once while a page carries it, as it stays at rest in the page.
   */
  readonly motion: Signal<StackBarMotion> = computed(() => {
    const motion = this.#chrome.bottomBarMotion();
    return this.carried() ? { ...motion, duration: 0 } : motion;
  });

  readonly #bar: CarriedBar = {
    chrome: this.#chrome,
    frame: () => untracked(this.#frame),
    box: () => this.#element.getBoundingClientRect(),
    carry: (frame) => this.#carry(frame),
    home: () => this.#home(),
  };
  readonly #remove = addBar(this.#chrome, this.#bar);

  constructor() {
    // Starts tracking the bar's layout (see lynx-element/layout.ts), so the
    // outlet knows where it is by the time a page carries it.
    this.#element.getBoundingClientRect?.();
  }

  ngOnDestroy(): void {
    this.#remove();
    this.#frame.set(null);
    // Destroyed while a page carries it: Angular takes it out of the page,
    // which is where it is, and its own place goes too.
    const place = this.#place;
    if (place) {
      this.#place = null;
      this.#renderer.removeChild(this.#renderer.parentNode(place), place);
    }
  }

  /**
   * Puts the bar in a page's frame: over the page, last in it, along its
   * bottom. A comment keeps its own place meanwhile.
   */
  #carry(frame: unknown): void {
    if (this.#frame() === frame) return;
    const renderer = this.#renderer;
    const element = this.#element;
    if (!this.#place) {
      const parent = renderer.parentNode(element);
      // Out of the tree, it has nowhere to come back to.
      if (!parent) return;
      this.#place = renderer.createComment('');
      renderer.insertBefore(parent, this.#place, element);
      for (const [name, value] of Object.entries(CARRIED)) {
        renderer.setStyle(element, name, value);
      }
    }
    renderer.appendChild(frame, element);
    this.#frame.set(frame);
  }

  /**
   * Puts the bar back in its own place, from the page's frame it's in.
   */
  #home(): void {
    const place = this.#place;
    const renderer = this.#renderer;
    const element = this.#element;
    this.#place = null;
    const parent = renderer.parentNode(place);
    if (parent) {
      renderer.insertBefore(parent, element, place);
      renderer.removeChild(parent, place);
    } else {
      // Its place went with its parent (whose view is going): it doesn't
      // stay on the page either.
      renderer.removeChild(renderer.parentNode(element), element);
    }
    for (const name of Object.keys(CARRIED)) {
      renderer.removeStyle(element, name);
    }
    this.#frame.set(null);
  }
}
