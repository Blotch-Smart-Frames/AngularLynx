import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiButton } from '../components/ui/button';
import { UiCard } from '../components/ui/card';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiButton, UiCard],
  template: `
    <view
      class="h-screen flex-col items-center bg-background p-6 flex justify-center"
    >
      <text class="mb-1 text-[28px] font-bold text-foreground">Counter</text>
      <text class="mb-8 text-[13px] text-muted-foreground">
        Signal-based reactivity with computed state.
      </text>

      <ui-card class="mb-8 items-center px-12 py-8">
        <text class="mb-1 text-[72px] font-bold text-primary">{{
          count()
        }}</text>
        <text class="text-sm text-muted-foreground">{{ label() }}</text>
      </ui-card>

      <view class="flex-row gap-3 flex">
        <ui-button size="lg" (pressed)="decrement()">−</ui-button>
        <ui-button variant="outline" size="lg" (pressed)="reset()">
          Reset
        </ui-button>
        <ui-button size="lg" (pressed)="increment()">+</ui-button>
      </view>
    </view>
  `,
})
export class App {
  readonly count = signal(0);
  readonly label = computed(() => {
    const n = this.count();
    if (n === 0) return 'Tap + or − to start';
    return n > 0 ? `${n} above zero` : `${Math.abs(n)} below zero`;
  });

  increment(): void {
    this.count.update((n) => n + 1);
  }
  decrement(): void {
    this.count.update((n) => n - 1);
  }
  reset(): void {
    this.count.set(0);
  }
}
