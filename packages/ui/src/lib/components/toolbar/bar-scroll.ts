import {
  ApplicationRef,
  Component,
  DestroyRef,
  ElementRef,
  Injectable,
  Injector,
  Renderer2,
  ViewEncapsulation,
  computed,
  inject,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import {
  type LayoutChangeDetail,
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  type LynxEvent,
  LynxStackPage,
  LynxSystemInfo,
  LynxTabPage,
  type ScrollDetail,
} from '@blotch/angular-lynx';

import { DURATION, EASING } from '../../utils/animate';
import { cn } from '../../utils/cn';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import { injectIconColor } from '../icon/icon-theme';
import { ICONS, paintIcon } from '../icon/icons';

/**
 * A bar over the top of the screen, as the scroll view under it sees it: a
 * navigation bar, or a bar of your own.
 */
export type UiTopBar = {
  /** The bar's height below the status bar, in px. Content starts below it. */
  readonly height: Signal<number>;
  /**
   * A large title for the top of the content, which scrolls away with it
   * while the bar shows the title inline, or `null` for none.
   */
  readonly largeTitle: Signal<string | null>;
  /**
   * Whether the title opens a menu, such as a picker of what the screen
   * shows: the large title is then a button, with a chevron after it. A bar
   * that leaves it out has a plain title.
   */
  readonly titleMenu?: Signal<boolean>;
  /**
   * What a tap on the large title calls while `titleMenu` is set, for the
   * bar to open its menu as a tap on its own title does.
   */
  readonly titlePressed?: () => void;
};

/** A bar over the bottom of the screen, such as a toolbar. */
export type UiBottomBar = {
  /** The bar's height above the home indicator, in px. */
  readonly height: Signal<number>;
};

/**
 * What the bars of a screen and the scroll view under them tell each other.
 * The bars say how much room they take, and the scroll view makes that room
 * at its ends and says where its content is: the frosted bar turns opaque
 * once content scrolls under it, and Material's changes color.
 *
 * A service, because neither can inject the other: the bars and the scroll
 * view are siblings in a screen's template. It's provided in the root, which
 * fits one screen at a time. Each page of a `<lynx-stack-outlet>` and each tab
 * of a `<lynx-tab-outlet>`, which keep several alive at once, gets one of its
 * own (see {@link injectBarState}).
 * When two screens with bars show at once otherwise, such as a sheet with its
 * own navigation bar over a screen with one, give each its own by providing
 * `UiBarState` on the component that holds it:
 *
 * ```ts
 * @Component({ providers: [UiBarState], … })
 * export class EditNoteSheet {}
 * ```
 *
 * A bar of your own injects it with `injectBarState()`, as the library's do.
 */
@Injectable({ providedIn: 'root' })
export class UiBarState {
  readonly topBar = signal<UiTopBar | null>(null);
  readonly bottomBar = signal<UiBottomBar | null>(null);
  /** The scroll view under the bars (a `ui-bar-scroll`), while there's one. */
  readonly content = signal<object | null>(null);

  /** Whether content has scrolled under the top bar. */
  readonly scrolledUnderTop = signal(false);
  /**
   * Whether the large title has scrolled under the top bar, so the bar shows
   * the title instead.
   */
  readonly largeTitleUnder = signal(false);
  /** Whether content continues under the bottom bar. */
  readonly scrolledUnderBottom = signal(false);

  /**
   * Puts `value` in `slot` until `destroyRef`'s component goes, and returns
   * the callback's removal. It clears the slot only if it still holds
   * `value`: when the router swaps screens, the next screen's bar may
   * already be in it.
   */
  attach<T extends object>(
    slot: WritableSignal<T | null>,
    value: T,
    destroyRef: DestroyRef,
  ): () => void {
    slot.set(value);
    return destroyRef.onDestroy(() => {
      if (slot() === value) slot.set(null);
    });
  }
}

/** Each stack page's and each tab's bar state (see injectBarState). */
const screenStates = new WeakMap<LynxStackPage | LynxTabPage, UiBarState>();

/**
 * The bar state of the screen a bar or scroll view is on: a component's own
 * `UiBarState` when one provides it, the page's when it's on a page of a
 * `<lynx-stack-outlet>`, the tab's when it's in a tab of a
 * `<lynx-tab-outlet>`, or else the root's.
 *
 * The root's is one for the whole app, which fits a `<router-outlet>`: it
 * shows one screen at a time. A stack outlet keeps the pages under the top
 * one alive, bars and all, and a tab outlet each tab, so the next screen's
 * bar would take the root's from the one before, which would come back
 * without its own (no large title, its content under the bar). So each page,
 * and each tab, gets one.
 */
export const injectBarState = (): UiBarState => {
  const state = inject(UiBarState);
  const screen =
    inject(LynxStackPage, { optional: true }) ??
    inject(LynxTabPage, { optional: true });
  if (!screen || state !== inject(ApplicationRef).injector.get(UiBarState)) {
    return state;
  }
  let own = screenStates.get(screen);
  if (!own) {
    own = new UiBarState();
    screenStates.set(screen, own);
  }
  return own;
};

/**
 * How far content scrolls before the large title has passed under the bar,
 * which then shows the title instead, in px: past iOS's 34pt bold title in
 * its 52pt band, and Material 3 Expressive's 28sp title in the 48dp its
 * medium flexible app bar adds.
 */
const LARGE_TITLE_UNDER: Readonly<Record<GlassDesign, number>> = {
  glass: 44,
  frosted: 44,
  material: 40,
};

/**
 * The chevron after a large title that opens a menu, in px: the title's type
 * size in each design, so it's in proportion to the title, as the smaller
 * one after the bar's own title is. The icon's strokes span half of its box,
 * so it sits well inside the title's line and adds nothing to its height.
 */
const LARGE_TITLE_CHEVRON: Readonly<Record<GlassDesign, number>> = {
  glass: 34,
  frosted: 34,
  material: 28,
};

/**
 * The space between a title that opens a menu and its chevron, in px, for
 * the large title and the bar's own.
 */
export const TITLE_CHEVRON_GAP = 2;

/**
 * The chevron of a title that opens a menu, as markup in the title's color,
 * for a component's field: the large title here and the bar's own draw the
 * same one. It's drawn as markup rather than by a nested `<ui-icon>`, as a
 * toolbar item draws its icon: an SVG can't read the title's text class, so
 * the theme's foreground is resolved to its value and written into it (see
 * icon-theme.ts). A signal, so it follows the color scheme.
 */
export const injectTitleMenuChevron = (): Signal<string> => {
  const resolveColor = injectIconColor();
  return computed(() =>
    paintIcon(ICONS['chevron-down'], resolveColor('var(--foreground)')),
  );
};

/**
 * How a title that opens a menu answers a finger: it dims at once, as a
 * control answers the touch rather than the tap that follows it, and fades
 * back when the finger lifts. Without `animate` (Reduce Motion) it comes
 * back at once too.
 */
export const titleMenuPressStyle = (
  pressing: boolean,
  animate: boolean,
): Record<string, string> => ({
  opacity: pressing ? '0.4' : '1',
  transition:
    pressing || !animate
      ? 'none'
      : `opacity ${DURATION.fast}ms ${EASING.standard}`,
});

/**
 * How the scroll edge effect fades content under a glass bar: how much of it
 * shows (0 to 1) at fractions of the bar's space from the screen's edge.
 * None of it shows under the status bar, little under the bar's controls,
 * so they stay legible over whatever passes beneath them, and all of it from
 * the bar's inner edge, where content rests before it scrolls.
 */
const EDGE_FADE: readonly (readonly [at: number, alpha: number])[] = [
  [0, 0],
  [0.7, 0],
  [0.9, 0.12],
  [1, 1],
];

/**
 * The scroll edge effect for a glass bar to draw itself, where the scroll
 * view can't: Android, whose `<scroll-view>` takes no `mask-image` (a plain
 * view does). It's the mask's fade the other way round, in the theme's
 * background color, from the screen's edge `toward` the content, over the
 * bar's own box, which takes the safe area as the scroll view's spacer does.
 * So content fades to the background color rather than to what's behind.
 */
export const edgeFadeOverlay = (toward: 'bottom' | 'top'): string => {
  const stops = EDGE_FADE.map(
    ([at, alpha]) =>
      `rgba(var(--background-rgb), ${Number((1 - alpha).toFixed(2))}) ${Number((at * 100).toFixed(2))}%`,
  );
  return `linear-gradient(to ${toward}, ${stops.join(', ')})`;
};

/**
 * The platform, as SystemInfo names it, or undefined where there's no
 * SystemInfo to read, such as in unit tests, where LynxSystemInfo throws.
 */
export const platformOf = (injector: Injector): string | undefined => {
  try {
    return injector.get(LynxSystemInfo).platform;
  } catch {
    return undefined;
  }
};

/**
 * A mask stop: content fully hidden (`0`) to fully shown (`1`) at `at`.
 */
const stop = (alpha: number, at: string): string =>
  `rgba(0, 0, 0, ${alpha}) ${at}`;

/**
 * Makes a `<scroll-view>` the content under a screen's bars
 * (`ui-navigation-bar` and `ui-toolbar`), as UIKit adjusts a scroll view for
 * the bars over it:
 *
 * ```html
 * <ui-navigation-bar title="Notes" largeTitle />
 * <scroll-view ui-bar-scroll scroll-orientation="vertical" class="h-full">
 *   …
 * </scroll-view>
 * ```
 *
 * - **Room for the bars:** the content starts below the top bar and the
 *   status bar, and ends above the bottom bar and the home indicator, so it
 *   scrolls beneath them but rests clear of them.
 * - **The large title** sits at the top of the content and scrolls away with
 *   it, and the bar shows the title once it has gone under. It's a button,
 *   with a chevron after it, when the bar's title opens a menu.
 * - **The scroll edge effect:** under glass bars, content fades out as it
 *   passes under them, so their controls stay legible. It's a mask on the
 *   scroll view, so it fades to whatever is behind, the screen's background
 *   or an image.
 * - **Where the content is,** for the bars: the frosted bars before iOS 26
 *   turn opaque, and Material's top app bar changes color, once content
 *   scrolls under them.
 *
 * It listens to the scroll view's events itself, as `ui-dock-scroll` does,
 * so it updates the bars only when they should change, rather than running
 * change detection on every event.
 */
@Component({
  selector: 'scroll-view[ui-bar-scroll]',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: { '[style.mask-image]': 'edgeMask()' },
  // The spacers measure themselves, for the edge effect: their height counts
  // the safe area, which only CSS knows.
  template: `
    <view
      [style.height]="topInset()"
      (bindlayoutchange)="measureTop($event)"
    ></view>
    @if (largeTitle(); as title) {
      <view [class]="largeTitleClass()">
        @if (titleMenu()) {
          <!-- A title that opens a menu is one accessibility element, a
               button named by the title: a <view> isn't one by default, so
               screen readers would read only the text, with nothing to say
               it opens anything. It stays the screen's heading where the
               platform reads more than one trait.

               It keeps to its text and chevron (self-start) rather than
               the row's width, so only a tap on the title opens the menu,
               and to the row at most (max-w-full): a long title stays on
               one line and ends with "…", and the chevron keeps its width
               after it. Wrapped, the title would leave its band, over the
               bar and the content.

               It dims under a finger from the touch's start. Touch events
               for native and mouse events for the web preview, which sends
               no touches for a cursor; a canceled touch (a scroll taking
               over) and a cursor leaving release too. -->
          <view
            class="max-w-full flex-row items-center self-start flex"
            [style]="titleButtonStyle()"
            accessibility-element="true"
            accessibility-traits="button"
            [accessibility-label]="title"
            [lynxAccessibilityTraits]="{ header: true }"
            (bindtouchstart)="pressTitle(true)"
            (bindtouchend)="pressTitle(false)"
            (bindtouchcancel)="pressTitle(false)"
            (bindmousedown)="pressTitle(true)"
            (bindmouseup)="pressTitle(false)"
            (bindmouseleave)="pressTitle(false)"
            (bindtap)="tapTitle()"
          >
            <text [text-maxline]="1" [class]="titleMenuTextClass()">{{
              title
            }}</text>
            <svg
              class="shrink-0"
              [attr.content]="titleChevron()"
              [style]="titleChevronStyle()"
            />
          </view>
        } @else {
          <text accessibility-traits="header" [class]="largeTitleTextClass()">{{
            title
          }}</text>
        }
      </view>
    }
    <ng-content />
    <view
      [style.height]="bottomInset()"
      (bindlayoutchange)="measureBottom($event)"
    ></view>
  `,
})
export class UiBarScroll {
  readonly #state = injectBarState();
  readonly #renderer = inject(Renderer2);
  readonly #element = inject(ElementRef).nativeElement;
  readonly #design = injectGlassDesign();
  readonly #platform = platformOf(inject(Injector));
  readonly #settings = inject(LynxAccessibilitySettings);

  /** A finger (or the mouse) is down on a large title that opens a menu. */
  protected readonly titlePressing = signal(false);

  /** The scroll view's own height and its spacers', from Lynx's layout. */
  protected readonly viewport = signal(0);
  protected readonly topSpace = signal(0);
  protected readonly bottomSpace = signal(0);

  /** The last scroll position and content height Lynx reported. */
  #scrollTop = 0;
  #scrollHeight = 0;

  protected readonly attachment = this.#state.attach(
    this.#state.content,
    this,
    inject(DestroyRef),
  );

  protected readonly listeners = [
    this.#renderer.listen(
      this.#element,
      'bindscroll',
      (event: LynxEvent<ScrollDetail>) => this.#scrolled(event.detail),
    ),
    // iOS and Android report the content's height when it changes, which a
    // frosted toolbar needs before anything scrolls.
    this.#renderer.listen(
      this.#element,
      'bindcontentsizechanged',
      (event: LynxEvent<ScrollDetail>) => this.#scrolled(event.detail),
    ),
    this.#renderer.listen(
      this.#element,
      'bindlayoutchange',
      (event: LynxEvent<LayoutChangeDetail>) => {
        this.viewport.set(event.detail.height);
        this.#update();
      },
    ),
  ];

  protected readonly cleanup = inject(DestroyRef).onDestroy(() => {
    for (const remove of this.listeners) remove();
    if (this.#state.content() === null) {
      this.#state.scrolledUnderTop.set(false);
      this.#state.largeTitleUnder.set(false);
      this.#state.scrolledUnderBottom.set(false);
    }
  });

  protected readonly largeTitle = computed(
    () => this.#state.topBar()?.largeTitle() ?? null,
  );

  /**
   * Whether the large title opens a menu. A bar of an app's own may leave
   * `titleMenu` out, for a plain title.
   */
  protected readonly titleMenu = computed(
    () => this.#state.topBar()?.titleMenu?.() ?? false,
  );

  protected readonly topInset = computed(() => {
    const bar = this.#state.topBar();
    return bar ? `calc(env(safe-area-inset-top) + ${bar.height()}px)` : null;
  });

  protected readonly bottomInset = computed(() => {
    const bar = this.#state.bottomBar();
    return bar ? `calc(env(safe-area-inset-bottom) + ${bar.height()}px)` : null;
  });

  protected readonly largeTitleClass = computed(() =>
    cn(
      'flex-col px-[16px] flex justify-end',
      this.#design() === 'material' ? 'h-[48px] pb-[4px]' : 'h-[52px] pb-[8px]',
    ),
  );

  protected readonly largeTitleTextClass = computed(() =>
    this.#design() === 'material'
      ? 'text-[28px] leading-[36px] text-foreground'
      : 'text-[34px] font-bold leading-[41px] text-foreground',
  );

  /**
   * The large title's type, on one line ([text-maxline]="1"): without the
   * ellipsis, Android draws a long title's second line below its band.
   */
  protected readonly titleMenuTextClass = computed(() =>
    cn(this.largeTitleTextClass(), 'text-ellipsis'),
  );

  protected readonly titleChevron = injectTitleMenuChevron();

  protected readonly titleChevronStyle = computed(() => {
    const size = `${LARGE_TITLE_CHEVRON[this.#design()]}px`;
    return {
      width: size,
      height: size,
      'margin-left': `${TITLE_CHEVRON_GAP}px`,
    };
  });

  protected readonly titleButtonStyle = computed(() =>
    titleMenuPressStyle(this.titlePressing(), !this.#settings.reduceMotion()),
  );

  /**
   * The scroll edge effect: a mask that fades content out under glass bars,
   * from the spacers' measured heights. The other designs mark the edge with
   * the bar's own background instead, as their platforms do.
   *
   * Native Lynx reads only percentages as gradient stops, so there the stops
   * come from the scroll view's height too. The web preview's scroll view
   * reports no layout (web-elements' `<x-scroll-view>` sends no
   * `layoutchange`), but the browser reads lengths, so there the stops are
   * px from each end. Android's scroll view takes no mask, so there the
   * bars draw the edge themselves (see edgeFadeOverlay).
   */
  protected readonly edgeMask = computed(() => {
    const top = this.topSpace();
    const bottom = this.bottomSpace();
    const height = this.viewport();
    const web = this.#platform === 'web';
    if (
      this.#design() !== 'glass' ||
      this.#platform === 'Android' ||
      top + bottom <= 0 ||
      (!web && height <= 0)
    ) {
      return null;
    }
    const percent = (px: number) =>
      `${Math.min(100, Math.max(0, (px / height) * 100)).toFixed(2)}%`;
    const length = (px: number) => `${Number(px.toFixed(2))}px`;
    const fromTop = (px: number) => (web ? length(px) : percent(px));
    const fromBottom = (px: number) =>
      web ? `calc(100% - ${length(px)})` : percent(height - px);
    // Top down to the content, then the bottom bar's fade the other way up.
    const stops = [
      ...(top > 0
        ? EDGE_FADE.map(([edge, alpha]) => stop(alpha, fromTop(top * edge)))
        : [stop(1, fromTop(0))]),
      ...(bottom > 0
        ? EDGE_FADE.map(([edge, alpha]) =>
            stop(alpha, fromBottom(bottom * edge)),
          ).reverse()
        : [stop(1, fromBottom(0))]),
    ];
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  });

  protected measureTop({ detail }: LynxEvent<LayoutChangeDetail>): void {
    this.topSpace.set(detail.height);
  }

  protected measureBottom({ detail }: LynxEvent<LayoutChangeDetail>): void {
    this.bottomSpace.set(detail.height);
  }

  protected pressTitle(down: boolean): void {
    this.titlePressing.set(down);
  }

  /**
   * Tells the bar, which opens its menu: the title is the bar's to act on.
   */
  protected tapTitle(): void {
    this.#state.topBar()?.titlePressed?.();
  }

  #scrolled({ scrollTop, scrollHeight }: ScrollDetail): void {
    this.#scrollTop = scrollTop;
    this.#scrollHeight = scrollHeight;
    this.#update();
  }

  /**
   * Tells the bars where the content is. Signals ignore a value they already
   * hold, so the bars change only when content crosses an edge.
   */
  #update(): void {
    const state = this.#state;
    if (state.content() !== this) return;
    const top = this.#scrollTop;
    state.scrolledUnderTop.set(top > 0);
    state.largeTitleUnder.set(
      !!this.largeTitle() && top >= LARGE_TITLE_UNDER[this.#design()],
    );
    const viewport = this.viewport();
    state.scrolledUnderBottom.set(
      viewport > 0 && top + viewport < this.#scrollHeight - 1,
    );
  }
}
