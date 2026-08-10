import { Component, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  LynxMainThread,
  mainThreadFn,
  backgroundFn,
  createMainThreadRef,
  type MainThread,
} from '@blotch/angular-lynx';
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

// ── Main-thread functions ──────────────────────────────────────────────────
// These run on the MAIN thread with direct access to the native element via
// event.currentTarget. Style writes here land with zero cross-thread latency,
// which is what makes them ideal for touch-driven UI (color, opacity, transforms)
// — the pixel updates before a round trip to Angular could ever complete.

// A main-thread ref persists state across taps *on the main thread* — it is not
// reactive Angular state, so it never triggers change detection.
const tapCount = createMainThreadRef(0);

// A curated palette of vivid mid-tones. White label text stays readable on every
// one of them, so the surface can cycle freely without a contrast check per color.
const TAP_COLORS = [
  '#6366f1',
  '#14b8a6',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#10b981',
];

const handleTap = mainThreadFn((event: MainThread.TouchEvent) => {
  const el = event.currentTarget;
  tapCount.current++;
  // Overrides the element's base `bg-indigo-500` class with an inline color. The
  // first tap moves to index 1 (teal), so there's always a visible change.
  const color = TAP_COLORS[tapCount.current % TAP_COLORS.length]!;
  el.setStyleProperty('background-color', color);
});

const handleTouchMove = mainThreadFn((event: MainThread.TouchEvent) => {
  const el = event.currentTarget;
  const rect = (
    el as unknown as { getBoundingClientRect(): DOMRect }
  ).getBoundingClientRect();
  // Map the finger's horizontal position within the box to an opacity ramp.
  const relativeX = (event.touches[0]!.clientX - rect.left) / rect.width;
  const opacity = Math.max(0.3, Math.min(1, relativeX));
  el.setStyleProperty('opacity', String(opacity));
});

const handleTouchEnd = mainThreadFn((event: MainThread.TouchEvent) => {
  // Restore full opacity once the finger lifts.
  event.currentTarget.setStyleProperty('opacity', '1');
});

// ── Background functions ────────────────────────────────────────────────────
// Registered with backgroundFn() and invoked from a main-thread handler via
// runOnBackground(). This is the "instant feedback now, heavy work later" pattern:
// paint on the main thread, then hand state updates / API calls / analytics off
// to the background thread where Angular lives.
let bgDispatchCount = 0;

const incrementBgCounter = backgroundFn(() => {
  bgDispatchCount++;
  return bgDispatchCount;
});

// Main → Background: instant visual feedback on the main thread, THEN dispatch to
// the background thread to update app state.
const handleCrossThreadTap = mainThreadFn((event: MainThread.TouchEvent) => {
  const el = event.currentTarget;

  // 1. Instant dip on the main thread — no latency.
  el.setStyleProperty('opacity', '0.6');

  // 2. Hand off to the background thread (see onCrossThreadTap for the visible
  //    state update that runs there).
  (
    globalThis as unknown as { runOnBackground: (fn: unknown) => void }
  ).runOnBackground(incrementBgCounter);

  // 3. Settle back to full opacity.
  setTimeout(() => el.setStyleProperty('opacity', '1'), 150);
});

// Background → Main: a main-thread function callable from Angular via
// LynxMainThread.runOnMainThread(). Runs a native flash with no Angular re-render.
const flashElement = mainThreadFn((color: string, elementSelector: string) => {
  const page = __GetPageElement();
  const target = __QuerySelector(page, elementSelector, {});
  if (!target) return;
  __AddInlineStyle(target, 'background-color', color);
  __FlushElementTree();
  setTimeout(() => {
    // Clear the inline override so the surface falls back to its themed base
    // class (bg-muted), which respects light/dark mode — rather than resetting to
    // a hardcoded color that would look wrong in one of the themes.
    __SetInlineStyles(target, '');
    __FlushElementTree();
  }, 300);
});

@Component({
  selector: 'app-main-thread-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    LynxMainThreadEvent,
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
      heading="Main Thread"
      category="Platform"
      description="Lynx runs on two threads. Drive instant, native UI on the main thread — then hop to Angular on the background thread when you need app state."
    >
      <!-- ── Concept: the two threads ── -->
      <ui-card class="w-full">
        <ui-card-content class="flex-row items-stretch gap-3 p-4 flex">
          <view
            class="flex-1 flex-col gap-1 rounded-lg border border-border bg-muted p-3 flex"
          >
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="circle" size="xs" />
              <text class="text-sm font-semibold text-foreground">
                Main thread
              </text>
            </view>
            <text class="text-xs text-muted-foreground">
              Native UI. Style writes land the instant your finger moves — zero
              cross-thread latency.
            </text>
          </view>
          <view
            class="flex-1 flex-col gap-1 rounded-lg border border-border bg-muted p-3 flex"
          >
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="loader" size="xs" />
              <text class="text-sm font-semibold text-foreground">
                Background thread
              </text>
            </view>
            <text class="text-xs text-muted-foreground">
              Where Angular runs. App state, signals and logic live here.
            </text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Main thread: instant color ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="star" size="sm" />
              <ui-card-title class="text-lg">Instant color</ui-card-title>
            </view>
            <ui-badge variant="secondary" [animated]="false">
              Main thread
            </ui-badge>
          </view>
          <ui-card-description>
            Tap cycles the color directly on the main thread — no round trip to
            Angular.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg bg-indigo-500 py-10 flex justify-center"
            [mainThreadBindtap]="handleTap"
          >
            <text class="text-base font-semibold text-white">
              Tap to cycle colors
            </text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Main thread: live opacity ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="eye" size="sm" />
              <ui-card-title class="text-lg">Live opacity</ui-card-title>
            </view>
            <ui-badge variant="secondary" [animated]="false">
              Main thread
            </ui-badge>
          </view>
          <ui-card-description>
            Drag across the box — opacity tracks your finger, updated live on
            the main thread.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg bg-teal-500 py-10 flex justify-center"
            [mainThreadBindtouchmove]="handleTouchMove"
            [mainThreadBindtouchend]="handleTouchEnd"
          >
            <text class="text-base font-semibold text-white">
              Drag across me
            </text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Main → Background (runOnBackground) ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="arrow-right" size="sm" />
              <ui-card-title class="text-lg">Main → Background</ui-card-title>
            </view>
            <ui-badge [animated]="false">Main → BG</ui-badge>
          </view>
          <ui-card-description>
            The tap dips instantly on the main thread, then dispatches to
            Angular via runOnBackground() to bump the counter.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg bg-violet-500 py-10 flex justify-center"
            [mainThreadBindtap]="handleCrossThreadTap"
            (bindtap)="onCrossThreadTap()"
          >
            <text class="text-base font-semibold text-white">Tap me</text>
          </view>
          <view class="flex-row items-center flex justify-between">
            <ui-badge [animated]="false">
              Cross-thread taps: {{ crossThreadCount() }}
            </ui-badge>
            <ui-button
              size="sm"
              variant="outline"
              (pressed)="resetCrossThread()"
            >
              Reset
            </ui-button>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Background → Main (runOnMainThread) ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="arrow-left" size="sm" />
              <ui-card-title class="text-lg">Background → Main</ui-card-title>
            </view>
            <ui-badge [animated]="false">BG → Main</ui-badge>
          </view>
          <ui-card-description>
            Angular calls runOnMainThread() to flash the target natively — no
            component re-render involved.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="flash-target items-center rounded-lg border border-dashed border-border bg-muted py-10 flex justify-center"
          >
            <text class="text-base font-semibold text-foreground">
              Flash target
            </text>
          </view>
          <ui-button size="sm" (pressed)="onFlashFromBackground()">
            Flash from Angular
          </ui-button>
        </ui-card-content>
      </ui-card>

      <!-- ── Background thread only (comparison) ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="info" size="sm" />
              <ui-card-title class="text-lg">Background only</ui-card-title>
            </view>
            <ui-badge variant="outline" [animated]="false">Background</ui-badge>
          </view>
          <ui-card-description>
            This handler runs entirely on the background thread — the tap makes
            a round trip before anything updates.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg border border-dashed border-border bg-muted py-10 flex justify-center"
            (bindtap)="onBackgroundTap()"
          >
            <text class="text-base font-medium text-muted-foreground">
              Tap me (background thread)
            </text>
          </view>
          <view class="flex-row items-center flex justify-between">
            <ui-badge variant="secondary" [animated]="false">
              BG taps: {{ bgTapCount() }}
            </ui-badge>
            <ui-button size="sm" variant="outline" (pressed)="resetBgTaps()">
              Reset
            </ui-button>
          </view>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class MainThreadDemo {
  readonly #mts = inject(LynxMainThread);

  // Expose the main-thread handles to the template.
  readonly handleTap = handleTap;
  readonly handleTouchMove = handleTouchMove;
  readonly handleTouchEnd = handleTouchEnd;
  readonly handleCrossThreadTap = handleCrossThreadTap;

  // Angular (background-thread) state.
  readonly crossThreadCount = signal(0);
  readonly bgTapCount = signal(0);

  /**
   * Background-thread handler bound alongside the main-thread tap on the same box.
   */
  onCrossThreadTap(): void {
    this.crossThreadCount.update((v) => v + 1);
  }

  resetCrossThread(): void {
    this.crossThreadCount.set(0);
  }

  /**
   * Background → Main: call a main-thread function from Angular code.
   */
  onFlashFromBackground(): void {
    const colors = ['#6366f1', '#14b8a6', '#f59e0b', '#f43f5e'];
    const color = colors[this.crossThreadCount() % colors.length]!;
    this.#mts.runOnMainThread(flashElement, color, '.flash-target');
  }

  onBackgroundTap(): void {
    this.bgTapCount.update((v) => v + 1);
  }

  resetBgTaps(): void {
    this.bgTapCount.set(0);
  }
}
