/**
 * LynxSplashScreen under the testing library: it keeps whether the splash
 * screen is up in memory, as LynxLocalStorage keeps its values, and render()
 * hides it as bootstrapApplication() does, so a spec can check when the app
 * lets it go.
 */

import { Component, inject } from '@angular/core';
import { RouterOutlet, type Routes } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxSplashScreen,
  provideRouter,
  provideSplashScreen,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { render, screen, waitForUpdate } from './index.js';

@Component({
  selector: 'home-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Home</text>`,
})
class HomePage {}

const routes: Routes = [{ path: '', component: HomePage }];

@Component({
  selector: 'splash-app',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `<router-outlet />`,
})
class App {
  readonly splash = inject(LynxSplashScreen);
}

describe('LynxSplashScreen in specs', () => {
  it('is hidden at the first frame without provideSplashScreen()', async () => {
    const { componentRef } = await render(App, {
      providers: [provideRouter(routes)],
    });
    expect(componentRef.instance.splash.visible()).toBe(false);
  });

  it("is hidden once the router's first screen is there", async () => {
    const { componentRef } = await render(App, {
      providers: [provideRouter(routes), provideSplashScreen()],
    });
    for (let i = 0; i < 5 && !screen.queryByText('Home'); i++) {
      await waitForUpdate();
    }
    await waitForUpdate();

    expect(screen.getByText('Home')).toBeTruthy();
    expect(componentRef.instance.splash.visible()).toBe(false);
  });

  it('waits for the app with manual hiding', async () => {
    const { componentRef } = await render(App, {
      providers: [
        provideRouter(routes),
        provideSplashScreen({ hide: 'manual' }),
      ],
    });
    const { splash } = componentRef.instance;
    expect(splash.visible()).toBe(true);

    splash.hide();

    expect(splash.visible()).toBe(false);
  });
});
