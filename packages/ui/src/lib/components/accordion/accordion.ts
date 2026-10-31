import {
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, revealIn } from '../../utils/animate';
import { cn } from '../../utils/cn';

/**
 * Each part is its host element, styled through `host`, rather than a view
 * inside the host. Angular gives a component's host every static attribute the
 * app writes on it, so a class on <ui-accordion-item> or any other part lands
 * on the host whatever the component does: with a styled view inside as well,
 * a border or padding applied twice.
 */
@Component({
  selector: 'ui-accordion',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: '<ng-content />',
})
export class UiAccordion {
  readonly type = input<'single' | 'multiple'>('single');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly expandedItems = signal<Set<string>>(new Set());

  protected readonly containerClass = computed(() =>
    cn('flex-col flex', this.userClass()),
  );

  toggle(value: string): void {
    // `new Set(current)` creates a fresh Set on every toggle. Angular signals
    // use reference equality — mutating the existing Set in-place wouldn't
    // trigger change detection since the signal value (the Set reference) stays
    // the same. A new Set forces the signal to see a changed reference.
    const current = new Set(this.expandedItems());
    if (current.has(value)) {
      current.delete(value);
    } else {
      if (this.type() === 'single') {
        current.clear();
      }
      current.add(value);
    }
    this.expandedItems.set(current);
  }

  isExpanded(value: string): boolean {
    return this.expandedItems().has(value);
  }
}

@Component({
  selector: 'ui-accordion-item',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'itemClass()' },
  template: '<ng-content />',
})
export class UiAccordionItem {
  readonly #accordion = inject(UiAccordion);

  readonly itemValue = input.required<string>({ alias: 'value' });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly isExpanded = computed(() =>
    this.#accordion.expandedItems().has(this.itemValue()),
  );

  protected readonly itemClass = computed(() =>
    cn('flex-col border-b border-border flex', this.userClass()),
  );

  toggle(): void {
    this.#accordion.toggle(this.itemValue());
  }
}

@Component({
  selector: 'ui-accordion-trigger',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'triggerClass()',
    '(bindtap)': 'onTap()',
  },
  template: `
    <text [class]="textClass()"><ng-content /></text>
    <text [class]="chevronClass()">{{ item.isExpanded() ? '▼' : '▶' }}</text>
  `,
})
export class UiAccordionTrigger {
  protected readonly item = inject(UiAccordionItem);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly triggerClass = computed(() =>
    cn('flex-row items-center py-4 flex justify-between', this.userClass()),
  );

  protected readonly textClass = computed(() =>
    cn('text-sm font-medium text-foreground'),
  );

  protected readonly chevronClass = computed(() =>
    cn('text-xs text-muted-foreground'),
  );

  protected onTap(): void {
    this.item.toggle();
  }
}

@Component({
  selector: 'ui-accordion-content',
  encapsulation: ViewEncapsulation.None,
  // Mount the content only while expanded, via `@if`. On Lynx this works because
  // the renderer recreates a destroyed element's native painting node when it is
  // re-inserted (see LynxElement.#recreateSubtree in @blotch/angular-lynx): when
  // the panel re-expands, the projected `<ng-content>` is rebuilt from cache and
  // renders again, cycle after cycle. While collapsed the host is hidden, so
  // the classes the app wrote on it (which Angular puts on the host either way)
  // take no room. revealIn animates from opacity:0 / translateY(-8px) with
  // fill:'none', so the host's own style takes over once the animation ends.
  host: { '[class]': 'contentClass()' },
  template: `
    @if (item.isExpanded()) {
      <ng-content />
    }
  `,
})
export class UiAccordionContent {
  protected readonly item = inject(UiAccordionItem);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #host = inject(ElementRef).nativeElement;
  #anim?: AnimationHandle;

  /**
   * Animates the reveal whenever the panel expands. A field rather than a
   * constructor: Angular's test build keeps a function for a constructor that
   * nothing calls, which an app's coverage report would show as uncovered.
   *
   * Deferred one macrotask so the re-inserted content is committed to the
   * native tree before we animate it. By then the panel may have collapsed
   * again, which leaves nothing to animate.
   */
  protected readonly revealing = effect(() => {
    if (!this.item.isExpanded()) return;
    setTimeout(() => {
      if (!this.item.isExpanded()) return;
      this.#anim?.cancel();
      this.#anim = revealIn(this.#host, { fromY: -8, fill: 'none' });
    }, 0);
  });

  protected readonly contentClass = computed(() =>
    this.item.isExpanded()
      ? cn('flex-col pb-4 flex', this.userClass())
      : 'hidden',
  );
}
