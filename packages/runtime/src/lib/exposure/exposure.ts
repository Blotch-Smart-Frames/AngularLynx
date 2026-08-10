import {
  Directive,
  ElementRef,
  inject,
  type OnDestroy,
  signal,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';

@Directive({
  selector: '[lynxExposure]',
  exportAs: 'lynxExposure',
})
export class LynxExposure implements OnDestroy {
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;

  // Whether this element is currently visible in the viewport.
  readonly visible = signal(false);

  #removeAppear: (() => void) | null = null;
  #removeDisappear: (() => void) | null = null;

  constructor() {
    // `binduiappear` / `binduidisappear` are Lynx-native events fired by the
    // element's UIAppearance system — the equivalent of IntersectionObserver on web.
    // They fire when the element enters or leaves the visible viewport of its
    // scroll container, enabling lazy-load and analytics tracking patterns.
    this.#removeAppear = this.#el.addEventListener('binduiappear', () =>
      this.visible.set(true),
    );
    this.#removeDisappear = this.#el.addEventListener('binduidisappear', () =>
      this.visible.set(false),
    );
  }

  ngOnDestroy(): void {
    this.#removeAppear?.();
    this.#removeDisappear?.();
  }
}
