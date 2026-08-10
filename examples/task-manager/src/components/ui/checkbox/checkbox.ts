import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  popIn,
  popOut,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';

@Component({
  selector: 'ui-checkbox',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view
      class="h-11 w-11 items-center flex justify-center"
      (bindtap)="toggle()"
    >
      <view [class]="boxClass()">
        <text
          #checkmark
          [class]="checkClass()"
          [style]="checked() ? 'opacity: 1;' : 'opacity: 0;'"
        >
          ✓
        </text>
      </view>
    </view>
  `,
})
export class UiCheckbox {
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<boolean>();

  readonly checkmarkRef = viewChild<ElementRef>('checkmark');
  #checkAnim?: AnimationHandle;
  #previousChecked?: boolean;

  constructor() {
    // Animate the checkmark on state transitions (skip initial render).
    // `#previousChecked === undefined` guards the first run — we don't want to
    // pop-in the checkmark when the component mounts already-checked.
    // The `isChecked === this.#previousChecked` guard prevents a second animation
    // from firing if the effect re-runs without an actual state change.
    effect(() => {
      const isChecked = this.checked();
      const el = this.checkmarkRef()?.nativeElement;
      if (!el || this.#previousChecked === undefined) {
        this.#previousChecked = isChecked;
        return;
      }
      if (isChecked === this.#previousChecked) return;
      this.#previousChecked = isChecked;

      this.#checkAnim?.cancel();
      this.#checkAnim = isChecked ? popIn(el) : popOut(el);
    });
  }

  protected readonly boxClass = computed(() =>
    cn(
      'h-5 w-5 items-center rounded-sm border flex justify-center',
      this.checked()
        ? 'border-primary bg-primary'
        : 'border-primary bg-transparent',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected readonly checkClass = computed(() =>
    cn('text-[10px] font-bold text-primary-foreground'),
  );

  toggle(): void {
    if (this.disabled()) return;
    const next = !this.checked();
    this.checked.set(next);
    this.changed.emit(next);
  }
}
