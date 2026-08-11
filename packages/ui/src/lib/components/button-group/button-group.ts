import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
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

/**
 * Per-item styling. Corners are intentionally left square here: the group
 * container clips the whole bar with `overflow-hidden` + `rounded-md`, so only
 * the outer edges round off while every internal seam stays crisp. Rounding
 * individual items by position would require `:first-child`/`:last-child`
 * selectors, which Lynx's CSS engine does not support (no component in the
 * library relies on positional selectors — see CLAUDE.md).
 */
export const buttonGroupItemVariants = cva('items-center flex justify-center', {
  variants: {
    variant: {
      // Filled segments — the whole bar reads as a solid control.
      default: 'bg-secondary',
      // Neutral segments against the app background, ringed by the container.
      outline: 'bg-background',
    },
    size: {
      default: 'h-10 px-4',
      sm: 'h-9 px-3',
      lg: 'h-11 px-6',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

const buttonGroupTextVariants = cva('font-medium', {
  variants: {
    variant: {
      default: 'text-secondary-foreground',
      outline: 'text-foreground',
    },
    size: {
      default: 'text-sm',
      sm: 'text-xs',
      lg: 'text-base',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ButtonGroupVariant = NonNullable<
  VariantProps<typeof buttonGroupItemVariants>['variant']
>;
export type ButtonGroupSize = NonNullable<
  VariantProps<typeof buttonGroupItemVariants>['size']
>;
export type ButtonGroupOrientation = 'horizontal' | 'vertical';

/**
 * A row (or column) of connected action buttons — a toolbar of related
 * commands rendered as a single, seamless control.
 *
 * The group owns the shared appearance (`variant`, `size`, `orientation`,
 * `disabled`) and each `<ui-button-group-item>` reads it back via DI, mirroring
 * the `UiToggleGroup`/`UiToggleGroupItem` pattern. Unlike a toggle group this
 * carries no selection state: every item is an independent action that emits
 * `pressed`.
 */
@Component({
  selector: 'ui-button-group',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiButtonGroup {
  readonly orientation = input<ButtonGroupOrientation>('horizontal');
  readonly variant = input<ButtonGroupVariant>('default');
  readonly size = input<ButtonGroupSize>('default');
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn(
      // The dividers between items are the group's own `bg-border` showing
      // through a 1px `gap-px` seam — no per-item borders needed, which keeps
      // items position-agnostic. `overflow-hidden` + `rounded-md` then clip the
      // square item corners so the bar reads as one rounded control.
      'gap-px rounded-md border border-border bg-border flex overflow-hidden',
      // `self-start` stops the bar stretching to fill a column parent so it
      // hugs its buttons like a real toolbar. Pass `class="w-full"` to override.
      'self-start',
      this.orientation() === 'vertical' ? 'flex-col' : 'flex-row',
      this.userClass(),
    ),
  );
}

/**
 * A single pressable action inside a `<ui-button-group>`. Inherits appearance
 * from the parent group; set `disabled` per-item to disable just this action.
 */
@Component({
  selector: 'ui-button-group-item',
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
      <text [class]="labelClass()"><ng-content /></text>
    </view>
  `,
})
export class UiButtonGroupItem {
  readonly #group = inject(UiButtonGroup);

  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  readonly containerRef = viewChild<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  // Disabled when either the whole group or this specific item is disabled.
  protected readonly isDisabled = computed(
    () => this.#group.disabled() || this.disabled(),
  );

  protected readonly containerClass = computed(() =>
    cn(
      buttonGroupItemVariants({
        variant: this.#group.variant(),
        size: this.#group.size(),
      }),
      this.isDisabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected readonly labelClass = computed(() =>
    cn(
      buttonGroupTextVariants({
        variant: this.#group.variant(),
        size: this.#group.size(),
      }),
    ),
  );

  protected onPressStart(): void {
    if (this.isDisabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    if (this.isDisabled()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    // Restore scale on cancel too — otherwise a touch stolen by a scroll
    // gesture leaves the item stuck in its pressed-down state.
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    if (!this.isDisabled()) {
      this.pressed.emit();
    }
  }
}
