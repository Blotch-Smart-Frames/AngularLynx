import { Subject } from 'rxjs';
import type { GlobalExposureEvent } from './exposure.types';

export type GlobalExposureBatch = {
  type: 'exposure' | 'disexposure';
  events: GlobalExposureEvent;
};

/**
 * Every batch of global exposure events, on whichever thread this module runs.
 * LynxGlobalExposure subscribes.
 */
export const globalExposureBatches = new Subject<GlobalExposureBatch>();

const FORWARD_EVENT = 'AngularLynx.GlobalExposure';

/**
 * Lynx reports global exposure (elements with an `exposure-id` entering or
 * leaving the screen) only on the background thread, through
 * GlobalEventEmitter. The main thread draws the UI, so its LynxGlobalExposure
 * signals never changed. The background thread now publishes each batch locally
 * and forwards it to the main thread, through the same cross-thread event
 * channel as the worklet RPC in global-callbacks.ts: the background thread
 * dispatches on getCoreContext(), and the main thread listens on getJSContext().
 *
 * Installed once at module load rather than by LynxGlobalExposure, because a
 * component the router creates after a tap exists only on the main thread, so
 * the background thread might never construct the service.
 */
const installGlobalExposureBridge = (): void => {
  if (typeof lynx === 'undefined') return;
  try {
    if (__MAIN_THREAD__) {
      (lynx as any)
        .getJSContext?.()
        ?.addEventListener(FORWARD_EVENT, (event: { data: string }) =>
          globalExposureBatches.next(JSON.parse(event.data)),
        );
      return;
    }
    const emitter = lynx.getJSModule?.('GlobalEventEmitter');
    if (!emitter?.addListener) return;
    for (const type of ['exposure', 'disexposure'] as const) {
      emitter.addListener(type, (...args: unknown[]) => {
        const batch = { type, events: args[0] as GlobalExposureEvent };
        globalExposureBatches.next(batch);
        (lynx as any).getCoreContext?.()?.dispatchEvent({
          type: FORWARD_EVENT,
          data: JSON.stringify(batch),
        });
      });
    }
  } catch {
    // The thread contexts and GlobalEventEmitter may be missing outside a real
    // Lynx host. Global exposure then simply never fires.
  }
};

installGlobalExposureBridge();
