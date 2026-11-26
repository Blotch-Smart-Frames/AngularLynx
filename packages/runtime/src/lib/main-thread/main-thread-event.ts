import {
  Directive,
  ElementRef,
  inject,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';
import { __workletMap, transformParams } from '../worklet-bridge';
import type { MainThreadFnHandle } from './main-thread-fn';

/**
 * Plain functions are also accepted: the worklet build plugin turns one with
 * the 'main thread' directive into a MainThreadFnHandle at compile time, so
 * TypeScript only sees the function, and the directive runs any other
 * function itself.
 */
type MaybeHandle =
  | MainThreadFnHandle
  | ((...args: any[]) => any)
  | undefined
  | null;

/**
 * The directive's inputs. Each is `mainThread` followed by the Lynx listener
 * name it binds, capitalized: `mainThreadBindtap` listens as `(bindtap)`
 * does, and `mainThreadCatchscroll` as `(catchscroll)`, so the element's
 * `bind`/`catch` handling (see LynxElement.addEventListener) applies to a
 * script as to any listener.
 */
const INPUTS = [
  'mainThreadBindtap',
  'mainThreadCatchtap',
  'mainThreadBindtouchstart',
  'mainThreadCatchtouchstart',
  'mainThreadBindtouchmove',
  'mainThreadCatchtouchmove',
  'mainThreadBindtouchend',
  'mainThreadCatchtouchend',
  // A desktop browser never fires touch events, so on Lynx for Web a mouse
  // drag needs these. Native Lynx on a phone never fires them, and a mobile
  // browser only fires them after a tap, so binding both is safe.
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
] as const;

const INPUT_SET: ReadonlySet<string> = new Set(INPUTS);

/**
 * The listener name an input binds: `bindtap` for `mainThreadBindtap`.
 */
const listenerNameOf = (inputName: string): string => {
  const name = inputName.slice('mainThread'.length);
  return name.charAt(0).toLowerCase() + name.slice(1);
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
 * - Normal `(bindtap)` handlers run on the main thread too, but each one goes
 *   through Angular's listener wrapper, which marks the view for change
 *   detection on every dispatch: too much for gesture-driven UI
 *   (scroll-tracking, drag, pinch) that mutates styles at native frame rate.
 *   Their event's targets are also plain data.
 * - The `mainThreadBind*` / `mainThreadCatch*` family runs the function
 *   itself, with no Angular wrapper, and hands it MainThreadElement targets
 *   (see transformParams), whose __AddInlineStyle / __SetAttribute calls are
 *   synchronous. Angular does no work per event.
 * - These inputs cannot be expressed as @Output() because Angular would route
 *   them through its own event subscription system and the function would
 *   never be run as a script.
 *
 * The worklet plugin (in rsbuild-plugin-angular-lynx) rewrites any function
 * annotated with `'main thread'` directive into a `MainThreadFnHandle`
 * carrying a stable `_wkltId`, registered in __workletMap. A handle is looked
 * up there as the event fires, as runWorklet looks up a worklet.
 *
 * Each script is a listener on the element (see LynxElement.addEventListener),
 * beside the template's `(bindtap)` and anything added later, such as an
 * IntersectionObserver's scroll listener: Lynx keeps one native handler per
 * event name on an element, and the element's handler runs every listener for
 * the event. The directive used to register its script with `__AddEvent`
 * itself and keep the element's own listeners off the event, so a `(bindtap)`
 * beside a `[mainThreadBindtap]` never ran, and an observer inside a
 * `[mainThreadBindscroll]` scroll-view never heard it scroll (issue #471).
 * Sharing the handler also keeps the script registered when the element's
 * native ref is rebuilt, and removes it the way the element's own listeners
 * are removed.
 */
@Directive({
  // The selector and inputs are INPUTS spelled out: Angular's compiler reads
  // them as literals.
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
  /** Stops the listener each input has on the element. */
  readonly #listening = new Map<string, () => void>();

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
    for (const inputName of Object.keys(changes)) {
      if (!INPUT_SET.has(inputName)) continue;
      // The old script stops listening first, whether or not a new one takes
      // its place: null or undefined removes the handler, as unbinding a DOM
      // listener would, and leaving it would keep the old script firing.
      this.#listening.get(inputName)?.();
      this.#listening.delete(inputName);

      const handle = (this as Record<string, unknown>)[
        inputName
      ] as MaybeHandle;
      if (!isMainThreadHandle(handle) && typeof handle !== 'function') continue;
      this.#listening.set(
        inputName,
        this.#el.addEventListener(listenerNameOf(inputName), (event) =>
          runScript(handle, event),
        ),
      );
    }
  }

  ngOnDestroy(): void {
    // A script left listening would keep running for a destroyed component,
    // and hold it through the element's listeners.
    for (const stop of this.#listening.values()) stop();
    this.#listening.clear();
  }
}

/**
 * Runs a script for an event the element dispatched to it. The script gets
 * what runWorklet gives a worklet: a copy of the event whose targets are
 * MainThreadElements (see transformParams). The element's other listeners get
 * the event itself, as `$event`, so the copy keeps the script's element
 * handles out of the plain data they see.
 *
 * A handle's function is looked up as the event fires, as runWorklet does:
 * a component's 'main thread' method is released when the component is
 * destroyed (see mainThreadFn), which may come before this directive's own
 * destroy.
 *
 * It returns what the script returns, as runWorklet did when the script had
 * the native handler: native reads an `eventReturnResult` from it
 * (TouchEventHandler::FireElementWorklet), and the element's handler returns
 * what its last listener returned.
 */
const runScript = (
  handle: MainThreadFnHandle | ((...args: any[]) => any),
  event: unknown,
): unknown => {
  const fn = isMainThreadHandle(handle) ? __workletMap[handle._wkltId] : handle;
  if (!fn) {
    if (__DEV__) {
      console.warn(
        `[angular-lynx] Worklet not found: ${(handle as MainThreadFnHandle)._wkltId}`,
      );
    }
    return undefined;
  }
  return fn(transformParams(event));
};
