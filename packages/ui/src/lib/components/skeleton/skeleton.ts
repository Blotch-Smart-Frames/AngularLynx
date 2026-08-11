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

import { type AnimationHandle, pulse } from '../../utils/animate';
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

  readonly skeletonRef = viewChild<ElementRef>('skeleton');
  #pulseAnim?: AnimationHandle;

  constructor() {
    // Start the pulse animation once the element is available
    effect(() => {
      const el = this.skeletonRef()?.nativeElement;
      if (!el) return;
      this.#pulseAnim?.cancel();
      this.#pulseAnim = pulse(el);
    });
  }

  protected readonly skeletonClass = computed(() =>
    cn('rounded-md bg-muted', this.userClass()),
  );
}
