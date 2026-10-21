import { DestroyRef, inject, Injectable, signal } from '@angular/core';
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
    lynx.stopExposure(options);
    this.active.set(false);
  }

  resumeExposure(): void {
    if (typeof lynx === 'undefined') return;
    lynx.resumeExposure();
    this.active.set(true);
  }

  setObserverFrameRate(options?: ObserverFrameRateOptions): void {
    if (typeof lynx === 'undefined') return;
    lynx.setObserverFrameRate(options);
  }
}
