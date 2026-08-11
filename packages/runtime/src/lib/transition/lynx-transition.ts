import {
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  Renderer2,
  signal,
} from '@angular/core';

/**
 * Animates the enter/leave of projected content using CSS `@keyframes`.
 *
 * Two classes are toggled on the host element:
 *
 * | Phase | Class applied   | Plays                                  |
 * |-------|-----------------|----------------------------------------|
 * | Enter | `{name}-enter`  | on mount, until `duration` elapses     |
 * | Leave | `{name}-leave`  | then the element is unmounted          |
 *
 * **Why keyframes, not a two-phase CSS `transition`.** The obvious Vue-style
 * approach (mount in a `-enter-from` state, then swap to `-enter-to` one frame
 * later so a `transition` interpolates) needs a real paint gap between the two
 * states. Lynx's background thread — where Angular runs — has no reliable frame
 * boundary: `requestAnimationFrame` is microtask-mapped/absent, and class
 * mutations made from an rAF/`setTimeout` callback don't go through change
 * detection so they never reliably flush to the main thread (the element tree is
 * committed once per CD cycle in `LynxRendererFactory2.end()`). A `@keyframes`
 * animation sidesteps all of it: a SINGLE class, applied inside the effect (a CD
 * pass) so it flushes in the same commit that mounts the element, and the native
 * engine plays the keyframes from 0%. This mirrors the proven single-class
 * pattern in `examples/animations`.
 *
 * Completion is timer-based (`duration`) because the background thread has no
 * `animationend` bridge — `duration` must match your CSS animation length.
 *
 * @usageNotes
 * ```html
 * <lynx-transition [show]="isVisible()" name="fade" [duration]="300">
 *   <view class="panel"><text>Hello</text></view>
 * </lynx-transition>
 * ```
 *
 * ```css
 * @keyframes fade-enter { from { opacity: 0; } to { opacity: 1; } }
 * @keyframes fade-leave { from { opacity: 1; } to { opacity: 0; } }
 * .fade-enter { animation: fade-enter 300ms ease both; }
 * .fade-leave { animation: fade-leave 300ms ease both; }
 * ```
 */
@Component({
  selector: 'lynx-transition',
  standalone: true,
  template: `@if (shouldRender()) {
    <ng-content />
  }`,
})
export class LynxTransition {
  readonly show = input<boolean>(false);
  readonly name = input<string>('v');
  readonly duration = input<number>(300);

  readonly afterEnter = output<void>();
  readonly afterLeave = output<void>();

  readonly shouldRender = signal(false);

  readonly #renderer = inject(Renderer2);
  readonly #el = inject(ElementRef);
  #initialized = false;
  #enterTimer: ReturnType<typeof setTimeout> | null = null;
  #leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const show = this.show();

      // Skip animation on the very first run — sync shouldRender to the initial
      // show value without playing an enter/leave transition. This prevents the
      // component from animating in on page load when it starts as visible.
      if (!this.#initialized) {
        this.#initialized = true;
        this.shouldRender.set(show);
        return;
      }

      if (show) {
        this.#enter();
      } else {
        this.#leave();
      }
    });
  }

  #enter(): void {
    this.#clearTimers();

    const el = this.#el.nativeElement;
    const name = this.name();

    // Swap to the enter keyframe and mount in the same change-detection pass, so
    // both are committed to the main thread together and the native engine plays
    // `${name}-enter` from 0% on the freshly-mounted element. Removing a stale
    // leave class first handles a quick hide→show toggle.
    this.#renderer.removeClass(el, `${name}-leave`);
    this.#renderer.addClass(el, `${name}-enter`);
    this.shouldRender.set(true);

    // Timer-based completion (no animationend bridge on the background thread).
    // The enter class holds the final frame (animation-fill-mode: both) = the
    // resting state, so it's safe to leave applied until the next leave.
    this.#enterTimer = setTimeout(() => {
      this.#enterTimer = null;
      this.afterEnter.emit();
    }, this.duration());
  }

  #leave(): void {
    this.#clearTimers();

    const el = this.#el.nativeElement;
    const name = this.name();

    this.#renderer.removeClass(el, `${name}-enter`);
    this.#renderer.addClass(el, `${name}-leave`);

    // Keep the content mounted until the leave animation finishes, then unmount.
    // shouldRender is a signal, so flipping it runs change detection and flushes
    // the unmount (the leave class stays put; the next enter removes it).
    this.#leaveTimer = setTimeout(() => {
      this.#leaveTimer = null;
      this.shouldRender.set(false);
      this.afterLeave.emit();
    }, this.duration());
  }

  #clearTimers(): void {
    if (this.#enterTimer !== null) {
      clearTimeout(this.#enterTimer);
      this.#enterTimer = null;
    }
    if (this.#leaveTimer !== null) {
      clearTimeout(this.#leaveTimer);
      this.#leaveTimer = null;
    }
  }
}
