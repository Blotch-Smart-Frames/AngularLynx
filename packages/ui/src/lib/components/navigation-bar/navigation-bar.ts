import { Location, LocationStrategy } from '@angular/common';
import {
  Component,
  DestroyRef,
  Injector,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ROUTES, Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxLocationStrategy,
} from '@blotch/angular-lynx';

import { DURATION, EASING } from '../../utils/animate';
import { cn } from '../../utils/cn';
import { UiGlass } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import { UiBarState } from '../toolbar/bar-scroll';
import { UiToolbarItem } from '../toolbar/toolbar';

/**
 * The bar's height below the status bar, in px: 44pt on iOS, with and without
 * Liquid Glass, and Material 3's 64dp small and center-aligned top app bars.
 */
const BAR_HEIGHT: Readonly<Record<GlassDesign, number>> = {
  glass: 44,
  frosted: 44,
  material: 64,
};

/**
 * The row's padding at each end, in px: iOS 26's bars float their controls
 * 16pt in, the bars before it 8pt, and Material's top app bar has its icon
 * buttons' 4dp in each end's own padding.
 */
const ROW_PADDING: Readonly<Record<GlassDesign, number>> = {
  glass: 16,
  frosted: 8,
  material: 0,
};

/** The space between a centered title and the controls beside it, in px. */
const TITLE_GAP = 8;

/** What Lynx's `layoutchange` event carries, as far as the bar reads it. */
type LayoutChangeEvent = Event & { detail: { width: number } };

/**
 * How the inline title comes in as the large title scrolls under the bar,
 * and how Material's bar changes color as content scrolls under it.
 */
const TITLE_TRANSITION = `opacity ${DURATION.fast}ms ${EASING.standard}`;
const CONTAINER_TRANSITION = `background-color ${DURATION.normal}ms ${EASING.standard}`;

/**
 * The router's history, when the app set the router up with `provideRouter()`
 * from `@blotch/angular-lynx`, whose in-memory history says whether there's
 * a screen to go back to. Without the router there's nothing to go back
 * through, and its LocationStrategy is never created: on Lynx the browser's
 * one it would fall back to can't be.
 */
const historyOf = (injector: Injector): LynxLocationStrategy | null => {
  if (!injector.get(ROUTES, null)) return null;
  const strategy = injector.get(LocationStrategy);
  return strategy instanceof LynxLocationStrategy ? strategy : null;
};

/**
 * The bar at the top of a screen: its title, a Back button while there's a
 * screen to go back to, and the screen's actions, floating over the content,
 * which scrolls beneath it.
 *
 * ```html
 * <ui-navigation-bar title="Notes" largeTitle>
 *   <ui-toolbar-item leading label="Edit" (pressed)="edit()" />
 *   <ui-toolbar-group>
 *     <ui-toolbar-item icon="search" label="Search" (pressed)="search()" />
 *     <ui-toolbar-item icon="plus" label="New note" (pressed)="add()" />
 *   </ui-toolbar-group>
 * </ui-navigation-bar>
 * <scroll-view ui-bar-scroll scroll-orientation="vertical" class="h-full">
 *   …
 * </scroll-view>
 * ```
 *
 * Items and groups go at the trailing end, or after the Back button with the
 * `leading` attribute. Put `ui-bar-scroll` on the screen's scroll view: its
 * content then starts below the bar and the status bar, the large title
 * scrolls with it, and the bar follows it.
 *
 * Its form follows the platform (see GlassDesign):
 *
 * - `'glass'` (iOS 26 and later, the web, Android with the glass opt-in): no
 *   bar background. The items float in glass, grouped items share one
 *   capsule, the Back button is a glass circle with a chevron, and the title
 *   is plain text. Content fades out as it scrolls beneath them, iOS's
 *   scroll edge effect.
 * - `'frosted'` (iOS 15 to 25): the navigation bar of that time, clear while
 *   the content is at its top and on the blur material with a hairline once
 *   content scrolls under it. Items and the Back button, a chevron with the
 *   previous screen's title, are in the tint color.
 * - `'material'` (Android): Material 3's small top app bar, or center-aligned
 *   with `titleCentered`, whose container turns from the surface color to the
 *   surface container's as content scrolls under it. The Back button is its
 *   navigation icon, an arrow.
 *
 * With `largeTitle`, the title starts large at the top of the content, and
 * the bar shows it once it has scrolled under: iOS's large title, and
 * Material 3 Expressive's medium flexible app bar.
 */
@Component({
  selector: 'ui-navigation-bar',
  imports: [LYNX_ELEMENTS, UiGlass, UiToolbarItem],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[style.transition]': 'containerTransition()',
  },
  // The frosted material is added and removed rather than faded: a blur
  // view under a fading opacity draws wrongly on iOS.
  template: `
    @if (frostedBackground()) {
      <blur-view
        ui-glass
        shape="rounded"
        [radius]="0"
        class="absolute bottom-0 left-0 right-0 top-0"
      ></blur-view>
      <view class="h-[0.5px] bg-border absolute bottom-0 left-0 right-0"></view>
    }
    <view
      [class]="rowClass()"
      [style]="rowStyle()"
      (bindlayoutchange)="measureRow($event)"
    >
      @if (!titleAtStart()) {
        <!-- An unconstrained, invisible copy of the title, which measures
             how wide it would be on one line. -->
        <view
          class="flex-row opacity-0 flex absolute left-0 top-0"
          accessibility-elements-hidden="true"
        >
          <text
            [class]="titleClass()"
            (bindlayoutchange)="measureTitle($event)"
            >{{ title() }}</text
          >
        </view>
      }
      <view
        [class]="leadingClass()"
        (bindlayoutchange)="measureLeading($event)"
      >
        @if (backShown()) {
          <ui-toolbar-item back [label]="backLabel()" (pressed)="goBack()" />
        }
        <ng-content select="[leading]" />
      </view>
      <view
        [class]="titleBoxClass()"
        [style]="titleBoxStyle()"
        [attr.accessibility-elements-hidden]="titleShown() ? null : true"
      >
        <text
          [text-maxline]="1"
          accessibility-traits="header"
          [class]="titleClass()"
          >{{ title() }}</text
        >
      </view>
      <view
        [class]="trailingClass()"
        (bindlayoutchange)="measureTrailing($event)"
      >
        <ng-content />
      </view>
    </view>
  `,
})
export class UiNavigationBar {
  /** The screen's title: a word or a short phrase. */
  readonly title = input('');
  /**
   * The title starts large at the top of the content, and moves into the bar
   * as it scrolls under it. Needs `ui-bar-scroll` on the screen's scroll
   * view, which draws it.
   */
  readonly largeTitle = input(false, { transform: booleanAttribute });
  /**
   * Material's center-aligned top app bar, rather than the small one with
   * the title at the start. iOS always centers the title in the bar.
   */
  readonly titleCentered = input(false, { transform: booleanAttribute });
  /**
   * The previous screen's title, which the Back button shows beside its
   * chevron before iOS 26, and which screen readers say for it everywhere.
   */
  readonly backLabel = input('Back');
  /**
   * Where Back goes when there's no screen to go back to, such as a detail
   * screen the app opened on: a URL for `Router.navigateByUrl()`, usually
   * the screen above it. It replaces the current screen in the history.
   * Without it, the Back button shows only while there's history.
   */
  readonly backRoute = input<string | undefined>(undefined);
  /**
   * Hides the Back button, for a screen that's a starting point though
   * there's history behind it, such as a tab's first screen.
   */
  readonly backButtonHidden = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #state = inject(UiBarState);
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #injector = inject(Injector);
  readonly #history = historyOf(this.#injector);

  /** The design on this platform (see GlassDesign), which the items follow. */
  readonly design = injectGlassDesign();

  readonly #material = computed(() => this.design() === 'material');
  /** No fading or color changing under Reduce Motion. */
  readonly #animate = computed(() => !this.#settings.reduceMotion());

  /** The widths of the bar, its two ends and its title, from Lynx's layout. */
  protected readonly rowWidth = signal(0);
  protected readonly leadingWidth = signal(0);
  protected readonly trailingWidth = signal(0);
  protected readonly titleWidth = signal(0);

  /**
   * Whether there's a screen to go back to in the router's history: there
   * is after a navigation, and isn't on the first screen.
   */
  readonly canGoBack = computed(() => this.#history?.canGoBack() ?? false);

  protected readonly backShown = computed(
    () => !this.backButtonHidden() && (this.canGoBack() || !!this.backRoute()),
  );

  // What the scroll view under the bar makes room for: the bar below the
  // status bar, and the large title at the top of its content.
  protected readonly attachment = this.#state.attach(
    this.#state.topBar,
    {
      height: computed(() => BAR_HEIGHT[this.design()]),
      largeTitle: computed(() => (this.largeTitle() ? this.title() : null)),
    },
    inject(DestroyRef),
  );

  /**
   * The title shows in the bar unless the large title is showing at the top
   * of the content: before it has scrolled under the bar. Without a scroll
   * view there's no large title, so the bar shows the title.
   */
  protected readonly titleShown = computed(
    () =>
      !this.largeTitle() ||
      !this.#state.content() ||
      this.#state.largeTitleUnder(),
  );

  protected readonly frostedBackground = computed(
    () => this.design() === 'frosted' && this.#state.scrolledUnderTop(),
  );

  /** Material's small top app bar puts the title at the start. */
  protected readonly titleAtStart = computed(
    () => this.#material() && !this.titleCentered(),
  );

  protected readonly hostClass = computed(() =>
    cn(
      'flex-col flex absolute left-0 right-0 top-0 pt-safe',
      this.#material() &&
        (this.#state.scrolledUnderTop() ? 'bg-secondary' : 'bg-background'),
      this.userClass(),
    ),
  );

  protected readonly containerTransition = computed(() =>
    this.#material() && this.#animate() ? CONTAINER_TRANSITION : null,
  );

  protected readonly rowClass = computed(() =>
    cn(
      'flex-row items-center flex relative justify-between',
      this.#material() ? 'h-[64px]' : 'h-[44px]',
    ),
  );

  protected readonly rowStyle = computed(() => {
    const padding = `${ROW_PADDING[this.design()]}px`;
    return { 'padding-left': padding, 'padding-right': padding };
  });

  /**
   * The ends keep their controls' width. Material's small bar puts its
   * navigation icon 4dp in, and the title 16dp in without one (`min-w`), or
   * right after it: Compose's TopAppBar layout.
   */
  protected readonly leadingClass = computed(() =>
    cn(
      'shrink-0 flex-row items-center flex',
      this.#material() ? 'pl-[4px]' : 'gap-[8px]',
      this.titleAtStart() && 'min-w-[12px]',
    ),
  );

  protected readonly trailingClass = computed(() =>
    cn(
      'shrink-0 flex-row items-center flex',
      this.#material() ? 'pr-[4px]' : 'gap-[8px]',
    ),
  );

  /**
   * A centered title is centered on the screen, clear of the wider end on
   * both sides, when it fits there; otherwise it's centered in the room
   * between the ends, and shortens with an ellipsis when even that's too
   * little: UIKit's inline title. At the start, it takes the room between
   * the ends.
   */
  protected readonly titleBoxClass = computed(() =>
    this.titleAtStart()
      ? 'flex-1 flex-row items-center flex px-[4px]'
      : 'flex-row items-center flex absolute bottom-0 top-0 justify-center',
  );

  protected readonly titleBoxStyle = computed(() => {
    const style: Record<string, string> = {
      opacity: this.titleShown() ? '1' : '0',
      transition: this.#animate() ? TITLE_TRANSITION : 'none',
    };
    if (!this.titleAtStart()) {
      const padding = ROW_PADDING[this.design()];
      const leading = padding + this.leadingWidth() + TITLE_GAP;
      const trailing = padding + this.trailingWidth() + TITLE_GAP;
      const centered = Math.max(leading, trailing);
      const fits = this.titleWidth() <= this.rowWidth() - 2 * centered;
      style['left'] = `${fits ? centered : leading}px`;
      style['right'] = `${fits ? centered : trailing}px`;
    }
    return style;
  });

  protected readonly titleClass = computed(() =>
    cn(
      this.#material()
        ? 'text-[22px] leading-7'
        : 'text-[17px] font-semibold leading-[22px]',
      !this.titleAtStart() && 'text-center',
      'text-foreground',
    ),
  );

  protected measureRow(event: Event): void {
    this.rowWidth.set((event as LayoutChangeEvent).detail.width);
  }

  protected measureTitle(event: Event): void {
    this.titleWidth.set((event as LayoutChangeEvent).detail.width);
  }

  protected measureLeading(event: Event): void {
    this.leadingWidth.set((event as LayoutChangeEvent).detail.width);
  }

  protected measureTrailing(event: Event): void {
    this.trailingWidth.set((event as LayoutChangeEvent).detail.width);
  }

  /**
   * Goes back, as the Back button does: through the router's history when
   * there's a screen to go back to, which runs the screen's guards as the
   * browser's back button does, or else to `backRoute`, in place of this
   * screen. With neither, it does nothing.
   */
  goBack(): void {
    if (this.canGoBack()) {
      this.#injector.get(Location).back();
      return;
    }
    const route = this.backRoute();
    if (route) {
      void this.#injector
        .get(Router)
        .navigateByUrl(route, { replaceUrl: true });
    }
  }
}
