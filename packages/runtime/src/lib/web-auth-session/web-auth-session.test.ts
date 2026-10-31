import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxNativeModule } from '../native-module/native-module';
import {
  LynxWebAuthSession,
  type WebAuthSessionErrorCode,
  WebAuthSessionError,
} from './web-auth-session';

type Done = (result: {
  url?: string;
  error?: string;
  message?: string;
}) => void;

const createSession = () =>
  Injector.create({
    providers: [LynxWebAuthSession, LynxNativeModule],
  }).get(LynxWebAuthSession);

/**
 * Stands in for the shells' AngularLynxWebAuth module, as the background
 * thread sees it. `finish` ends the open session the way the platform would.
 */
const stubModule = () => {
  let done: Done | undefined;
  const start = vi.fn((_request: unknown, callback: Done) => {
    done = callback;
  });
  vi.stubGlobal('NativeModules', { AngularLynxWebAuth: { start } });
  return { start, finish: (result: Parameters<Done>[0]) => done?.(result) };
};

const rejection = async (
  promise: Promise<string>,
): Promise<{ code: WebAuthSessionErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(WebAuthSessionError);
  const { code, message } = error as WebAuthSessionError;
  return { code, message };
};

describe('LynxWebAuthSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the page and resolves with the URL it returns to', async () => {
    const { start, finish } = stubModule();

    const callback = createSession().start({
      url: 'https://example.com/authorize?client_id=app',
      callbackScheme: 'myapp',
    });
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    finish({ url: 'myapp://auth?code=42#state=s' });

    await expect(callback).resolves.toBe('myapp://auth?code=42#state=s');
    expect(start).toHaveBeenCalledWith(
      {
        url: 'https://example.com/authorize?client_id=app',
        callbackScheme: 'myapp',
        ephemeral: false,
      },
      expect.any(Function),
    );
  });

  it('asks for an ephemeral session', async () => {
    const { start } = stubModule();

    void createSession().start({
      url: 'https://example.com',
      callbackScheme: 'myapp',
      ephemeral: true,
    });

    await vi.waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
        expect.any(Function),
      ),
    );
  });

  it.each<[string, WebAuthSessionErrorCode, string]>([
    ['canceled', 'canceled', 'The sign-in was canceled.'],
    ['failed', 'failed', 'The sign-in page could not be opened.'],
  ])(
    'rejects with %s when the platform reports it',
    async (error, code, message) => {
      const { start, finish } = stubModule();

      const callback = createSession().start({
        url: 'https://example.com',
        callbackScheme: 'myapp',
      });
      await vi.waitFor(() => expect(start).toHaveBeenCalled());
      finish({ error });

      expect(await rejection(callback)).toEqual({ code, message });
    },
  );

  it("passes on the platform's own message", async () => {
    const { start, finish } = stubModule();

    const callback = createSession().start({
      url: 'https://example.com',
      callbackScheme: 'myapp',
    });
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    finish({ error: 'failed', message: 'A sign-in is already open.' });

    expect(await rejection(callback)).toEqual({
      code: 'failed',
      message: 'A sign-in is already open.',
    });
  });

  it('rejects as unavailable where the host has no module', async () => {
    vi.stubGlobal('NativeModules', {});

    const { code } = await rejection(
      createSession().start({
        url: 'https://example.com',
        callbackScheme: 'myapp',
      }),
    );

    expect(code).toBe('unavailable');
  });

  it('rejects as unavailable when the main thread has no background thread to relay to', async () => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    vi.stubGlobal('lynx', {
      getJSContext: () => {
        throw new Error('no background thread');
      },
    });

    const { code } = await rejection(
      createSession().start({
        url: 'https://example.com',
        callbackScheme: 'myapp',
      }),
    );

    expect(code).toBe('unavailable');
  });

  it('rejects as unavailable outside Lynx', async () => {
    const { code } = await rejection(
      createSession().start({
        url: 'https://example.com',
        callbackScheme: 'myapp',
      }),
    );

    expect(code).toBe('unavailable');
  });
});
