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
// event.currentTarget. Style writes here land straight away, with no change
// detection, which is what makes them ideal for touch-driven UI (color,
// opacity, transforms).

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

// The box's position, measured when a drag starts. getBoundingClientRect() is
// asynchronous, so each touchmove reads this instead of measuring again.
const dragBox = createMainThreadRef<MainThread.BoundingClientRect | null>(null);

const handleTouchStart = mainThreadFn((event: MainThread.TouchEvent) => {
  void event.currentTarget.getBoundingClientRect().then((rect) => {
    dragBox.current = rect;
  });
});

const handleTouchMove = mainThreadFn((event: MainThread.TouchEvent) => {
  const rect = dragBox.current;
  // The first moves can arrive before the measurement does.
  if (!rect) return;
  // Map the finger's horizontal position within the box to an opacity ramp.
  // Touch clientX and the rect's left are both measured from the LynxView.
  const relativeX = (event.touches[0]!.clientX - rect.left) / rect.width;
  const opacity = Math.max(0.3, Math.min(1, relativeX));
  event.currentTarget.setStyleProperty('opacity', String(opacity));
});

const handleTouchEnd = mainThreadFn((event: MainThread.TouchEvent) => {
  // Restore full opacity once the finger lifts.
  event.currentTarget.setStyleProperty('opacity', '1');
});

// ── Background functions ────────────────────────────────────────────────────
// Registered with backgroundFn() at module level, so the background thread
// registers them when it runs this file, and called with runOnBackground().
// This is the "instant feedback now, background work later" pattern: paint on
// the main thread, then hand API calls and other background-only work to the
// background thread. The counter lives there, and its value comes back to
// Angular as the call's result.
let bgDispatchCount = 0;

const incrementBgCounter = backgroundFn(() => {
  bgDispatchCount++;
  return bgDispatchCount;
});

const resetBgCounter = backgroundFn(() => {
  bgDispatchCount = 0;
});

// The background thread's count, as last reported. Module-level, so the
// main-thread script below can set it: it runs on the main thread, like the
// component.
const crossThreadCount = signal(0);

// Instant visual feedback on the main thread, with no change detection, then
// the background thread bumps its count. The script asks for the count itself
// because Lynx keeps one tap handler per element, so a (bindtap) next to
// [mainThreadBindtap] would never run.
const handleCrossThreadTap = mainThreadFn((event: MainThread.TouchEvent) => {
  const el = event.currentTarget;
  el.setStyleProperty('opacity', '0.6');
  setTimeout(() => el.setStyleProperty('opacity', '1'), 150);
  void runOnBackground(incrementBgCounter).then((count) =>
    crossThreadCount.set(count as number),
  );
});

// A main-thread function callable from Angular via
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
      description="Lynx runs on two threads. Angular and your handlers run on the main thread, next to the native UI — hop to the background thread for APIs only it has."
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
              Native UI and your Angular app. Handlers and main-thread scripts
              run here, with zero cross-thread latency.
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
              Background-only APIs, such as fetch and native modules. Reach it
              with runOnBackground().
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
            [mainThreadBindtouchstart]="handleTouchStart"
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
            A main-thread script dips the box instantly, then asks a background
            function to bump its counter with runOnBackground().
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg bg-violet-500 py-10 flex justify-center"
            [mainThreadBindtap]="handleCrossThreadTap"
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

      <!-- ── Main-thread script from Angular (runOnMainThread) ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="zap" size="sm" />
              <ui-card-title class="text-lg">Script from Angular</ui-card-title>
            </view>
            <ui-badge [animated]="false">runOnMainThread</ui-badge>
          </view>
          <ui-card-description>
            Angular calls runOnMainThread() to run a main-thread script that
            flashes the target natively — no component re-render involved.
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

      <!-- ── Template handler (comparison) ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="info" size="sm" />
              <ui-card-title class="text-lg">Template handler</ui-card-title>
            </view>
            <ui-badge variant="outline" [animated]="false">(bindtap)</ui-badge>
          </view>
          <ui-card-description>
            A plain (bindtap) handler runs on the main thread too. It sets a
            signal, and Angular re-renders after it returns.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view
            class="items-center rounded-lg border border-dashed border-border bg-muted py-10 flex justify-center"
            (bindtap)="onBackgroundTap()"
          >
            <text class="text-base font-medium text-muted-foreground">
              Tap me
            </text>
          </view>
          <view class="flex-row items-center flex justify-between">
            <ui-badge variant="secondary" [animated]="false">
              Handler taps: {{ bgTapCount() }}
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
  readonly handleTouchStart = handleTouchStart;
  readonly handleTouchMove = handleTouchMove;
  readonly handleTouchEnd = handleTouchEnd;
  readonly handleCrossThreadTap = handleCrossThreadTap;

  readonly crossThreadCount = crossThreadCount;
  readonly bgTapCount = signal(0);

  resetCrossThread(): void {
    void runOnBackground(resetBgCounter).then(() => crossThreadCount.set(0));
  }

  /**
   * Call a main-thread script from Angular code.
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
