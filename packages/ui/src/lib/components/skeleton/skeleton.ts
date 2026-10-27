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

import { pulse } from '../../utils/animate';
import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-skeleton',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<view #skeleton [class]="skeletonClass()" />`,
})
export class UiSkeleton {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly skeletonRef = viewChild.required<ElementRef>('skeleton');

  /**
   * Pulses the skeleton. A field rather than a constructor: Angular's test
   * build keeps a function for a constructor that nothing calls, which an
   * app's coverage report would show as uncovered.
   */
  protected readonly pulsing = effect(() => {
    pulse(this.skeletonRef().nativeElement);
  });

  protected readonly skeletonClass = computed(() =>
    cn('rounded-md bg-muted', this.userClass()),
  );
}
