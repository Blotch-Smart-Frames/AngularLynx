// @vitest-environment jsdom
import '@angular/compiler';
import { LocationStrategy } from '@angular/common';
import {
  Component,
  ErrorHandler,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { Router, type Routes } from '@angular/router';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { type DeepLinkRoute, provideDeepLinkRoute } from './deep-links';
import {
  carryOverLocation,
  LynxLocationStrategy,
} from './lynx-location-strategy';
import { provideRouter } from './lynx-router';

@Component({ template: '' })
class Screen {}

const routes: Routes = [
  { path: '', component: Screen },
  { path: 'orders/:id', component: Screen },
  { path: 'renamed', component: Screen },
];

/** The links to the app the shell keeps until they're taken. */
let waiting: string[];
/** The global events the shell would send, by name. */
let listeners: Record<string, () => void>;

/**
 * Stands in for an app `ng build --platform` made, started by
 * `initialURL` if it's given.
 */
const stubHost = (initialURL?: string) => {
  vi.stubGlobal('NativeModules', {
    AngularLynxLinking: {
      takeURLs: (done: (result: object) => void) =>
        done({ urls: waiting.splice(0) }),
    },
  });
  vi.stubGlobal('lynx', {
    __globalProps: initialURL === undefined ? {} : { initialURL },
    getJSModule: (name: string) =>
      name === 'GlobalEventEmitter'
        ? {
            addListener: (event: string, fn: () => void) =>
              (listeners[event] = fn),
          }
        : undefined,
  });
};

/**
 * Starts the app as `bootstrapApplication` would, and returns its router.
 */
const start = (...providers: unknown[]) => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      ...(providers as []),
    ],
  });
  const router = TestBed.inject(Router);
  router.initialNavigation();
  return router;
};

const strategy = () =>
  TestBed.inject(LocationStrategy) as unknown as LynxLocationStrategy;

/**
 * Lets the service's calls to the shell, and the microtasks after them, go.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));

/**
 * A link to the app arrives while it's open.
 */
const arrive = async (url: string) => {
  waiting.push(url);
  listeners['angularLynxURL']!();
  await settle();
};

describe('deep links', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    waiting = [];
    listeners = {};
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts the app at the route of the link that started it, with nothing before it', async () => {
    stubHost('myapp://orders/42?tab=items');
    const router = start();

    await vi.waitFor(() => expect(router.url).toBe('/orders/42?tab=items'));
    expect(strategy().canGoBack()).toBe(false);
  });

  it('starts at / without a link', async () => {
    stubHost();
    const router = start();

    await vi.waitFor(() => expect(router.navigated).toBe(true));
    expect(router.url).toBe('/');
  });

  it('starts at / for a link to /', async () => {
    stubHost('myapp://');
    const router = start();

    await vi.waitFor(() => expect(router.navigated).toBe(true));
    expect(router.url).toBe('/');
  });

  it('falls back to / and warns when no route matches the link that started the app', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubHost('myapp://nowhere');
    const router = start();

    await vi.waitFor(() => expect(router.url).toBe('/'));
    await vi.waitFor(() => expect(router.navigated).toBe(true));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('opened with myapp://nowhere'),
    );
    expect(strategy().canGoBack()).toBe(false);
  });

  it('leaves a later navigation that fails alone once the first screen is up', async () => {
    stubHost('myapp://orders/1');
    const router = start();
    await vi.waitFor(() => expect(router.url).toBe('/orders/1'));

    await router.navigateByUrl('/nowhere');

    expect(router.url).toBe('/orders/1');
  });

  it('navigates to the route of a link that arrives while the app is open', async () => {
    stubHost();
    const router = start();
    await vi.waitFor(() => expect(router.navigated).toBe(true));
    await settle();

    await arrive('myapp://orders/7');

    await vi.waitFor(() => expect(router.url).toBe('/orders/7'));
    expect(strategy().canGoBack()).toBe(true);
  });

  it('navigates to a link that arrived while the app was starting', async () => {
    waiting.push('myapp://orders/3');
    stubHost();
    const router = start();

    await vi.waitFor(() => expect(router.url).toBe('/orders/3'));
  });

  describe('provideDeepLinkRoute', () => {
    it('sends the link that started the app where it says, and tells it the link was the first', async () => {
      stubHost('myapp://old?x=1');
      const decide = vi.fn<DeepLinkRoute>(() => '/renamed');
      const router = start(provideDeepLinkRoute(decide));

      await vi.waitFor(() => expect(router.url).toBe('/renamed'));
      expect(decide).toHaveBeenCalledWith({
        url: 'myapp://old?x=1',
        route: '/old?x=1',
        initial: true,
      });
    });

    it('starts at / when it returns null for the link that started the app', async () => {
      stubHost('myapp://auth?code=1');
      const router = start(provideDeepLinkRoute(() => null));

      await vi.waitFor(() => expect(router.navigated).toBe(true));
      expect(router.url).toBe('/');
    });

    it('sends a later link where it says, or nowhere for null', async () => {
      stubHost();
      const decide = vi.fn<DeepLinkRoute>(({ url, route }) =>
        url.includes('auth') ? null : route,
      );
      const router = start(provideDeepLinkRoute(decide));
      await vi.waitFor(() => expect(router.navigated).toBe(true));
      await settle();

      await arrive('myapp://auth?code=1');
      expect(router.url).toBe('/');
      expect(decide).toHaveBeenLastCalledWith({
        url: 'myapp://auth?code=1',
        route: '/auth?code=1',
        initial: false,
      });

      await arrive('myapp://orders/9');
      await vi.waitFor(() => expect(router.url).toBe('/orders/9'));
    });

    it("sends its error to the ErrorHandler, and doesn't keep the app from starting", async () => {
      stubHost('myapp://orders/1');
      const error = new Error('bad route');
      const handleError = vi.fn();
      const router = start(
        { provide: ErrorHandler, useValue: { handleError } },
        provideDeepLinkRoute(() => {
          throw error;
        }),
      );

      await vi.waitFor(() => expect(router.navigated).toBe(true));
      expect(router.url).toBe('/');
      expect(handleError).toHaveBeenCalledWith(error);
    });
  });

  it('keeps the history a hot update carried over rather than going to the link again', async () => {
    const old = new LynxLocationStrategy();
    old.pushState(null, '', '/orders/5', '');
    carryOverLocation({
      get: () => old,
    } as unknown as Parameters<typeof carryOverLocation>[0]);
    stubHost('myapp://orders/42');
    const router = start();

    await vi.waitFor(() => expect(router.url).toBe('/orders/5'));
  });

  it('leaves an app with its own LocationStrategy at its own start', async () => {
    stubHost('myapp://orders/42');
    class OwnStrategy extends LocationStrategy {
      path = () => '/';
      prepareExternalUrl = (url: string) => url;
      getState = () => null;
      pushState = () => {};
      replaceState = () => {};
      forward = () => {};
      back = () => {};
      onPopState = () => {};
      getBaseHref = () => '/';
    }
    const router = start({ provide: LocationStrategy, useClass: OwnStrategy });

    await vi.waitFor(() => expect(router.navigated).toBe(true));
    expect(router.url).toBe('/');
  });
});
