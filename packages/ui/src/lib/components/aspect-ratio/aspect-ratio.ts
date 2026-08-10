import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-aspect-ratio',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()" [style]="containerStyle()">
      <ng-content />
    </view>
  `,
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
