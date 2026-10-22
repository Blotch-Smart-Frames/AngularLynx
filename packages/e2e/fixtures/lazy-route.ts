import { Component, inject, signal, type OnInit } from '@angular/core';
import {
  backgroundFn,
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  LynxNativeModule,
  mainThreadFn,
} from '@blotch/angular-lynx';

import { initRuns } from './hello/hello';

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
 * A background function defined in a lazy chunk. Only the main thread's
 * router loads the chunk, so the background thread has the function only if
 * it ran the chunk's lazy import too (issue #81).
 */
const lazyEcho = backgroundFn((text: string) => `${text} back`);

type Emitter = {
  addListener(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, args: unknown[]): void;
};

/**
 * E2E fixture loaded through `loadComponent`. Lazy loading only fails at
 * runtime, never at build time, so the render tests navigate here and look for
 * its text. The texts aren't flattened, so Maestro can see them on Android (see
 * counter.ts).
 *
 * "Main taps" checks that setting a `[mainThreadBind*]` input to null removes
 * its handler. A tap on the text runs `countMainTap`, then bubbles to the
 * view, whose tap handler sets the input to null, so a second tap must leave
 * the count at 1. Native Lynx ignored the `undefined` the directive used to
 * pass to remove a main-thread handler, while the web didn't (issue #55).
 * The checks live on this page because the counter page has no room left on
 * a small screen (see counter.ts).
 *
 * The right-hand column checks that Angular runs on the main thread only and
 * the background thread still does its part (issue #81). It's a column, with
 * small gaps, so the page gets no taller: on CI's 320x640 Android emulator, a
 * row below "Main taps" would be off the screen, where Maestro can't tap it.
 * - "Init runs" is how many times the counter page's ngOnInit ran (see
 *   counter.ts). The background thread used to start a second copy of the app,
 *   which made it 2. That copy never navigated, so the count is kept on the
 *   first screen.
 * - "Echo" calls `lazyEcho` above.
 * - "Emitter" listens to GlobalEventEmitter and emits on it. Lynx has JS
 *   modules on the background thread only, so both calls and the event go
 *   through LynxNativeModule's relay.
 */
@Component({
  selector: 'app-lazy-route',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent],
  template: `
    <view style="display: flex; flex-direction: row; margin-top: 16px;">
      <view>
        <text flatten="false">Lazy page loaded</text>
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
      </view>
      <view style="margin-left: 16px;">
        <text flatten="false">Init runs: {{ initRuns() }}</text>
        <text flatten="false" style="margin-top: 4px;" (bindtap)="askLazyEcho()"
          >Echo: {{ echo() }}</text
        >
        <text flatten="false" style="margin-top: 4px;" (bindtap)="pingEmitter()"
          >Emitter: {{ emitted() }}</text
        >
      </view>
    </view>
  `,
})
export class LazyRoute implements OnInit {
  readonly mainTaps = mainTaps;
  readonly mainTapsOn = signal(true);
  readonly countMainTap = countMainTap;
  readonly initRuns = initRuns;
  readonly echo = signal('');
  readonly emitted = signal('');

  readonly #emitter =
    inject(LynxNativeModule).getJSModule<Emitter>('GlobalEventEmitter');

  ngOnInit(): void {
    this.#emitter?.addListener('angularLynxE2e', (reply) =>
      this.emitted.set(String(reply)),
    );
  }

  askLazyEcho(): void {
    void runOnBackground(lazyEcho, 'hi').then(
      (reply) => this.echo.set(String(reply)),
      (error: unknown) => this.echo.set(String(error)),
    );
  }

  pingEmitter(): void {
    this.#emitter?.emit('angularLynxE2e', ['pong']);
  }
}
