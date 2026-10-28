import {
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  Renderer2,
  inject,
  signal,
} from '@angular/core';

/**
 * Whether the dock is minimized, shared by the dock and the scroll views that
 * minimize it. A service rather than an input, because the two sit in
 * different parts of the app: the dock beside the `<router-outlet>`, and the
 * scroll views inside the routed screens, which can't reach it.
 *
 * ```ts
 * // Bring the dock back from code, after a search, for example.
 * inject(UiDockState).minimized.set(false);
 * ```
 *
 * This is what the app asks for. Whether the dock is minimized now is the
 * dock's own `minimized()`: it stays whole where its design doesn't minimize.
 */
@Injectable({ providedIn: 'root' })
export class UiDockState {
  /**
   * Whether the dock should be minimized: on iOS 26 and later and the web,
   * the bar shrinks to the selected item's icon, and on Android's Material
   * design it slides away. The frosted design of iOS 15 to 25 doesn't
   * minimize, as Apple's tab bars didn't, so there it stays expanded whatever
   * this says.
   */
  readonly minimized = signal(false);

  /**
   * Whether the dock's search field is open, for a `<ui-dock-action>` without
   * a route: pressing the action opens it, and the bar's button, Cancel or
   * leaving the search closes it. Set it to open or close the search from
   * code. With a route, the search is open while the route is active, and
   * this isn't needed.
   */
  readonly searching = signal(false);
}

/**
 * How far content scrolls the same way before the dock follows, in px: a
 * longer way down than up, as iOS's tab bar does, so a small drag doesn't
 * hide it, but a glance back up brings it back.
 */
const MINIMIZE_AFTER = 24;
const EXPAND_AFTER = 12;

/**
 * Near enough to the top that the dock expands, in px: content scrolled back
 * to its start always shows the whole dock.
 */
const TOP = 8;

/** What Lynx sends with `scroll` and `layoutchange`, as far as this reads. */
type ScrollDetail = { scrollTop: number; scrollHeight: number };
type LayoutDetail = { height: number };

/**
 * Minimizes the dock while this scroll view scrolls down, and expands it when
 * it scrolls up or back to the top, as iOS 26 minimizes its tab bar
 * (`tabBarMinimizeBehavior(.onScrollDown)`). Put it on each screen's
 * `<scroll-view>` (or `<list>`) that should minimize the dock:
 *
 * ```html
 * <scroll-view ui-dock-scroll scroll-orientation="vertical" class="h-full">
 *   …
 * </scroll-view>
 * ```
 *
 * It listens to the scroll view's `scroll` events itself, outside Angular's
 * templates: a template listener would run change detection for every event,
 * many times a second while content moves, where this updates the dock only
 * when it should change. AngularLynx already runs it on Lynx's main thread,
 * beside the native scroll, so it needs no main-thread script.
 *
 * Leaving the screen expands the dock again, so the next screen starts with
 * it whole.
 */
@Directive({ selector: 'scroll-view[ui-dock-scroll], list[ui-dock-scroll]' })
export class UiDockScroll {
  readonly #state = inject(UiDockState);
  readonly #renderer = inject(Renderer2);
  readonly #element = inject(ElementRef).nativeElement;

  /** The last scroll position, to tell which way content moved. */
  #lastTop = 0;
  /** How far content has moved the same way, negative upward. */
  #travel = 0;
  /** The scroll view's own height, once Lynx has laid it out. */
  #viewport = 0;

  protected readonly listeners = [
    this.#renderer.listen(
      this.#element,
      'bindscroll',
      (event: { detail: ScrollDetail }) => this.#scrolled(event.detail),
    ),
    this.#renderer.listen(
      this.#element,
      'bindlayoutchange',
      (event: { detail: LayoutDetail }) => {
        this.#viewport = event.detail.height;
      },
    ),
  ];

  protected readonly cleanup = inject(DestroyRef).onDestroy(() => {
    for (const remove of this.listeners) remove();
    this.#state.minimized.set(false);
  });

  #scrolled({ scrollTop, scrollHeight }: ScrollDetail): void {
    const delta = scrollTop - this.#lastTop;
    this.#lastTop = scrollTop;

    // At the top, including iOS's bounce above it, the dock is whole.
    if (scrollTop <= TOP) {
      this.#travel = 0;
      this.#state.minimized.set(false);
      return;
    }
    // iOS bounces past the end and back, which reads as scrolling up. The
    // user didn't, so the dock stays as it is.
    if (this.#viewport > 0 && scrollTop > scrollHeight - this.#viewport) {
      return;
    }

    // Count the distance moved one way, starting again when content turns.
    this.#travel = delta * this.#travel >= 0 ? this.#travel + delta : delta;
    if (this.#travel >= MINIMIZE_AFTER) {
      this.#state.minimized.set(true);
    } else if (this.#travel <= -EXPAND_AFTER) {
      this.#state.minimized.set(false);
    }
  }
}
