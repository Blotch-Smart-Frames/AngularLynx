/**
 * Remote logger service — sends log calls from on-device to the rspeedy dev
 * server via fetch() so they appear in the developer's terminal.
 * All methods are no-ops in production (__DEV__ guard dead-code-eliminated).
 *
 * Threading: Angular, and so every LynxLogger call, runs on the main thread,
 * which has no fetch. Only the background thread has it. Logs are relayed to
 * the background thread via IPC:
 *   main thread:       lynx.getJSContext().dispatchEvent(...)
 *   background thread: lynx.getCoreContext().addEventListener(...)
 * This mirrors how React Lynx's runOnBackground() IPC works.
 */
import { Injectable } from '@angular/core';

type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

type LogEntry = {
  level: LogLevel;
  timestamp: number;
  args: string[];
};

const LOG_EVENT = '__lynx_log__';

/**
 * The dev server's log endpoint, or '' when there's none (a production build,
 * or a dev build without a server).
 */
const logUrl = (): string =>
  __DEV__ && typeof __DEV_LOG_URL__ !== 'undefined' ? __DEV_LOG_URL__ : '';

/**
 * This thread's fetch, which only the background thread has: Lynx injects it
 * through the background bundle's tt.define() wrapper, so it's in module scope
 * rather than on globalThis. Read once the module runs, on either thread.
 */
const resolveFetch = ():
  | ((url: string, init?: RequestInit) => Promise<Response>)
  | undefined => {
  try {
    if (typeof fetch === 'function') {
      return fetch;
      // In Vitest (jsdom) `fetch` is always a function on the module scope,
      // so the else-if that falls back to `globalThis.fetch` is never
      // reachable. The fallback exists for Lynx's background thread where
      // `fetch` is injected via `tt.define()` instead.
      /* v8 ignore start */
    } else if (typeof (globalThis as any).fetch === 'function') {
      return (globalThis as any).fetch;
    }
    /* v8 ignore stop */
  } catch {}
  return undefined;
};

/**
 * Posts one entry to the dev server. Failures are dropped: logging must never
 * break the app.
 */
const postToServer = (
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  entry: LogEntry,
): void => {
  try {
    fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: [entry] }),
    }).catch(() => {});
  } catch {}
};

/**
 * Background thread: posts the log entries the main thread relays. Installed
 * at module load, not by the service, because no Angular code, so no
 * LynxLogger, runs on this thread.
 */
const installLogRelay = (): void => {
  if (typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__) return;
  const url = logUrl();
  const fetchFn = resolveFetch();
  if (!url || !fetchFn) return;
  try {
    if (
      typeof lynx !== 'undefined' &&
      typeof lynx.getCoreContext === 'function'
    ) {
      lynx.getCoreContext().addEventListener(LOG_EVENT, (event: any) => {
        try {
          postToServer(fetchFn, url, JSON.parse(event.data as string));
        } catch {}
      });
    }
  } catch {}
};

installLogRelay();

@Injectable({ providedIn: 'root' })
export class LynxLogger {
  readonly #url: string = logUrl();
  /**
   * This thread's fetch: set when the logger runs on the background thread,
   * such as in a test, where it posts directly instead of relaying.
   */
  readonly #fetchFn = this.#url ? resolveFetch() : undefined;

  log(...args: unknown[]): void {
    this.#send('log', args);
  }
  warn(...args: unknown[]): void {
    this.#send('warn', args);
  }
  error(...args: unknown[]): void {
    this.#send('error', args);
  }
  info(...args: unknown[]): void {
    this.#send('info', args);
  }
  debug(...args: unknown[]): void {
    this.#send('debug', args);
  }

  #send(level: LogLevel, args: unknown[]): void {
    if (!this.#url) return;
    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      args: args.map(String),
    };

    if (this.#fetchFn) {
      // Background thread: send directly via fetch.
      postToServer(this.#fetchFn, this.#url, entry);
    } else {
      // Main thread: no fetch available. Relay to background thread via IPC.
      // The relay installed above handles it there.
      try {
        if (
          typeof lynx !== 'undefined' &&
          typeof (lynx as any).getJSContext === 'function'
        ) {
          (lynx as any).getJSContext().dispatchEvent({
            type: LOG_EVENT,
            data: JSON.stringify(entry),
          });
        }
      } catch {}
    }
  }
}
