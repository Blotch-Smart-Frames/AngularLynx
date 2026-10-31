import { Component, ViewEncapsulation, computed, input } from '@angular/core';

import { cn } from '../../utils/cn';

/**
 * The box is the host, styled through `host`. Angular gives a component's
 * host every static attribute the app writes on it, so a class on
 * <ui-aspect-ratio> lands on the host whatever the component does: with a
 * styled view inside as well, a margin or padding applied twice.
 */
@Component({
  selector: 'ui-aspect-ratio',
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'containerClass()',
    '[style]': 'containerStyle()',
  },
  template: '<ng-content />',
})
export class UiAspectRatio {
  readonly ratio = input(1);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('w-full overflow-hidden', this.userClass()),
  );

  protected readonly containerStyle = computed(
    () => `aspect-ratio: ${this.ratio()};`,
  );
}
