import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import {
  Gesture,
  LongPressGesture,
  LYNX_ELEMENTS,
  LynxGestureDetector,
  PanGesture,
  TapGesture,
} from '@blotch/angular-lynx';
import { UiBadge, type BadgeVariant } from '../../components/ui/badge';
import { UiIcon } from '../../components/ui/icon';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

// Spring easing with a slight overshoot — the same curve @blotch/dolan uses for
// its press/pop micro-interactions, kept inline so the demo has no dependency on
// the private animate utils. Used for the puck's snap-back and the tap pulse.
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

/**
 * Gesture demo — a focused, single-screen showcase of the four native gesture
 * primitives bridged through Angular via `[lynxGesture]`: pan (drag), tap,
 * long-press, and exclusive composition.
 *
 * It deliberately does NOT use the shared `DemoScreen` wrapper (or any
 * scroll-view): nesting the pan target inside a scroll-view makes the drag fight
 * the scroll for the same vertical touch stream, so this screen fits everything
 * on one page instead. The hero drag arena claims the slack via `flex-1`, so the
 * layout adapts to any device height without scrolling.
 *
 * `ScreenHost` gives the host a definite height (flex-1) so `h-full` below
 * resolves against the routed area rather than collapsing to content height.
 */
@Component({
  selector: 'app-gesture-demo',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, LynxGestureDetector, UiText, UiBadge, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <view class="h-full w-full flex-col gap-3 bg-background p-4 flex">
      <!-- Header -->
      <view class="flex-row items-center gap-2 flex">
        <ui-text variant="h3">Gestures</ui-text>
        <ui-badge variant="secondary">Platform</ui-badge>
      </view>
      <ui-text variant="muted">
        Native touch gestures bridged to Angular — drag, tap, hold, and
        exclusive composition.
      </ui-text>

      <!-- ── Pan (drag) — the hero. The puck tracks the finger 1:1 via a live
           inline transform, then springs back to center on release. ────────── -->
      <view
        class="flex-1 flex-col gap-3 rounded-xl border border-border bg-card p-4 flex"
      >
        <view class="flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <ui-text variant="large">Drag</ui-text>
            <ui-badge variant="outline" [animated]="false">Pan</ui-badge>
          </view>
          <!-- Live translation readout, updated every frame from onUpdate. -->
          <view
            class="flex-row items-center gap-3 rounded-full bg-muted px-3 py-1 flex"
          >
            <text class="text-xs font-medium text-muted-foreground">
              x {{ panX() }}
            </text>
            <text class="text-xs font-medium text-muted-foreground">
              y {{ panY() }}
            </text>
          </view>
        </view>

        <view
          class="flex-1 items-center rounded-xl border border-dashed border-border bg-muted flex justify-center"
        >
          <view
            #puck
            class="h-20 w-20 items-center rounded-2xl bg-primary flex justify-center"
            [style.transform]="puckTransform()"
            [lynxGesture]="panGesture"
          >
            <!-- Grab-handle dots. Built from views (not an icon) so the color
                 follows the theme via bg-primary-foreground — an icon's color is
                 a literal that wouldn't flip in dark mode. -->
            <view class="flex-row items-center gap-1 flex">
              <view class="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
              <view class="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
              <view class="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
            </view>
          </view>
        </view>

        <text class="text-xs text-muted-foreground text-center">
          Drag the tile — it tracks your finger, then springs home.
        </text>
      </view>

      <!-- ── Tap + Long-press, side by side. flex-1 lives on these plain views
           (not the ui-card component, whose host wouldn't take flex-grow). ──── -->
      <view class="flex-row gap-3 flex">
        <!-- Tap -->
        <view
          class="flex-1 flex-col items-center gap-1 rounded-xl border border-border bg-card p-4 flex justify-center"
          [lynxGesture]="tapGesture"
        >
          <ui-badge variant="outline" class="self-center" [animated]="false">
            Tap
          </ui-badge>
          <text #tapNum class="text-4xl font-bold text-foreground">{{
            tapCount()
          }}</text>
          <text class="text-xs text-muted-foreground">tap to count</text>
        </view>

        <!-- Long press -->
        <view
          class="flex-1 flex-col items-center gap-2 rounded-xl border p-4 flex justify-center {{
            longPressActive()
              ? 'border-primary bg-secondary'
              : 'border-border bg-card'
          }}"
          [lynxGesture]="longPressGesture"
        >
          <ui-badge variant="outline" class="self-center" [animated]="false">
            Hold
          </ui-badge>
          <view
            class="h-12 w-12 items-center rounded-full flex justify-center {{
              longPressActive() ? 'bg-primary' : 'bg-muted'
            }}"
          >
            <view
              class="h-5 w-5 rounded-full {{
                longPressActive() ? 'bg-primary-foreground' : 'bg-border'
              }}"
            />
          </view>
          <text class="text-xs text-muted-foreground">
            {{
              longPressActive()
                ? 'Holding…'
                : holdCount() > 0
                  ? 'Held ×' + holdCount()
                  : 'Hold 500ms'
            }}
          </text>
        </view>
      </view>

      <!-- ── Exclusive composition — pan and tap on one target, mutually
           exclusive. A short move resolves as a tap; crossing 10px hands the
           gesture to pan and cancels the tap. ─────────────────────────────── -->
      <view
        class="flex-col gap-2 rounded-xl border border-border bg-card p-4 flex"
        [lynxGesture]="exclusiveGesture"
      >
        <view class="flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <ui-text variant="large">Exclusive</ui-text>
            <ui-badge variant="outline" [animated]="false">Pan vs Tap</ui-badge>
          </view>
          <ui-badge [variant]="composedVariant()">{{
            composedAction()
          }}</ui-badge>
        </view>
        <view class="flex-row items-center gap-2 flex">
          <ui-icon name="info" size="xs" color="#a1a1aa" />
          <text class="flex-1 text-xs text-muted-foreground">
            Tap for a tap. Drag past 10px and pan takes over — only one wins.
          </text>
        </view>
      </view>
    </view>
  `,
})
export class GestureDemo {
  // ── Pan (drag) ──
  readonly panX = signal(0);
  readonly panY = signal(0);
  // Lifted while a drag is in progress, so the puck scales up for grab feedback.
  readonly dragging = signal(false);

  readonly puckRef = viewChild<ElementRef>('puck');

  // The live transform bound to the puck. During a drag this reflects the
  // finger's translation frame-by-frame (no CSS transition, so it tracks 1:1);
  // on release onEnd resets panX/panY to 0 and animate() eases it home.
  readonly puckTransform = computed(
    () =>
      `translate(${this.panX()}px, ${this.panY()}px) scale(${
        this.dragging() ? 1.06 : 1
      })`,
  );

  readonly panGesture = new PanGesture()
    .onStart(() => {
      this.dragging.set(true);
    })
    .onUpdate((event) => {
      this.panX.set(Math.round(event.translationX));
      this.panY.set(Math.round(event.translationY));
    })
    .onEnd(() => {
      // Spring the puck home from the release point. This is the same hand-off
      // as @blotch/dolan's drag-to-dismiss: animate() with fill:'forwards'
      // drives the motion, and we then reset panX/panY/dragging so the inline
      // binding's resting value matches the animation's final frame — the two
      // agree once fill:'forwards' hands control back to the style binding.
      const fromX = this.panX();
      const fromY = this.panY();

      this.puckRef()?.nativeElement.animate?.(
        [
          { transform: `translate(${fromX}px, ${fromY}px) scale(1.06)` },
          { transform: 'translate(0px, 0px) scale(1)' },
        ],
        { duration: 350, easing: SPRING, fill: 'forwards' },
      );

      this.dragging.set(false);
      this.panX.set(0);
      this.panY.set(0);
    });

  // ── Tap ──
  readonly tapCount = signal(0);
  readonly tapNumRef = viewChild<ElementRef>('tapNum');

  // onEnd counts every recognized tap. LynxGestureDetector normalizes onEnd for
  // discrete gestures, so a drag that overshoots the tap threshold no longer
  // counts (Lynx's native engine fires onEnd on failure too — see the directive).
  readonly tapGesture = new TapGesture().onEnd(() => {
    this.tapCount.update((v) => v + 1);
    // A quick spring pulse on the counter makes each tap feel registered.
    this.tapNumRef()?.nativeElement.animate?.(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.35)' },
        { transform: 'scale(1)' },
      ],
      { duration: 250, easing: SPRING },
    );
  });

  // ── Long press ──
  readonly longPressActive = signal(false);
  readonly holdCount = signal(0);

  readonly longPressGesture = new LongPressGesture()
    .minDuration(500)
    .onStart(() => {
      this.longPressActive.set(true);
    })
    .onEnd(() => {
      // onStart/onEnd only fire once the 500ms hold is recognized, so this
      // counts completed holds — not brief taps that never crossed the threshold.
      this.longPressActive.set(false);
      this.holdCount.update((v) => v + 1);
    });

  // ── Exclusive composition (pan vs tap on the same element) ──
  readonly composedAction = signal('Waiting');

  readonly composedTap = new TapGesture().onEnd(() => {
    this.composedAction.set('Tapped');
  });
  readonly composedPan = new PanGesture()
    .minDistance(10)
    .onStart(() => {
      this.composedAction.set('Panning…');
    })
    .onEnd(() => {
      this.composedAction.set('Pan ended');
    });

  // Exclusive: gestures are tried in order and the first to enter its active
  // state cancels the others. Pan has a minDistance(10) threshold, so short
  // movements still resolve as taps; once the finger crosses 10px, pan wins.
  readonly exclusiveGesture = Gesture.Exclusive(
    this.composedPan,
    this.composedTap,
  );

  // Color the result badge by which gesture won — primary for pan, a neutral
  // secondary for a tap, and a quiet outline while idle.
  readonly composedVariant = computed<BadgeVariant>(() => {
    switch (this.composedAction()) {
      case 'Panning…':
      case 'Pan ended':
        return 'default';
      case 'Tapped':
        return 'secondary';
      default:
        return 'outline';
    }
  });
}
