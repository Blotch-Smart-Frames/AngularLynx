import { Location, LocationStrategy, UpperCasePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { LYNX_ELEMENTS, LynxLocationStrategy } from '@blotch/angular-lynx';
import { Press } from './press';

/**
 * The bar over the top of a screen: black glazing under the status bar,
 * then a transom of frosted panes, the screen's title in the widest.
 *
 * On a tab's first screen the title is the large one at the top of the
 * wall, and the transom only brightens in once that has scrolled under it
 * (`shown`), as iOS's navigation bar takes over its large title. A pushed
 * screen shows it from the start, with a Back pane naming where it goes.
 */
@Component({
  selector: 'app-top-bar',
  imports: [LYNX_ELEMENTS, UpperCasePipe, Press],
  host: { class: 'absolute left-0 top-0 right-0 flex flex-col' },
  template: `
    <view class="pt-status bg-bar"></view>
    <view
      class="glazing flex flex-row"
      style="transition: opacity 280ms cubic-bezier(0.22, 1, 0.36, 1)"
      [style.opacity]="shown() ? 1 : 0"
      [user-interaction-enabled]="shown()"
      [attr.accessibility-elements-hidden]="!shown() || null"
    >
      @if (back(); as back) {
        <view
          appPress
          class="glow glazing relative h-[50px] w-[118px] overflow-hidden"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="'Back to ' + back"
          (bindtap)="goBack()"
        >
          <blur-view
            class="absolute top-0 right-0 bottom-0 left-0"
            blur-effect="light"
            blur-radius="18px"
          ></blur-view>
          <view
            class="frost absolute top-0 right-0 bottom-0 left-0 flex flex-row items-center gap-1.5 px-3"
          >
            <view class="chevron"></view>
            <text class="label text-ellipsis text-ink" [text-maxline]="1">{{
              back | uppercase
            }}</text>
          </view>
        </view>
      }
      <view class="glazing relative h-[50px] flex-1 overflow-hidden">
        <blur-view
          class="absolute top-0 right-0 bottom-0 left-0"
          blur-effect="light"
          blur-radius="18px"
        ></blur-view>
        <view
          class="frost absolute top-0 right-0 bottom-0 left-0 flex flex-row items-center px-3"
          [class.justify-center]="!back()"
        >
          <text
            class="display text-[21px] text-ellipsis"
            style="transition: opacity 280ms cubic-bezier(0.22, 1, 0.36, 1)"
            [style.opacity]="titleShown() ? 1 : 0"
            [text-maxline]="1"
            accessibility-traits="header"
            >{{ title() | uppercase }}</text
          >
        </view>
      </view>
    </view>
  `,
})
export class TopBar {
  readonly title = input.required<string>();
  /** Where Back goes, as its pane names it, or null for a tab's first screen. */
  readonly back = input<string | null>(null);
  /** Where Back goes when there's no screen before this one to go back to. */
  readonly backRoute = input('/on-view');
  /** Whether the transom shows. */
  readonly shown = input(true);
  /** Whether its title does: a pushed screen's comes in as its own scrolls away. */
  readonly titleShown = input(true);

  readonly #location = inject(Location);
  readonly #strategy = inject(LocationStrategy);
  readonly #router = inject(Router);

  /**
   * Back through the router, so the stack slides the screen away. A screen a
   * shortcut opened directly has nothing under it, so Back goes to its tab.
   */
  protected goBack(): void {
    const strategy = this.#strategy;
    const canGoBack =
      strategy instanceof LynxLocationStrategy && strategy.canGoBack();
    if (canGoBack) this.#location.back();
    else void this.#router.navigateByUrl(this.backRoute());
  }
}
