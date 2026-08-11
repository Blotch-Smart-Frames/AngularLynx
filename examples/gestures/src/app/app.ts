import { Component, computed, signal } from '@angular/core';
import {
  Gesture,
  LynxGestureDetector,
  PanGesture,
  TapGesture,
  LYNX_ELEMENTS,
} from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Gestures</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Pan, tap, and exclusive gesture recognition.
        </text>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Pan Gesture
          </text>
          <view
            [lynxGesture]="panGesture"
            [style.transform]="panTransform()"
            class="justify-content mb-2 h-[100px] w-[100px] items-center rounded-[10px] bg-indigo-500"
          >
            <text class="text-sm font-medium text-white">Drag me</text>
          </view>
          <text class="text-xs text-zinc-500">
            X: {{ panX() }} Y: {{ panY() }}
          </text>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Tap Gesture
          </text>
          <view
            [lynxGesture]="tapGesture"
            class="items-center rounded-[10px] bg-green-500 px-6 py-3.5 justify-center"
          >
            <text class="text-[15px] font-semibold text-white">
              Taps: {{ tapCount() }}
            </text>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-3 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Exclusive (Pan vs Tap)
          </text>
          <view
            [lynxGesture]="exclusive"
            class="items-center rounded-[10px] bg-orange-500 p-4 justify-center"
          >
            <text class="text-sm font-medium text-white">{{ action() }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS, LynxGestureDetector],
})
export class App {
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly tapCount = signal(0);
  readonly action = signal('pan or tap this area');

  // The box's live position = committed offset (#baseX/#baseY) + the current
  // drag's translation. Driving the view's transform off this makes the box
  // follow the finger.
  readonly panTransform = computed(
    () => `translate(${this.panX()}px, ${this.panY()}px)`,
  );

  // Where the box rests between drags. Lynx's translationX/Y is measured from
  // each gesture's start, so we add it to this committed offset while dragging,
  // then fold it in on release — that's what makes the box stay where dropped
  // and the next drag continue from there (rather than snapping back).
  #baseX = 0;
  #baseY = 0;

  readonly panGesture = new PanGesture()
    .minDistance(5)
    .onUpdate((e) => {
      this.panX.set(Math.round(this.#baseX + e.translationX));
      this.panY.set(Math.round(this.#baseY + e.translationY));
    })
    .onEnd(() => {
      // Commit the drop position (the value already shown) so the next drag
      // continues from here. Reading the signal avoids depending on the end
      // event carrying a final translation.
      this.#baseX = this.panX();
      this.#baseY = this.panY();
    });

  readonly tapGesture = new TapGesture().onEnd(() =>
    this.tapCount.update((v) => v + 1),
  );

  readonly #exPan = new PanGesture()
    .minDistance(10)
    .onUpdate((e) =>
      this.action.set(
        `pan x:${Math.round(e.translationX)} y:${Math.round(e.translationY)}`,
      ),
    )
    .onEnd(() => this.action.set('pan ended'));

  readonly #exTap = new TapGesture().onEnd(() =>
    this.action.set('tap detected'),
  );

  readonly exclusive = Gesture.Exclusive(this.#exPan, this.#exTap);
}
