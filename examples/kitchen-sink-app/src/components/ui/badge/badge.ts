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
import { cva, type VariantProps } from 'class-variance-authority';

import { popIn } from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';

export const badgeVariants = cva(
  // `self-start` keeps the badge hugging its content. Lynx views default to `linear`
  // layout, where a child with no explicit width stretches to fill the parent's cross
  // axis — so without it a badge renders full-width. (Web shadcn uses `inline-flex` for
  // the same shrink-to-fit; Lynx has no inline display, so align-self is the lever.)
  'items-center self-start rounded-full px-2.5 py-0.5 flex',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const badgeTextVariants = cva('text-xs font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>['variant']
>;

@Component({
  selector: 'ui-badge',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view #container [class]="containerClass()">
      <text [class]="labelClass()"><ng-content /></text>
    </view>
  `,
})
export class UiBadge {
  readonly variant = input<BadgeVariant>('default');
  /**
   * When true, badge pops in with a spring animation on first render
   */
  readonly animated = input(true);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly containerRef = viewChild<ElementRef>('container');

  constructor() {
    effect(() => {
      const el = this.containerRef()?.nativeElement;
      if (el && this.animated()) {
        popIn(el, { duration: 200 });
      }
    });
  }

  protected readonly containerClass = computed(() =>
    cn(badgeVariants({ variant: this.variant() }), this.userClass()),
  );

  protected readonly labelClass = computed(() =>
    cn(badgeTextVariants({ variant: this.variant() })),
  );
}
