import {
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
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

/**
 * The alert is its host, styled through `host`. Angular gives a component's
 * host every static attribute the app writes on it, so a class on <ui-alert>
 * lands on the host whatever the component does: with a styled view inside as
 * well, the padding and border applied twice. Its title lands there too, and
 * goes: it's shown in a <text>, and on the web preview a `title` attribute is
 * a tooltip (and a second match for getByTitle).
 */
@Component({
  selector: 'ui-alert',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'containerClass()',
    '[attr.title]': 'null',
  },
  template: `
    @if (title()) {
      <text [class]="titleClass()">{{ title() }}</text>
    }
    @if (description()) {
      <text [class]="descriptionClass()">{{ description() }}</text>
    }
    <ng-content />
  `,
})
export class UiAlert {
  readonly variant = input<AlertVariant>('default');
  readonly title = input<string>('');
  readonly description = input<string>('');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #host = inject(ElementRef).nativeElement;

  /**
   * Reveals the alert with a subtle entrance on first render. A field rather
   * than a constructor: Angular's test build keeps a function for a
   * constructor that nothing calls, which an app's coverage report would show
   * as uncovered.
   */
  protected readonly entrance = effect(() => {
    revealIn(this.#host, { fromY: 4 });
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
