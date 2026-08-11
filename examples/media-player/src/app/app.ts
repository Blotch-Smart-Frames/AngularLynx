import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiProgress } from '../components/ui/progress';
import { UiToggle } from '../components/ui/toggle';
import {
  UiCollapsible,
  UiCollapsibleTrigger,
  UiCollapsibleContent,
} from '../components/ui/collapsible';
import { UiButton } from '../components/ui/button';
import { UiAvatar } from '../components/ui/avatar';
import { UiSeparator } from '../components/ui/separator';

type Track = { title: string; artist: string; duration: string };

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiProgress,
    UiToggle,
    UiCollapsible,
    UiCollapsibleTrigger,
    UiCollapsibleContent,
    UiButton,
    UiAvatar,
    UiSeparator,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-zinc-50">
      <view class="flex-col items-center gap-6 px-6 py-8 flex">
        <view class="rounded-[20px] border border-zinc-200 bg-white p-2">
          <ui-avatar size="2xl" src="" fallback="♪" />
        </view>

        <view class="flex-col items-center gap-1 flex">
          <text class="text-[22px] font-bold text-zinc-900">{{
            currentTrack().title
          }}</text>
          <text class="text-sm text-zinc-500">{{ currentTrack().artist }}</text>
        </view>

        <view class="w-full flex-col gap-1.5 flex">
          <ui-progress [value]="position()" />
          <view class="flex-row flex justify-between">
            <text class="text-xs text-zinc-400">{{ elapsed() }}</text>
            <text class="text-xs text-zinc-400">{{
              currentTrack().duration
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
              <text class="text-sm font-semibold text-zinc-900">Up Next</text>
              <text class="text-xs text-zinc-400">
                {{ queue.length }} tracks
              </text>
            </view>
          </ui-collapsible-trigger>
          <ui-collapsible-content>
            <view class="mt-2 flex-col gap-1.5 flex">
              @for (track of queue; track track.title; let i = $index) {
                <view
                  class="flex-row items-center gap-3 rounded-[10px] px-3 py-2.5 flex"
                  [class.bg-indigo-50]="i === trackIndex()"
                  (bindtap)="jumpTo(i)"
                >
                  <ui-avatar size="sm" src="" [fallback]="String(i + 1)" />
                  <view class="flex-1 flex-col gap-0.5 flex">
                    <text class="text-sm font-medium text-zinc-900">{{
                      track.title
                    }}</text>
                    <text class="text-xs text-zinc-400">{{
                      track.artist
                    }}</text>
                  </view>
                  <text class="text-xs text-zinc-400">{{
                    track.duration
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
  readonly playing = signal(false);
  readonly shuffle = signal(false);
  readonly repeat = signal(false);
  readonly position = signal(35);
  readonly trackIndex = signal(0);

  readonly queue: Track[] = [
    // cspell:disable-next-line
    { title: 'Signals & Noise', artist: 'The Reactives', duration: '3:42' },
    { title: 'Zone-Free Zone', artist: 'Async Await', duration: '4:15' },
    { title: 'Computed Values', artist: 'Signal Corps', duration: '2:58' },
    { title: 'Change Detection', artist: 'OnPush Band', duration: '5:01' },
  ];

  readonly currentTrack = computed(() => this.queue[this.trackIndex()]);

  readonly elapsed = computed(() => {
    const [m, s] = this.currentTrack().duration.split(':').map(Number);
    const totalSecs = m * 60 + s;
    const secs = Math.floor((this.position() / 100) * totalSecs);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  });

  togglePlay(): void {
    this.playing.update((p) => !p);
  }
  next(): void {
    this.trackIndex.update((i) => (i + 1) % this.queue.length);
    this.position.set(0);
  }
  prev(): void {
    this.trackIndex.update(
      (i) => (i - 1 + this.queue.length) % this.queue.length,
    );
    this.position.set(0);
  }
  jumpTo(index: number): void {
    this.trackIndex.set(index);
    this.position.set(0);
    this.playing.set(true);
  }
}
