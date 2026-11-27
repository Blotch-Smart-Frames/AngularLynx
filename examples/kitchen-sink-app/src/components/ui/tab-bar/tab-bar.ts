import {
  ApplicationRef,
  Component,
  ElementRef,
  Renderer2,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  type Event as RouterEvent,
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  Router,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import {
  type BaseLynxElement,
  LYNX_ELEMENTS,
  LynxStackBottomBar,
} from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  pressDown,
  pressRelease,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { injectIconColor } from '../icon/icon-theme';
import { type IconName, injectIconMarkup, paintIcon } from '../icon/icons';

/**
 * The bar along the bottom of the screen that switches between an app's
 * top-level screens. Put a `<ui-tab-bar-item>` in it for each screen, and
 * place it under the `<router-outlet>`.
 *
 * A page that a `<lynx-stack-outlet>` pushes over its first page takes the
 * bar away, as iOS's `hidesBottomBarWhenPushed` and Material's navigation
 * bar do, and the bar comes back as the page goes (see `LynxStackChrome`).
 * While it's away, it lies over the bottom of the screen rather than under
 * the outlet, so the pushed page runs to the bottom edge. Where the pages
 * move as iOS's do, the page underneath carries it (see
 * `LynxStackBottomBar`): it moves a little left with the page, and the pushed
 * page covers it, rounded corner, shadow and all. Where they move as
 * Android's do, it slides down off the screen. It follows a finger dragging
 * a page back, and it leaves screen readers and taps alone while it's away.
 *
 * A tapped item shows selected at once, before the screen it shows is built
 * (see `markTapped`).
 */
@Component({
  selector: 'ui-tab-bar',
  imports: [LYNX_ELEMENTS],
  // A page the stack moves carries the bar, under the page moving over it.
  hostDirectives: [LynxStackBottomBar],
  encapsulation: ViewEncapsulation.None,
  // The bar and each item are their host elements, styled through `host`,
  // rather than a view inside the host. Angular gives a component's host
  // every static attribute the app writes on it, so `<ui-tab-bar
  // class="pt-2">` puts `pt-2` on the host whatever the component does with
  // its `class` input: with a styled view inside as well, the padding applied
  // twice.
  //
  // `pb-safe` pads the bar by the bottom safe-area inset, so the items sit
  // above the iPhone's home indicator while the bar's background still runs
  // to the bottom edge, as a native tab bar's does. Lynx reports no insets on
  // Android, nor does the web preview have any, so it's 0 there.
  //
  // `tabbar` is UIKit's tab bar trait (UIAccessibilityTraitTabBar), the one a
  // native tab bar's container has: it tells VoiceOver that the buttons in it
  // are tabs. Android reads a single trait and has no tab bar trait, so there
  // the row stays a plain container.
  //
  // The tabs sit in a row of their own inside the bar, which stops their
  // taps while the bar is away.
  host: {
    'accessibility-traits': 'tabbar',
    '[class]': 'barClass()',
    '[style.transform]': 'stackLook().transform',
    '[style.transition]': 'stackLook().transition',
    '[attr.accessibility-elements-hidden]': 'stackHidden() || null',
  },
  template: `<view
    class="flex-1 flex-row flex"
    [user-interaction-enabled]="!stackHidden()"
  >
    <ng-content />
  </view>`,
})
export class UiTabBar {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #bar = inject(LynxStackBottomBar);
  readonly #router = inject(Router);
  readonly #appRef = inject(ApplicationRef);

  /**
   * The item tapped last, while the navigation its tap started is under
   * way: it shows selected from the tap, rather than once RouterLinkActive
   * says its route is active (see UiTabBarItem.active). RouterLinkActive
   * says so when the navigation ends, and so after the outlet has built the
   * screen the item shows: on a tab not built yet, the bar sat still as if
   * the tap had missed, then the mark and the screen came together.
   */
  readonly #tapped = signal<UiTabBarItem | null>(null);
  readonly tappedItem = this.#tapped.asReadonly();

  // The tapped item gives way to RouterLinkActive once the navigation is
  // over, however it ended: after a guard's redirect, a failure or a
  // cancel, the item of the route the router shows is selected again. It
  // checks the event itself rather than with rxjs's `filter`: dolan copies
  // this file into apps, and an import from rxjs would make rxjs one of the
  // component's own packages.
  protected readonly settleTapped = this.#router.events
    .pipe(takeUntilDestroyed())
    .subscribe((event) => {
      if (navigationOver(event)) this.#tapped.set(null);
    });

  /**
   * Whether a page of the stack that's showing has taken the bar away (see
   * LynxStackChrome).
   */
  protected readonly stackHidden = computed(() => this.#bar.hidden());

  /**
   * Where the stack has the bar, as its pages move.
   *
   * Where they move as iOS's do, the page under a pushed one carries the
   * bar, as UIKit's carries its tab bar (see LynxStackBottomBar): the bar
   * moves left with it, and the pushed page covers it, rounded corner and
   * shadow and all. The bar stays as it is, at rest in the page.
   *
   * Otherwise it slides down off the screen, as Material's navigation bar
   * leaves a screen it drills down to. So does a bar no page can carry, such
   * as one going away with a page that's popped.
   *
   * It moves as long as the pages do, on their curve, and at once as a
   * finger drags them. Under Reduce Motion, while the pages cross-fade, it
   * goes and comes at once.
   */
  protected readonly stackLook = computed(() => {
    const progress = this.#bar.progress();
    const motion = this.#bar.motion();
    const moving = motion.duration > 0;
    return {
      transform: `translateY(${round(progress * 100)}%)`,
      // While it's away or on its way, it lies over the outlet's bottom
      // rather than under it, so the outlet, and the pushed page, run to the
      // screen's bottom edge from the start. (A page carrying it puts it
      // there itself.)
      lifted: this.stackHidden() || progress > 0 || moving,
      transition:
        moving && motion.animation !== 'fade'
          ? `transform ${motion.duration}ms ${motion.easing}`
          : null,
    };
  });

  protected readonly barClass = computed(() =>
    cn(
      'flex-row border-t border-border bg-background flex pb-safe',
      this.stackLook().lifted && 'absolute bottom-0 left-0 right-0',
      this.userClass(),
    ),
  );

  // A native view of its own on Android, where a flattened view's transition
  // doesn't move it.
  protected readonly ownView = inject(Renderer2).setAttribute(
    inject(ElementRef).nativeElement,
    'flatten',
    'false',
  );

  /**
   * Shows `item` selected now, for a tap on it that started a navigation.
   * After a tap that started none, because the router shows the item's
   * route already, the router's own item shows.
   */
  markTapped(item: UiTabBarItem): void {
    // The item's RouterLink navigates from the same tap, before this: its
    // host listener comes first. A navigation to the URL the router shows is
    // skipped then and there, which leaves none under way, and cancels one
    // another tap started.
    this.#tapped.set(this.#router.currentNavigation() ? item : null);
    // Draws the mark now, before the router builds the screen: it goes on
    // after this turn's listeners (it waits a microtask after
    // NavigationStart), and the change detection after it would bring the
    // mark and the built screen together. The apps' shells send a flush to
    // the UI thread at once, which draws the mark while the screen is built.
    this.#appRef.tick();
  }
}

/**
 * Whether a router event ends a navigation, as Angular's own
 * `afterNextNavigation` counts it: a cancel for a guard's redirect, or for a
 * newer navigation (another tap), comes before that navigation's own end.
 */
const navigationOver = (event: RouterEvent): boolean =>
  event instanceof NavigationEnd ||
  event instanceof NavigationSkipped ||
  event instanceof NavigationError ||
  (event instanceof NavigationCancel &&
    event.code !== NavigationCancellationCode.Redirect &&
    event.code !== NavigationCancellationCode.SupersededByNewNavigation);

/**
 * A number to two places, for a style that changes with a finger.
 */
const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * One tab: an icon over a label that navigates to its `route` on a tap. The
 * icon is one from the set (`icon`) or the app's own mark (`svg`), such as
 * its logo on the Home tab.
 *
 * The host itself is the link. Angular's own `RouterLink` and
 * `RouterLinkActive` sit on it as host directives, so every `RouterLink`
 * option (`queryParams`, `replaceUrl`, `state`, …) and
 * `routerLinkActiveOptions` work as they do on the web, and the item knows
 * whether its route is active without the app wiring `routerLinkActive` up.
 * It shows selected from the tap, though, while the screen is built (see
 * `UiTabBar.markTapped`), and screen readers hear it `selected` as it shows.
 */
@Component({
  selector: 'ui-tab-bar-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  hostDirectives: [
    {
      directive: RouterLink,
      // `route`, not `routerLink`: an app that imports RouterLink would
      // otherwise put a second RouterLink on the item (its selector matches
      // `routerLink`), and Angular rejects two of one directive on an element.
      inputs: [
        'routerLink: route',
        'queryParams',
        'queryParamsHandling',
        'fragment',
        'preserveFragment',
        'state',
        'info',
        'relativeTo',
        'replaceUrl',
        'skipLocationChange',
      ],
    },
    { directive: RouterLinkActive, inputs: ['routerLinkActiveOptions'] },
  ],
  host: {
    // The host is the tap target and fills an equal share of the bar's row.
    // `flex-1` has to be on the host, the row's real child: on an inner view
    // it would share out the host's width instead (same lesson as
    // ui-nav-drawer-content).
    '[class]': 'contentClass()',
    // One accessibility element per tab, named by its label, so a screen
    // reader reads "Inbox, 3, button" instead of an unlabeled SVG and a word.
    // `selected` is added to `button` while the tab shows selected (see
    // markingSelected). The label is an attribute binding: a property
    // binding on a component's host is checked against the DOM schema, which
    // has no `accessibility-label`.
    'accessibility-element': 'true',
    'accessibility-traits': 'button',
    '[attr.accessibility-label]': 'accessibilityLabel()',
    // Press feedback binds touch and mouse events: native fires only touch,
    // and the web preview, in a browser, fires only mouse. See pressDown().
    '(bindtouchstart)': 'onPressStart()',
    '(bindmousedown)': 'onPressStart()',
    // A canceled touch (a scroll taking over) and a cursor leaving mid-press
    // release too, or the tab would stay shrunk.
    '(bindtouchend)': 'onPressEnd()',
    '(bindtouchcancel)': 'onPressEnd()',
    '(bindmouseup)': 'onPressEnd()',
    '(bindmouseleave)': 'onPressEnd()',
    // RouterLink navigates on the same tap through its own listener, which
    // runs first: Lynx keeps one handler per event, and the runtime runs
    // them all from it, in the order they were added.
    '(bindtap)': 'onTap()',
  },
  template: `
    <view class="relative">
      <svg [attr.content]="iconSvg()" style="width: 24px; height: 24px;" />
      @if (badgeText()) {
        <!-- Hangs off the icon's top-right corner, as on a native tab bar.
             min-w-4 keeps a one-digit badge round; longer ones grow into
             a pill. -->
        <view
          class="h-4 min-w-4 items-center rounded-full bg-destructive px-1 flex absolute -right-2.5 -top-1 justify-center"
        >
          <text
            class="text-[10px] font-semibold leading-4 text-destructive-foreground"
            >{{ badgeText() }}</text
          >
        </view>
      }
    </view>
    <text [class]="labelClass()">{{ label() }}</text>
  `,
})
export class UiTabBarItem {
  /**
   * An icon from the set, registered with `provideIcons()`. Give this or
   * `svg`.
   */
  readonly icon = input<IconName | undefined>(undefined);
  /**
   * SVG markup to draw instead of an icon from the set, such as the app's
   * logo. `currentColor` in it takes the tab's color for its state, as the
   * set's icons do, so a one-color mark follows selection and the theme;
   * colors written out stay. Give this or `icon`.
   */
  readonly svg = input<string | undefined>(undefined);
  readonly label = input.required<string>();
  /**
   * A count or short text over the icon's corner, such as unread messages.
   * Nothing shows for `0`, an empty string, `null` or `undefined`, so a count
   * can be bound as it is.
   */
  readonly badge = input<string | number | null | undefined>(undefined);
  readonly userClass = input<string>('', { alias: 'class' });

  /** Emits on every tap, including a tap on the tab that's already active. */
  readonly pressed = output<void>();

  /**
   * Whether the item's route is active, from the RouterLinkActive on the host.
   * RouterLinkActive reports only changes, and starts from not active.
   */
  readonly #routeActive = toSignal(inject(RouterLinkActive).isActiveChange, {
    initialValue: false,
  });

  readonly #tabBar = inject(UiTabBar);
  readonly #link = inject(RouterLink);

  /**
   * Whether the tab shows selected: the tab tapped last while the navigation
   * its tap started is under way, and otherwise the tab whose route is
   * active.
   */
  protected readonly active = computed(() => {
    const tapped = this.#tabBar.tappedItem();
    return tapped ? tapped === this : this.#routeActive();
  });

  // The host, not an inner view, shrinks on a press: it's the whole tap
  // target, and injecting it needs no view query.
  readonly #host = inject<ElementRef<BaseLynxElement>>(ElementRef);
  #pressAnim?: AnimationHandle;

  /**
   * The selected tab is `selected` to a screen reader as it shows, from the
   * tap. The trait is added to the host's own `button`: on iOS it reads
   * `button,selected`, and Android, which reads one trait, keeps `button`.
   */
  protected readonly markingSelected = effect(() => {
    this.#host.nativeElement.setAccessibilityTrait('selected', this.active());
  });

  protected readonly badgeText = computed(() => {
    const text = String(this.badge() ?? '');
    return text === '0' ? '' : text;
  });

  protected readonly accessibilityLabel = computed(() =>
    this.badgeText() ? `${this.label()}, ${this.badgeText()}` : this.label(),
  );

  readonly #resolveColor = injectIconColor();
  readonly #iconMarkup = injectIconMarkup();

  // The active tab takes the theme's primary color and the others its muted
  // foreground, like the tint of a native tab bar. They're solid tokens, not
  // an opacity modifier, which a theme copied before the `--x-rgb` channels
  // can't draw.
  //
  // The icon is drawn here, as the spinner and pagination draw theirs, rather
  // than by a nested <ui-icon>: each tab stays a single component, with no
  // child whose inputs it has to keep in step. An SVG can't read the label's
  // text class (Lynx doesn't pass `color` down, and the markup is parsed
  // apart from the page's CSS), so the token is resolved to its value and
  // written into the markup (see icon-theme.ts).
  protected readonly iconSvg = computed(() =>
    paintIcon(
      this.#iconMarkup(
        this.icon(),
        this.svg(),
        '<ui-tab-bar-item> needs an icon or an svg, not both.',
      ),
      this.#resolveColor(
        this.active() ? 'var(--primary)' : 'var(--muted-foreground)',
      ),
    ),
  );

  protected readonly labelClass = computed(() =>
    cn(
      'text-xs font-medium',
      this.active() ? 'text-primary' : 'text-muted-foreground',
    ),
  );

  protected readonly contentClass = computed(() =>
    cn(
      'flex-1 flex-col items-center gap-1 px-1 pb-1.5 pt-2 flex justify-center',
      this.userClass(),
    ),
  );

  /**
   * A tap on a tab that isn't selected shows it selected at once (see
   * UiTabBar.markTapped). One on the selected tab changes nothing here.
   */
  protected onTap(): void {
    this.pressed.emit();
    if (this.#link.urlTree !== null && !this.active()) {
      this.#tabBar.markTapped(this);
    }
  }

  protected onPressStart(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.#host.nativeElement);
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.#host.nativeElement);
  }
}
