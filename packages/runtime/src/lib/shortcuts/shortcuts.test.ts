// @vitest-environment jsdom
import '@angular/compiler';
import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  ErrorHandler,
  inject,
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
import {
  type LynxShortcut,
  LynxShortcuts,
  SHORTCUT_NAVIGATE,
} from './shortcuts';

/** The shortcuts the person ran that the app hasn't taken, as the shell keeps them. */
let waiting: LynxShortcut[];
/** The global events the shell would send, by name. */
let listeners: Record<string, () => void>;
let take: ReturnType<typeof vi.fn>;

/**
 * Stands in for an app `ng build --platform` made: its AngularLynxShortcuts
 * module and its global events.
 */
const stubHost = (opts: { module?: object; emitter?: object | null } = {}) => {
  vi.stubGlobal('NativeModules', {
    AngularLynxShortcuts: opts.module ?? { take },
  });
  vi.stubGlobal('lynx', {
    getJSModule: (name: string) =>
      name === 'GlobalEventEmitter' && opts.emitter !== null
        ? (opts.emitter ?? {
            addListener: (event: string, fn: () => void) =>
              (listeners[event] = fn),
          })
        : undefined,
  });
};

/**
 * Lets the service's calls to the shell, and the microtasks after them, go.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));

/**
 * The person runs a shortcut while the app is open.
 */
const run = async (shortcut: LynxShortcut) => {
  waiting.push(shortcut);
  listeners['angularLynxShortcut']!();
  await settle();
};

const start = (...providers: unknown[]) => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), ...(providers as [])],
  });
  return TestBed.inject(LynxShortcuts);
};

describe('LynxShortcuts', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    waiting = [];
    listeners = {};
    take = vi.fn((done: (result: object) => void) =>
      done({ shortcuts: waiting.splice(0) }),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('hands the shortcut that started the app to the handler for its ID', async () => {
    waiting.push({ id: 'refresh' });
    stubHost();
    const refresh = vi.fn();
    const other = vi.fn();
    const shortcuts = start();
    shortcuts.on('refresh', refresh);
    shortcuts.on('photos', other);
    await settle();

    expect(refresh.mock.calls).toEqual([[{ id: 'refresh' }]]);
    expect(other).not.toHaveBeenCalled();
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('takes a shortcut run while the app is open when the shell says one is waiting', async () => {
    stubHost();
    const refresh = vi.fn();
    start().on('refresh', refresh);
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    await run({ id: 'refresh' });
    await run({ id: 'refresh' });

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('calls every handler registered for the ID', async () => {
    stubHost();
    const first = vi.fn();
    const second = vi.fn();
    const shortcuts = start();
    shortcuts.on('refresh', first);
    shortcuts.on('refresh', second);
    await settle();

    await run({ id: 'refresh' });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps a shortcut nothing handled yet for the first handler of its ID, once', async () => {
    waiting.push({ id: 'refresh' }, { id: 'refresh' });
    stubHost();
    const shortcuts = start();
    await settle();

    const first = vi.fn();
    const second = vi.fn();
    shortcuts.on('refresh', first);
    shortcuts.on('refresh', second);
    // After the caller has finished, so a constructor can set its fields.
    expect(first).not.toHaveBeenCalled();
    await settle();

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).not.toHaveBeenCalled();
  });

  it('drops a kept shortcut whose handler is removed before it gets it', async () => {
    waiting.push({ id: 'refresh' });
    stubHost();
    const shortcuts = start();
    await settle();

    const refresh = vi.fn();
    shortcuts.on('refresh', refresh)();
    await settle();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops calling a handler once the function it returned is called', async () => {
    stubHost();
    const refresh = vi.fn();
    const remove = start().on('refresh', refresh);
    await settle();
    await run({ id: 'refresh' });

    remove();
    await run({ id: 'refresh' });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('removes a handler registered in an injection context when that is destroyed', async () => {
    stubHost();
    const refresh = vi.fn();

    @Component({ template: '' })
    class Feed {
      constructor() {
        inject(LynxShortcuts).on('refresh', refresh);
      }
    }

    start();
    const fixture = TestBed.createComponent(Feed);
    await settle();
    await run({ id: 'refresh' });
    expect(refresh).toHaveBeenCalledTimes(1);

    fixture.destroy();
    await run({ id: 'refresh' });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ties a handler to the injector it's given", async () => {
    stubHost();
    const refresh = vi.fn();
    const shortcuts = start();
    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    shortcuts.on('refresh', refresh, { injector });
    await settle();
    await run({ id: 'refresh' });

    injector.destroy();
    await run({ id: 'refresh' });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("lets a handler remove itself while it's being called", async () => {
    stubHost();
    const shortcuts = start();
    const second = vi.fn();
    const remove = shortcuts.on('refresh', () => remove());
    shortcuts.on('refresh', second);
    await settle();

    await run({ id: 'refresh' });
    await run({ id: 'refresh' });

    expect(second).toHaveBeenCalledTimes(2);
  });

  it("reports a handler's error and still calls the others", async () => {
    stubHost();
    const handleError = vi.fn();
    const error = new Error('refresh failed');
    const second = vi.fn();
    const shortcuts = start({
      provide: ErrorHandler,
      useValue: { handleError },
    });
    shortcuts.on('refresh', () => {
      throw error;
    });
    shortcuts.on('refresh', second);
    await settle();

    await run({ id: 'refresh' });

    expect(handleError.mock.calls).toEqual([[error]]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("navigates to a shortcut's route, then calls its handlers", async () => {
    stubHost();
    const order: string[] = [];
    const navigate = vi.fn(() => order.push('navigate'));
    const shortcuts = start({ provide: SHORTCUT_NAVIGATE, useValue: navigate });
    shortcuts.on('photos', () => order.push('handler'));
    await settle();

    await run({ id: 'photos', route: '/photos' });
    await run({ id: 'refresh' });

    expect(navigate.mock.calls).toEqual([['/photos']]);
    expect(order).toEqual(['navigate', 'handler']);
  });

  it('reports a navigation that throws and still calls the handlers', async () => {
    stubHost();
    const handleError = vi.fn();
    const error = new Error('no router');
    const photos = vi.fn();
    const shortcuts = start(
      { provide: ErrorHandler, useValue: { handleError } },
      {
        provide: SHORTCUT_NAVIGATE,
        useValue: () => {
          throw error;
        },
      },
    );
    shortcuts.on('photos', photos);
    await settle();

    await run({ id: 'photos', route: '/photos' });

    expect(handleError.mock.calls).toEqual([[error]]);
    expect(photos).toHaveBeenCalledTimes(1);
  });

  it('leaves the route to the handlers in an app without a router', async () => {
    stubHost();
    const photos = vi.fn();
    start().on('photos', photos);
    await settle();

    await run({ id: 'photos', route: '/photos' });

    expect(photos.mock.calls).toEqual([[{ id: 'photos', route: '/photos' }]]);
  });

  it('goes to the route with the router provideRouter() sets up, without the app injecting the service', async () => {
    waiting.push({ id: 'photos', route: '/photos' });
    stubHost();

    @Component({ template: '' })
    class Screen {}

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: '', component: Screen },
          { path: 'photos', component: Screen },
        ]),
      ],
    });
    const router = TestBed.inject(Router);
    router.initialNavigation();

    await vi.waitFor(() => expect(router.url).toBe('/photos'));
  });

  it('hears nothing on a host without the module, such as Lynx Explorer', async () => {
    stubHost({ module: {} });
    const refresh = vi.fn();
    start().on('refresh', refresh);
    await settle();

    listeners['angularLynxShortcut']!();
    await settle();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('takes nothing from a module that answers without shortcuts', async () => {
    take.mockImplementation((done: (result?: object) => void) => done());
    stubHost();
    const refresh = vi.fn();
    start().on('refresh', refresh);
    await settle();

    expect(take).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('still takes the shortcut that started the app where global events cannot be heard', async () => {
    waiting.push({ id: 'refresh' });
    stubHost({
      emitter: {
        addListener: () => {
          throw new Error('no background thread');
        },
      },
    });
    const refresh = vi.fn();
    start().on('refresh', refresh);
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('takes it on a host without a GlobalEventEmitter too', async () => {
    waiting.push({ id: 'refresh' });
    stubHost({ emitter: null });
    const refresh = vi.fn();
    start().on('refresh', refresh);
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
