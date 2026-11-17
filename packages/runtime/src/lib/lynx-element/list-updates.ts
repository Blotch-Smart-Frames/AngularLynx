import { noteNativeTreeChanged } from './tree-version';
import {
  isFirstRenderPending,
  runAfterFirstRender,
} from '../lynx-render-lifecycle';

/**
 * @internal A `<list>` whose items changed since it last told native about
 * them: a LynxListElement. `_processUpdate()` sends its update-list-info, and
 * says whether it sent one. Typed by what it does rather than by the class,
 * so that lynx-element.ts can import this module: LynxListElement extends
 * LynxElement, and importing it back into lynx-element.ts would be a cycle.
 */
export type ListUpdate = { _processUpdate(): boolean };

/**
 * The lists to tell native about with the next flush of the element tree
 * (see LynxListElement.#scheduleUpdate). A set of the JS wrappers, never of
 * native element refs (see LynxListElement.getUIChildren).
 */
const pendingListUpdates = new Set<ListUpdate>();

/**
 * The lists whose update waits for the first render to finish (see
 * processPendingListUpdates), or null when none do.
 */
let afterFirstRender: Set<ListUpdate> | null = null;

/**
 * What sending lists' update-list-info came to: whether any was sent, and
 * the first error a list threw, if one did (`threw`, since anything can be
 * thrown, `undefined` too).
 */
type Sending = { sent: boolean; threw: boolean; error: unknown };

/**
 * Nothing pending, or nothing sent yet: never changed, each sending gets its
 * own.
 */
const NOTHING_SENT: Readonly<Sending> = {
  sent: false,
  threw: false,
  error: undefined,
};

/**
 * Sends each list's update-list-info: each list, even after one has sent, so
 * they all go with one flush, and even after one has thrown (native refusing
 * its update-list-info, say), so the others aren't lost with it. The caller
 * flushes, then throws the first error (see rethrow): the flush still comes,
 * with the cycle's other writes in it.
 */
const sendListUpdates = (lists: Iterable<ListUpdate>): Sending => {
  const sending: Sending = { sent: false, threw: false, error: undefined };
  for (const list of lists) {
    try {
      if (list._processUpdate()) sending.sent = true;
    } catch (error) {
      // It may have sent its update-list-info before it threw (its callbacks
      // go after), so the flush lays out as for a list that sent.
      sending.sent = true;
      if (!sending.threw) {
        sending.threw = true;
        sending.error = error;
      }
    }
  }
  return sending;
};

/**
 * Throws the first error a list threw while its update was sent, once the
 * flush that follows has been made.
 */
const rethrow = (sending: Readonly<Sending>): void => {
  if (sending.threw) throw sending.error;
};

/**
 * The flush that lays out lists whose update-list-info was just sent, when
 * nothing else needs one: from the root, with layout, as React Lynx's flush
 * after its patch and its lists' updates (updateMainThread.ts). Its layout
 * pass is what has native ask for the lists' items (componentAtIndex). A
 * flush of the list element alone, tried early on, never had native ask for
 * them (see investigations/list-item.md). Then the first error a list threw,
 * if one did.
 */
const layOutLists = (sending: Readonly<Sending>): void => {
  if (sending.sent) {
    // Native applies the lists' updates, which take items out of them.
    noteNativeTreeChanged();
    __FlushElementTree(undefined, { triggerLayout: true });
  }
  rethrow(sending);
};

/**
 * Waits for the first render to finish before telling native about these
 * lists, and then tells it about all of them with one flush. While native's
 * first renderPage() call is under way, a list's update-list-info and the
 * layout that asks for its items would run inside it (see
 * isFirstRenderPending). Every list the first screen changes waits for the
 * same task, after it: the lists of each change detection cycle join the
 * ones before.
 */
const deferToFirstRender = (lists: readonly ListUpdate[]): void => {
  if (afterFirstRender) {
    for (const list of lists) afterFirstRender.add(list);
    return;
  }
  afterFirstRender = new Set(lists);
  runAfterFirstRender(() => {
    const deferred = afterFirstRender!;
    afterFirstRender = null;
    layOutLists(sendListUpdates(deferred));
  });
};

/**
 * Sends the pending lists' update-list-info (see sendListUpdates), or hands
 * them to the end of the first render while it's under way (see
 * deferToFirstRender). Never throws: what a list threw is in what it returns.
 */
const sendPendingListUpdates = (): Readonly<Sending> => {
  if (pendingListUpdates.size === 0) return NOTHING_SENT;
  // Copied and cleared before sending: a list scheduled while they're sent
  // waits for the next flush.
  const lists = [...pendingListUpdates];
  pendingListUpdates.clear();
  if (isFirstRenderPending()) {
    deferToFirstRender(lists);
    return NOTHING_SENT;
  }
  return sendListUpdates(lists);
};

/**
 * Sends each pending list's update-list-info, and says whether any was sent:
 * whoever calls it flushes once for all of them, if any was. No flush here.
 * A `*lynxListFor` item's change detection calls it (see bindListItem), to
 * leave its lists to the item's flush; LynxRendererFactory2.end() and the
 * settle flush send them with their own (see flushTreeWithListUpdates).
 * Throws the first error a list threw, once every list has been sent.
 *
 * Until the first render has finished, the lists wait for it instead (see
 * deferToFirstRender), and nothing is sent now.
 */
export const processPendingListUpdates = (): boolean => {
  const sending = sendPendingListUpdates();
  rethrow(sending);
  return sending.sent;
};

/**
 * @internal Flushes the element tree once, with the update-list-info of every
 * list changed since the last flush: LynxRendererFactory2.end()'s flush for a
 * change detection cycle, and the settle flush for changes outside one.
 *
 * React Lynx sends a commit's lists before its one flush ("always call this
 * before `__FlushElementTree`", updateMainThread.ts / calledByNative.ts).
 * Each list used to flush on its own after the cycle's flush: a cycle that
 * changed N lists made N + 1 flushes of the whole tree, each a native patch
 * pass that also queues work for the UI thread. One flush does what they did:
 * native resolves everything dirty first, the cycle's elements and the
 * lists' update-list-info, then lays out once, which asks each list for its
 * items. A flush with no options lays out by default (PipelineOptions'
 * `trigger_layout_`), but takes the option of the pipeline it runs in, if
 * one is under way; when lists were sent it asks for layout, as their own
 * flush did.
 *
 * The flush is always made, even when a list threw: the cycle's other writes
 * are in it, and the cycle has already noted them flushed (markTreeFlushed).
 * The first error is thrown after it.
 */
export const flushTreeWithListUpdates = (): void => {
  const sending = sendPendingListUpdates();
  // A list's updates take items out of it natively, with no __RemoveElement,
  // and a flush is when native applies them (see tree-version.ts).
  noteNativeTreeChanged();
  if (sending.sent) {
    __FlushElementTree(undefined, { triggerLayout: true });
  } else {
    __FlushElementTree();
  }
  rethrow(sending);
};

/**
 * Lists changed outside a change detection cycle, with no flush coming for
 * them: a static `<list-item>` a lazy route's component creates, before its
 * first check. Lists changed in one task share this microtask and its flush.
 * A settle flush that runs first sends them with its own (see
 * flushTreeWithListUpdates), and this finds nothing left.
 */
const flushPendingListUpdates = (): void => {
  layOutLists(sendPendingListUpdates());
};

/**
 * @internal Tells native about `list`'s items with the next flush:
 * LynxRendererFactory2.end()'s, a settle flush's, or the microtask queued
 * here if neither comes first. One microtask for all the lists that change
 * before it runs.
 */
export const scheduleListUpdate = (list: ListUpdate): void => {
  const wasEmpty = pendingListUpdates.size === 0;
  pendingListUpdates.add(list);
  if (wasEmpty) queueMicrotask(flushPendingListUpdates);
};

/**
 * @internal Forgets a list that's gone: its update would set an attribute on
 * an element native has let go of.
 */
export const cancelListUpdate = (list: ListUpdate): void => {
  pendingListUpdates.delete(list);
};
