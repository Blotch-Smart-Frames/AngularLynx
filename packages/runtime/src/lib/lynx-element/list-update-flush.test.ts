import { Injector, runInInjectionContext } from '@angular/core';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  markFirstRenderComplete,
  setInsideChangeDetection,
} from '../lynx-render-lifecycle';
import { LynxRendererFactory2 } from '../renderer/lynx-renderer-factory2';
import { LYNX_DOCUMENT } from '../renderer/token';
import { InMemoryDocument } from '../testing/in-memory-document';
import {
  afterNextFlush,
  LynxElement,
  scheduleSettleFlush,
} from './lynx-element';
import { LynxListElement } from './lynx-list-element';

/**
 * The flush that carries the lists' update-list-info, through
 * LynxRendererFactory2.end() and the settle flush: it's made even when a
 * list throws, and a UI method on a list goes with it.
 */

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const flush = vi.fn();
const addEvent = vi.fn();
/** The list whose update-list-info native refuses, if any. */
let refused: object | null = null;

/**
 * The native handler the element registered for an event.
 */
const nativeHandler = (name: string): ((event: unknown) => unknown) => {
  const calls = addEvent.mock.calls.filter((call) => call[2] === name);
  return calls.at(-1)![3].value;
};

const createFactory = () => {
  const injector = Injector.create({
    providers: [
      { provide: LYNX_DOCUMENT, useFactory: () => new InMemoryDocument() },
    ],
  });
  return runInInjectionContext(injector, () => new LynxRendererFactory2());
};

/**
 * Two lists with an item each, ready for their update, the first of them
 * refused by native.
 */
const listsOneRefused = (): void => {
  const a = new LynxListElement({} as never);
  const b = new LynxListElement({} as never);
  a.appendChild(new LynxElement({} as never));
  b.appendChild(new LynxElement({} as never));
  refused = a.element as object;
};

beforeAll(() => {
  markFirstRenderComplete();
});

beforeEach(() => {
  flush.mockReset();
  addEvent.mockClear();
  refused = null;
  vi.stubGlobal('__FlushElementTree', flush);
  vi.stubGlobal('__AddEvent', addEvent);
  let lastId = 0;
  const ids = new WeakMap<object, number>();
  vi.stubGlobal('__GetElementUniqueID', (ref: object) => {
    if (!ids.has(ref)) ids.set(ref, ++lastId);
    return ids.get(ref);
  });
  for (const name of [
    '__SetDataset',
    '__AddInlineStyle',
    '__SetInlineStyles',
    '__SetClasses',
    '__AddClass',
    '__SetID',
    '__UpdateListCallbacks',
    '__AppendElement',
    '__InsertElementBefore',
    '__RemoveElement',
    '__InvokeUIMethod',
    '__ElementAnimate',
  ]) {
    vi.stubGlobal(name, vi.fn());
  }
  vi.stubGlobal('__GetClasses', () => []);
  vi.stubGlobal('__GetAttributeByName', () => null);
  vi.stubGlobal('__GetParent', () => null);
  vi.stubGlobal('__FirstElement', () => ({}));
  vi.stubGlobal(
    '__SetAttribute',
    vi.fn((ref: object, name: string) => {
      if (name === 'update-list-info' && ref === refused) {
        throw new Error('native refused update-list-info');
      }
    }),
  );
  vi.stubGlobal('SystemInfo', { platform: 'iOS' });
  setInsideChangeDetection(false);
});

afterEach(async () => {
  await settle();
  vi.unstubAllGlobals();
});

describe('a list that throws while its update is sent', () => {
  it('leaves the cycle its flush, and the next event nothing to flush', async () => {
    const factory = createFactory();
    // A tappable view, flushed clean.
    const view = new LynxElement({} as never);
    view.addEventListener('bindtap', vi.fn());
    scheduleSettleFlush();
    await settle();
    flush.mockClear();
    const waiting = vi.fn();

    factory.begin?.();
    // The cycle writes something that needs the tree's flush, a call waits
    // for it, and two lists change, the first of which native refuses.
    view.setAttribute('class', 'pressed');
    afterNextFlush(waiting);
    listsOneRefused();
    expect(() => factory.end?.()).toThrow('native refused update-list-info');

    // The other list went with the flush, and the waiting call after it.
    expect(flush).toHaveBeenCalledExactlyOnceWith(undefined, {
      triggerLayout: true,
    });
    expect(waiting).toHaveBeenCalledOnce();
    // The class went with that flush: a tap whose listener changes nothing
    // has nothing left to flush.
    nativeHandler('tap')({ type: 'tap' });
    await settle();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('leaves the settle flush its flush, and the calls waiting for it', async () => {
    // A lazy route's elements ask for the settle flush first; its static
    // items then reach their lists. The settle flush's microtask throws what
    // the list threw: catch it where it would surface.
    const thrown: unknown[] = [];
    const queue = globalThis.queueMicrotask;
    vi.stubGlobal('queueMicrotask', (callback: () => void) =>
      queue(() => {
        try {
          callback();
        } catch (error) {
          thrown.push(error);
        }
      }),
    );
    const view = new LynxElement({} as never);
    const waiting = vi.fn();

    afterNextFlush(waiting);
    view.setAttribute('class', 'x');
    listsOneRefused();
    await settle();

    expect(flush).toHaveBeenCalledExactlyOnceWith(undefined, {
      triggerLayout: true,
    });
    expect(waiting).toHaveBeenCalledOnce();
    expect(thrown).toEqual([new Error('native refused update-list-info')]);
  });
});

describe('a UI method on a list, in the cycle that changes the list', () => {
  it('reaches native with the flush that gives the list its items', () => {
    // As a chat scrolling to its newest row from a view effect. With
    // pending invokes, native runs the call after the list's update-list-info
    // in that flush; each list used to flush after the cycle's flush, which
    // sent the call to the list while it had its old items.
    const order: string[] = [];
    flush.mockImplementation((_element?: unknown, options?: any) =>
      order.push(options?.triggerLayout ? 'flush(layout)' : 'flush'),
    );
    vi.stubGlobal(
      '__SetAttribute',
      vi.fn((_ref: unknown, name: string) => {
        if (name === 'update-list-info') order.push('update-list-info');
      }),
    );
    vi.stubGlobal(
      '__InvokeUIMethod',
      vi.fn((_ref: unknown, method: string) => order.push(`invoke ${method}`)),
    );
    const factory = createFactory();

    factory.begin?.();
    const list = new LynxListElement({} as never);
    list.appendChild(new LynxElement({} as never));
    list.invoke('scrollToPosition', { position: 0 });
    factory.end?.();

    expect(order).toEqual([
      'invoke scrollToPosition',
      'update-list-info',
      'flush(layout)',
    ]);
  });
});
