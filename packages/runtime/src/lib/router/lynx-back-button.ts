import { Location, LocationStrategy } from '@angular/common';
import { effect, inject, Injectable } from '@angular/core';
import { LynxNativeModule } from '../native-module/native-module';
import { LynxLocationStrategy } from './lynx-location-strategy';

/**
 * The native module and global event of the Android app that
 * `ng build --platform android` makes (`ShellModule.kt` in
 * `packages/native/templates/android`).
 */
const SHELL_MODULE = 'AngularLynxShell';
const BACK_EVENT = 'angularLynxBack';

type ShellModule = {
  setBackHandlerEnabled(enabled: boolean): unknown;
};

type GlobalEventEmitter = {
  addListener(name: string, listener: () => void): unknown;
};

/**
 * Connects the Android back button to the router, so that it goes back a
 * screen, as the browser's back button does in a web app, and leaves the app
 * from the first one.
 *
 * Android decides whether an app handles back when the gesture starts, before
 * JavaScript could answer, so the shell can't ask the app each time. Instead
 * back is Android's (it leaves the app) until the app enables the shell's
 * handler, and while it's enabled each press arrives as the `angularLynxBack`
 * global event. This keeps the handler enabled while the router has a screen to
 * go back to, and turns each press into `Location.back()`. The router then
 * navigates as for the browser's back button, running guards and resolvers.
 *
 * Other hosts (the iOS app, Lynx Explorer, the web preview) have no
 * `AngularLynxShell` module and never send the event, so this does nothing
 * there. An app with its own `LocationStrategy` keeps Android's back, because
 * only `LynxLocationStrategy` says whether there's somewhere to go back to.
 *
 * Created by `provideRouter()`.
 */
@Injectable({ providedIn: 'root' })
export class LynxBackButton {
  constructor() {
    const strategy = inject(LocationStrategy);
    if (!(strategy instanceof LynxLocationStrategy)) return;
    const location = inject(Location);
    const modules = inject(LynxNativeModule);

    // On the main thread, where Angular runs, both are proxies whose calls go
    // through the background thread and return promises. A host without the
    // module rejects the call, and then never gets another.
    const shell = modules.getNativeModule(SHELL_MODULE) as
      | ShellModule
      | undefined;
    let hasShell = true;
    effect(() => {
      const enabled = strategy.canGoBack();
      if (!hasShell) return;
      Promise.resolve()
        .then(() => shell?.setBackHandlerEnabled(enabled))
        .catch(() => (hasShell = false));
    });

    const emitter =
      modules.getJSModule<GlobalEventEmitter>('GlobalEventEmitter');
    Promise.resolve()
      .then(() => emitter?.addListener(BACK_EVENT, () => location.back()))
      .catch(() => {
        // Without a background thread there are no global events to hear.
      });
  }
}
