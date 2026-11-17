import { Injectable, InjectionToken, inject } from '@angular/core';

/** What modules/app-startup-module declares natively, written out for TypeScript. */
export interface NativeAppStartup {
  reportInitiallyDrawn(): void;
  reportFullyDrawn(): void;
  reportMountStart(): void;
  reportMountEnd(): void;
}

/**
 * The benchmark's marks, emitted by the local Expo module as os_signpost events on iOS (and
 * `Activity.reportFullyDrawn()` on Android), as the reference app's module does.
 */
@Injectable({ providedIn: 'root' })
export class AppStartup {
  /** The native module, or null where it is not in the build (a test in Node). */
  static readonly NATIVE = new InjectionToken<NativeAppStartup | null>('AppStartup.native', {
    // Required lazily, as Angular Native's guide to Expo modules does: a static import of 'expo'
    // pulls in react-native, which a test in Node cannot load.
    factory: () =>
      typeof require === 'function'
        ? (require('expo') as typeof import('expo')).requireOptionalNativeModule<NativeAppStartup>(
            'AppStartupModule',
          )
        : null,
  });

  readonly #native = inject(AppStartup.NATIVE);

  reportInitiallyDrawn(): void {
    this.#native?.reportInitiallyDrawn();
  }

  reportFullyDrawn(): void {
    this.#native?.reportFullyDrawn();
  }

  reportMountStart(): void {
    this.#native?.reportMountStart();
  }

  reportMountEnd(): void {
    this.#native?.reportMountEnd();
  }
}
