import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-label',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="labelClass()"><ng-content /></text>`,
})
export class UiLabel {
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly labelClass = computed(() =>
    cn(
      'text-sm font-medium text-foreground',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );
}
