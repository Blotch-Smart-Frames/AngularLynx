import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { callOnBackground } from '../background-call';
import { globalExposureBatches } from './global-exposure-bridge';
import type {
  GlobalExposureEvent,
  ObserverFrameRateOptions,
} from './exposure.types';

@Injectable({ providedIn: 'root' })
export class LynxGlobalExposure {
  // The most recent batch of elements that came on screen. Lynx batches them
  // and reports them through GlobalEventEmitter's 'exposure' event.
  readonly exposures = signal<GlobalExposureEvent>([]);

  // The most recent batch of elements that left the screen ('disexposure').
  readonly disexposures = signal<GlobalExposureEvent>([]);

  // Whether the global exposure detection system is currently active.
  // Lynx allows pausing/resuming via stopExposure()/resumeExposure().
  readonly active = signal<boolean>(true);

  constructor() {
    // Lynx reports these events only on the background thread. The bridge
    // forwards them to the main thread, which draws the UI, and publishes them
    // on both (see global-exposure-bridge.ts). Unsubscribe when the app is
    // destroyed, so an HMR re-bootstrap doesn't leave the old app listening.
    const subscription = globalExposureBatches.subscribe(({ type, events }) =>
      (type === 'exposure' ? this.exposures : this.disexposures).set(events),
    );
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  /**
   * Pauses global exposure detection. Elements with exposure-id stop generating
   * exposure/disexposure GlobalEventEmitter events. Element-level
   * binduiappear/binduidisappear events continue to fire.
   */
  stopExposure(options?: { sendEvent: boolean }): void {
    if (typeof lynx === 'undefined') return;
    if (typeof lynx.stopExposure === 'function') {
      lynx.stopExposure(options);
    } else {
      this.#relay(callOnBackground('stopExposure', options));
    }
    this.active.set(false);
  }

  resumeExposure(): void {
    if (typeof lynx === 'undefined') return;
    if (typeof lynx.resumeExposure === 'function') {
      lynx.resumeExposure();
    } else {
      this.#relay(callOnBackground('resumeExposure'));
    }
    this.active.set(true);
  }

  /**
   * Sets how often Lynx checks for exposure. Only the background thread's
   * `lynx` has setObserverFrameRate, so a call from an event handler, which
   * runs on the main thread, goes through the background thread (see
   * background-call.ts). Resolves once it's applied.
   */
  setObserverFrameRate(options?: ObserverFrameRateOptions): Promise<void> {
    if (typeof lynx === 'undefined') return Promise.resolve();
    return callOnBackground('setObserverFrameRate', options);
  }

  /**
   * Web-core's main thread has no stopExposure or resumeExposure, so there the
   * call goes through the background thread (see background-call.ts). These
   * methods return nothing, so report a failed relay rather than leave an
   * unhandled rejection.
   */
  #relay(call: Promise<void>): void {
    call.catch((error: unknown) => console.error(error));
  }
}
