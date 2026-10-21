import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { GlobalData } from './data-flow.types';
import { globalDataUpdates } from './host-updates';

@Injectable({ providedIn: 'root' })
export class LynxGlobalData {
  // Seeded from lynx.__globalProps at construction time; updated when the host
  // changes it. A host that never sets global props leaves __globalProps
  // undefined, so fall back to an empty object: readers like LynxTheme index
  // into it.
  readonly globalData = signal<GlobalData>(
    ((typeof lynx !== 'undefined' && lynx.__globalProps) || {}) as GlobalData,
  );

  constructor() {
    // The engine's update callbacks publish the merged data on each thread
    // (see host-updates.ts), so this works on the main thread, which draws
    // the UI, as well as on the background thread. Unsubscribe when the app
    // is destroyed, so an HMR re-bootstrap doesn't leave the old app listening.
    const subscription = globalDataUpdates.subscribe((data) =>
      this.globalData.set(data),
    );
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }
}
