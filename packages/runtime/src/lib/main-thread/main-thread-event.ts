import {
  Directive,
  ElementRef,
  inject,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';
import { __workletMap } from '../worklet-bridge';
import type { MainThreadFnHandle } from './main-thread-fn';

/**
 * Plain functions are also accepted: the worklet build plugin turns one with
 * the 'main thread' directive into a MainThreadFnHandle at compile time, so
 * TypeScript only sees the function, and the directive registers any other
 * function itself.
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
  // A desktop browser never fires touch events, so on Lynx for Web a mouse
  // drag needs these. Native Lynx on a phone never fires them, and a mobile
  // browser only fires them after a tap, so binding both is safe.
  mainThreadBindmousedown: ['bindEvent', 'mousedown'],
  mainThreadCatchmousedown: ['catchEvent', 'mousedown'],
  mainThreadBindmousemove: ['bindEvent', 'mousemove'],
  mainThreadCatchmousemove: ['catchEvent', 'mousemove'],
  mainThreadBindmouseup: ['bindEvent', 'mouseup'],
  mainThreadCatchmouseup: ['catchEvent', 'mouseup'],
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

// IDs for the plain functions the directive registers itself. They have their
// own prefix so they never collide with the IDs mainThreadFn() gives.
let nextHandlerId = 0;

/**
 * The __AddEvent value that removes a main-thread handler: a worklet with no
 * ID, which runWorklet ignores. `undefined` works on the web, but native Lynx
 * keeps the handler: Element::RemoveEvent erases from `static_events_`, while
 * worklet handlers live in `lepus_events_` (attribute_holder.cc). React Lynx
 * removes them the same way (updateWorkletEvent in workletEvent.ts).
 */
const noHandler = (): {
  type: 'worklet';
  value: { _workletType: 'main-thread' };
} => ({ type: 'worklet', value: { _workletType: 'main-thread' } });

/** A handler the directive has passed to __AddEvent for one of its inputs. */
type Registration = {
  eventType: string;
  eventName: string;
  /** The ID the directive registered a plain function under, and releases. */
  ownId?: string;
};

/**
 * Bridges Angular template bindings like `(mainThreadBindtap)="handler"` to
 * Lynx's main-thread (Lepus) event dispatch.
 *
 * Why a dedicated directive and not the renderer's listen() path:
 * - Normal `(bindtap)` handlers run on the main thread too (listen() registers
 *   them as worklets), but each one goes through Angular's listener wrapper,
 *   which marks the view for change detection on every dispatch: too much for
 *   gesture-driven UI (scroll-tracking, drag, pinch) that mutates styles at
 *   native frame rate. Their event's targets are also plain data.
 * - The `mainThreadBind*` / `mainThreadCatch*` family registers the function
 *   itself as a *worklet* with `_workletType: 'main-thread'`, so Lynx invokes
 *   it directly, and runWorklet hands it MainThreadElement targets, whose
 *   __AddInlineStyle / __SetAttribute calls are synchronous. Angular does no
 *   work per event.
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
    '[mainThreadBindmousedown],[mainThreadCatchmousedown],' +
    '[mainThreadBindmousemove],[mainThreadCatchmousemove],' +
    '[mainThreadBindmouseup],[mainThreadCatchmouseup],' +
    '[mainThreadBindlongpress],[mainThreadCatchlongpress],' +
    '[mainThreadBindscroll],[mainThreadCatchscroll],' +
    '[mainThreadBindanimationstart],[mainThreadBindanimationend],' +
    '[mainThreadBindtransitionend],[mainThreadBindlayoutchange]',
  inputs: [
    'mainThreadBindtap',
    'mainThreadCatchtap',
    'mainThreadBindtouchstart',
    'mainThreadCatchtouchstart',
    'mainThreadBindtouchmove',
    'mainThreadCatchtouchmove',
    'mainThreadBindtouchend',
    'mainThreadCatchtouchend',
    'mainThreadBindmousedown',
    'mainThreadCatchmousedown',
    'mainThreadBindmousemove',
    'mainThreadCatchmousemove',
    'mainThreadBindmouseup',
    'mainThreadCatchmouseup',
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
  readonly #registrations = new Map<string, Registration>();

  mainThreadBindtap?: MaybeHandle;
  mainThreadCatchtap?: MaybeHandle;
  mainThreadBindtouchstart?: MaybeHandle;
  mainThreadCatchtouchstart?: MaybeHandle;
  mainThreadBindtouchmove?: MaybeHandle;
  mainThreadCatchtouchmove?: MaybeHandle;
  mainThreadBindtouchend?: MaybeHandle;
  mainThreadCatchtouchend?: MaybeHandle;
  mainThreadBindmousedown?: MaybeHandle;
  mainThreadCatchmousedown?: MaybeHandle;
  mainThreadBindmousemove?: MaybeHandle;
  mainThreadCatchmousemove?: MaybeHandle;
  mainThreadBindmouseup?: MaybeHandle;
  mainThreadCatchmouseup?: MaybeHandle;
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
      this.#release(inputName);

      const registration: Registration = { eventType, eventName };
      let workletId: string | undefined;
      if (isMainThreadHandle(handle)) {
        workletId = handle._wkltId;
      } else if (typeof handle === 'function') {
        // A function the build didn't wrap, such as a method without the
        // directive. This copy of the app runs on the main thread, where the
        // function already lives, so registering it is all a handle would do.
        // Skipping it would leave the element silently without a handler.
        workletId = '__angular_mts_handler_' + nextHandlerId++;
        registration.ownId = workletId;
        __workletMap[workletId] = handle;
      }

      if (workletId === undefined) {
        // null or undefined removes the handler, as unbinding a DOM listener
        // would. Leaving it registered would keep the old handler firing.
        if (this.#registrations.delete(inputName)) {
          __AddEvent(elementRef, eventType, eventName, noHandler());
        }
        continue;
      }

      // type: 'worklet' tells the Lynx engine to invoke this handler via the
      // worklet system (runWorklet) on the main thread, NOT via the
      // background-thread event dispatch Lynx defaults to. _workletType:
      // 'main-thread' ensures the handler runs on the Lepus thread where it can
      // call __AddInlineStyle, __SetAttribute, etc. for 60fps animations
      // without cross-thread latency.
      // A new handler for the same event replaces the old one natively.
      __AddEvent(elementRef, eventType, eventName, {
        type: 'worklet',
        value: { _wkltId: workletId, _workletType: 'main-thread' },
      });
      this.#registrations.set(inputName, registration);
    }
  }

  ngOnDestroy(): void {
    const elementRef = (this.#el as any).element;
    if (!elementRef) return;

    // Lynx's PAPI has no __RemoveEvent: __AddEvent replaces the handler, here
    // with one that does nothing (see noHandler). Without this cleanup, the
    // worklet handle would keep its registration pointing at a destroyed
    // component, and any subsequent native dispatch would invoke a stale
    // closure (or, worse, leak a reference that pins the component graph).
    for (const [inputName, { eventType, eventName }] of this.#registrations) {
      __AddEvent(elementRef, eventType, eventName, noHandler());
      this.#release(inputName);
    }
    this.#registrations.clear();
  }

  /**
   * Unregisters the plain function the directive registered for an input, if
   * any, so replacing or removing it doesn't leave the old one in the registry.
   */
  #release(inputName: string): void {
    const ownId = this.#registrations.get(inputName)?.ownId;
    if (ownId !== undefined) {
      delete __workletMap[ownId];
    }
  }
}
