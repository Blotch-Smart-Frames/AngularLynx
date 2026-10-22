import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  backgroundFn,
  createMainThreadRef,
  LYNX_ELEMENTS,
  MainThreadRef,
} from '@blotch/angular-lynx';

import { TailwindCard } from './tailwind-card';

const factor = createMainThreadRef(2);

/**
 * Runs on the background thread for "Ask background". It's async, and takes a
 * MainThreadRef, so its answer only shows when runOnBackground() awaits the
 * result and hands the ref over as the background thread's copy (issue #54).
 */
const multiply = backgroundFn(async (ref: unknown, n: number) => {
  await Promise.resolve();
  return ref instanceof MainThreadRef ? n * (ref.current as number) : -1;
});

/**
 * E2E fixture that replaces the `hello` component the component schematic
 * generates. Tapping "Increment" proves the round trip from a native event,
 * through change detection, to the renderer; "Open lazy page" proves that
 * lazy route chunks load.
 *
 * The views the tests tap are accessibility elements with labels, so native UI
 * tests (Maestro, in Layer 6) can find them by name. `<text>` is an
 * accessibility element by default, labeled with its content.
 *
 * Every element a native test taps or checks also turns off flattening. On
 * Android, Lynx draws flattened elements into their parent instead of giving
 * them a View, and unless TalkBack is on (Lynx Explorer sets up accessibility
 * lazily) nothing exposes them, so Maestro can't see them. A View of its own
 * carries the label (or the text) as its content description.
 *
 * Below the buttons are elements from Lynx's XElement library rather than its
 * core: `<input>`, `<svg>` and `<overlay>`. An app shell that doesn't link and
 * register XElement renders nothing for them (on Android, nothing after them
 * either), with no error on screen, so native/xelement.yaml types into the
 * input, finds the svg and opens the overlay. Lynx Explorer bundles XElement;
 * the shells from `ng build --platform` have to as well.
 *
 * "Ask background" calls an async background function from a tap handler.
 *
 * The last element is a component with an `.html` template styled by Tailwind
 * (tailwind-card.ts).
 */
@Component({
  selector: 'app-hello',
  imports: [LYNX_ELEMENTS, TailwindCard],
  template: `
    <view style="margin-top: 16px; align-items: center;">
      <text flatten="false" style="font-size: 18px;">Count: {{ count() }}</text>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Increment"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="increment()"
      >
        <text>Increment</text>
      </view>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open lazy page"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="openLazyPage()"
      >
        <text>Open lazy page</text>
      </view>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Ask background"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="askBackground()"
      >
        <text>Ask background</text>
      </view>
      <text flatten="false" style="margin-top: 8px;"
        >Background: {{ answer() }}</text
      >
      <input
        accessibility-label="Text field"
        placeholder="Type here"
        style="margin-top: 16px; width: 200px; height: 40px; padding: 0 8px; border-width: 1px; border-color: #999999;"
        (bindinput)="onInput($event)"
      />
      <text flatten="false" style="margin-top: 8px;">Typed: {{ typed() }}</text>
      <!-- Static flatten="false" here and on the <text>s, bound on the <view>s:
        every element's flatten input takes both, and the build checks it. -->
      <svg
        flatten="false"
        [accessibility-element]="true"
        accessibility-label="SVG circle"
        style="margin-top: 8px; width: 24px; height: 24px;"
        content='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#6366f1"/></svg>'
      ></svg>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open overlay"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="overlayOpen.set(true)"
      >
        <text>Open overlay</text>
      </view>
      <overlay [attr.visible]="overlayOpen()">
        <view
          style="width: 100%; height: 100%; align-items: center; justify-content: center; background-color: rgba(0, 0, 0, 0.4);"
        >
          <view
            [flatten]="false"
            [accessibility-element]="true"
            accessibility-label="Close overlay"
            style="padding: 12px; background-color: #ffffff;"
            (bindtap)="overlayOpen.set(false)"
          >
            <text>Close overlay</text>
          </view>
        </view>
      </overlay>
      <app-tailwind-card />
    </view>
  `,
})
export class Hello {
  readonly #router = inject(Router);
  readonly count = signal(0);
  readonly typed = signal('');
  readonly overlayOpen = signal(false);
  readonly answer = signal('');

  increment() {
    this.count.update((count) => count + 1);
  }

  onInput(event: Event) {
    this.typed.set((event as CustomEvent<{ value: string }>).detail.value);
  }

  openLazyPage() {
    void this.#router.navigateByUrl('/lazy');
  }

  /**
   * Asks `multiply` for 21 times the ref. Tap handlers run on the main
   * thread, where runOnBackground() exists.
   */
  askBackground() {
    void runOnBackground(multiply, factor, 21).then(
      (result) => this.answer.set(JSON.stringify(result)),
      (error: unknown) => this.answer.set(String(error)),
    );
  }
}
