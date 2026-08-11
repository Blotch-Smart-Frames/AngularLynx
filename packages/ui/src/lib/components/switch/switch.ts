import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, springTranslateX } from '../../utils/animate';
import { cn } from '../../utils/cn';

/**
 * Pixel offsets for the thumb within the 44px track.
 *
 * The thumb is positioned with a px-based `translateX`, so the track and thumb
 * MUST be sized in px too (see the `w-[44px]`/`w-[20px]` arbitrary values in the
 * templates below) — NOT with Tailwind's rem-based scale (`w-11`/`w-5`).
 *
 * Why: Tailwind's default width scale compiles to rem (`w-11` → `2.75rem`), and
 * on Lynx `1rem` resolves against the root `<page>` font-size, which defaults to
 * 14px (`DEFAULT_FONT_SIZE_DP`) — not the 16px browsers use. So `w-11` renders as
 * 38.5px on device, not 44px. Mixing that rem-sized track with a px `translateX`
 * made the ON thumb overshoot the right edge (it was offset 22px inside a 38.5px
 * track). Sizing everything in px keeps the geometry self-consistent regardless
 * of the ambient font-size.
 *
 * Track is 44px wide, 24px tall; thumb is 20px square. OFF: 2px from the left
 * edge; ON: 2px from the right edge (44 - 20 - 2 = 22).
 */
const THUMB_OFFSET_OFF = 2;
const THUMB_OFFSET_ON = 22;

@Component({
  selector: 'ui-switch',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="trackClass()" (bindtap)="toggle()">
      <view #thumb [class]="thumbClass()" [style]="thumbPositionStyle()" />
    </view>
  `,
})
export class UiSwitch {
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<boolean>();

  readonly thumbRef = viewChild<ElementRef>('thumb');
  #activeAnimation?: AnimationHandle;

  protected readonly trackClass = computed(() =>
    cn(
      'h-[24px] w-[44px] flex-row items-center rounded-full flex',
      this.checked() ? 'bg-primary' : 'bg-input',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected readonly thumbClass = computed(() =>
    cn('h-[20px] w-[20px] rounded-full bg-background'),
  );

  protected readonly thumbPositionStyle = computed(
    () =>
      `transform: translateX(${this.checked() ? THUMB_OFFSET_ON : THUMB_OFFSET_OFF}px);`,
  );

  toggle(): void {
    if (this.disabled()) return;

    const thumb = this.thumbRef()?.nativeElement;
    const wasChecked = this.checked();
    const next = !wasChecked;

    if (thumb) {
      this.#activeAnimation?.cancel();
      const from = wasChecked ? THUMB_OFFSET_ON : THUMB_OFFSET_OFF;
      const to = next ? THUMB_OFFSET_ON : THUMB_OFFSET_OFF;
      // Spring translate with squish effect at midpoint
      this.#activeAnimation = springTranslateX(thumb, from, to);
    }

    this.checked.set(next);
    this.changed.emit(next);
  }
}
