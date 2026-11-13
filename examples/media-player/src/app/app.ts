import { Component, computed, effect, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiSlider } from '../components/ui/slider';
import { UiToggle } from '../components/ui/toggle';
import {
  UiCollapsible,
  UiCollapsibleTrigger,
  UiCollapsibleContent,
} from '../components/ui/collapsible';
import { UiButton } from '../components/ui/button';
import { UiAvatar } from '../components/ui/avatar';
import { UiSeparator } from '../components/ui/separator';

type Track = { title: string; artist: string; seconds: number };

/**
 * How often the playback position moves while playing, in ms. A quarter
 * of a second rather than a whole one, so pausing and playing again loses
 * at most that much of the track.
 */
const TICK_MS = 250;

/**
 * How far into a track the previous button restarts it rather than going
 * back a track, in seconds, as Spotify's and Apple Music's do.
 */
const RESTART_AFTER = 3;

/**
 * A time in seconds as the player shows it, such as `3:42`.
 */
const formatTime = (seconds: number): string => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiSlider,
    UiToggle,
    UiCollapsible,
    UiCollapsibleTrigger,
    UiCollapsibleContent,
    UiButton,
    UiAvatar,
    UiSeparator,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-background">
      <view class="flex-col items-center gap-6 px-6 py-8 flex">
        <view class="rounded-[20px] border border-border bg-card p-2">
          <ui-avatar size="2xl" src="" fallback="♪" />
        </view>

        <view class="flex-col items-center gap-1 flex">
          <text class="text-[22px] font-bold text-foreground">{{
            currentTrack().title
          }}</text>
          <text class="text-sm text-muted-foreground">{{
            currentTrack().artist
          }}</text>
        </view>

        <view class="w-full flex-col gap-1.5 flex">
          <!--
            One-way [value] plus the two outputs, rather than [(value)]: a
            drag reports where the thumb is (valueChange) apart from where
            playback is, so the ticking position doesn't pull the thumb out
            from under the finger, and playback only jumps once the user lets
            go or taps (changed).
          -->
          <ui-slider
            accessibility-label="Playback position"
            [max]="currentTrack().seconds"
            [value]="shownPosition()"
            [valueText]="positionText()"
            (valueChange)="scrubTo($event)"
            (changed)="seek($event)"
          />
          <view class="flex-row flex justify-between">
            <text class="text-xs text-muted-foreground">{{ elapsed() }}</text>
            <text class="text-xs text-muted-foreground">{{
              formatTime(currentTrack().seconds)
            }}</text>
          </view>
        </view>

        <view class="flex-row items-center gap-5 flex">
          <ui-toggle [(pressed)]="shuffle" aria-label="Shuffle">
            <text class="text-base">⇌</text>
          </ui-toggle>
          <ui-button variant="ghost" size="icon" (pressed)="prev()">
            <text class="text-[24px]">⏮</text>
          </ui-button>
          <view
            class="h-16 w-16 items-center rounded-[50%] bg-indigo-500 justify-center"
            (bindtap)="togglePlay()"
          >
            <text class="text-[24px] text-white">{{
              playing() ? '⏸' : '▶'
            }}</text>
          </view>
          <ui-button variant="ghost" size="icon" (pressed)="next()">
            <text class="text-[24px]">⏭</text>
          </ui-button>
          <ui-toggle [(pressed)]="repeat" aria-label="Repeat">
            <text class="text-base">↺</text>
          </ui-toggle>
        </view>

        <ui-separator class="w-full" />

        <ui-collapsible class="w-full">
          <ui-collapsible-trigger>
            <view class="flex-row items-center gap-1 py-2 flex justify-between">
              <text class="text-sm font-semibold text-foreground">Up Next</text>
              <text class="text-xs text-muted-foreground">
                {{ queue.length }} tracks
              </text>
            </view>
          </ui-collapsible-trigger>
          <ui-collapsible-content>
            <view class="mt-2 flex-col gap-1.5 flex">
              @for (track of queue; track track.title; let i = $index) {
                <view
                  class="flex-row items-center gap-3 rounded-[10px] px-3 py-2.5 flex"
                  [class.bg-indigo-500/10]="i === trackIndex()"
                  (bindtap)="jumpTo(i)"
                >
                  <ui-avatar size="sm" src="" [fallback]="String(i + 1)" />
                  <view class="flex-1 flex-col gap-0.5 flex">
                    <text class="text-sm font-medium text-foreground">{{
                      track.title
                    }}</text>
                    <text class="text-xs text-muted-foreground">{{
                      track.artist
                    }}</text>
                  </view>
                  <text class="text-xs text-muted-foreground">{{
                    formatTime(track.seconds)
                  }}</text>
                </view>
              }
            </view>
          </ui-collapsible-content>
        </ui-collapsible>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly String = String;
  readonly formatTime = formatTime;
  readonly playing = signal(false);
  readonly shuffle = signal(false);
  readonly repeat = signal(false);
  /**
   * Where playback is in the current track, in seconds. It starts part way
   * into the first track, so the player looks like one resuming a song.
   */
  readonly position = signal(78);
  /**
   * Where the user is dragging the slider's thumb, in seconds, or null when
   * they aren't. Shown in place of the playback position until they let go.
   */
  readonly scrubbing = signal<number | null>(null);
  readonly trackIndex = signal(0);

  readonly queue: Track[] = [
    // cspell:disable-next-line
    { title: 'Signals & Noise', artist: 'The Reactives', seconds: 222 },
    { title: 'Zone-Free Zone', artist: 'Async Await', seconds: 255 },
    { title: 'Computed Values', artist: 'Signal Corps', seconds: 178 },
    { title: 'Change Detection', artist: 'OnPush Band', seconds: 301 },
  ];

  readonly currentTrack = computed(() => this.queue[this.trackIndex()]);

  readonly shownPosition = computed(() => this.scrubbing() ?? this.position());

  readonly elapsed = computed(() => formatTime(this.shownPosition()));

  /**
   * What a screen reader says for the slider, such as "1:18 of 3:42", in
   * place of its default percentage.
   */
  readonly positionText = computed(() => {
    const total = formatTime(this.currentTrack().seconds);
    return (seconds: number) => `${formatTime(seconds)} of ${total}`;
  });

  /**
   * Moves the playback position while playing. The interval only exists while
   * `playing` is true: pausing runs the cleanup, which stops it, and the
   * component's destruction does the same.
   */
  protected readonly playback = effect((onCleanup) => {
    if (!this.playing()) return;
    const interval = setInterval(() => this.#advance(TICK_MS / 1000), TICK_MS);
    onCleanup(() => clearInterval(interval));
  });

  togglePlay(): void {
    this.playing.update((p) => !p);
  }
  next(): void {
    this.trackIndex.update((i) => (i + 1) % this.queue.length);
    this.position.set(0);
  }
  /**
   * Restarts the track once it's a few seconds in, and only goes back a
   * track near its start, like a real player's previous button.
   */
  prev(): void {
    if (this.position() < RESTART_AFTER) {
      this.trackIndex.update(
        (i) => (i - 1 + this.queue.length) % this.queue.length,
      );
    }
    this.position.set(0);
  }
  jumpTo(index: number): void {
    this.trackIndex.set(index);
    this.position.set(0);
    this.playing.set(true);
  }
  /**
   * The thumb moved, with every step of a drag and on a tap: the time
   * follows it.
   */
  scrubTo(seconds: number): void {
    this.scrubbing.set(seconds);
  }
  /**
   * The user let go of the thumb, or tapped the track: playback jumps
   * there, and carries on from it if it was playing.
   */
  seek(seconds: number): void {
    this.scrubbing.set(null);
    this.position.set(seconds);
  }

  /**
   * Plays on by a tick. Playback holds still while the thumb is being
   * dragged, so a track can't end and change under the user's finger.
   */
  #advance(seconds: number): void {
    if (this.scrubbing() !== null) return;
    const next = this.position() + seconds;
    if (next < this.currentTrack().seconds) {
      this.position.set(next);
      return;
    }
    this.#trackEnded();
  }

  /**
   * Moves on to the next track. After the last one, repeat starts the
   * queue over; without it, the player stops at the first track, as
   * Spotify and Apple Music do when a queue runs out.
   */
  #trackEnded(): void {
    const last = this.trackIndex() === this.queue.length - 1;
    this.next();
    if (last && !this.repeat()) this.playing.set(false);
  }
}
