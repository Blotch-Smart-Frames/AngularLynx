import { Subject } from 'rxjs';
import type { GlobalData, InitData } from './data-flow.types';

/**
 * Host data that changes after the page has started. The engine reports each
 * change through a callback it calls by name (see global-callbacks.ts), outside
 * Angular's DI, so the callback stores the new value on `lynx` and publishes it
 * here, and LynxInitData and LynxGlobalData subscribe. Each thread runs its own
 * copy of this module, fed by that thread's callbacks: the main thread's copy
 * is the one that reaches the screen.
 */
export const initDataUpdates = new Subject<InitData>();
export const globalDataUpdates = new Subject<GlobalData>();

const asRecord = (data: unknown): Record<string, unknown> =>
  typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)
    : {};

/**
 * Merges an InitData update into `lynx.__initData`, as React Lynx does, and
 * publishes the result. `reset` starts from an empty object, for a host that
 * resets the data instead of updating it. Always builds a new object, because
 * a signal given the same object again doesn't notify its readers.
 */
export const applyInitDataUpdate = (
  data: unknown,
  reset: boolean,
): InitData => {
  const host = lynx as any;
  const next = {
    ...(reset ? {} : host.__initData),
    ...asRecord(data),
  } as InitData;
  host.__initData = next;
  initDataUpdates.next(next);
  return next;
};

/**
 * Merges a GlobalData update into `lynx.__globalProps`, as React Lynx does, and
 * publishes the result. The host sends the whole object, so the merge only
 * matters if it ever sends part of one. Builds a new object for the same reason
 * as applyInitDataUpdate().
 */
export const applyGlobalDataUpdate = (data: unknown): GlobalData => {
  const next = { ...lynx.__globalProps, ...asRecord(data) } as GlobalData;
  lynx.__globalProps = next as typeof lynx.__globalProps;
  globalDataUpdates.next(next);
  return next;
};
