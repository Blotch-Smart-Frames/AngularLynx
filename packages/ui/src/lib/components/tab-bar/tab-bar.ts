import {
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LYNX_ELEMENTS, LynxRouterLinkActive } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  pressDown,
  pressRelease,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import { injectIconColor } from '../icon/icon-theme';
import { type IconName, ICONS } from '../icon/icons';

/**
 * The bar along the bottom of the screen that switches between an app's
 * top-level screens. Put a `<ui-tab-bar-item>` in it for each screen, and
 * place it under the `<router-outlet>`.
 */
@Component({
  selector: 'ui-tab-bar',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // `pb-safe` pads the bar by the bottom safe-area inset, so the items sit
  // above the iPhone's home indicator while the bar's background still runs
  // to the bottom edge, as a native tab bar's does. Lynx reports no insets on
  // Android, nor does the web preview have any, so it's 0 there.
  //
  // `tabbar` is UIKit's tab bar trait (UIAccessibilityTraitTabBar), the one a
  // native tab bar's container has: it tells VoiceOver that the buttons in it
  // are tabs. Android reads a single trait and has no tab bar trait, so there
  // the row stays a plain container.
  template: `
    <view accessibility-traits="tabbar" [class]="barClass()">
      <ng-content />
    </view>
  `,
})
export class UiTabBar {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly barClass = computed(() =>
    cn(
      'flex-row border-t border-border bg-background flex pb-safe',
      this.userClass(),
    ),
  );
}

/**
 * One tab: an icon over a label that navigates to its `route` on a tap.
 *
 * The host itself is the link. Angular's own `RouterLink` and
 * `RouterLinkActive` sit on it as host directives, so every `RouterLink`
 * option (`queryParams`, `replaceUrl`, `state`, …) and
 * `routerLinkActiveOptions` work as they do on the web, and the item knows
 * whether its route is active without the app wiring `routerLinkActive` up.
 * Host directives don't match selectors, so `LynxRouterLinkActive`, which
 * marks the active item `selected` for screen readers, is listed too.
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
    LynxRouterLinkActive,
  ],
  host: {
    // The host is the tap target and fills an equal share of the bar's row.
    // `flex-1` has to be on the host, the row's real child: on an inner view
    // it would share out the host's width instead (same lesson as
    // ui-nav-drawer-content).
    class: 'flex-1 flex-col flex',
    // One accessibility element per tab, named by its label, so a screen
    // reader reads "Inbox, 3, button" instead of an unlabeled SVG and a word.
    // LynxRouterLinkActive adds `selected` to `button` while the route is
    // active. The label is an attribute binding: a property binding on a
    // component's host is checked against the DOM schema, which has no
    // `accessibility-label`.
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
    // RouterLink navigates on the same tap through its own listener: Lynx
    // keeps one handler per event, and the runtime runs both from it.
    '(bindtap)': 'pressed.emit()',
  },
  template: `
    <view [class]="contentClass()">
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
    </view>
  `,
})
export class UiTabBarItem {
  readonly icon = input.required<IconName>();
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
  protected readonly active = toSignal(
    inject(RouterLinkActive).isActiveChange,
    { initialValue: false },
  );

  // The host, not an inner view, shrinks on a press: it's the whole tap
  // target, and injecting it needs no view query.
  readonly #host = inject(ElementRef);
  #pressAnim?: AnimationHandle;

  protected readonly badgeText = computed(() => {
    const text = String(this.badge() ?? '');
    return text === '0' ? '' : text;
  });

  protected readonly accessibilityLabel = computed(() =>
    this.badgeText() ? `${this.label()}, ${this.badgeText()}` : this.label(),
  );

  readonly #resolveColor = injectIconColor();

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
  // written into the markup (see icon-theme.ts). split/join, not
  // replaceAll(), which PrimJS's ES2019 runtime lacks (see UiIcon).
  protected readonly iconSvg = computed(() =>
    ICONS[this.icon()]
      .split('currentColor')
      .join(
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

  protected onPressStart(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.#host.nativeElement);
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.#host.nativeElement);
  }
}
