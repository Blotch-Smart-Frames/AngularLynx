import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
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
  selector: 'ui-radio-group',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiRadioGroup {
  readonly value = model<string>('');
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<string>();

  protected readonly containerClass = computed(() =>
    cn('flex-col gap-2 flex', this.userClass()),
  );

  select(value: string): void {
    if (this.disabled()) return;
    this.value.set(value);
    this.changed.emit(value);
  }
}

@Component({
  selector: 'ui-radio-group-item',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="itemClass()" (bindtap)="select()">
      <view [class]="circleClass()">
        <view
          #dot
          [class]="dotClass()"
          [style]="
            isSelected() ? 'opacity: 1;' : 'opacity: 0; transform: scale(0.6);'
          "
        />
      </view>
      <text [class]="labelClass()"><ng-content /></text>
    </view>
  `,
})
export class UiRadioGroupItem {
  readonly #group = inject(UiRadioGroup);

  readonly itemValue = input.required<string>({ alias: 'value' });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly dotRef = viewChild<ElementRef>('dot');
  #dotAnim?: AnimationHandle;
  #previousSelected?: boolean;

  protected readonly isSelected = computed(
    () => this.#group.value() === this.itemValue(),
  );

  constructor() {
    // Same guard pattern as UiCheckbox: `#previousSelected === undefined` skips
    // the first run so a pre-selected item doesn't animate in on mount.
    // The equality guard prevents duplicate animations if the effect re-runs.
    effect(() => {
      const selected = this.isSelected();
      const el = this.dotRef()?.nativeElement;
      if (!el || this.#previousSelected === undefined) {
        this.#previousSelected = selected;
        return;
      }
      if (selected === this.#previousSelected) return;
      this.#previousSelected = selected;

      this.#dotAnim?.cancel();
      this.#dotAnim = selected ? popIn(el) : popOut(el);
    });
  }

  protected readonly itemClass = computed(() =>
    cn(
      'h-11 flex-row items-center gap-3 flex',
      this.#group.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected readonly circleClass = computed(() =>
    cn(
      'h-5 w-5 items-center rounded-full border flex justify-center',
      this.isSelected() ? 'border-primary' : 'border-primary',
    ),
  );

  protected readonly dotClass = computed(() =>
    cn('h-2.5 w-2.5 rounded-full bg-primary'),
  );

  protected readonly labelClass = computed(() => cn('text-sm text-foreground'));

  select(): void {
    if (this.#group.disabled()) return;
    this.#group.select(this.itemValue());
  }
}
