import { Injectable, signal } from '@angular/core';
import type { InitData } from './data-flow.types';

@Injectable({ providedIn: 'root' })
export class LynxInitData {
  // Seeded from lynx.__initData at construction time; updated reactively via onDataChanged.
  // __initData is not declared in @lynx-js/types, so we access it via any.
  readonly initData = signal<InitData>(
    typeof lynx !== 'undefined'
      ? ((lynx as any).__initData as InitData)
      : ({} as InitData),
  );

  constructor() {
    // Same background-thread-only guard as LynxGlobalData — GlobalEventEmitter
    // is a background-thread API. See global-data.ts for details.
    if (
      typeof lynx === 'undefined' ||
      (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) ||
      typeof lynx.getJSModule !== 'function'
    )
      return;
    const emitter = lynx.getJSModule('GlobalEventEmitter');
    if (!emitter?.addListener) return;
    emitter.addListener('onDataChanged', (...args: unknown[]) =>
      this.initData.set(args[0] as InitData),
    );
  }
}
