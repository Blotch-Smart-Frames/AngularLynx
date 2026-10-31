import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, popIn, popOut } from '../../utils/animate';
import { cn } from '../../utils/cn';

/**
 * The host is the checkbox's 44pt tap target, with the box inside, and the
 * app's class is the box's. Angular also gives the host every static
 * attribute the app writes on <ui-checkbox>, so the class styled the target
 * too: a margin applied twice. The host drops it, and takes its own size
 * from an inline style, which dropping the class leaves alone.
 */
@Component({
  selector: 'ui-checkbox',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[attr.class]': 'null',
    style:
      'width: 2.75rem; height: 2.75rem; display: flex; align-items: center; justify-content: center;',
    '(bindtap)': 'toggle()',
  },
  template: `
    <view [class]="boxClass()">
      <text
        #checkmark
        [class]="checkClass()"
        [style]="checked() ? 'opacity: 1;' : 'opacity: 0;'"
      >
        ✓
      </text>
    </view>
  `,
})
export class UiCheckbox {
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<boolean>();

  readonly checkmarkRef = viewChild.required<ElementRef>('checkmark');
  #checkAnim?: AnimationHandle;
  #previousChecked?: boolean;

  /**
   * Pops the checkmark in when checked and out when unchecked. A field rather
   * than a constructor: Angular's test build keeps a function for a
   * constructor that nothing calls, which an app's coverage report would show
   * as uncovered.
   *
   * `#previousChecked === undefined` guards the first run: we don't want to
   * pop in the checkmark when the component mounts already checked. The
   * equality guard skips a run that isn't a change: `checked` set and set
   * back before the effect runs (two taps in one frame) still re-runs it.
   */
  protected readonly checkmarkAnimation = effect(() => {
    const isChecked = this.checked();
    const el = this.checkmarkRef().nativeElement;
    if (this.#previousChecked === undefined) {
      this.#previousChecked = isChecked;
      return;
    }
    if (isChecked === this.#previousChecked) return;
    this.#previousChecked = isChecked;

    this.#checkAnim?.cancel();
    this.#checkAnim = isChecked ? popIn(el) : popOut(el);
  });

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
