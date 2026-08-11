import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, revealIn } from '../../utils/animate';
import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-accordion',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
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
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="itemClass()">
      <ng-content />
    </view>
  `,
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
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="triggerClass()" (bindtap)="onTap()">
      <text [class]="textClass()"><ng-content /></text>
      <text [class]="chevronClass()">{{ item.isExpanded() ? '▼' : '▶' }}</text>
    </view>
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
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Mount the content only while expanded, via `@if`. On Lynx this works because
  // the renderer recreates a destroyed element's native painting node when it is
  // re-inserted (see LynxElement.#recreateSubtree in @blotch/angular-lynx): when
  // the panel re-expands, the projected `<ng-content>` — recycled with the
  // re-created wrapper — is rebuilt from cache and renders again, cycle after
  // cycle. The inline opacity/transform is the resting state; revealIn animates
  // from opacity:0 / translateY(-8px) with fill:'none' so the inline style takes
  // over once the animation ends.
  template: `
    @if (item.isExpanded()) {
      <view
        #content
        [class]="contentClass()"
        style="opacity: 1; transform: translateY(0);"
      >
        <ng-content />
      </view>
    }
  `,
})
export class UiAccordionContent {
  protected readonly item = inject(UiAccordionItem);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly contentRef = viewChild<ElementRef>('content');
  #anim?: AnimationHandle;

  constructor() {
    // Animate the reveal whenever the panel expands. contentRef only resolves
    // while the `@if` content is mounted; defer one macrotask so the freshly
    // (re)created element is committed to the native tree before we animate it.
    effect(() => {
      if (!this.item.isExpanded()) return;
      setTimeout(() => {
        const el = this.contentRef()?.nativeElement;
        if (!el) return;
        this.#anim?.cancel();
        this.#anim = revealIn(el, { fromY: -8, fill: 'none' });
      }, 0);
    });
  }

  protected readonly contentClass = computed(() =>
    cn('flex-col pb-4 flex', this.userClass()),
  );
}
