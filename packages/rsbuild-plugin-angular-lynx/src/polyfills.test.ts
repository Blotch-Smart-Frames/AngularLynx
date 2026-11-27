import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * The tests run polyfills.js in a fresh `node:vm` realm, which has
 * ECMAScript's built-ins and none of the web's or Node's globals, as Lynx's
 * engines don't: no AbortController, no Node, no document. The module's one
 * import (vacated-slots.js, tested on its own) is left out, so the rest runs
 * as a plain script. This is the only copy of these stand-ins an app carries
 * (the runtime's went in #765), so they're tested here.
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
});
