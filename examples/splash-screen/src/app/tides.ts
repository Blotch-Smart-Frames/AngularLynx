import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type ResolveFn } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { map } from 'rxjs';

type Tide = {
  readonly time: string;
  readonly kind: 'High' | 'Low';
  readonly height: number;
};

type TideTable = {
  readonly place: string;
  readonly tides: readonly Tide[];
  /** How long the tides took to come in, behind the splash screen. */
  readonly loadedInMs: number;
};

/**
 * Stands in for a request to a tide service: the first screen has nothing
 * to draw until it answers, which is what the splash screen waits for.
 */
export const loadTides: ResolveFn<TideTable> = async () => {
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return {
    place: 'Saltmarsh Bay',
    tides: [
      { time: '03:12', kind: 'High', height: 4.8 },
      { time: '09:27', kind: 'Low', height: 0.9 },
      { time: '15:41', kind: 'High', height: 4.6 },
      { time: '21:55', kind: 'Low', height: 1.1 },
    ],
    loadedInMs: Date.now() - started,
  };
};

@Component({
  selector: 'app-tides',
  imports: [LYNX_ELEMENTS],
  template: `
    @if (table(); as table) {
      <view class="h-full flex-col px-6 pb-10 pt-24 flex">
        <text
          class="uppercase text-sm tracking-widest"
          style="color: var(--sea)"
        >
          Today's tides
        </text>
        <text class="mt-2 text-4xl font-bold" style="color: var(--ink)">
          {{ table.place }}
        </text>

        <view class="mt-10">
          @for (tide of table.tides; track tide.time) {
            <view
              class="flex-row items-center border-b py-4 flex"
              style="border-color: var(--rule)"
            >
              <text class="w-24 text-2xl" style="color: var(--ink)">
                {{ tide.time }}
              </text>
              <text class="flex-1 text-base" style="color: var(--sea)">
                {{ tide.kind }} tide
              </text>
              <text class="text-xl font-bold" style="color: var(--ink)">
                {{ tide.height }} m
              </text>
            </view>
          }
        </view>

        <text class="mt-auto text-sm" style="color: var(--sea)">
          {{ loadedIn() }}
        </text>
      </view>
    }
  `,
})
export class Tides {
  readonly table = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => data['tides'] as TideTable)),
  );

  readonly loadedIn = computed(() => {
    const seconds = ((this.table()?.loadedInMs ?? 0) / 1000).toFixed(1);
    return `The tides took ${seconds} s to load, behind the splash screen.`;
  });
}
