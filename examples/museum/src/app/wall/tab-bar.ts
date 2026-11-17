import { UpperCasePipe } from '@angular/common';
import {
  ApplicationRef,
  Component,
  ElementRef,
  Renderer2,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  Router,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import { LYNX_ELEMENTS, LynxStackBottomBar } from '@blotch/angular-lynx';
import { SavedWorks } from '../state/saved';
import { Press } from './press';

type Tab = { readonly route: string; readonly label: string };

const TABS: readonly Tab[] = [
  { route: '/on-view', label: 'On view' },
  { route: '/search', label: 'Search' },
  { route: '/saved', label: 'Saved' },
];

/**
 * The tab bar: a transom of three frosted panes between black bars, the
 * current one flooded cobalt. It's the app's own bar rather than
 * `@blotch/ui`'s, built on what the runtime gives a bar of your own:
 *
 * - `RouterLink` and `RouterLinkActive` on each pane, as on the web. A tap
 *   on the tab you're in goes back to its first screen (the tab outlet pops
 *   its stack).
 * - `LynxStackBottomBar`: a work pushed over a tab's first screen takes the
 *   bar away. On iOS the screen underneath carries it, so the pushed screen
 *   slides over it; elsewhere it slides down by `progress()`.
 * - The pane tapped floods at once, before its tab is built: the tap marks
 *   it and runs change detection (`ApplicationRef.tick()`), and the router
 *   builds the tab after the tap's listeners return.
 *
 * It floats over the bottom of the screen, so the wall shows blurred
 * through its panes as it scrolls under them; screens pad their ends for it.
 * The glazing bars are the panes' black borders (`glazing`), not a black
 * backing behind them, which the glass would blur to flat gray.
 */
@Component({
  selector: 'app-tab-bar',
  imports: [LYNX_ELEMENTS, UpperCasePipe, RouterLink, RouterLinkActive, Press],
  hostDirectives: [LynxStackBottomBar],
  host: {
    class: 'absolute bottom-0 left-0 right-0 flex flex-col',
    'accessibility-traits': 'tabbar',
    '[style.transform]': 'look().transform',
    '[style.transition]': 'look().transition',
    '[attr.accessibility-elements-hidden]': 'hidden() || null',
  },
  template: `
    <view class="glazing flex flex-row" [user-interaction-enabled]="!hidden()">
      @for (tab of tabs; track tab.route) {
        <view
          appPress
          #link="routerLinkActive"
          class="glow glazing relative h-[58px] flex-1 overflow-hidden"
          [routerLink]="tab.route"
          routerLinkActive
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="tab.label"
          (bindtap)="mark(tab)"
        >
          <blur-view
            class="absolute top-0 right-0 bottom-0 left-0"
            blur-effect="light"
            blur-radius="18px"
          ></blur-view>
          <view
            class="frost absolute top-0 right-0 bottom-0 left-0 flex flex-row items-center justify-center gap-2"
            [class.flooded]="selected(tab, link.isActive)"
          >
            <text
              class="label text-[13px]"
              [class.text-on-color]="selected(tab, link.isActive)"
              [class.text-ink]="!selected(tab, link.isActive)"
              >{{ tab.label | uppercase }}</text
            >
            @if (tab.route === '/saved' && saved.count()) {
              <view
                class="pane-amber flex h-[20px] min-w-[20px] flex-row items-center justify-center px-1"
              >
                <text class="label text-[11px] text-ink">{{
                  saved.count()
                }}</text>
              </view>
            }
          </view>
        </view>
      }
    </view>
    <view class="pb-home bg-bar"></view>
  `,
})
export class TabBar {
  protected readonly tabs = TABS;
  protected readonly saved = inject(SavedWorks);

  readonly #bar = inject(LynxStackBottomBar);
  readonly #router = inject(Router);
  readonly #appRef = inject(ApplicationRef);

  /** The pane tapped last, while the navigation its tap started runs. */
  readonly #tapped = signal<Tab | null>(null);

  protected readonly settle = this.#router.events
    .pipe(takeUntilDestroyed())
    .subscribe((event) => {
      if (
        event instanceof NavigationEnd ||
        event instanceof NavigationSkipped ||
        event instanceof NavigationError ||
        event instanceof NavigationCancel
      ) {
        this.#tapped.set(null);
      }
    });

  /** Whether a pushed work has taken the bar away. */
  protected readonly hidden = computed(() => this.#bar.hidden());

  /** Where the stack has put the bar, moving with its pages. */
  protected readonly look = computed(() => {
    const progress = this.#bar.progress();
    const motion = this.#bar.motion();
    return {
      transform: `translateY(${Math.round(progress * 10000) / 100}%)`,
      transition:
        motion.duration > 0 && motion.animation !== 'fade'
          ? `transform ${motion.duration}ms ${motion.easing}`
          : null,
    };
  });

  /**
   * The bar draws in its own native view, so the stack can carry it into a
   * page on iOS without flattening it into the screen it's leaving.
   */
  protected readonly ownView = inject(Renderer2).setAttribute(
    inject(ElementRef).nativeElement,
    'flatten',
    'false',
  );

  protected selected(tab: Tab, active: boolean): boolean {
    const tapped = this.#tapped();
    return tapped ? tapped === tab : active;
  }

  protected mark(tab: Tab): void {
    this.#tapped.set(this.#router.currentNavigation() ? tab : null);
    this.#appRef.tick();
  }
}
