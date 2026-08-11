import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';

@Component({
  selector: 'ui-progress',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="trackClass()">
      <view #fill [class]="fillClass()" [style]="fillStyle()" />
    </view>
  `,
})
export class UiProgress {
  readonly value = input(0);
  readonly max = input(100);
  /**
   * When true, shows an indeterminate (looping) animation
   */
  readonly indeterminate = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly fillRef = viewChild<ElementRef>('fill');
  #fillAnim?: AnimationHandle;
  #indeterminateAnim?: AnimationHandle;
  #previousPercent: number | null = null;

  constructor() {
    effect(() => {
      const el = this.fillRef()?.nativeElement;
      if (!el) return;

      // Handle indeterminate mode with infinite sliding animation.
      // The fill element is 40% of the track width. `translateX` percentages
      // are relative to the element's OWN width, so:
      //   translateX(-100%) = left edge at -40% of track = starts off-screen left
      //   translateX(250%)  = left edge at +100% of track = exits off-screen right
      // 250% is the minimum that pushes the 40%-wide fill fully past the right edge.
      if (this.indeterminate()) {
        this.#fillAnim?.cancel();
        this.#indeterminateAnim?.cancel();
        this.#indeterminateAnim = el.animate(
          [
            { transform: 'translateX(-100%)', width: '40%' },
            { transform: 'translateX(250%)', width: '40%' },
          ],
          {
            duration: 1200,
            easing: EASING.standard,
            iterations: Infinity,
          },
        );
        return;
      }

      // Determinate mode — animate width changes smoothly.
      // `#previousPercent === null` skips the very first effect run so
      // the bar doesn't animate from 0% → initial value on mount.
      // The equality guard prevents redundant animations if the effect
      // re-runs without an actual percent change.
      this.#indeterminateAnim?.cancel();
      const percent = this.percent();
      if (this.#previousPercent === null) {
        this.#previousPercent = percent;
        return;
      }
      if (percent === this.#previousPercent) return;

      this.#fillAnim?.cancel();
      this.#fillAnim = el.animate(
        [{ width: `${this.#previousPercent}%` }, { width: `${percent}%` }],
        { duration: DURATION.slow, easing: EASING.standard, fill: 'forwards' },
      );
      this.#previousPercent = percent;
    });
  }

  protected readonly percent = computed(() => {
    const m = this.max();
    if (m <= 0) return 0;
    return Math.min(100, Math.max(0, (this.value() / m) * 100));
  });

  protected readonly trackClass = computed(() =>
    cn(
      // bg-muted (solid, theme-aware) instead of bg-primary/20: opacity
      // modifiers on semantic colors don't work on Lynx (colors are opaque
      // rgba values with no separable channels).
      'h-2 w-full rounded-full bg-muted overflow-hidden',
      this.userClass(),
    ),
  );

  protected readonly fillClass = computed(() =>
    cn('h-full rounded-full bg-primary'),
  );

  protected readonly fillStyle = computed(() =>
    this.indeterminate() ? 'width: 40%;' : `width: ${this.percent()}%;`,
  );
}
