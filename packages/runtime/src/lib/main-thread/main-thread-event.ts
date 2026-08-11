import {
  Directive,
  ElementRef,
  inject,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';
import type { MainThreadFnHandle } from './main-thread-fn';

/**
 * Plain functions are also accepted because the worklet build plugin transforms
 * them into MainThreadFnHandle objects at compile time.
 */
type MaybeHandle =
  | MainThreadFnHandle
  | ((...args: any[]) => any)
  | undefined
  | null;

/**
 * Maps directive input names to [eventType, eventName] for Lynx's __AddEvent PAPI.
 * eventType is 'bindEvent' (bubbles) or 'catchEvent' (stops propagation) —
 * these map to Lynx's bind* / catch* event model, not DOM addEventListener.
 */
const INPUT_TO_EVENT: Record<string, [string, string]> = {
  mainThreadBindtap: ['bindEvent', 'tap'],
  mainThreadCatchtap: ['catchEvent', 'tap'],
  mainThreadBindtouchstart: ['bindEvent', 'touchstart'],
  mainThreadCatchtouchstart: ['catchEvent', 'touchstart'],
  mainThreadBindtouchmove: ['bindEvent', 'touchmove'],
  mainThreadCatchtouchmove: ['catchEvent', 'touchmove'],
  mainThreadBindtouchend: ['bindEvent', 'touchend'],
  mainThreadCatchtouchend: ['catchEvent', 'touchend'],
  mainThreadBindlongpress: ['bindEvent', 'longpress'],
  mainThreadCatchlongpress: ['catchEvent', 'longpress'],
  mainThreadBindscroll: ['bindEvent', 'scroll'],
  mainThreadCatchscroll: ['catchEvent', 'scroll'],
  mainThreadBindanimationstart: ['bindEvent', 'animationstart'],
  mainThreadBindanimationend: ['bindEvent', 'animationend'],
  mainThreadBindtransitionend: ['bindEvent', 'transitionend'],
  mainThreadBindlayoutchange: ['bindEvent', 'layoutchange'],
};

const isMainThreadHandle = (h: MaybeHandle): h is MainThreadFnHandle =>
  !!h &&
  '__isMainThreadFn' in h &&
  !!(h as MainThreadFnHandle).__isMainThreadFn;

/**
 * Bridges Angular template bindings like `(mainThreadBindtap)="handler"` to
 * Lynx's main-thread (Lepus) event dispatch.
 *
 * Why a dedicated directive and not the renderer's listen() path:
 * - Normal `(bindtap)` events are delivered to the background JS thread and
 *   incur a thread hop on every dispatch — fine for one-shot taps, but too
 *   slow for gesture-driven UI (scroll-tracking, drag, pinch) where the
 *   handler needs to mutate styles at native frame rate.
 * - The `mainThreadBind*` / `mainThreadCatch*` family registers the handler
 *   as a *worklet* with `_workletType: 'main-thread'`, so Lynx invokes it
 *   directly on the Lepus thread where __AddInlineStyle / __SetAttribute are
 *   synchronous. There is no thread hop and no background JS involvement.
 * - These inputs cannot be expressed as @Output() because Angular would route
 *   them through its own event subscription system and the underlying
 *   worklet handle would never be passed to __AddEvent.
 *
 * The worklet plugin (in rsbuild-plugin-angular-lynx) rewrites any function
 * annotated with `'main thread'` directive into a `MainThreadFnHandle`
 * carrying a stable `_wkltId`. That ID is what we hand to __AddEvent here.
 */
@Directive({
  selector:
    '[mainThreadBindtap],[mainThreadCatchtap],' +
    '[mainThreadBindtouchstart],[mainThreadCatchtouchstart],' +
    '[mainThreadBindtouchmove],[mainThreadCatchtouchmove],' +
    '[mainThreadBindtouchend],[mainThreadCatchtouchend],' +
    '[mainThreadBindlongpress],[mainThreadCatchlongpress],' +
    '[mainThreadBindscroll],[mainThreadCatchscroll],' +
    '[mainThreadBindanimationstart],[mainThreadBindanimationend],' +
    '[mainThreadBindtransitionend],[mainThreadBindlayoutchange]',
  standalone: true,
  inputs: [
    'mainThreadBindtap',
    'mainThreadCatchtap',
    'mainThreadBindtouchstart',
    'mainThreadCatchtouchstart',
    'mainThreadBindtouchmove',
    'mainThreadCatchtouchmove',
    'mainThreadBindtouchend',
    'mainThreadCatchtouchend',
    'mainThreadBindlongpress',
    'mainThreadCatchlongpress',
    'mainThreadBindscroll',
    'mainThreadCatchscroll',
    'mainThreadBindanimationstart',
    'mainThreadBindanimationend',
    'mainThreadBindtransitionend',
    'mainThreadBindlayoutchange',
  ],
})
export class LynxMainThreadEvent implements OnChanges, OnDestroy {
  readonly #el: BaseLynxElement = inject(ElementRef).nativeElement;
  #registeredEvents: [string, string][] = [];

  mainThreadBindtap?: MaybeHandle;
  mainThreadCatchtap?: MaybeHandle;
  mainThreadBindtouchstart?: MaybeHandle;
  mainThreadCatchtouchstart?: MaybeHandle;
  mainThreadBindtouchmove?: MaybeHandle;
  mainThreadCatchtouchmove?: MaybeHandle;
  mainThreadBindtouchend?: MaybeHandle;
  mainThreadCatchtouchend?: MaybeHandle;
  mainThreadBindlongpress?: MaybeHandle;
  mainThreadCatchlongpress?: MaybeHandle;
  mainThreadBindscroll?: MaybeHandle;
  mainThreadCatchscroll?: MaybeHandle;
  mainThreadBindanimationstart?: MaybeHandle;
  mainThreadBindanimationend?: MaybeHandle;
  mainThreadBindtransitionend?: MaybeHandle;
  mainThreadBindlayoutchange?: MaybeHandle;

  ngOnChanges(changes: SimpleChanges): void {
    // ElementRef.nativeElement is our BaseLynxElement wrapper; the underlying
    // native handle that __AddEvent expects lives on its `.element` property.
    // We reach in via `any` rather than widening the public type because this
    // back-channel exists only for PAPI calls and shouldn't be part of the
    // public BaseLynxElement contract used elsewhere.
    const elementRef = (this.#el as any).element;
    if (!elementRef) return;

    for (const inputName of Object.keys(changes)) {
      const mapping = INPUT_TO_EVENT[inputName];
      if (!mapping) continue;

      const [eventType, eventName] = mapping;
      const handle = (this as any)[inputName] as MaybeHandle;

      if (isMainThreadHandle(handle)) {
        // type: 'worklet' tells the Lynx engine to invoke this handler via the
        // worklet system (runWorklet) on the main thread, NOT via the normal
        // background-thread event dispatch. _workletType: 'main-thread' ensures
        // the handler runs on the Lepus thread where it can call __AddInlineStyle,
        // __SetAttribute, etc. for 60fps animations without cross-thread latency.
        __AddEvent(elementRef, eventType, eventName, {
          type: 'worklet',
          value: { _wkltId: handle._wkltId, _workletType: 'main-thread' },
        });
        // Track (eventType, eventName) so ngOnDestroy can unregister the same
        // pair. We deliberately don't deduplicate — re-binding the same input
        // overwrites the previous registration at the native level, so a
        // duplicate entry in the array is harmless (the second cleanup is a
        // no-op).
        this.#registeredEvents.push([eventType, eventName]);
      }
    }
  }

  ngOnDestroy(): void {
    const elementRef = (this.#el as any).element;
    if (!elementRef) return;

    // Lynx's PAPI unregisters an event handler by calling __AddEvent with
    // `undefined` as the handler value — there is no separate __RemoveEvent.
    // Without this cleanup, the worklet handle would keep its registration
    // pointing at a destroyed component, and any subsequent native dispatch
    // would invoke a stale closure (or, worse, leak a reference that pins
    // the component graph).
    for (const [eventType, eventName] of this.#registeredEvents) {
      __AddEvent(elementRef, eventType, eventName, undefined);
    }
    this.#registeredEvents = [];
  }
}
