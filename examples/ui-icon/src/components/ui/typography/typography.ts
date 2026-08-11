import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@blotch/dolan/utils/cn';

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

@Component({
  selector: 'ui-text',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="textClass()"><ng-content /></text>`,
})
export class UiText {
  readonly variant = input<TypographyVariant>('p');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn(typographyVariants({ variant: this.variant() }), this.userClass()),
  );
}
