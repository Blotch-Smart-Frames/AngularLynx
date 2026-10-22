import { Component, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  mainThreadFn,
} from '@blotch/angular-lynx';

/** How many taps `countMainTap` has run for. */
const mainTaps = signal(0);

/**
 * A main-thread script, which Lynx runs through the LynxMainThreadEvent
 * directive rather than Angular's event listener.
 */
const countMainTap = mainThreadFn(() => {
  mainTaps.update((taps) => taps + 1);
});

/**
 * E2E fixture loaded through `loadComponent`. Lazy loading only fails at
 * runtime, never at build time, so the render tests navigate here and look for
 * its text. The text isn't flattened, so Maestro can see it on Android (see
 * counter.ts).
 *
 * "Main taps" checks that setting a `[mainThreadBind*]` input to null removes
 * its handler. A tap on the text runs `countMainTap`, then bubbles to the
 * view, whose tap handler sets the input to null, so a second tap must leave
 * the count at 1. Native Lynx ignored the `undefined` the directive used to
 * pass to remove a main-thread handler, while the web didn't (issue #55).
 * The check lives on this page because the counter page has no room left on
 * a small screen (see counter.ts).
 */
@Component({
  selector: 'app-lazy-route',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent],
  template: `
    <text flatten="false" style="margin-top: 16px;">Lazy page loaded</text>
    <view
      style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
      (bindtap)="mainTapsOn.set(false)"
    >
      <text
        flatten="false"
        [mainThreadBindtap]="mainTapsOn() ? countMainTap : null"
        >Main taps: {{ mainTaps() }}</text
      >
    </view>
  `,
})
export class LazyRoute {
  readonly mainTaps = mainTaps;
  readonly mainTapsOn = signal(true);
  readonly countMainTap = countMainTap;
}
