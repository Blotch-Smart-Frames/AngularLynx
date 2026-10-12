import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * E2E fixture that replaces the `hello` component the component schematic
 * generates. Tapping "Increment" proves the round trip from a native event,
 * through change detection, to the renderer; "Open lazy page" proves that
 * lazy route chunks load.
 *
 * The views the tests tap are accessibility elements with labels, so native UI
 * tests (Maestro, in Layer 6) can find them by name. `<text>` is an
 * accessibility element by default, labeled with its content.
 */
@Component({
  selector: 'app-hello',
  imports: [LYNX_ELEMENTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <view style="margin-top: 16px; align-items: center;">
      <text style="font-size: 18px;">Count: {{ count() }}</text>
      <view
        [accessibility-element]="true"
        accessibility-label="Increment"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="increment()"
      >
        <text>Increment</text>
      </view>
      <view
        [accessibility-element]="true"
        accessibility-label="Open lazy page"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="openLazyPage()"
      >
        <text>Open lazy page</text>
      </view>
    </view>
  `,
})
export class Hello {
  readonly #router = inject(Router);
  readonly count = signal(0);

  increment() {
    this.count.update((count) => count + 1);
  }

  openLazyPage() {
    void this.#router.navigateByUrl('/lazy');
  }
}
