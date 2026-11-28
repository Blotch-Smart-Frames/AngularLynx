import { Injectable } from '@angular/core';
import { Application, isAndroid, isIOS } from '@nativescript/core';

/**
 * The benchmark's marks, emitted as os_signpost events by the app's own Swift class
 * (App_Resources/iOS/src/AppStartup.swift), as the reference app's native module does, and
 * through `Activity.reportFullyDrawn()` on Android. NativeScript calls native code from
 * JavaScript directly, so each is a method call, not a bridge.
 */
@Injectable({ providedIn: 'root' })
export class Startup {
  reportFullyDrawn(): void {
    if (isIOS) AppStartup.reportFullyDrawn();
    if (isAndroid) Application.android.foregroundActivity?.reportFullyDrawn();
  }

  reportMountStart(): void {
    if (isIOS) AppStartup.reportMountStart();
  }

  reportMountEnd(): void {
    if (isIOS) AppStartup.reportMountEnd();
  }
}
