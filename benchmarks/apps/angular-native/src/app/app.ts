import { Component, afterNextRender, inject } from '@angular/core';
import { SafeAreaProvider } from '@ng-native/components';
import { StatusBar } from '@ng-native/device';
import { splashScreen } from '@ng-native/expo/splash-screen';
import { NativeStackOutlet } from '@ng-native/router';
import { AppStartup } from './startup/app-startup.ts';

/** The reference's root _layout: a native stack, with the tabs as its first screen. */
@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet, SafeAreaProvider],
  template: `
    <safe-area-provider>
      <native-stack-outlet />
    </safe-area-provider>
  `,
  styles: `
    :host {
      flex: 1;
    }
  `,
})
export class App {
  constructor() {
    // The reference's screens are white whatever the system appearance, so dark icons always.
    inject(StatusBar).set({ style: 'dark' });

    const startup = inject(AppStartup);
    afterNextRender(() => {
      // expo-splash-screen hides itself when React Native posts RCTContentDidAppearNotification.
      // Left to that, the splash stayed up about 5 s after TTFD on the simulator, covering rows
      // already drawn. Angular Native's docs hide it from the app instead; hiding it after the
      // first commit is the moment the reference's splash goes, its first mount.
      void splashScreen.hide();
      // The reference reports its first frame from the root layout's first effect, a frame
      // later. The harness takes the first frame from Instruments' App Launch instead, so this
      // is kept only so the app makes the same native call the reference does.
      requestAnimationFrame(() => startup.reportInitiallyDrawn());
    });
  }
}
