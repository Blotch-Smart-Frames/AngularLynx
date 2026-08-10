import type { Animation as LynxJsAnimation } from '@lynx-js/types/main-thread';

/**
 * A no-op animation returned when `animate()` is called on the background
 * thread where `__ElementAnimate` is unavailable. Provides the same API
 * surface as `LynxAnimation` so callers can call `.cancel()`, `.pause()`,
 * `.play()` without crashing — the calls simply do nothing.
 *
 * Fixes: "Uncaught Error: animate() is only available on the main thread"
 * in the Go web preview (and any background-thread context).
 *
 * Why needed: In the Lynx dual-thread model, Angular runs on the background
 * thread where __ElementAnimate doesn't exist. Previously, calling
 * element.animate() from a component (e.g. the animations example's "Tap to
 * pulse" button) would throw, crashing the Go web preview on the docs site.
 *
 * Approach: Return a silent no-op instead of throwing. This matches how
 * @lynx-js/web-core itself handles __ElementAnimate on the server — it's
 * defined as `() => {}` (a no-op). We mirror that graceful degradation here.
 * Alternatives considered:
 *   - Cross-thread bridge via lynx.getCoreContext().dispatchEvent() — correct
 *     long-term but complex; LynxBackgroundElement doesn't hold a native ref.
 *   - Removing animate() from the example — wrong because it's the primary
 *     demonstration of the JS animate API.
 */
export class NoopLynxAnimation implements Pick<
  LynxJsAnimation,
  'id' | 'cancel' | 'pause' | 'play'
> {
  static #count = 0;

  readonly id: string;

  constructor() {
    this.id = `__lynx-angular-noop-animation-${NoopLynxAnimation.#count++}`;
  }

  play(): void {
    // No-op — animation cannot run on the background thread.
  }

  pause(): void {
    // No-op — animation cannot run on the background thread.
  }

  cancel(): void {
    // No-op — animation cannot run on the background thread.
  }
}
