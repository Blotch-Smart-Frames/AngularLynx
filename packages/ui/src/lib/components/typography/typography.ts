import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { registerHostElement } from '@blotch/angular-lynx';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../utils/cn';

export const typographyVariants = cva('', {
  variants: {
    variant: {
      h1: 'text-4xl font-bold text-foreground',
      h2: 'text-3xl font-semibold text-foreground',
      h3: 'text-2xl font-semibold text-foreground',
      h4: 'text-xl font-semibold text-foreground',
      p: 'text-base text-foreground',
      lead: 'text-xl text-muted-foreground',
      large: 'text-lg font-semibold text-foreground',
      small: 'text-sm font-medium text-foreground',
      muted: 'text-sm text-muted-foreground',
    },
  },
  defaultVariants: {
    variant: 'p',
  },
});

export type TypographyVariant = NonNullable<
  VariantProps<typeof typographyVariants>['variant']
>;

/**
 * The text is its host, a `<text>` (registerHostElement, below), styled
 * through `host`. Angular gives a component's host every static attribute the
 * app writes on it, so `<ui-text class="mb-4">` puts `mb-4` on the host
 * whatever the component does: with a styled `<text>` inside a view host as
 * well, the margin applied twice.
 */
@Component({
  selector: 'ui-text',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'textClass()' },
  template: '<ng-content />',
})
export class UiText {
  readonly variant = input<TypographyVariant>('p');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn(typographyVariants({ variant: this.variant() }), this.userClass()),
  );
}

registerHostElement(UiText, 'text');
