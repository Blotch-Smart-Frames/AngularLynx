import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * The tests run polyfills.js in a fresh `node:vm` realm, which has
 * ECMAScript's built-ins and none of the web's or Node's globals, as Lynx's
 * engines don't: no AbortController, no Node, no document, no
 * queueMicrotask. The module's one import (vacated-slots.js, tested on its
 * own) is left out, so the rest runs as a plain script. This is the only copy
 * of these stand-ins an app carries (the runtime's went in #765 and #780), so
 * they're tested here.
 */
const source = readFileSync(
  new URL('./polyfills.js', import.meta.url),
  'utf8',
).replace(/^import .*;$/gm, '');

/**
 * A realm with polyfills.js run in it.
 */
const realm = (globals: object = {}): Context => {
  const context = createContext({ ...globals });
  runInContext(source, context);
  return context;
};

describe('polyfills.js', () => {
  describe('AbortController', () => {
    it('installs an AbortController whose signal tells its abort listeners', () => {
      const context = realm();
      expect(
        runInContext(
          `
            const controller = new AbortController();
            const signal = controller.signal;
            const heard = [];
            const removed = () => heard.push('removed');
            signal.addEventListener('abort', () => heard.push('abort'));
            signal.addEventListener('other', () => heard.push('other'));
            signal.addEventListener('abort', removed);
            signal.removeEventListener('abort', removed);
            signal.removeEventListener('other', removed);
            const before = signal.aborted;
            signal.throwIfAborted();
            const dispatched = signal.dispatchEvent({ type: 'noop' });
            controller.abort();
            controller.abort('ignored');
            let thrown;
            try {
              signal.throwIfAborted();
            } catch (error) {
              thrown = error;
            }
            ({
              isSignal: signal instanceof AbortSignal,
              before,
              dispatched,
              heard,
              aborted: signal.aborted,
              reason: signal.reason.name + ': ' + signal.reason.message,
              thrown: thrown === signal.reason,
            });
          `,
          context,
        ),
      ).toEqual({
        isSignal: true,
        before: false,
        dispatched: true,
        // The second abort() tells no one: the signal is aborted already.
        heard: ['abort'],
        aborted: true,
        // Lynx has no DOMException, so the default reason is a plain Error
        // with the name the web's has.
        reason: 'AbortError: This operation was aborted',
        thrown: true,
      });
    });

    it('keeps the reason abort() is given', () => {
      expect(
        runInContext(
          `
            const controller = new AbortController();
            controller.abort('custom-reason');
            controller.signal.reason;
          `,
          realm(),
        ),
      ).toBe('custom-reason');
    });

    it('keeps an AbortController the engine has', () => {
      class EngineAbortController {}
      expect(
        runInContext(
          'AbortController',
          realm({ AbortController: EngineAbortController }),
        ),
      ).toBe(EngineAbortController);
    });
  });

  describe('Node', () => {
    it("installs a Node class with the DOM's node-type constants", () => {
      expect(
        runInContext(
          `({
            type: typeof Node,
            element: Node.ELEMENT_NODE,
            text: Node.TEXT_NODE,
            comment: Node.COMMENT_NODE,
            // Angular's dev paths test elements with instanceof, which
            // throws unless Node is callable.
            isNode: ({}) instanceof Node,
          })`,
          realm(),
        ),
      ).toEqual({
        type: 'function',
        element: 1,
        text: 3,
        comment: 8,
        isNode: false,
      });
    });

    it('keeps a Node the platform has', () => {
      class DomNode {}
      expect(runInContext('Node', realm({ Node: DomNode }))).toBe(DomNode);
    });
  });

  describe('queueMicrotask', () => {
    it("uses the background thread's lynx.queueMicrotask", () => {
      const queued: unknown[] = [];
      const lynx = {
        queueMicrotask: (callback: unknown) => queued.push(callback),
      };
      const context = realm({ lynx });
      const callback = (): void => {};
      runInContext('queueMicrotask', context)(callback);
      expect(queued).toEqual([callback]);
    });

    it('queues a promise job where lynx has none, as on the main thread', async () => {
      const context = realm({ lynx: {} });
      const order = runInContext(
        `
          const order = [];
          queueMicrotask(() => order.push('microtask'));
          order.push('sync');
          order;
        `,
        context,
      );
      expect(order).toEqual(['sync']);
      await runInContext('Promise.resolve().then(() => {})', context);
      expect(order).toEqual(['sync', 'microtask']);
    });

    it('throws what a callback throws again from a timer, as the web reports it', async () => {
      const thrown: unknown[] = [];
      const context = realm({
        // The timer runs at once, inside a catch, so the error is seen here
        // rather than reaching Vitest.
        setTimeout: (callback: () => void) => {
          try {
            callback();
          } catch (error) {
            thrown.push(error);
          }
        },
      });
      runInContext(
        `queueMicrotask(() => { throw new Error('microtask boom'); })`,
        context,
      );
      await runInContext(
        'Promise.resolve().then(() => {}).then(() => {}).then(() => {})',
        context,
      );
      expect(thrown).toHaveLength(1);
      expect((thrown[0] as Error).message).toBe('microtask boom');
    });

    it('keeps a queueMicrotask the engine has', () => {
      const engineQueueMicrotask = (): void => {};
      expect(
        runInContext(
          'queueMicrotask',
          realm({ queueMicrotask: engineQueueMicrotask }),
        ),
      ).toBe(engineQueueMicrotask);
    });
  });

  describe('navigator', () => {
    it('installs a navigator with an empty userAgent', () => {
      expect(runInContext('navigator.userAgent', realm())).toBe('');
    });

    it('keeps a navigator the platform has', () => {
      const navigator = { userAgent: 'Engine' };
      expect(runInContext('navigator', realm({ navigator }))).toBe(navigator);
    });
  });

  describe('document', () => {
    it('installs a placeholder whose queries find nothing', () => {
      // getBaseHrefFromDOM() calls document.querySelector('base'), and
      // Angular falls back to APP_BASE_HREF for null.
      expect(
        runInContext(
          `({
            view: document.defaultView === globalThis,
            base: document.querySelector('base'),
          })`,
          realm(),
        ),
      ).toEqual({ view: true, base: null });
    });

    it('keeps a document the platform has', () => {
      const document = {};
      expect(runInContext('document', realm({ document }))).toBe(document);
    });
  });

  describe('window', () => {
    it('points window at globalThis', () => {
      expect(runInContext('window === globalThis', realm())).toBe(true);
    });

    /**
     * polyfills.js run as the web preview's main thread runs it: inside
     * web-core's wrapper, which declares `let window`, with a globalThis
     * whose `window` is a getter, as the iframe's is, so assigning
     * globalThis.window throws. (A vm realm's own global would take the
     * assignment quietly.) Returns whether the wrapper's `window` is that
     * globalThis afterwards.
     */
    const wrappedWindow = (web: boolean): boolean => {
      const iframeWindow = {};
      Object.defineProperty(iframeWindow, 'window', { get: () => undefined });
      return runInContext(
        `(function (globalThis) {
          'use strict';
          let window = void 0;
          ${source}
          return window === globalThis;
        })`,
        realm({ __WEB__: web }),
      )(iframeWindow);
    };

    it("points the web wrapper's window at globalThis", () => {
      expect(wrappedWindow(true)).toBe(true);
    });

    it('leaves a read-only window alone elsewhere', () => {
      expect(wrappedWindow(false)).toBe(false);
    });
  });

  describe('addEventListener/removeEventListener', () => {
    it('installs no-op listener methods', () => {
      // BrowserPlatformLocation's onPopState and onHashChange call
      // window.addEventListener; the background thread runs no Angular.
      expect(
        runInContext(
          `({
            add: addEventListener('popstate', () => {}),
            remove: removeEventListener('popstate', () => {}),
          })`,
          realm(),
        ),
      ).toEqual({ add: undefined, remove: undefined });
    });

    it('keeps the ones the platform has', () => {
      const addEventListener = (): void => {};
      const removeEventListener = (): void => {};
      expect(
        runInContext(
          '[addEventListener, removeEventListener]',
          realm({ addEventListener, removeEventListener }),
        ),
      ).toEqual([addEventListener, removeEventListener]);
    });
  });
});
