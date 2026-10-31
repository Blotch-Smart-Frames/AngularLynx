import {
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { cva, type VariantProps } from 'class-variance-authority';

import { popIn } from '../../utils/animate';
import { cn } from '../../utils/cn';

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

/**
 * The badge's pill is its host, styled through `host`, with its label inside.
 * Angular gives a component's host every static attribute the app writes on
 * it, so a class on <ui-badge> lands on the host whatever the component does:
 * with a styled pill inside as well, a margin applied twice.
 */
@Component({
  selector: 'ui-badge',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: `<text [class]="labelClass()"><ng-content /></text>`,
})
export class UiBadge {
  readonly variant = input<BadgeVariant>('default');
  /**
   * When true, badge pops in with a spring animation on first render
   */
  readonly animated = input(true, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #host = inject(ElementRef).nativeElement;

  /**
   * Pops the badge in on first render, unless `animated` is off. A field
   * rather than a constructor: Angular's test build keeps a function for a
   * constructor that nothing calls, which an app's coverage report would show
   * as uncovered.
   */
  protected readonly entrance = effect(() => {
    if (this.animated()) {
      popIn(this.#host, { duration: 200 });
    }
  });

  protected readonly containerClass = computed(() =>
    cn(badgeVariants({ variant: this.variant() }), this.userClass()),
  );

  protected readonly labelClass = computed(() =>
    cn(badgeTextVariants({ variant: this.variant() })),
  );
}
