import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
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
import { UiSpinner } from '../spinner/spinner';

export const buttonVariants = cva(
  'items-center rounded-md flex justify-center',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-background',
        secondary: 'bg-secondary',
        ghost: 'bg-transparent',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const buttonTextVariants = cva('font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
    },
    size: {
      default: 'text-sm',
      sm: 'text-xs',
      lg: 'text-base',
      icon: 'text-sm',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>['variant']
>;
export type ButtonSize = NonNullable<
  VariantProps<typeof buttonVariants>['size']
>;

@Component({
  selector: 'ui-button',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiSpinner],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- Press feedback binds BOTH touch and mouse events on purpose. Native
         (iOS/Android) only ever fires touch; Lynx web runs in the browser, where
         a cursor press fires mousedown/up and NEVER touchstart — so touch-only
         bindings gave zero visual feedback on web while (bindtap) still fired the
         action (a "the button works but doesn't react" split). Binding both makes
         the press-and-hold identical on every platform; mouse events are inert on
         touch devices, so there's no double-fire. The scale animation itself lives
         in pressDown/pressRelease — see their JSDoc for why it's a CSS transition
         (which serializes to the DOM on Lynx web) and not el.animate() (whose Web
         Animation runs on web-core's offscreen node and never reaches the screen). -->
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
      @if (loading()) {
        <ui-spinner [size]="spinnerSize()" />
      } @else {
        <text [class]="labelClass()"><ng-content /></text>
      }
    </view>
  `,
})
export class UiButton {
  readonly variant = input<ButtonVariant>('default');
  readonly size = input<ButtonSize>('default');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  readonly containerRef = viewChild<ElementRef>('container');
  #pressAnim?: AnimationHandle;

  protected readonly containerClass = computed(() =>
    cn(
      buttonVariants({ variant: this.variant(), size: this.size() }),
      (this.disabled() || this.loading()) && 'opacity-50',
      this.userClass(),
    ),
  );

  protected readonly labelClass = computed(() =>
    cn(buttonTextVariants({ variant: this.variant(), size: this.size() })),
  );

  protected readonly spinnerSize = computed(() => {
    const s = this.size();
    return s === 'sm' ? ('xs' as const) : ('sm' as const);
  });

  protected onPressStart(): void {
    if (this.disabled() || this.loading()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    if (this.disabled() || this.loading()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onPressCancel(): void {
    // Also restore scale on cancel — without this, a canceled touch (e.g. scroll
    // gesture taking over) leaves the button stuck in its pressed-down state.
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }

  protected onTap(): void {
    if (!this.disabled() && !this.loading()) {
      this.pressed.emit();
    }
  }
}
