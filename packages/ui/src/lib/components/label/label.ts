import {
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';
import { registerHostElement } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';

/**
 * The label is its host, a `<text>` (registerHostElement, below), styled
 * through `host`. Angular gives a component's host every static attribute the
 * app writes on it, so `<ui-label class="mb-2">` puts `mb-2` on the host
 * whatever the component does: with a styled `<text>` inside a view host as
 * well, the margin applied twice.
 */
@Component({
  selector: 'ui-label',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'labelClass()' },
  template: '<ng-content />',
})
export class UiLabel {
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly labelClass = computed(() =>
    cn(
      'text-sm font-medium text-foreground',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );
}

registerHostElement(UiLabel, 'text');
