// @vitest-environment jsdom
import '@angular/compiler';
import {
  Component,
  EnvironmentInjector,
  inject,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { type CanActivateFn, Router } from '@angular/router';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { provideRouter } from '../router/lynx-router';
import {
  hideSplashScreenUnlessProvided,
  LynxSplashScreen,
  provideSplashScreen,
} from './index';

/**
 * Stands in for the element tree's flushes: hide() waits for the next one,
 * which a test runs with flush().
 */
const { flushes } = vi.hoisted(() => ({ flushes: [] as (() => void)[] }));
vi.mock('../lynx-element/lynx-element', () => ({
  afterNextFlush: (callback: () => void) => flushes.push(callback),
}));
const flush = () => {
  for (const callback of flushes.splice(0)) callback();
};

/**
 * Lets the router's navigation and the microtasks after it run.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));

/**
 * The shells' AngularLynxShell module, as the background thread sees it.
 * Unit tests run as the background thread, so the service calls it directly.
 */
let hideSplashScreen: ReturnType<typeof vi.fn>;

@Component({ template: '' })
class Screen {}

/** A guard the test lets through when it's ready. */
let release: () => void;
const waitForRelease: CanActivateFn = () =>
  new Promise<boolean>((resolve) => (release = () => resolve(true)));

const routes = [
  { path: '', component: Screen },
  { path: 'slow', component: Screen, canActivate: [waitForRelease] },
  {
    path: 'guarded',
    component: Screen,
    canActivate: [() => inject(Router).parseUrl('/slow')],
  },
  { path: 'broken', loadComponent: () => Promise.reject(new Error('offline')) },
];

describe('LynxSplashScreen', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    flushes.length = 0;
    hideSplashScreen = vi.fn();
    vi.stubGlobal('NativeModules', { AngularLynxShell: { hideSplashScreen } });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  const create = (...providers: unknown[]) => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ...(providers as [])],
    });
    return TestBed.inject(LynxSplashScreen);
  };

  describe('hide()', () => {
    it('is visible until hidden', () => {
      const splash = create();
      expect(splash.visible()).toBe(true);

      splash.hide();

      expect(splash.visible()).toBe(false);
    });

    it("asks the shell once the app's latest changes are flushed", async () => {
      const splash = create();
      splash.hide();
      await settle();
      expect(hideSplashScreen).not.toHaveBeenCalled();

      flush();
      await settle();

      expect(hideSplashScreen).toHaveBeenCalledTimes(1);
    });

    it('does nothing the second time', async () => {
      const splash = create();
      splash.hide();
      splash.hide();
      flush();
      await settle();

      expect(hideSplashScreen).toHaveBeenCalledTimes(1);
    });

    it('only records it in the testing library, which has no shell or flushes', () => {
      vi.stubGlobal('lynxTestingEnv', {});
      const splash = create();

      splash.hide();

      expect(splash.visible()).toBe(false);
      expect(flushes).toEqual([]);
    });

    it('only records it on a host without the shell, as in Lynx Explorer and the web', async () => {
      vi.stubGlobal('NativeModules', {});
      const splash = create();

      splash.hide();
      flush();
      await settle();

      expect(splash.visible()).toBe(false);
    });
  });

  describe('hideSplashScreenUnlessProvided()', () => {
    const appRef = () => ({ injector: TestBed.inject(EnvironmentInjector) });

    it('hides it without provideSplashScreen()', () => {
      const splash = create();
      hideSplashScreenUnlessProvided(appRef() as never);
      expect(splash.visible()).toBe(false);
    });

    it('leaves it to the app with provideSplashScreen()', () => {
      const splash = create(provideSplashScreen({ hide: 'manual' }));
      hideSplashScreenUnlessProvided(appRef() as never);
      expect(splash.visible()).toBe(true);
    });
  });

  describe("provideSplashScreen({ hide: 'manual' })", () => {
    it('waits for the app, whatever the router does', async () => {
      const splash = create(
        provideRouter(routes),
        provideSplashScreen({ hide: 'manual' }),
      );
      await TestBed.inject(Router).navigateByUrl('/');
      await settle();

      expect(splash.visible()).toBe(true);
    });
  });

  describe("provideSplashScreen({ hide: 'afterFirstNavigation' })", () => {
    /**
     * Starts the app with the router, and navigates to `url` first.
     */
    const start = (url: string, hide = provideSplashScreen()) => {
      const splash = create(provideRouter(routes), hide);
      const router = TestBed.inject(Router);
      void router.navigateByUrl(url);
      return { splash, router };
    };

    it('is the default', async () => {
      const { splash } = start('/');
      await settle();
      expect(splash.visible()).toBe(false);
    });

    it("waits for the first navigation's guards", async () => {
      const { splash } = start(
        '/slow',
        provideSplashScreen({ hide: 'afterFirstNavigation' }),
      );
      await settle();
      expect(splash.visible()).toBe(true);

      release();
      await settle();

      expect(splash.visible()).toBe(false);
    });

    it('follows a redirect from a guard to the screen it leads to', async () => {
      const { splash, router } = start('/guarded');
      await settle();
      // The guard's redirect canceled the first navigation, and its own
      // is held by the next guard.
      expect(router.url).not.toBe('/slow');
      expect(splash.visible()).toBe(true);

      release();
      await settle();

      expect(router.url).toBe('/slow');
      expect(splash.visible()).toBe(false);
    });

    it('goes when the first navigation fails, rather than stay up', async () => {
      const { splash } = start('/broken');
      await settle();
      expect(splash.visible()).toBe(false);
    });

    it('stays hidden after the app hid it first, and asks the shell once', async () => {
      const { splash } = start('/slow');
      splash.hide();
      release();
      await settle();
      flush();
      await settle();

      expect(splash.visible()).toBe(false);
      expect(hideSplashScreen).toHaveBeenCalledTimes(1);
    });

    it('needs the router', () => {
      expect(() => create(provideSplashScreen())).toThrow(
        /needs the router: add provideRouter\(routes\)/,
      );
    });

    it('stops listening when the app is destroyed', async () => {
      const { splash } = start('/slow');
      await settle();
      TestBed.resetTestingModule();
      release();
      await settle();

      expect(splash.visible()).toBe(true);
    });
  });
});
