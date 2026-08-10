/**
 * Remote logger service — sends log calls from on-device to the rspeedy dev
 * server via fetch() so they appear in the developer's terminal.
 * All methods are no-ops in production (__DEV__ guard dead-code-eliminated).
 *
 * Threading: Lynx dual-thread model means event handlers run on the main thread
 * (no fetch), while the Angular app runs on the background thread (has fetch).
 * Logs from the main thread are relayed to the background thread via IPC:
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

@Injectable({ providedIn: 'root' })
export class LynxLogger {
  readonly #url: string = '';
  /**
   * Only set on background thread where fetch is available via tt.define() scope.
   */
  #fetchFn:
    | ((url: string, init?: RequestInit) => Promise<Response>)
    | undefined;

  constructor() {
    if (!__DEV__) return;

    this.#url = typeof __DEV_LOG_URL__ !== 'undefined' ? __DEV_LOG_URL__ : '';
    if (!this.#url) return;

    // Resolve fetch — injected by Lynx's tt.define() into module scope,
    // only available on the background thread.
    try {
      if (typeof fetch === 'function') {
        this.#fetchFn = fetch;
      } else if (typeof (globalThis as any).fetch === 'function') {
        this.#fetchFn = (globalThis as any).fetch;
      }
    } catch {}

    if (!this.#fetchFn) return;

    // Background thread only: register IPC listener for log events relayed
    // from the main thread (event handlers, etc.) which cannot use fetch.
    try {
      if (
        typeof lynx !== 'undefined' &&
        typeof lynx.getCoreContext === 'function'
      ) {
        lynx.getCoreContext().addEventListener('__lynx_log__', (event: any) => {
          try {
            this.#postToServer(JSON.parse(event.data as string));
          } catch {}
        });
      }
    } catch {}
  }

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
      this.#postToServer(entry);
    } else {
      // Main thread: no fetch available. Relay to background thread via IPC.
      // Background thread's addEventListener('__lynx_log__') will handle it.
      try {
        if (
          typeof lynx !== 'undefined' &&
          typeof (lynx as any).getJSContext === 'function'
        ) {
          (lynx as any).getJSContext().dispatchEvent({
            type: '__lynx_log__',
            data: JSON.stringify(entry),
          });
        }
      } catch {}
    }
  }

  #postToServer(entry: LogEntry): void {
    try {
      this.#fetchFn!(this.#url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: [entry] }),
      }).catch(() => {});
    } catch {}
  }
}
