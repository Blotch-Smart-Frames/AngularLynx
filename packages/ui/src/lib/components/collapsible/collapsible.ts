import {
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
} from '@angular/core';

import { type AnimationHandle, revealIn } from '../../utils/animate';
import { cn } from '../../utils/cn';

/**
 * Each part is its host element, styled through `host`, rather than a view
 * inside the host. Angular gives a component's host every static attribute the
 * app writes on it, so `<ui-collapsible class="rounded-lg border">` puts those
 * classes on the host whatever the component does: with a styled view inside
 * as well, the border was drawn twice.
 */
@Component({
  selector: 'ui-collapsible',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: '<ng-content />',
})
export class UiCollapsible {
  readonly open = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('flex-col flex', this.userClass()),
  );

  toggle(): void {
    if (!this.disabled()) {
      this.open.update((v) => !v);
    }
  }
}

@Component({
  selector: 'ui-collapsible-trigger',
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'triggerClass()',
    '(bindtap)': 'onTap()',
  },
  template: '<ng-content />',
})
export class UiCollapsibleTrigger {
  readonly #collapsible = inject(UiCollapsible);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly triggerClass = computed(() =>
    cn(
      'flex-row items-center flex',
      this.#collapsible.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected onTap(): void {
    this.#collapsible.toggle();
  }
}

@Component({
  selector: 'ui-collapsible-content',
  encapsulation: ViewEncapsulation.None,
  // Mount the content only while open, via `@if`. On Lynx this works because the
  // renderer recreates a destroyed element's native painting node when it is
  // re-inserted (see LynxElement.#recreateSubtree in @blotch/angular-lynx): when
  // the panel reopens, the projected `<ng-content>` is rebuilt from cache and
  // renders again on every open. While closed the host is hidden, so the
  // classes the app wrote on it (which Angular puts on the host either way)
  // take no room. revealIn animates from opacity:0 / translateY(-8px) with
  // fill:'none', so the host's own style takes over once the animation ends.
  host: { '[class]': 'contentClass()' },
  template: `
    @if (collapsible.open()) {
      <ng-content />
    }
  `,
})
export class UiCollapsibleContent {
  protected readonly collapsible = inject(UiCollapsible);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #host = inject(ElementRef).nativeElement;
  #anim?: AnimationHandle;

  /**
   * Animates the reveal whenever the panel opens. A field rather than a
   * constructor: Angular's test build keeps a function for a constructor that
   * nothing calls, which an app's coverage report would show as uncovered.
   *
   * Deferred one macrotask so the re-inserted content is committed to the
   * native tree before we animate it. By then the panel may have closed
   * again, which leaves nothing to animate.
   */
  protected readonly revealing = effect(() => {
    if (!this.collapsible.open()) return;
    setTimeout(() => {
      if (!this.collapsible.open()) return;
      this.#anim?.cancel();
      this.#anim = revealIn(this.#host, { fromY: -8, fill: 'none' });
    }, 0);
  });

  protected readonly contentClass = computed(() =>
    this.collapsible.open() ? cn('flex-col flex', this.userClass()) : 'hidden',
  );
}
