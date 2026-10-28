import type { ObserverFrameRateOptions } from './exposure/exposure.types';
import {
  abortFetchForMainThread,
  fetchForMainThread,
  type RelayedRequest,
  type RelayedResponse,
} from './network/background-fetch';

/**
 * Some Lynx APIs exist only on the background thread's `lynx` object. The main
 * thread's (`Utils::CreateLynx` in Lynx core's renderer_ng.cc) has no
 * `accessibilityAnnounce`, `addFont`, `setObserverFrameRate`,
 * `subscribeSessionStorage`, `requestResourcePrefetch` or `getJSModule`, and
 * web-core's has no `stopExposure` or `resumeExposure` either. `NativeModules`
 * exists only on the background thread too, as does `fetch`. Angular runs on
 * the main thread, so no service can reach them directly. callOnBackground() runs the call on
 * the background thread and resolves with its result, from either thread.
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
const CALLBACK_EVENT = 'AngularLynx.Callback';

/**
 * `__MAIN_THREAD__` is a build-time define. Unit tests don't define it, and run
 * as the background thread unless they stub it.
 *
 * @returns Whether this code runs on the main thread.
 */
export const isMainThread = (): boolean =>
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

/** A function argument as it crosses threads: the ID to call it back by. */
type FunctionMarker = { __angularLynxCallback: number };

/** Main thread: each function sent with a relayed call, by ID. */
const relayedFunctions = new Map<number, (...args: unknown[]) => unknown>();
/** Main thread: the ID each function was sent with, so it keeps one. */
const relayedFunctionIds = new WeakMap<object, number>();
let nextFunctionId = 0;
/** Background thread: the stand-in for each of the main thread's functions. */
const standIns = new Map<number, (...args: unknown[]) => void>();

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isFunctionMarker = (value: unknown): value is FunctionMarker =>
  isPlainObject(value) && typeof value['__angularLynxCallback'] === 'number';

/**
 * Main thread: the marker for a function, registered so the background
 * thread's stand-in can call it. A function keeps its ID, so passing the same
 * listener again, to remove it, reaches the same stand-in there. `owner` is the
 * object a method came from, which it's called on.
 */
const markFunction = (fn: Function, owner?: object): FunctionMarker => {
  let id = relayedFunctionIds.get(fn);
  if (id === undefined) {
    id = nextFunctionId++;
    relayedFunctionIds.set(fn, id);
    relayedFunctions.set(id, (...args) => fn.apply(owner, args));
  }
  return { __angularLynxCallback: id };
};

/**
 * Prepares a relayed call's arguments: on the main thread, each function in
 * them, or in a plain object or array in them, becomes a marker that the
 * background thread calls back. Elsewhere the call runs in place, so the
 * arguments are left alone.
 *
 * @param value - The arguments, or one of them.
 * @returns The value to send.
 */
export const relayFunctions = (value: unknown): unknown => {
  if (!isMainThread()) return value;
  const relay = (item: unknown, owner?: object): unknown => {
    if (typeof item === 'function') return markFunction(item, owner);
    if (Array.isArray(item)) return item.map((entry) => relay(entry));
    if (isPlainObject(item)) {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(item)) {
        result[key] = relay(item[key], item);
      }
      return result;
    }
    return item;
  };
  return relay(value);
};

/**
 * Prepares a JS module for registering from the main thread: its methods,
 * including ones on its prototype such as a class's, become markers bound to
 * it, and its other fields are copied.
 *
 * @param module - The module to register.
 * @returns The value to send.
 */
export const relayModuleObject = (module: object): unknown => {
  if (!isMainThread()) return module;
  const result: Record<string, unknown> = {};
  for (
    let source: object | null = module;
    source !== null && source !== Object.prototype;
    source = Object.getPrototypeOf(source)
  ) {
    for (const key of Object.getOwnPropertyNames(source)) {
      if (key === 'constructor' || key in result) continue;
      const value = (module as Record<string, unknown>)[key];
      result[key] =
        typeof value === 'function'
          ? markFunction(value, module)
          : relayFunctions(value);
    }
  }
  return result;
};

/**
 * Background thread: swaps each function marker for a stand-in that calls
 * the main thread's function, with its arguments copied as JSON. A value
 * without markers comes back as the same object, so a module registered on
 * this thread keeps its identity.
 */
const restoreFunctions = (value: unknown): unknown => {
  if (isFunctionMarker(value)) {
    const id = value.__angularLynxCallback;
    let standIn = standIns.get(id);
    if (!standIn) {
      standIn = (...args: unknown[]) => {
        try {
          (lynx as any).getCoreContext().dispatchEvent({
            type: CALLBACK_EVENT,
            data: JSON.stringify({ id, args }),
          });
        } catch {
          // Arguments JSON can't copy, such as a circular object, can't reach
          // the main thread. Native code calling back has nobody to tell.
        }
      };
      standIns.set(id, standIn);
    }
    return standIn;
  }
  if (Array.isArray(value)) {
    const items = value.map(restoreFunctions);
    return items.some((item, i) => item !== value[i]) ? items : value;
  }
  if (isPlainObject(value)) {
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = restoreFunctions(value[key]);
      changed ||= result[key] !== value[key];
    }
    return changed ? result : value;
  }
  return value;
};

/**
 * The host's `NativeModules.bridge`, if it has one.
 */
const nativeBridge = ():
  | {
      call(
        name: string,
        params: unknown,
        callback: (...args: unknown[]) => void,
      ): void;
      on(name: string, callback: (...args: unknown[]) => void): void;
    }
  | undefined => {
  const bridge =
    typeof NativeModules !== 'undefined' && NativeModules != null
      ? (NativeModules as any).bridge
      : undefined;
  return typeof bridge?.call === 'function' ? bridge : undefined;
};

/**
 * A native module or JS module by name, or undefined.
 */
const findModule = (kind: ModuleKind, name: string): any => {
  if (kind === 'native') {
    return typeof NativeModules !== 'undefined' && NativeModules != null
      ? (NativeModules as any)[name]
      : undefined;
  }
  return typeof lynx !== 'undefined' &&
    typeof (lynx as any).getJSModule === 'function'
    ? (lynx as any).getJSModule(name)
    : undefined;
};

/** Which registry a relayed module comes from. */
export type ModuleKind = 'native' | 'js';

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

  requestResourcePrefetch: (data: unknown): Promise<unknown> =>
    new Promise((resolve) => lynxApi('requestResourcePrefetch')(data, resolve)),

  cancelResourcePrefetch: (data: unknown): Promise<unknown> =>
    new Promise((resolve) => lynxApi('cancelResourcePrefetch')(data, resolve)),

  /**
   * Calls the host's bridge method and resolves with the first value it
   * passes back. Without a bridge, such as in the web preview, it resolves
   * `undefined`, as LynxNativeModule.call() always has.
   */
  nativeBridgeCall: (name: string, params: unknown): Promise<unknown> => {
    const bridge = nativeBridge();
    if (!bridge) return Promise.resolve(undefined);
    return new Promise((resolve) =>
      bridge.call(name, params, (...args: unknown[]) => resolve(args[0])),
    );
  },

  nativeBridgeOn: (name: string, callback: unknown): void => {
    nativeBridge()?.on(
      name,
      restoreFunctions(callback) as (...args: unknown[]) => void,
    );
  },

  /**
   * Calls a method of a native module or a JS module. The main thread's
   * module proxies (relayedModule() below) send their calls here.
   */
  callModule: (
    kind: ModuleKind,
    name: string,
    method: string,
    args: unknown[],
  ): unknown => {
    const module = findModule(kind, name);
    const fn = module?.[method];
    if (typeof fn !== 'function') {
      throw new Error(
        `${kind === 'native' ? 'NativeModules' : 'lynx.getJSModule'}: ${name}.${method} is not available`,
      );
    }
    return fn.apply(module, restoreFunctions(args) as unknown[]);
  },

  registerJSModule: (name: string, module: unknown): void => {
    lynxApi('registerModule')(name, restoreFunctions(module));
  },

  /**
   * The OS version, for LynxSystemInfo on the main thread: native Lynx builds
   * that thread's SystemInfo without one, and the background thread's global
   * has it.
   */
  osVersion: (): string | undefined =>
    typeof SystemInfo !== 'undefined' ? SystemInfo.osVersion : undefined,

  /** The main thread's `fetch` (network/fetch.ts) sends its requests here. */
  fetch: (id: number, request: RelayedRequest): Promise<RelayedResponse> =>
    fetchForMainThread(id, request),

  abortFetch: (id: number): void => abortFetchForMainThread(id),
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

/** Main thread: one proxy per module, so repeated lookups return the same one. */
const moduleProxies = new Map<string, object>();

/**
 * Main thread: a stand-in for a native module or JS module, which only the
 * background thread can reach. Each method call runs there and returns a
 * promise of its result, and function arguments are called back here. Reading
 * `then` gives `undefined`, so the proxy isn't mistaken for a promise.
 *
 * @param kind - `'native'` for `NativeModules`, `'js'` for `lynx.getJSModule`.
 * @param name - The module's name.
 * @returns The proxy.
 */
export const relayedModule = (kind: ModuleKind, name: string): object => {
  const cacheKey = `${kind}:${name}`;
  let proxy = moduleProxies.get(cacheKey);
  if (!proxy) {
    const methods = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    proxy = new Proxy(
      {},
      {
        get: (_target, method) => {
          if (typeof method !== 'string' || method === 'then') {
            return undefined;
          }
          let call = methods.get(method);
          if (!call) {
            call = (...args: unknown[]) =>
              callOnBackground(
                'callModule',
                kind,
                name,
                method,
                relayFunctions(args) as unknown[],
              );
            methods.set(method, call);
          }
          return call;
        },
      },
    );
    moduleProxies.set(cacheKey, proxy);
  }
  return proxy;
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
      context.addEventListener(CALLBACK_EVENT, (event: { data: string }) => {
        const { id, args } = JSON.parse(event.data);
        relayedFunctions.get(id)?.(...args);
      });
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
      let data: string;
      try {
        data = JSON.stringify(reply);
      } catch (error) {
        // A result JSON can't copy, such as a circular object from a native
        // module, would otherwise leave the caller waiting forever.
        // JSON.stringify only throws TypeErrors.
        data = JSON.stringify({
          id,
          error: `The result of ${name} can't be sent to the main thread: ${(error as Error).message}`,
        });
      }
      context.dispatchEvent({ type: RESULT_EVENT, data });
    });
  } catch {
    // The thread contexts may be missing outside a real Lynx host. Calls from
    // the main thread then reject in callOnBackground().
  }
};

installRelay();
