// @vitest-environment jsdom
import '@angular/compiler';
import { Location, LocationStrategy } from '@angular/common';
import { MockLocationStrategy } from '@angular/common/testing';
import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  ErrorHandler,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { Router } from '@angular/router';
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
import { LynxBackButton } from './back-button';

@Component({ template: '' })
class Screen {}

const routes = [
  { path: '', component: Screen },
  { path: 'a', component: Screen },
  { path: 'b', component: Screen },
];

/** The global events the shell would send, by name. */
let listeners: Record<string, () => void>;
let setBackHandlerEnabled: ReturnType<typeof vi.fn>;

const stubHost = (opts: { shell?: object; emitter?: object } = {}) => {
  vi.stubGlobal('NativeModules', {
    AngularLynxShell: opts.shell ?? { setBackHandlerEnabled },
  });
  vi.stubGlobal('lynx', {
    getJSModule: (name: string) =>
      name === 'GlobalEventEmitter'
        ? (opts.emitter ?? {
            addListener: (event: string, fn: () => void) =>
              (listeners[event] = fn),
          })
        : undefined,
  });
};

const start = (...providers: unknown[]) => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      ...(providers as []),
    ],
  });
  TestBed.inject(LynxBackButton);
  const router = TestBed.inject(Router);
  // What bootstrapping does: among other things, it makes the router follow
  // the location's popstate events.
  router.initialNavigation();
  return router;
};

/**
 * Runs the effect, and lets its call and the navigation go.
 */
const settle = async () => {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
};

describe('LynxBackButton', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    listeners = {};
    setBackHandlerEnabled = vi.fn();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it("leaves back to Android on the first screen, which the shell's handler starts as", async () => {
    stubHost();
    start();
    await settle();

    expect(setBackHandlerEnabled.mock.calls).toEqual([[false]]);
  });

  it('enables the shell handler once there is a screen to go back to, and disables it back on the first', async () => {
    stubHost();
    const router = start();
    await settle();

    await router.navigateByUrl('/a');
    await settle();
    expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(true);

    await router.navigateByUrl('/b');
    await settle();
    TestBed.inject(Location).back();
    await settle();
    expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(true);

    TestBed.inject(Location).back();
    await settle();
    expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(false);
    expect(setBackHandlerEnabled.mock.calls).toEqual([
      [false],
      [true],
      [false],
    ]);
  });

  it("goes back a screen on the shell's back event, as the browser's back button does", async () => {
    stubHost();
    const router = start();
    await router.navigateByUrl('/a');
    await router.navigateByUrl('/b');
    await settle();

    listeners['angularLynxBack']();
    // The navigation waits for a timer, outside the event's callback.
    expect(router.url).toBe('/b');

    await vi.waitFor(() => expect(router.url).toBe('/a'));
  });

  it('keeps a replaced URL from counting as a screen to go back to', async () => {
    stubHost();
    const router = start();
    await router.navigateByUrl('/a', { replaceUrl: true });
    await settle();

    expect(setBackHandlerEnabled.mock.calls).toEqual([[false]]);
  });

  it('stops calling a host whose shell module rejects, such as one without it', async () => {
    setBackHandlerEnabled.mockRejectedValue(new Error('not available'));
    stubHost();
    const router = start();
    await settle();

    await router.navigateByUrl('/a');
    await settle();

    expect(setBackHandlerEnabled).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a host without the shell module or global events', async () => {
    vi.stubGlobal('NativeModules', {});
    vi.stubGlobal('lynx', { getJSModule: () => undefined });
    const router = start();

    await router.navigateByUrl('/a');
    await settle();

    expect(router.url).toBe('/a');
  });

  it('survives a global event emitter that throws', async () => {
    stubHost({
      emitter: {
        addListener: () => {
          throw new Error('no background thread');
        },
      },
    });
    const router = start();

    await router.navigateByUrl('/a');
    await settle();

    expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(true);
  });

  it("leaves back to Android with another LocationStrategy, which can't say whether there's history", async () => {
    stubHost();
    const router = start({
      provide: LocationStrategy,
      useClass: MockLocationStrategy,
    });

    await router.navigateByUrl('/a');
    await settle();

    // The handler stays as it started, off, and a press doesn't navigate.
    expect(setBackHandlerEnabled.mock.calls).toEqual([[false]]);
    listeners['angularLynxBack']();
    await settle();
    expect(router.url).toBe('/a');
  });

  describe('handlers', () => {
    it('enables the shell handler while one is registered, without a router', async () => {
      stubHost();
      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection()],
      });
      const backButton = TestBed.inject(LynxBackButton);
      await settle();
      expect(setBackHandlerEnabled.mock.calls).toEqual([[false]]);

      const remove = backButton.on(() => {});
      await settle();
      expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(true);

      remove();
      await settle();
      expect(setBackHandlerEnabled.mock.calls).toEqual([
        [false],
        [true],
        [false],
      ]);
    });

    it('gives a press to the handler registered last, and the router none', async () => {
      stubHost();
      const router = start();
      await router.navigateByUrl('/a');
      await settle();
      const backButton = TestBed.inject(LynxBackButton);
      const calls: string[] = [];
      const removeFirst = backButton.on(() => calls.push('first'));
      const removeSecond = backButton.on(() => calls.push('second'));

      listeners['angularLynxBack']();
      removeSecond();
      listeners['angularLynxBack']();
      removeFirst();
      await settle();

      expect(calls).toEqual(['second', 'first']);
      expect(router.url).toBe('/a');

      // With the handlers gone, back goes to the router again.
      listeners['angularLynxBack']();
      await vi.waitFor(() => expect(router.url).toBe('/'));
    });

    it('keeps the shell handler enabled on the first screen while a handler is registered', async () => {
      stubHost();
      start();
      await settle();

      TestBed.inject(LynxBackButton).on(() => {});
      await settle();

      expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(true);
    });

    it('counts a handler registered twice as two, each removed on its own', async () => {
      stubHost();
      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection()],
      });
      const backButton = TestBed.inject(LynxBackButton);
      const handler = vi.fn();
      const removeOne = backButton.on(handler);
      backButton.on(handler);

      removeOne();
      await settle();
      listeners['angularLynxBack']();

      expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('removes a handler when the injector it was registered in is destroyed', async () => {
      stubHost();
      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection()],
      });
      const backButton = TestBed.inject(LynxBackButton);
      const parent = TestBed.inject(EnvironmentInjector);
      const inContext = createEnvironmentInjector([], parent);
      const passed = createEnvironmentInjector([], parent);
      const fromContext = vi.fn();
      const fromOption = vi.fn();
      inContext.runInContext(() => backButton.on(fromContext));
      backButton.on(fromOption, { injector: passed });
      await settle();

      passed.destroy();
      listeners['angularLynxBack']();
      inContext.destroy();
      listeners['angularLynxBack']();
      await settle();

      expect(fromContext).toHaveBeenCalledTimes(1);
      expect(fromOption).not.toHaveBeenCalled();
      expect(setBackHandlerEnabled).toHaveBeenLastCalledWith(false);
    });

    it("reports a handler's error to the ErrorHandler", () => {
      stubHost();
      const handleError = vi.fn();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          { provide: ErrorHandler, useValue: { handleError } },
        ],
      });
      const error = new Error('handler failed');
      TestBed.inject(LynxBackButton).on(() => {
        throw error;
      });

      return vi.waitFor(() => {
        listeners['angularLynxBack']?.();
        expect(handleError).toHaveBeenCalledWith(error);
      });
    });

    it('does nothing on a press with no handler and no router', async () => {
      stubHost();
      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection()],
      });
      TestBed.inject(LynxBackButton);
      await settle();

      expect(() => listeners['angularLynxBack']()).not.toThrow();
    });
  });
});
