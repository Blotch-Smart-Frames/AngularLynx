import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import type { TouchEvent } from '@lynx-js/types';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * Events demo — showcases Lynx's native event-binding system, the layer beneath
 * the higher-level gesture API (see gesture-demo). Each card isolates one part
 * of the model:
 *
 *  - `bindtap` — the basic per-tap handler.
 *  - `bindtap` vs `catchtap` — Lynx controls event propagation through the event
 *    *prefix*, not a runtime `stopPropagation()` call. `bind*` lets a tap bubble
 *    to ancestor handlers; `catch*` consumes it. This card makes that difference
 *    visible with three independent counters.
 *  - `bindlongpress` — a hold gesture that fires independently of tap.
 *  - `bindtouchstart/move/end` — the raw touch stream, which delivers the full
 *    TouchEvent (with live coordinates) on the background thread as the finger
 *    moves.
 *
 * All handlers only write signals — never mutate the element tree — so they are
 * safe to run inside a Lynx worklet callback under zoneless change detection
 * (the render happens asynchronously on a later tick). See App.navigateTo() for
 * the contrasting case where a tree mutation must be deferred.
 */
@Component({
  selector: 'app-events-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiBadge,
    UiButton,
    UiIcon,
  ],
  template: `
    <app-demo-screen
      heading="Events"
      category="Platform"
      description="Lynx's native event system — tap, bubbling vs. catch, long press, and live touch tracking."
    >
      <!-- ── Tap: the basic (bindtap) handler ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="circle" size="sm" />
            <ui-card-title class="text-lg">Tap</ui-card-title>
          </view>
          <ui-card-description>
            Fires a handler on every (bindtap).
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg border border-dashed border-border bg-muted py-8 flex justify-center"
            (bindtap)="onTap()"
          >
            <text class="text-sm text-muted-foreground">
              Tap anywhere in this box
            </text>
          </view>
          <view class="flex-row items-center flex justify-between">
            <ui-badge [animated]="false">Taps: {{ tapCount() }}</ui-badge>
            <ui-button size="sm" variant="outline" (pressed)="resetTap()">
              Reset
            </ui-button>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Propagation: (bindtap) bubbles, (catchtap) stops ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-up" size="sm" />
            <ui-card-title class="text-lg">Propagation</ui-card-title>
          </view>
          <ui-card-description>
            (catchtap) stops a tap from reaching the parent; (bindtap) lets it
            bubble through.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <!-- The outer view has its own (bindtap). Tapping empty space here, or
               the "Bubbles" child (also bindtap), increments Outer. The "Stops"
               child uses (catchtap), so its tap never reaches this handler. -->
          <view
            class="flex-col gap-3 rounded-lg border border-dashed border-border bg-muted p-4 flex"
            (bindtap)="onOuterTap()"
          >
            <text class="text-sm text-muted-foreground">
              Outer view — tap a child below
            </text>
            <view class="flex-row gap-3 flex">
              <view
                class="flex-1 items-center rounded-md bg-primary py-3 flex justify-center"
                (bindtap)="onBubbleTap()"
              >
                <text class="text-sm font-medium text-primary-foreground">
                  Bubbles
                </text>
              </view>
              <view
                class="flex-1 items-center rounded-md bg-secondary py-3 flex justify-center"
                (catchtap)="onCatchTap()"
              >
                <text class="text-sm font-medium text-secondary-foreground">
                  Stops
                </text>
              </view>
            </view>
          </view>
          <view class="flex-row flex-wrap items-center gap-2 flex">
            <ui-badge [animated]="false">Outer: {{ outerCount() }}</ui-badge>
            <ui-badge variant="secondary" [animated]="false">
              Bubbles: {{ bubbleCount() }}
            </ui-badge>
            <ui-badge variant="outline" [animated]="false">
              Stops: {{ catchCount() }}
            </ui-badge>
          </view>
          <ui-button size="sm" variant="outline" (pressed)="resetPropagation()">
            Reset
          </ui-button>
        </ui-card-content>
      </ui-card>

      <!-- ── Long press: (bindlongpress), distinct from tap ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="loader" size="sm" />
            <ui-card-title class="text-lg">Long press</ui-card-title>
          </view>
          <ui-card-description>
            Hold to fire (bindlongpress) — a quick tap fires (bindtap) instead.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg border border-dashed border-border bg-muted py-8 flex justify-center"
            (bindtap)="onLongPressAreaTap()"
            (bindlongpress)="onLongPress()"
          >
            <text class="text-sm text-muted-foreground">Press and hold</text>
          </view>
          <view class="flex-row flex-wrap items-center gap-2 flex">
            <ui-badge [animated]="false">
              Long presses: {{ longPressCount() }}
            </ui-badge>
            <ui-badge variant="secondary" [animated]="false">
              Taps: {{ longPressAreaTapCount() }}
            </ui-badge>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Touch stream: live coordinates from the full TouchEvent ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">Touch tracking</ui-card-title>
          </view>
          <ui-card-description>
            Reads live coordinates from the TouchEvent as your finger moves.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <!-- catch* (not bind*) so the drag is consumed here instead of bubbling
               up to the demo-screen scroll-view — otherwise a vertical drag would
               scroll the page instead of tracking. The pad tints while active so
               the touch state is visible without reading the badges. -->
          <view
            class="items-center rounded-lg border border-dashed py-10 flex justify-center"
            [class.border-border]="!touching()"
            [class.bg-muted]="!touching()"
            [class.border-primary]="touching()"
            [class.bg-primary]="touching()"
            (catchtouchstart)="onTouchStart($event)"
            (catchtouchmove)="onTouchMove($event)"
            (catchtouchend)="onTouchEnd()"
            (catchtouchcancel)="onTouchEnd()"
          >
            <text
              class="text-sm"
              [class.text-muted-foreground]="!touching()"
              [class.text-primary-foreground]="touching()"
            >
              {{ touching() ? 'Tracking…' : 'Drag your finger here' }}
            </text>
          </view>
          <view class="flex-row flex-wrap items-center gap-2 flex">
            <ui-badge
              [variant]="touching() ? 'default' : 'secondary'"
              [animated]="false"
            >
              {{ touching() ? 'touching' : 'idle' }}
            </ui-badge>
            <ui-badge variant="outline" [animated]="false">
              x: {{ touchX() }}
            </ui-badge>
            <ui-badge variant="outline" [animated]="false">
              y: {{ touchY() }}
            </ui-badge>
            <ui-badge variant="outline" [animated]="false">
              Δx: {{ touchDeltaX() }}
            </ui-badge>
            <ui-badge variant="outline" [animated]="false">
              Δy: {{ touchDeltaY() }}
            </ui-badge>
          </view>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class EventsDemo {
  // ── Tap ──
  readonly tapCount = signal(0);

  onTap(): void {
    this.tapCount.update((v) => v + 1);
  }

  resetTap(): void {
    this.tapCount.set(0);
  }

  // ── Propagation ──
  readonly outerCount = signal(0);
  readonly bubbleCount = signal(0);
  readonly catchCount = signal(0);

  /** Fires for a tap on the outer view directly, or a tap that bubbled up from
   *  the "Bubbles" (bindtap) child. */
  onOuterTap(): void {
    this.outerCount.update((v) => v + 1);
  }

  onBubbleTap(): void {
    this.bubbleCount.update((v) => v + 1);
  }

  /**
   * catchtap on the child stops the tap here — onOuterTap() never runs.
   */
  onCatchTap(): void {
    this.catchCount.update((v) => v + 1);
  }

  resetPropagation(): void {
    this.outerCount.set(0);
    this.bubbleCount.set(0);
    this.catchCount.set(0);
  }

  // ── Long press ──
  readonly longPressCount = signal(0);
  readonly longPressAreaTapCount = signal(0);

  onLongPress(): void {
    this.longPressCount.update((v) => v + 1);
  }

  onLongPressAreaTap(): void {
    this.longPressAreaTapCount.update((v) => v + 1);
  }

  // ── Touch stream ──
  readonly touching = signal(false);
  readonly touchX = signal(0);
  readonly touchY = signal(0);
  readonly touchDeltaX = signal(0);
  readonly touchDeltaY = signal(0);

  // First-contact point, used to derive the running delta. Kept private since
  // it is internal bookkeeping, not part of the demo's observable state.
  #startX = 0;
  #startY = 0;

  onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    this.#startX = touch.clientX;
    this.#startY = touch.clientY;
    this.touching.set(true);
    this.#applyTouch(touch.clientX, touch.clientY);
  }

  onTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    this.#applyTouch(touch.clientX, touch.clientY);
  }

  onTouchEnd(): void {
    this.touching.set(false);
  }

  #applyTouch(x: number, y: number): void {
    this.touchX.set(Math.round(x));
    this.touchY.set(Math.round(y));
    this.touchDeltaX.set(Math.round(x - this.#startX));
    this.touchDeltaY.set(Math.round(y - this.#startY));
  }
}
