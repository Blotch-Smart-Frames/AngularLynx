import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

type VideoMethod = 'play' | 'pause' | 'stop' | 'seek';

// Angular types $event on native element events as DOM Event; Lynx delivers
// the payload on `detail`, so handlers cast to CustomEvent<…Detail>.
type TimeUpdateDetail = { current: number; duration: number };
type VideoErrorDetail = { errorCode: number; errorMsg: string };

/**
 * Showcase for the native `<video>` element (experimental, Lynx 4.1+).
 * Attributes configure the player; playback only changes through the
 * `play`/`pause`/`stop`/`seek` UI methods, invoked via SelectorQuery.
 *
 * Uses the shared `<app-demo-screen>` frame (it owns the page scroll-view).
 */
@Component({
  selector: 'app-video-demo',
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiButton,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiText,
  ],
  template: `
    <app-demo-screen
      heading="Video"
      category="Elements"
      description="The native <video> element, controlled through its play, pause, stop and seek UI methods."
    >
      <view class="w-full rounded-xl bg-black overflow-hidden">
        <video
          id="kitchen-sink-video"
          class="h-[200px] w-full"
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

      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>{{ status() }}</ui-card-title>
          <ui-card-description>
            {{ current().toFixed(1) }}s / {{ duration().toFixed(1) }}s
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-row gap-2 p-4 pt-0 flex">
          <ui-button class="flex-1" (pressed)="togglePlay()">
            {{ playing() ? 'Pause' : 'Play' }}
          </ui-button>
          <ui-button class="flex-1" variant="outline" (pressed)="stop()">
            Stop
          </ui-button>
          <ui-button class="flex-1" variant="outline" (pressed)="seekTo(0)">
            Restart
          </ui-button>
        </ui-card-content>
      </ui-card>

      <ui-card class="w-full">
        <ui-card-header class="p-4">
          <ui-card-title>Attributes</ui-card-title>
          <ui-card-description>
            Bound live to the native player.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view class="flex-row items-center gap-2 flex">
            <ui-text variant="muted" class="w-[56px]">Audio</ui-text>
            <ui-button
              size="sm"
              [variant]="muted() ? 'default' : 'outline'"
              (pressed)="muted.set(!muted())"
            >
              muted
            </ui-button>
            <ui-button
              size="sm"
              [variant]="loop() ? 'default' : 'outline'"
              (pressed)="loop.set(!loop())"
            >
              loop
            </ui-button>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <ui-text variant="muted" class="w-[56px]">Speed</ui-text>
            @for (s of speeds; track s) {
              <ui-button
                size="sm"
                [variant]="s === speed() ? 'default' : 'outline'"
                (pressed)="speed.set(s)"
              >
                {{ s }}x
              </ui-button>
            }
          </view>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class VideoDemo {
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
      .select('#kitchen-sink-video')
      .invoke({
        method,
        params,
        fail: (res: { code: number }) =>
          this.status.set(`${method} failed (code ${res.code})`),
      })
      .exec();
  }
}
