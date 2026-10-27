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

import { revealIn } from '../../utils/animate';
import { cn } from '../../utils/cn';

export const alertVariants = cva('flex-col rounded-lg border p-4 flex', {
  variants: {
    variant: {
      default: 'border-border bg-background',
      // A solid destructive border over red at 10%. The tint is the
      // pre-composed bg-destructive-subtle, not bg-destructive/10: a modifier
      // needs the theme's --destructive-rgb, which themes copied before it
      // existed don't have.
      destructive: 'border-destructive bg-destructive-subtle',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

const alertTitleVariants = cva('mb-1 font-medium', {
  variants: {
    variant: {
      default: 'text-foreground',
      destructive: 'text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

const alertDescriptionVariants = cva('text-sm', {
  variants: {
    variant: {
      default: 'text-muted-foreground',
      destructive: 'text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

export type AlertVariant = NonNullable<
  VariantProps<typeof alertVariants>['variant']
>;

@Component({
  selector: 'ui-alert',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view #container [class]="containerClass()">
      @if (title()) {
        <text [class]="titleClass()">{{ title() }}</text>
      }
      @if (description()) {
        <text [class]="descriptionClass()">{{ description() }}</text>
      }
      <ng-content />
    </view>
  `,
})
export class UiAlert {
  readonly variant = input<AlertVariant>('default');
  readonly title = input<string>('');
  readonly description = input<string>('');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly containerRef = viewChild.required<ElementRef>('container');

  /**
   * Reveals the alert with a subtle entrance on first render. A field rather
   * than a constructor: Angular's test build keeps a function for a
   * constructor that nothing calls, which an app's coverage report would show
   * as uncovered.
   */
  protected readonly entrance = effect(() => {
    revealIn(this.containerRef().nativeElement, { fromY: 4 });
  });

  protected readonly containerClass = computed(() =>
    cn(alertVariants({ variant: this.variant() }), this.userClass()),
  );

  protected readonly titleClass = computed(() =>
    cn(alertTitleVariants({ variant: this.variant() })),
  );

  protected readonly descriptionClass = computed(() =>
    cn(alertDescriptionVariants({ variant: this.variant() })),
  );
}
