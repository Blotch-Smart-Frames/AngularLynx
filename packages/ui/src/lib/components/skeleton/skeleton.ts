import {
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';

import { pulse } from '../../utils/animate';
import { cn } from '../../utils/cn';

/**
 * The skeleton is its host, styled through `host`. Angular gives a
 * component's host every static attribute the app writes on it, so a class on
 * <ui-skeleton> lands on the host whatever the component does: with a styled
 * view inside as well, a margin applied twice, and the placeholder's size had
 * to be set on both.
 */
@Component({
  selector: 'ui-skeleton',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'skeletonClass()' },
  template: '',
})
export class UiSkeleton {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #host = inject(ElementRef).nativeElement;

  /**
   * Pulses the skeleton. A field rather than a constructor: Angular's test
   * build keeps a function for a constructor that nothing calls, which an
   * app's coverage report would show as uncovered.
   */
  protected readonly pulsing = effect(() => {
    pulse(this.#host);
  });

  protected readonly skeletonClass = computed(() =>
    cn('rounded-md bg-muted', this.userClass()),
  );
}
