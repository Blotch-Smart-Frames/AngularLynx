import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiButton } from '../components/ui/button';
import { UiCard } from '../components/ui/card';

/**
 * Tailwind CSS 4 on Lynx: utilities whose Tailwind 4 CSS Lynx can't read as
 * written (oklch() colors, opacity modifiers, logical padding, the
 * translate/rotate/scale properties, @property variables), which the build
 * rewrites, next to the @blotch/ui theme loaded with @plugin.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiButton, UiCard],
  template: `
    <scroll-view class="h-full bg-background" scroll-orientation="vertical">
      <view class="flex flex-col gap-4 px-5 pt-14 pb-10">
        <view class="flex flex-col gap-1">
          <text class="text-2xl font-bold tracking-tight text-foreground">
            Tailwind CSS 4
          </text>
          <text class="text-sm text-muted-foreground">
            The CSS-first Tailwind, rewritten for Lynx at build time.
          </text>
        </view>

        <ui-card class="flex flex-col gap-3 p-4">
          <text class="text-xs font-semibold text-muted-foreground uppercase">
            Palette and opacity
          </text>
          <view class="flex flex-row gap-2">
            <view class="size-9 rounded-lg bg-rose-500"></view>
            <view class="size-9 rounded-lg bg-amber-400"></view>
            <view class="size-9 rounded-lg bg-emerald-500"></view>
            <view class="size-9 rounded-lg bg-sky-500"></view>
            <view class="size-9 rounded-lg bg-sky-500/40"></view>
            <view class="size-9 rounded-full bg-violet-500 opacity-60"></view>
            <view
              class="size-9 rounded-lg bg-linear-to-br from-fuchsia-500 to-cyan-400"
            ></view>
          </view>
        </ui-card>

        <ui-card class="flex flex-col gap-3 p-4">
          <text class="text-xs font-semibold text-muted-foreground uppercase">
            Spacing and borders
          </text>
          <view class="flex flex-row items-center gap-3">
            <view class="rounded-md bg-primary/10 px-4 py-2">
              <text class="text-sm text-primary">px-4 py-2</text>
            </view>
            <view
              class="rounded-md border-2 border-dashed border-sky-500 px-3 py-1"
            >
              <text class="text-sm text-foreground">border-2</text>
            </view>
            <view
              class="rounded-md bg-white px-3 py-1 shadow-md ring-2 ring-rose-400"
            >
              <text class="text-sm text-zinc-900">ring-2</text>
            </view>
          </view>
          <view
            class="flex flex-col divide-y divide-zinc-200 rounded-md bg-muted px-3"
          >
            <text class="py-2 text-sm text-foreground"
              >divide-y, first row</text
            >
            <text class="py-2 text-sm text-foreground">second row</text>
          </view>
        </ui-card>

        <ui-card class="flex flex-col gap-3 p-4">
          <text class="text-xs font-semibold text-muted-foreground uppercase">
            Transforms and transitions
          </text>
          <view class="flex h-16 flex-row items-center justify-around">
            <view class="size-8 rotate-45 rounded-sm bg-rose-500"></view>
            <view class="size-8 scale-75 rounded-sm bg-amber-400"></view>
            <view
              class="size-8 -translate-y-2 rounded-sm bg-emerald-500"
            ></view>
            <view class="size-8 skew-x-12 rounded-sm bg-sky-500"></view>
            <view class="size-8 animate-spin rounded-sm bg-violet-500"></view>
          </view>
          <view
            class="h-2 rounded-full bg-primary transition-transform duration-300 ease-out"
            [class.scale-x-50]="!grown()"
          ></view>
        </ui-card>

        <ui-button size="lg" (pressed)="grown.update((value) => !value)">
          {{ grown() ? 'Shrink' : 'Grow' }} the bar
        </ui-button>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly grown = signal(true);
}
