import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

type VideoMethod = 'play' | 'pause' | 'stop' | 'seek';

// Angular types $event on native element events as DOM Event; Lynx delivers
// the payload on `detail`, so handlers cast to CustomEvent<…Detail>.
type TimeUpdateDetail = {
  current: number;
  duration: number;
};

type VideoErrorDetail = {
  errorCode: number;
  errorMsg: string;
};

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <scroll-view class="h-full bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Video</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Native video playback, controlled through UI methods.
        </text>

        <view class="mb-4 rounded-xl bg-black overflow-hidden">
          <video
            id="player"
            class="h-[210px] w-full"
            src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
            object-fit="cover"
            [muted]="muted()"
            [loop]="loop()"
            [speed]="speed()"
            (bindfirstframe)="onFirstFrame($event)"
            (bindplaying)="status.set('Playing')"
            (bindpaused)="status.set('Paused')"
            (bindstopped)="onStopped()"
            (bindended)="onEnded()"
            (bindtimeupdate)="onTimeUpdate($event)"
            (bindbuffering)="status.set('Buffering…')"
            (binderror)="onError($event)"
          ></video>
          <!-- Progress bar driven by bindtimeupdate. -->
          <view class="h-[4px] w-full bg-zinc-700">
            <view class="h-full bg-white" [style.width.%]="progress()"></view>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <view class="mb-3 flex-row flex justify-between">
            <text class="text-[13px] font-semibold text-zinc-900">
              {{ status() }}
            </text>
            <text class="text-[13px] text-zinc-500">
              {{ current().toFixed(1) }}s / {{ duration().toFixed(1) }}s
            </text>
          </view>

          <view class="flex-row flex">
            <view
              class="mr-2 flex-1 items-center rounded-lg bg-zinc-900 py-2.5"
              (bindtap)="togglePlay()"
            >
              <text class="text-[14px] font-semibold text-white">
                {{ playing() ? 'Pause' : 'Play' }}
              </text>
            </view>
            <view
              class="mr-2 flex-1 items-center rounded-lg bg-zinc-100 py-2.5"
              (bindtap)="stop()"
            >
              <text class="text-[14px] text-zinc-700">Stop</text>
            </view>
            <view
              class="flex-1 items-center rounded-lg bg-zinc-100 py-2.5"
              (bindtap)="seekTo(0)"
            >
              <text class="text-[14px] text-zinc-700">Restart</text>
            </view>
          </view>
        </view>

        <view class="mb-4 rounded-xl border border-zinc-200 bg-white p-4">
          <text
            class="uppercase mb-2.5 text-[11px] font-bold tracking-[0.5px] text-zinc-400"
          >
            Attributes
          </text>

          <view
            class="flex-row border-b border-zinc-100 py-2.5 flex justify-between"
            (bindtap)="muted.set(!muted())"
          >
            <text class="text-[14px] text-zinc-700">muted</text>
            <text class="text-[14px] font-semibold text-zinc-900">
              {{ muted() ? 'On' : 'Off' }}
            </text>
          </view>
          <view
            class="flex-row border-b border-zinc-100 py-2.5 flex justify-between"
            (bindtap)="loop.set(!loop())"
          >
            <text class="text-[14px] text-zinc-700">loop</text>
            <text class="text-[14px] font-semibold text-zinc-900">
              {{ loop() ? 'On' : 'Off' }}
            </text>
          </view>
          <view class="flex-row items-center pt-2.5 flex justify-between">
            <text class="text-[14px] text-zinc-700">speed</text>
            <view class="flex-row flex">
              @for (s of speeds; track s) {
                <view
                  class="ml-1.5 rounded-md px-2.5 py-1"
                  [class.bg-zinc-900]="s === speed()"
                  [class.bg-zinc-100]="s !== speed()"
                  (bindtap)="speed.set(s)"
                >
                  <text
                    class="text-[13px]"
                    [class.text-white]="s === speed()"
                    [class.text-zinc-700]="s !== speed()"
                  >
                    {{ s }}x
                  </text>
                </view>
              }
            </view>
          </view>
        </view>

        <view class="rounded-xl bg-zinc-100 p-3.5">
          <text class="text-[13px] text-zinc-500">
            &lt;video&gt; is experimental in Lynx 4.1. Attributes configure the
            player; playback only starts when you call the play method.
          </text>
        </view>
      </view>
    </scroll-view>
  `,
  imports: [LYNX_ELEMENTS],
})
export class App {
  readonly speeds = [0.5, 1, 1.5, 2] as const;

  readonly muted = signal(true);
  readonly loop = signal(false);
  readonly speed = signal<number>(1);
  readonly playing = signal(false);
  readonly status = signal('Tap Play to start');
  readonly current = signal(0);
  readonly duration = signal(0);
  readonly progress = computed(() =>
    this.duration() > 0 ? (this.current() / this.duration()) * 100 : 0,
  );

  togglePlay(): void {
    this.#invoke(this.playing() ? 'pause' : 'play');
    this.playing.set(!this.playing());
  }

  stop(): void {
    this.#invoke('stop');
    this.playing.set(false);
  }

  seekTo(position: number): void {
    this.#invoke('seek', { position });
    this.current.set(position);
  }

  onFirstFrame(event: Event): void {
    const { duration } = (event as CustomEvent<{ duration: number }>).detail;
    this.duration.set(duration);
    this.status.set('Ready');
  }

  onTimeUpdate(event: Event): void {
    const { current, duration } = (event as CustomEvent<TimeUpdateDetail>)
      .detail;
    this.current.set(current);
    this.duration.set(duration);
  }

  onStopped(): void {
    this.status.set('Stopped');
    this.current.set(0);
  }

  onEnded(): void {
    this.status.set('Ended');
    this.playing.set(false);
  }

  onError(event: Event): void {
    // `detail` is missing when the error comes from a platform without a Lynx
    // video implementation (Lynx for Web falls back to a plain HTML <video>).
    const detail = (event as CustomEvent<VideoErrorDetail | undefined>).detail;
    this.status.set(
      detail
        ? `Error ${detail.errorCode}: ${detail.errorMsg}`
        : 'Playback failed',
    );
    this.playing.set(false);
  }

  /**
   * <video> has no autoplay/paused attributes: playback state lives in the
   * native player and only changes through its UI methods, so they go through
   * SelectorQuery rather than a binding.
   */
  #invoke(method: VideoMethod, params: Record<string, unknown> = {}): void {
    lynx
      .createSelectorQuery()
      .select('#player')
      .invoke({
        method,
        params,
        fail: (res: { code: number }) =>
          this.status.set(`${method} failed (code ${res.code})`),
      })
      .exec();
  }
}
