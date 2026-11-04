import { GlobalEvents } from './global-events';
import { NativeScreenSource } from './native-source';
import { WebScreenSource } from './web-source';

export {
  GlobalEvents,
  LynxGlobalDocument,
  type ElementLookup,
  type GlobalEventsPage,
} from './global-events';
export { installGlobalDocument, installGlobalWindow } from './window';

/**
 * Where the hub is kept: on the global, so every copy of the runtime a realm
 * loads shares one document and one window, as a browser has. `ng test`
 * loads one for the setup file and another for the specs.
 */
const KEY = Symbol.for('@blotch/angular-lynx/global-events');

/**
 * The app's `document` and `window` events (see global-events.ts).
 */
export const globalEvents = (): GlobalEvents => {
  const store = globalThis as unknown as Record<symbol, GlobalEvents>;
  store[KEY] ??= new GlobalEvents(globalThis, (events) =>
    __WEB__ ? new WebScreenSource(events) : new NativeScreenSource(events),
  );
  return store[KEY];
};
