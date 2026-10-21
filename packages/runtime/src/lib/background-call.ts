import type { ObserverFrameRateOptions } from './exposure/exposure.types';

/**
 * Some Lynx APIs exist only on the background thread's `lynx` object. The main
 * thread's (`Utils::CreateLynx` in Lynx core's renderer_ng.cc) has no
 * `accessibilityAnnounce`, `addFont`, `setObserverFrameRate` or
 * `subscribeSessionStorage`, and web-core's has no `stopExposure` or
 * `resumeExposure` either. Template event handlers run on the main thread, so
 * a service method a handler calls can't reach them directly.
 * callOnBackground() runs the call on the background thread and resolves with
 * its result, from either thread.
 *
 * The relay uses the same cross-thread event channel as the worklet RPC in
 * global-callbacks.ts: the main thread dispatches on getJSContext(), and the
 * background thread listens and replies on getCoreContext(). Results travel as
 * JSON, and an error arrives as its message.
 *
 * The handlers live here rather than in the services, and the listeners are
 * installed at module load, because the background thread might never construct
 * a service that only a main-thread code path injects.
 */

const CALL_EVENT = 'AngularLynx.BackgroundCall';
const RESULT_EVENT = 'AngularLynx.BackgroundCallResult';
const SESSION_STORAGE_EVENT = 'AngularLynx.SessionStorageChange';

/**
 * `__MAIN_THREAD__` is a build-time define. Unit tests don't define it, and run
 * as the background thread unless they stub it.
 */
const isMainThread = (): boolean =>
  typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__;

/**
 * Returns a background-only `lynx` method, or throws the error the services
 * have always thrown where it's missing, such as in the web preview.
 */
const lynxApi = (name: string): ((...args: any[]) => any) => {
  const fn = typeof lynx !== 'undefined' ? (lynx as any)[name] : undefined;
  if (typeof fn !== 'function') {
    throw new Error(`lynx.${name} is not available in this environment`);
  }
  return fn.bind(lynx);
};

/** Native session storage subscriptions made for the main thread, by relay ID. */
const relayedSubscriptions = new Map<
  number,
  { key: string; listenerId: number }
>();

const handlers = {
  accessibilityAnnounce: (content: string): Promise<void> =>
    new Promise((resolve) =>
      lynxApi('accessibilityAnnounce')({ content }, () => resolve()),
    ),

  addFont: (fontFamily: string, src: string): Promise<void> =>
    new Promise((resolve, reject) =>
      lynxApi('addFont')({ 'font-family': fontFamily, src }, (err?: unknown) =>
        err ? reject(err) : resolve(),
      ),
    ),

  setObserverFrameRate: (options?: ObserverFrameRateOptions): void =>
    lynxApi('setObserverFrameRate')(options),

  // Native Lynx has these on both threads, but web-core only on the background
  // thread, where its exposure module reads `sendEvent` off the argument.
  stopExposure: (options?: { sendEvent: boolean }): void =>
    lynxApi('stopExposure')(options ?? {}),

  resumeExposure: (): void => lynxApi('resumeExposure')(),

  /**
   * Subscribes on the background thread and sends each change to the main
   * thread, where subscribeSessionStorageFromMainThread() delivers it.
   */
  subscribeSessionStorage: (key: string, relayId: number): void => {
    const listenerId: number = lynxApi('subscribeSessionStorage')(
      key,
      (value: unknown) =>
        (lynx as any).getCoreContext().dispatchEvent({
          type: SESSION_STORAGE_EVENT,
          data: JSON.stringify({ relayId, value }),
        }),
    );
    relayedSubscriptions.set(relayId, { key, listenerId });
  },

  unsubscribeSessionStorage: (relayId: number): void => {
    const subscription = relayedSubscriptions.get(relayId);
    if (!subscription) return;
    relayedSubscriptions.delete(relayId);
    lynxApi('unsubscribeSessionStorage')(
      subscription.key,
      subscription.listenerId,
    );
  },
};

type Handlers = typeof handlers;
type HandlerName = keyof Handlers;

const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
let nextCallId = 0;

/**
 * Runs a background-only Lynx API, directly on the background thread or relayed
 * from the main thread.
 */
export const callOnBackground = <N extends HandlerName>(
  name: N,
  ...args: Parameters<Handlers[N]>
): Promise<Awaited<ReturnType<Handlers[N]>>> => {
  if (!isMainThread()) {
    try {
      return Promise.resolve(
        (handlers[name] as (...a: unknown[]) => any)(...args),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    const id = nextCallId++;
    pending.set(id, { resolve, reject });
    try {
      (lynx as any).getJSContext().dispatchEvent({
        type: CALL_EVENT,
        data: JSON.stringify({ id, name, args }),
      });
    } catch {
      pending.delete(id);
      reject(
        new Error(
          `Can't reach the background thread to call lynx.${name} in this environment`,
        ),
      );
    }
  });
};

const sessionStorageListeners = new Map<number, (value: unknown) => void>();
let nextRelayId = 0;

/**
 * Main thread only. Subscribes to a session storage key through the background
 * thread, the only thread that can, and returns the ID to unsubscribe with.
 */
export const subscribeSessionStorageFromMainThread = (
  key: string,
  listener: (value: unknown) => void,
): number => {
  const relayId = nextRelayId++;
  sessionStorageListeners.set(relayId, listener);
  callOnBackground('subscribeSessionStorage', key, relayId).catch(() => {
    // Without a background thread there's nothing to subscribe to. The
    // caller's local listeners still see this thread's own writes.
    sessionStorageListeners.delete(relayId);
  });
  return relayId;
};

export const unsubscribeSessionStorageFromMainThread = (
  relayId: number,
): void => {
  if (!sessionStorageListeners.delete(relayId)) return;
  callOnBackground('unsubscribeSessionStorage', relayId).catch(() => {});
};

const installRelay = (): void => {
  if (typeof lynx === 'undefined') return;
  try {
    if (isMainThread()) {
      const context = (lynx as any).getJSContext();
      context.addEventListener(RESULT_EVENT, (event: { data: string }) => {
        const { id, value, error } = JSON.parse(event.data);
        const call = pending.get(id);
        if (!call) return;
        pending.delete(id);
        if (error !== undefined) {
          call.reject(new Error(error));
        } else {
          call.resolve(value);
        }
      });
      context.addEventListener(
        SESSION_STORAGE_EVENT,
        (event: { data: string }) => {
          const { relayId, value } = JSON.parse(event.data);
          sessionStorageListeners.get(relayId)?.(value);
        },
      );
      return;
    }
    const context = (lynx as any).getCoreContext();
    context.addEventListener(CALL_EVENT, async (event: { data: string }) => {
      const { id, name, args } = JSON.parse(event.data);
      let reply: { id: number; value?: unknown; error?: string };
      try {
        const handler = handlers[name as HandlerName] as
          | ((...a: unknown[]) => unknown)
          | undefined;
        if (!handler) throw new Error(`Unknown background call: ${name}`);
        reply = { id, value: await handler(...args) };
      } catch (error) {
        reply = {
          id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      context.dispatchEvent({
        type: RESULT_EVENT,
        data: JSON.stringify(reply),
      });
    });
  } catch {
    // The thread contexts may be missing outside a real Lynx host. Calls from
    // the main thread then reject in callOnBackground().
  }
};

installRelay();
