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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LynxLinking, routeOfLink } from './linking';

/** The links to the app the shell keeps until they're taken. */
let waiting: string[];
/** The global events the shell would send, by name. */
let listeners: Record<string, () => void>;
let takeURLs: ReturnType<typeof vi.fn>;

/**
 * Stands in for an app `ng build --platform` made: its AngularLynxLinking
 * module, its global events and its global props.
 */
const stubHost = (
  opts: {
    module?: object;
    emitter?: object | null;
    globalProps?: Record<string, unknown>;
  } = {},
) => {
  vi.stubGlobal('NativeModules', {
    AngularLynxLinking: opts.module ?? { takeURLs },
  });
  vi.stubGlobal('lynx', {
    __globalProps: opts.globalProps,
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
 * A link to the app arrives while it's open.
 */
const arrive = async (url: string) => {
  waiting.push(url);
  listeners['angularLynxURL']!();
  await settle();
};

const start = (...providers: unknown[]) => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), ...(providers as [])],
  });
  return TestBed.inject(LynxLinking);
};

describe('routeOfLink', () => {
  it.each([
    ['myapp://orders/42', '/orders/42'],
    ['myapp://orders/42?tab=items#top', '/orders/42?tab=items#top'],
    ['myapp:///orders/42', '/orders/42'],
    ['myapp://', '/'],
    ['myapp://?ref=mail', '/?ref=mail'],
    ['myapp:orders', '/orders'],
    ['https://example.com/orders/42?tab=items', '/orders/42?tab=items'],
    ['HTTP://example.com?x=1', '/?x=1'],
    ['https://example.com', '/'],
    ['/orders', '/orders'],
  ])('reads %s as %s', (url, route) => {
    expect(routeOfLink(url)).toBe(route);
  });
});

describe('LynxLinking, links to the app', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    waiting = [];
    listeners = {};
    takeURLs = vi.fn((done: (result: object) => void) =>
      done({ urls: waiting.splice(0) }),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  describe('getInitialURL', () => {
    it('returns the link that started the app, from the global props', () => {
      stubHost({ globalProps: { initialURL: 'myapp://orders/42' } });

      expect(start().getInitialURL()).toBe('myapp://orders/42');
    });

    it.each([
      ['no global props', undefined],
      ['none', { theme: 'Light' }],
      ['an empty one', { initialURL: '' }],
      ['one that is not a string', { initialURL: 42 }],
    ])('returns null with %s', (_name, globalProps) => {
      stubHost({ globalProps });

      expect(start().getInitialURL()).toBeNull();
    });

    it('returns null where there is no lynx global, as in a plain test', () => {
      expect(start().getInitialURL()).toBeNull();
    });
  });

  describe('onURL', () => {
    it('hands the links that arrived before anything listened to the first handler', async () => {
      waiting.push('myapp://orders/1');
      stubHost();
      const handler = vi.fn();
      start().onURL(handler);
      await settle();

      expect(handler.mock.calls).toEqual([['myapp://orders/1']]);
      expect(takeURLs).toHaveBeenCalledTimes(1);
    });

    it('takes a link that arrives while the app is open when the shell says one is waiting', async () => {
      stubHost();
      const handler = vi.fn();
      start().onURL(handler);
      await settle();
      expect(handler).not.toHaveBeenCalled();

      await arrive('myapp://orders/1');
      await arrive('myapp://orders/2');

      expect(handler.mock.calls).toEqual([
        ['myapp://orders/1'],
        ['myapp://orders/2'],
      ]);
    });

    it('calls every handler, and listens once', async () => {
      const addListener = vi.fn((event: string, fn: () => void) => {
        listeners[event] = fn;
      });
      stubHost({ emitter: { addListener } });
      const first = vi.fn();
      const second = vi.fn();
      const linking = start();
      linking.onURL(first);
      linking.onURL(second);
      await settle();

      await arrive('myapp://x');

      expect(first).toHaveBeenCalledWith('myapp://x');
      expect(second).toHaveBeenCalledWith('myapp://x');
      expect(addListener).toHaveBeenCalledTimes(1);
    });

    it('stops calling a handler once it is removed', async () => {
      stubHost();
      const handler = vi.fn();
      const remove = start().onURL(handler);
      await settle();

      remove();
      await arrive('myapp://x');

      expect(handler).not.toHaveBeenCalled();
    });

    it('removes the handler when the component that registered it is destroyed', async () => {
      stubHost();
      const handler = vi.fn();

      @Component({ template: '' })
      class Screen {
        constructor() {
          inject(LynxLinking).onURL(handler);
        }
      }

      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection()],
      });
      const fixture = TestBed.createComponent(Screen);
      await settle();
      fixture.destroy();

      await arrive('myapp://x');

      expect(handler).not.toHaveBeenCalled();
    });

    it('removes the handler when the injector it was given is destroyed', async () => {
      stubHost();
      const handler = vi.fn();
      const linking = start();
      const injector = createEnvironmentInjector(
        [],
        TestBed.inject(EnvironmentInjector),
      );
      linking.onURL(handler, { injector });
      await settle();

      injector.destroy();
      await arrive('myapp://x');

      expect(handler).not.toHaveBeenCalled();
    });

    it("sends a handler's error to the ErrorHandler and still calls the others", async () => {
      stubHost();
      const error = new Error('handler failed');
      const handleError = vi.fn();
      const second = vi.fn();
      const linking = start({
        provide: ErrorHandler,
        useValue: { handleError },
      });
      linking.onURL(() => {
        throw error;
      });
      linking.onURL(second);
      await settle();

      await arrive('myapp://x');

      expect(handleError.mock.calls).toEqual([[error]]);
      expect(second).toHaveBeenCalledWith('myapp://x');
    });

    it('hears nothing on a host without the module, such as Lynx Explorer', async () => {
      stubHost({ module: {} });
      const handler = vi.fn();
      start().onURL(handler);
      await settle();

      listeners['angularLynxURL']!();
      await settle();

      expect(handler).not.toHaveBeenCalled();
    });

    it('takes nothing from a module that answers without links', async () => {
      takeURLs.mockImplementation((done: (result?: object) => void) => done());
      stubHost();
      const handler = vi.fn();
      start().onURL(handler);
      await settle();

      expect(takeURLs).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
    });

    it('still takes the waiting links where global events cannot be heard', async () => {
      waiting.push('myapp://x');
      stubHost({
        emitter: {
          addListener: () => {
            throw new Error('no background thread');
          },
        },
      });
      const handler = vi.fn();
      start().onURL(handler);
      await settle();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('takes them on a host without a GlobalEventEmitter too', async () => {
      waiting.push('myapp://x');
      stubHost({ emitter: null });
      const handler = vi.fn();
      start().onURL(handler);
      await settle();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
