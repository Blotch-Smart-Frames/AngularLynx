import { Component, signal } from '@angular/core';
import {
  FlingGesture,
  Gesture,
  LYNX_ELEMENTS,
  LynxGestureDetector,
  PanGesture,
} from '@blotch/angular-lynx';

/** How far the pan must move before it activates. */
const MIN_DISTANCE = 20;

/**
 * E2E fixture loaded through `loadComponent`, for native/gestures.yaml and,
 * on Lynx for Web (whose gestures the runtime recognizes itself, since
 * web-core's `__SetGestureDetector` does nothing), playwright/render.test.ts.
 *
 * One swipe across "Swipe here" runs a pan and a fling together (issue #56):
 * - "Pan from touch" says whether the pan's `translationX` at `onStart`
 *   includes the distance moved before it activated. The translation used to
 *   restart at `onStart`, so it read 0 there.
 * - "Fling ended" says whether the fling's `onEnd` ran. Lynx fires a fling's
 *   `onEnd` only after its `onBegin`, and only when an `onBegin` is
 *   registered; neither gesture registers one here, so LynxGestureDetector
 *   must. The fling shares the element with the pan because Lynx flings only
 *   the element that won the touch, and a fling alone ignores the touch until
 *   the finger lifts.
 *
 * The page renders where the lazy page does, below the counter page, so it's
 * one row: on CI's 320x640 Android emulator, a second row would be off the
 * screen. The texts aren't flattened, so Maestro can see them on Android (see
 * counter.ts).
 */
@Component({
  selector: 'app-gestures',
  imports: [LYNX_ELEMENTS, LynxGestureDetector],
  template: `
    <view style="display: flex; flex-direction: row; margin-top: 16px;">
      <view
        [lynxGesture]="swipe"
        style="width: 100px; padding: 12px; background-color: #e0e0e0;"
      >
        <text flatten="false">Swipe here</text>
      </view>
      <view style="margin-left: 16px;">
        <text flatten="false"
          >Pan from touch: {{ panFromTouch() ? 'yes' : 'no' }}</text
        >
        <text flatten="false" style="margin-top: 4px;"
          >Fling ended: {{ flingEnded() ? 'yes' : 'no' }}</text
        >
      </view>
    </view>
  `,
})
export class GesturesRoute {
  readonly panFromTouch = signal(false);
  readonly flingEnded = signal(false);

  readonly swipe = Gesture.Simultaneous(
    new PanGesture()
      .minDistance(MIN_DISTANCE)
      .onStart((event) =>
        this.panFromTouch.set(Math.abs(event.translationX) >= MIN_DISTANCE),
      ),
    new FlingGesture().onEnd(() => this.flingEnded.set(true)),
  );
}
