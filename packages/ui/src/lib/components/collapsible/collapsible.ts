import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, revealIn } from '../../utils/animate';
import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-collapsible',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiCollapsible {
  readonly open = model(false);
  readonly disabled = input(false);
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
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="triggerClass()" (bindtap)="onTap()">
      <ng-content />
    </view>
  `,
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
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Mount the content only while open, via `@if`. On Lynx this works because the
  // renderer recreates a destroyed element's native painting node when it is
  // re-inserted (see LynxElement.#recreateSubtree in @blotch/angular-lynx): when
  // the panel reopens, the projected `<ng-content>` — recycled with the re-created
  // wrapper — is rebuilt from cache and renders again on every open. The inline
  // opacity/transform is the resting state; revealIn animates from opacity:0 /
  // translateY(-8px) with fill:'none' so the inline style takes over once the
  // animation ends.
  template: `
    @if (collapsible.open()) {
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
export class UiCollapsibleContent {
  protected readonly collapsible = inject(UiCollapsible);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly contentRef = viewChild<ElementRef>('content');
  #anim?: AnimationHandle;

  constructor() {
    // Animate the reveal whenever the panel opens. contentRef only resolves while
    // the `@if` content is mounted; defer one macrotask so the freshly (re)created
    // element is committed to the native tree before we animate it.
    effect(() => {
      if (!this.collapsible.open()) return;
      setTimeout(() => {
        const el = this.contentRef()?.nativeElement;
        if (!el) return;
        this.#anim?.cancel();
        this.#anim = revealIn(el, { fromY: -8, fill: 'none' });
      }, 0);
    });
  }

  protected readonly contentClass = computed(() =>
    cn('flex-col flex', this.userClass()),
  );
}
