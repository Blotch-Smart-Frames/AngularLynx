import { Component, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  createMainThreadRef,
  type MainThread,
} from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiCard } from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

// --- Worklet-transformed handlers ------------------------------------------
//
// Each function below is an ordinary arrow function whose FIRST statement is the
// string literal `'main thread'`. That directive is the whole feature: the
// rsbuild plugin detects it at build time and compiles the function into a Lynx
// main-thread worklet — the same result as wrapping it in `mainThreadFn()`, but
// with zero boilerplate. Bound with `[mainThreadBindtap]` / `[mainThreadBind…]`,
// they run natively on the UI thread, so touch feedback paints on the same frame
// as the gesture instead of round-tripping to Angular's background thread.
//
// They must live at module scope (not as methods) so the plugin can lift them
// onto the main thread; the component exposes them as `readonly` fields for the
// template to bind. Palettes are inlined inside each worklet rather than closed
// over from module scope — worklets are serialized across the thread boundary,
// so only main-thread refs (which are designed to cross it) are shared.

/** Persists across taps ON THE MAIN THREAD — Angular never sees this counter. */
const tapCount = createMainThreadRef(0);

/**
 * Cycle the tile's background on each tap, instantly, on the UI thread.
 */
const recolor = (event: MainThread.TouchEvent) => {
  'main thread';
  const el = event.currentTarget;
  tapCount.current++;
  const palette = [
    '#6366f1',
    '#8b5cf6',
    '#ec4899',
    '#f97316',
    '#10b981',
    '#0ea5e9',
  ];
  el.setStyleProperty(
    'background-color',
    palette[tapCount.current % palette.length]!,
  );
};

/**
 * Dim the tile as the finger slides left→right; opacity tracks the drag.
 */
const dimToFinger = (event: MainThread.TouchEvent) => {
  'main thread';
  const el = event.currentTarget;
  const touch = event.touches[0]!;
  const rect = (el as any).getBoundingClientRect();
  const ratio = (touch.clientX - rect.left) / rect.width;
  el.setStyleProperty('opacity', String(Math.max(0.2, Math.min(1, ratio))));
};

/**
 * Restore full opacity when the finger lifts.
 */
const resetDim = (event: MainThread.TouchEvent) => {
  'main thread';
  event.currentTarget.setStyleProperty('opacity', '1');
};

/**
 * Spring press: scale down now, release after 150ms — all on the UI thread.
 */
const springPress = (event: MainThread.TouchEvent) => {
  'main thread';
  const el = event.currentTarget;
  el.setStyleProperty('transform', 'scale(0.92)');
  setTimeout(() => el.setStyleProperty('transform', 'scale(1)'), 150);
};

/** Separate counter/palette for the A/B tile so it doesn't share `tapCount`. */
const flashCount = createMainThreadRef(0);

/**
 * The main-thread half of the A/B test: recolor with no cross-thread hop.
 */
const flashMain = (event: MainThread.TouchEvent) => {
  'main thread';
  const el = event.currentTarget;
  flashCount.current++;
  const palette = [
    '#6366f1',
    '#8b5cf6',
    '#ec4899',
    '#f97316',
    '#10b981',
    '#0ea5e9',
  ];
  el.setStyleProperty(
    'background-color',
    palette[flashCount.current % palette.length]!,
  );
};

@Component({
  selector: 'app-worklet-directive-demo',
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    LynxMainThreadEvent,
    DemoScreen,
    UiCard,
    UiText,
    UiBadge,
    UiIcon,
  ],
  template: `
    <app-demo-screen
      heading="Worklet Directive"
      category="Platform"
      description="Add 'main thread' as a function's first line and the build plugin compiles it into a UI-thread worklet — the ergonomic form of mainThreadFn(). Bound with [mainThreadBindtap], these handlers paint on the same frame you touch, with zero cross-thread latency."
    >
      <!-- ── The directive ──────────────────────────────────────────────────
           Lead with the concept: a plain function becomes a worklet purely
           because of one string literal. The snippet is the demo's thesis. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="settings" size="sm" />
            <ui-text variant="large">The directive</ui-text>
          </view>
          <ui-badge variant="outline">'main thread'</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          No wrapper, no registration. The one highlighted line tells the
          compiler to lift this function onto the UI thread.
        </ui-text>

        <view class="rounded-lg bg-muted p-3">
          <text class="font-[monospace] text-xs text-foreground">
            const recolor = (event) =&gt; &#123;
          </text>
          <text class="font-[monospace] text-xs font-semibold text-[#10b981]"
            >&nbsp;&nbsp;'main thread';
          </text>
          <text class="font-[monospace] text-xs text-foreground"
            >&nbsp;&nbsp;event.currentTarget.setStyleProperty(
          </text>
          <text class="font-[monospace] text-xs text-foreground"
            >&nbsp;&nbsp;&nbsp;&nbsp;'background-color', next);
          </text>
          <text class="font-[monospace] text-xs text-muted-foreground"
            >&#125;;
          </text>
        </view>
      </ui-card>

      <!-- ── Tap to recolor ─────────────────────────────────────────────────
           setStyleProperty('background-color') fired from a worklet: the swap
           happens on the touch's own frame. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-text variant="large">Tap to recolor</ui-text>
          </view>
          <ui-badge variant="outline">mainThreadBindtap</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Each tap cycles the background through a palette, instantly, on the UI
          thread. The counter lives in a main-thread ref Angular never touches.
        </ui-text>

        <view
          class="min-h-[104px] items-center rounded-xl bg-[#6366f1] p-4 flex justify-center"
          [mainThreadBindtap]="recolor"
        >
          <text class="text-base font-semibold text-white">Tap me</text>
          <text class="mt-1 text-xs text-white/70">
            setStyleProperty · main thread
          </text>
        </view>
      </ui-card>

      <!-- ── Drag to dim ────────────────────────────────────────────────────
           touchmove maps the finger's X to opacity — a per-frame value that
           would stutter if it had to cross threads. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-text variant="large">Drag to dim</ui-text>
          </view>
          <ui-badge variant="outline">mainThreadBindtouchmove</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Opacity follows your finger left to right. Continuous, per-frame
          updates are exactly what the UI thread is for.
        </ui-text>

        <view
          class="min-h-[104px] items-center rounded-xl bg-[#8b5cf6] p-4 flex justify-center"
          [mainThreadBindtouchmove]="dimToFinger"
          [mainThreadBindtouchend]="resetDim"
        >
          <text class="text-base font-semibold text-white">
            Slide across me
          </text>
          <text class="mt-1 text-xs text-white/70">
            opacity tracks your finger
          </text>
        </view>
      </ui-card>

      <!-- ── Spring press ───────────────────────────────────────────────────
           A scale-down/scale-up bounce driven entirely from the worklet with a
           setTimeout — no animationend bridge needed. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-up" size="sm" />
            <ui-text variant="large">Spring press</ui-text>
          </view>
          <ui-badge variant="outline">transform: scale()</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Press to squish, release to spring back — the whole bounce runs on the
          UI thread, so it never waits on Angular.
        </ui-text>

        <view
          class="min-h-[104px] items-center rounded-xl bg-[#10b981] p-4 flex justify-center"
          [mainThreadBindtap]="springPress"
        >
          <text class="text-base font-semibold text-white">Press me</text>
          <text class="mt-1 text-xs text-white/70">
            scale bounce · main thread
          </text>
        </view>
      </ui-card>

      <!-- ── Main vs. background (the "why") ─────────────────────────────────
           Both tiles do the same recolor. The left runs in a worklet; the right
           routes through Angular (a deferred signal write, cross-thread). On
           device the latency gap is the point of the whole feature. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="info" size="sm" />
            <ui-text variant="large">Main vs. background</ui-text>
          </view>
        </view>
        <ui-text variant="muted" class="mb-4">
          Same action, two threads. Tap both and feel the difference — the
          worklet paints immediately; the Angular handler round-trips first.
        </ui-text>

        <view class="flex-row gap-3 flex">
          <view
            class="min-h-[128px] flex-1 items-center rounded-xl bg-[#6366f1] p-4 flex justify-center"
            [mainThreadBindtap]="flashMain"
          >
            <text class="text-sm font-semibold text-white">Main thread</text>
            <text class="mt-1 text-[11px] text-white/70 text-center">
              worklet · zero latency
            </text>
          </view>

          <view
            class="min-h-[128px] flex-1 items-center rounded-xl p-4 flex justify-center"
            [style.background-color]="bgColor()"
            (bindtap)="onBgTap()"
          >
            <text class="text-sm font-semibold text-white">
              Background thread
            </text>
            <text class="mt-1 text-[11px] text-white/70 text-center">
              {{ bgTaps() }} taps · cross-thread
            </text>
          </view>
        </view>
      </ui-card>

      <!-- ── How it works ───────────────────────────────────────────────────
           Name the three moving parts so the demo teaches, not just entertains. -->
      <ui-card class="p-4">
        <view class="mb-2 flex-row items-center gap-2 flex">
          <ui-icon name="info" size="sm" />
          <ui-text variant="large">How it works</ui-text>
        </view>
        <view class="flex-col gap-3 flex">
          <view class="flex-row items-start gap-2 flex">
            <ui-badge variant="outline">'main thread'</ui-badge>
            <ui-text variant="muted" class="flex-1">
              First-line directive. The build plugin compiles the function into
              a UI-thread worklet — no mainThreadFn() wrapper.
            </ui-text>
          </view>
          <view class="flex-row items-start gap-2 flex">
            <ui-badge variant="outline">mainThreadBind*</ui-badge>
            <ui-text variant="muted" class="flex-1">
              Binds a worklet to a native touch event: tap, touchmove, touchend,
              and friends.
            </ui-text>
          </view>
          <view class="flex-row items-start gap-2 flex">
            <ui-badge variant="outline">createMainThreadRef</ui-badge>
            <ui-text variant="muted" class="flex-1">
              State that lives on the UI thread and survives between taps — like
              the recolor counter above.
            </ui-text>
          </view>
        </view>
        <ui-text variant="muted" class="mt-4">
          It mirrors React Lynx's main-thread scripts: gesture and animation
          handlers stay off the background thread, so they respond at native
          frame rate.
        </ui-text>
      </ui-card>
    </app-demo-screen>
  `,
})
export class WorkletDirectiveDemo {
  // Expose the module-level worklets to the template. They stay `readonly` — the
  // plugin has already lifted the underlying functions onto the main thread.
  readonly recolor = recolor;
  readonly dimToFinger = dimToFinger;
  readonly resetDim = resetDim;
  readonly springPress = springPress;
  readonly flashMain = flashMain;

  /** The background-thread half of the A/B tile. */
  readonly bgTaps = signal(0);
  readonly bgColor = signal('#6366f1');

  // Same palette as the worklets, but here it drives an Angular signal binding
  // so the recolor takes the full cross-thread path for the comparison.
  readonly #bgPalette = [
    '#6366f1',
    '#8b5cf6',
    '#ec4899',
    '#f97316',
    '#10b981',
    '#0ea5e9',
  ];

  onBgTap(): void {
    // Defer the signal writes out of the native bindtap callback: mutating state
    // synchronously inside a Lynx event handler can flush the renderer mid-frame
    // and crash. The setTimeout hop is itself part of what makes this path
    // slower than the worklet — exactly the latency the demo contrasts.
    setTimeout(() => {
      const next = this.bgTaps() + 1;
      this.bgTaps.set(next);
      this.bgColor.set(this.#bgPalette[next % this.#bgPalette.length]!);
    }, 0);
  }
}
