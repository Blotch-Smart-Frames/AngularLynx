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
import { LynxShareTarget, type ReceivedShare } from './share-target';

/** A share as the shells send it. */
type NativeShare = Record<string, unknown>;

/** The shares the app hasn't taken, as the shell keeps them. */
let waiting: NativeShare[];
/** The global events the shell would send, by name. */
let listeners: Record<string, () => void>;
let take: ReturnType<typeof vi.fn>;

/**
 * Stands in for an app `ng build --platform` made with `shareTarget`: its
 * AngularLynxShareTarget module and its global events.
 */
const stubHost = (opts: { module?: object; emitter?: object | null } = {}) => {
  vi.stubGlobal('NativeModules', {
    AngularLynxShareTarget: opts.module ?? { take },
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
 * The person shares to the app while it's open.
 */
const share = async (shared: NativeShare) => {
  waiting.push(shared);
  listeners['angularLynxShare']!();
  await settle();
};

const start = (...providers: unknown[]) => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), ...(providers as [])],
  });
  return TestBed.inject(LynxShareTarget);
};

/** "hello" as the shells send a file's bytes. */
const HELLO = 'aGVsbG8=';

describe('LynxShareTarget', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    waiting = [];
    listeners = {};
    take = vi.fn((done: (result: object) => void) =>
      done({ shares: waiting.splice(0) }),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('hands the share that started the app to the first handler', async () => {
    waiting.push({ title: 'A page', url: 'https://example.com/a', files: [] });
    stubHost();
    const handler = vi.fn();
    start().onShare(handler);
    await settle();

    expect(handler.mock.calls).toEqual([
      [{ files: [], title: 'A page', url: 'https://example.com/a' }],
    ]);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("turns the files' base64 into Blobs with their names, types and sizes", async () => {
    stubHost();
    const shares: ReceivedShare[] = [];
    start().onShare((received) => shares.push(received));
    await settle();

    await share({
      text: 'Look',
      files: [
        { base64: HELLO, name: 'hello.txt', type: 'text/plain' },
        { base64: HELLO, name: 'blob' },
      ],
    });

    expect(shares).toHaveLength(1);
    const [first, second] = shares[0]!.files;
    expect(shares[0]!.text).toBe('Look');
    expect(first).toMatchObject({
      name: 'hello.txt',
      type: 'text/plain',
      size: 5,
    });
    expect(await first!.blob.text()).toBe('hello');
    expect(first!.blob.type).toBe('text/plain');
    // A file the shell knows no type for.
    expect(second).toMatchObject({
      name: 'blob',
      type: 'application/octet-stream',
    });
  });

  it('leaves out what has the wrong type rather than handing it on', async () => {
    stubHost();
    const handler = vi.fn();
    start().onShare(handler);
    await settle();

    await share({
      title: 4,
      text: null,
      url: {},
      files: [{ base64: 1, name: 'x' }, { name: 'y' }, null],
    });
    await share({ text: 'no files' });

    expect(handler.mock.calls).toEqual([
      [{ files: [] }],
      [{ files: [], text: 'no files' }],
    ]);
  });

  it('calls every handler with a share that arrives while the app is open', async () => {
    stubHost();
    const first = vi.fn();
    const second = vi.fn();
    const target = start();
    target.onShare(first);
    target.onShare(second);
    await settle();

    await share({ text: 'one', files: [] });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps the shares nothing handled yet for the first handler, once, after its caller finishes', async () => {
    waiting.push({ text: 'one', files: [] }, { text: 'two', files: [] });
    stubHost();
    const target = start();
    await settle();

    const first = vi.fn();
    const second = vi.fn();
    target.onShare(first);
    target.onShare(second);
    expect(first).not.toHaveBeenCalled();
    await settle();

    expect(first.mock.calls.map(([received]) => received.text)).toEqual([
      'one',
      'two',
    ]);
    expect(second).not.toHaveBeenCalled();
  });

  it('drops a kept share whose handler is removed before it gets it', async () => {
    waiting.push({ text: 'one', files: [] });
    stubHost();
    const target = start();
    await settle();

    const handler = vi.fn();
    target.onShare(handler)();
    await settle();

    expect(handler).not.toHaveBeenCalled();
  });

  it('stops calling a handler once the function it returned is called', async () => {
    stubHost();
    const handler = vi.fn();
    const remove = start().onShare(handler);
    await settle();
    await share({ text: 'one', files: [] });

    remove();
    await share({ text: 'two', files: [] });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removes a handler registered in an injection context when that is destroyed', async () => {
    stubHost();
    const handler = vi.fn();

    @Component({ template: '' })
    class Inbox {
      constructor() {
        inject(LynxShareTarget).onShare(handler);
      }
    }

    start();
    const fixture = TestBed.createComponent(Inbox);
    await settle();
    await share({ text: 'one', files: [] });
    expect(handler).toHaveBeenCalledTimes(1);

    fixture.destroy();
    await share({ text: 'two', files: [] });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ties a handler to the injector it's given", async () => {
    stubHost();
    const handler = vi.fn();
    const target = start();
    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    target.onShare(handler, { injector });
    await settle();
    await share({ text: 'one', files: [] });

    injector.destroy();
    await share({ text: 'two', files: [] });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets go of the DestroyRef callback when the handler is removed by hand', () => {
    stubHost();
    const target = start();
    const unregister = vi.fn();
    const onDestroy = vi.fn(() => unregister);
    const injector = {
      get: () => ({ onDestroy }),
    } as unknown as EnvironmentInjector;

    const remove = target.onShare(() => {}, { injector });
    expect(onDestroy).toHaveBeenCalledTimes(1);
    remove();
    remove();

    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it("lets a handler remove itself while it's being called", async () => {
    stubHost();
    const target = start();
    const second = vi.fn();
    const remove = target.onShare(() => remove());
    target.onShare(second);
    await settle();

    await share({ text: 'one', files: [] });
    await share({ text: 'two', files: [] });

    expect(second).toHaveBeenCalledTimes(2);
  });

  it("reports a handler's error and still calls the others", async () => {
    stubHost();
    const handleError = vi.fn();
    const error = new Error('save failed');
    const second = vi.fn();
    const target = start({ provide: ErrorHandler, useValue: { handleError } });
    target.onShare(() => {
      throw error;
    });
    target.onShare(second);
    await settle();

    await share({ text: 'one', files: [] });

    expect(handleError.mock.calls).toEqual([[error]]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('receives nothing on a host without the module, such as Lynx Explorer', async () => {
    stubHost({ module: {} });
    const handler = vi.fn();
    start().onShare(handler);
    await settle();

    listeners['angularLynxShare']!();
    await settle();

    expect(handler).not.toHaveBeenCalled();
  });

  it('takes nothing from a module that answers without shares', async () => {
    take.mockImplementation((done: (result?: object) => void) => done());
    stubHost();
    const handler = vi.fn();
    start().onShare(handler);
    await settle();

    expect(take).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('still takes the share that started the app where global events cannot be heard', async () => {
    waiting.push({ text: 'one', files: [] });
    stubHost({
      emitter: {
        addListener: () => {
          throw new Error('no background thread');
        },
      },
    });
    const handler = vi.fn();
    start().onShare(handler);
    await settle();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('takes it on a host without a GlobalEventEmitter too', async () => {
    waiting.push({ text: 'one', files: [] });
    stubHost({ emitter: null });
    const handler = vi.fn();
    start().onShare(handler);
    await settle();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
