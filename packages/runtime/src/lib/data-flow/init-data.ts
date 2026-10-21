import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { InitData } from './data-flow.types';
import { initDataUpdates } from './host-updates';

@Injectable({ providedIn: 'root' })
export class LynxInitData {
  // Seeded from lynx.__initData at construction time; updated when the host sends new data.
  // The runtime sets __initData from renderPage on the main thread and from the
  // loadCard params on the background thread (see global-callbacks.ts). Outside
  // Lynx, or before either has run, fall back to an empty object so reads like
  // initData().userId don't throw. __initData is not declared in @lynx-js/types,
  // so we access it via any.
  readonly initData = signal<InitData>(
    ((typeof lynx !== 'undefined' && (lynx as any).__initData) ||
      {}) as InitData,
  );

  constructor() {
    // The engine's update callbacks publish the merged data on each thread
    // (see host-updates.ts), so this works on the main thread, which draws
    // the UI, as well as on the background thread. Unsubscribe when the app
    // is destroyed, so an HMR re-bootstrap doesn't leave the old app listening.
    const subscription = initDataUpdates.subscribe((data) =>
      this.initData.set(data),
    );
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }
}
