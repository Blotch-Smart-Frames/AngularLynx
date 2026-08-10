import { Injectable, signal } from '@angular/core';
import type {
  GlobalExposureEvent,
  ObserverFrameRateOptions,
} from './exposure.types';

@Injectable({ providedIn: 'root' })
export class LynxGlobalExposure {
  // Updated each time the Lynx engine fires a batched 'exposure' event via
  // GlobalEventEmitter. Contains the most recent batch of exposure details.
  readonly exposures = signal<GlobalExposureEvent>([]);

  // Updated each time the Lynx engine fires a batched 'disexposure' event.
  readonly disexposures = signal<GlobalExposureEvent>([]);

  // Whether the global exposure detection system is currently active.
  // Lynx allows pausing/resuming via stopExposure()/resumeExposure().
  readonly active = signal<boolean>(true);

  constructor() {
    // GlobalEventEmitter is only available on the background thread (BTS context).
    // On the main thread, getJSModule may return null or a stub without addListener,
    // and calling it crashes the main-thread Angular app — which handles rendering.
    // Since the main thread app stays broken, all subsequent route renders are blank.
    if (
      typeof lynx === 'undefined' ||
      (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__)
    )
      return;
    const emitter = lynx.getJSModule('GlobalEventEmitter');
    if (!emitter?.addListener) return;
    emitter.addListener('exposure', (...args: unknown[]) =>
      this.exposures.set(args[0] as GlobalExposureEvent),
    );
    emitter.addListener('disexposure', (...args: unknown[]) =>
      this.disexposures.set(args[0] as GlobalExposureEvent),
    );
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
