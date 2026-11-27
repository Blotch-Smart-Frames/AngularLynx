import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** What the app's own plugin (ios/App/App/AppStartupPlugin.swift) declares. */
interface AppStartupPlugin {
  reportFullyDrawn(): Promise<void>;
  reportMountStart(): Promise<void>;
  reportMountEnd(): Promise<void>;
}

/**
 * The app's Capacitor plugin, registered by its view controller (ios/App/App/ViewController.swift).
 * A call posts a message from the web view to native, which emits the mark; the call returns
 * nothing (`CAPPluginReturnNone`), so nothing waits on it.
 */
const native = registerPlugin<AppStartupPlugin>('AppStartup');

/**
 * The benchmark's marks, emitted as os_signpost events by the app's plugin, as the reference app's
 * native module does. In a browser (`ng serve`) there's no plugin, so they're dropped.
 */
@Injectable({ providedIn: 'root' })
export class Startup {
  readonly #native = Capacitor.isNativePlatform() ? native : null;

  reportFullyDrawn(): void {
    void this.#native?.reportFullyDrawn();
  }

  reportMountStart(): void {
    void this.#native?.reportMountStart();
  }

  reportMountEnd(): void {
    void this.#native?.reportMountEnd();
  }
}
