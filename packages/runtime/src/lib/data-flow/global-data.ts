import { Injectable, signal } from '@angular/core';
import type { GlobalData } from './data-flow.types';

@Injectable({ providedIn: 'root' })
export class LynxGlobalData {
  // Seeded from lynx.__globalProps at construction time; updated via
  // onGlobalPropsChanged. A host that never sets global props leaves
  // __globalProps undefined, so fall back to an empty object: readers like
  // LynxTheme index into it.
  readonly globalData = signal<GlobalData>(
    ((typeof lynx !== 'undefined' && lynx.__globalProps) || {}) as GlobalData,
  );

  constructor() {
    // Only subscribe on the background thread — global props are a host→JS
    // data channel that only fires on the background thread. The main thread
    // check guards against running in the Lepus context where getJSModule
    // doesn't exist and GlobalEventEmitter is not available.
    if (
      typeof lynx === 'undefined' ||
      (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) ||
      typeof lynx.getJSModule !== 'function'
    )
      return;
    const emitter = lynx.getJSModule('GlobalEventEmitter');
    if (!emitter?.addListener) return;
    emitter.addListener('onGlobalPropsChanged', (...args: unknown[]) =>
      this.globalData.set((args[0] ?? {}) as GlobalData),
    );
  }
}
