import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { cva, type VariantProps } from 'class-variance-authority';

import {
  type AnimationHandle,
  pressDown,
  pressRelease,
} from '../../utils/animate';
import { cn } from '../../utils/cn';

const toggleVariants = cva('items-center rounded-md flex justify-center', {
  variants: {
    variant: {
      default: '',
      outline: 'border border-border',
    },
    size: {
      default: 'h-10 px-3',
      sm: 'h-9 px-2.5',
      lg: 'h-11 px-5',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ToggleVariant = NonNullable<
  VariantProps<typeof toggleVariants>['variant']
>;
export type ToggleSize = NonNullable<
  VariantProps<typeof toggleVariants>['size']
>;

@Component({
  selector: 'ui-toggle',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view
      #container
      [class]="containerClass()"
      (bindtouchstart)="onPressStart()"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart()"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPressCancel()"
      (bindtap)="onTap()"
    >
      <ng-content />
    </view>
  `,
})
export class UiToggle {
  readonly pressed = model(false);
  readonly variant = input<ToggleVariant>('default');
  readonly size = input<ToggleSize>('default');
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly containerRef = viewChild<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly containerClass = computed(() =>
    cn(
      toggleVariants({ variant: this.variant(), size: this.size() }),
      this.pressed() ? 'bg-accent' : 'bg-transparent',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected onPressStart(): void {
    if (this.disabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    if (this.disabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    if (this.disabled()) return;
    this.pressed.update((v) => !v);
  }
}

@Component({
  selector: 'ui-toggle-group',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiToggleGroup {
  readonly type = input<'single' | 'multiple'>('single');
  readonly value = model<string[]>([]);
  readonly variant = input<ToggleVariant>('default');
  readonly size = input<ToggleSize>('default');
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('flex-row items-center gap-1 flex', this.userClass()),
  );

  toggle(val: string): void {
    if (this.disabled()) return;
    if (this.type() === 'single') {
      const current = this.value();
      // Single mode allows deselection: tapping the active item again clears
      // the selection to []. This differs from a radio group, which requires
      // one item to always be selected.
      this.value.set(current.includes(val) ? [] : [val]);
    } else {
      this.value.update((list) =>
        list.includes(val) ? list.filter((v) => v !== val) : [...list, val],
      );
    }
  }

  isSelected(val: string): boolean {
    return this.value().includes(val);
  }
}

@Component({
  selector: 'ui-toggle-group-item',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view
      #container
      [class]="containerClass()"
      (bindtouchstart)="onPressStart()"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart()"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPressCancel()"
      (bindtap)="onTap()"
    >
      <ng-content />
    </view>
  `,
})
export class UiToggleGroupItem {
  readonly #group = inject(UiToggleGroup);

  readonly itemValue = input.required<string>({ alias: 'value' });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly containerRef = viewChild<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly isSelected = computed(() =>
    this.#group.isSelected(this.itemValue()),
  );

  protected readonly containerClass = computed(() =>
    cn(
      toggleVariants({
        variant: this.#group.variant(),
        size: this.#group.size(),
      }),
      this.isSelected() ? 'bg-accent' : 'bg-transparent',
      this.#group.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected onPressStart(): void {
    if (this.#group.disabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    if (this.#group.disabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    this.#group.toggle(this.itemValue());
  }
}
