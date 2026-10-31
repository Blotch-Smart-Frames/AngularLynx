import {
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  inject,
  input,
} from '@angular/core';
import { registerHostElement } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  SCALE,
  pressDown,
  pressRelease,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';

/**
 * Each part is its host element, styled through `host`, rather than a view
 * (or text) inside the host. Angular gives a component's host every static
 * attribute the app writes on it, so `<ui-card-content class="pt-6">` puts
 * `pt-6` on the host whatever the component does with its `class` input: with
 * a styled view inside as well, the padding applied twice. On the host alone,
 * a class also acts where the part sits in its parent's layout (`flex-1`,
 * margins). The title and description are text, so their hosts are `<text>`
 * elements (registerHostElement, below).
 */
@Component({
  selector: 'ui-card',
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'containerClass()',
    '(bindtouchstart)': 'onPressStart()',
    '(bindtouchend)': 'onPressEnd()',
    '(bindtouchcancel)': 'onPressCancel()',
    '(bindmousedown)': 'onPressStart()',
    '(bindmouseup)': 'onPressEnd()',
    '(bindmouseleave)': 'onPressCancel()',
  },
  template: '<ng-content />',
})
export class UiCard {
  /**
   * When true, the card responds to touch with a subtle scale animation
   */
  readonly pressable = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #host = inject(ElementRef).nativeElement;
  #pressAnim?: AnimationHandle;

  protected readonly containerClass = computed(() =>
    cn('rounded-lg border border-border bg-card', this.userClass()),
  );

  protected onPressStart(): void {
    if (!this.pressable()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.#host, SCALE.pressDownLight);
  }

  protected onPressEnd(): void {
    if (!this.pressable()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.#host);
  }

  protected onPressCancel(): void {
    // Restore scale on cancel — without this, a scroll gesture taking over
    // mid-press would leave the card stuck in its pressed-down state.
    if (!this.pressable()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.#host);
  }
}

@Component({
  selector: 'ui-card-header',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: '<ng-content />',
})
export class UiCardHeader {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('flex-col p-6 flex', this.userClass()),
  );
}

@Component({
  selector: 'ui-card-title',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'textClass()' },
  template: '<ng-content />',
})
export class UiCardTitle {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-2xl font-semibold text-card-foreground', this.userClass()),
  );
}

registerHostElement(UiCardTitle, 'text');

@Component({
  selector: 'ui-card-description',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'textClass()' },
  template: '<ng-content />',
})
export class UiCardDescription {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-sm text-muted-foreground', this.userClass()),
  );
}

registerHostElement(UiCardDescription, 'text');

@Component({
  selector: 'ui-card-content',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: '<ng-content />',
})
export class UiCardContent {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('p-6 pt-0', this.userClass()),
  );
}

@Component({
  selector: 'ui-card-footer',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: '<ng-content />',
})
export class UiCardFooter {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('items-center p-6 pt-0 flex', this.userClass()),
  );
}
