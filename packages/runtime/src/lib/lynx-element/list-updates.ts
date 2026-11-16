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
 * Sends each list's update-list-info, and says whether any was sent: each
 * list, even after one has sent, so they all go with one flush.
 */
const sendListUpdates = (lists: Iterable<ListUpdate>): boolean => {
  let sent = false;
  for (const list of lists) {
    if (list._processUpdate()) sent = true;
  }
  return sent;
};

/**
 * The flush that lays out lists whose update-list-info was just sent, and
 * nothing else needed one: from the root, with layout, as React Lynx's
 * flush after its patch and its lists' updates (updateMainThread.ts). Its
 * layout pass is what has native ask for the lists' items (componentAtIndex,
 * synchronously inside it). From the root, not the list: native's layout
 * walks down from the root and stops at the first clean element, so a flush
 * of the list alone, under a clean parent, never reaches it; the list's
 * update-list-info marks its ancestors dirty, so a root flush does.
 */
const layOutLists = (sent: boolean): void => {
  if (sent) __FlushElementTree(undefined, { triggerLayout: true });
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
 * Sends each pending list's update-list-info, and says whether any was sent:
 * whoever calls it flushes once for all of them, if any was. No flush here.
 * LynxRendererFactory2.end() and the settle flush call it right before
 * theirs (see flushTreeWithListUpdates); a `*lynxListFor` item's change
 * detection (see bindListItem), to leave its lists to the item's flush.
 *
 * Until the first render has finished, the lists wait for it instead (see
 * deferToFirstRender), and nothing is sent now.
 */
export const processPendingListUpdates = (): boolean => {
  if (pendingListUpdates.size === 0) return false;
  // Copied and cleared before sending: a list scheduled while they're sent
  // waits for the next flush.
  const lists = [...pendingListUpdates];
  pendingListUpdates.clear();
  if (isFirstRenderPending()) {
    deferToFirstRender(lists);
    return false;
  }
  return sendListUpdates(lists);
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
 * items. Native's default is to lay out (`triggerLayout`); the option is
 * passed when lists were sent, as their own flush passed it.
 */
export const flushTreeWithListUpdates = (): void => {
  if (processPendingListUpdates()) {
    __FlushElementTree(undefined, { triggerLayout: true });
  } else {
    __FlushElementTree();
  }
};

/**
 * Lists changed outside a change detection cycle, with no flush coming for
 * them: a static `<list-item>` a lazy route's component creates, before its
 * first check. Lists changed in one task share this microtask and its flush.
 * A settle flush that runs first sends them with its own (see
 * flushTreeWithListUpdates), and this finds nothing left.
 */
const flushPendingListUpdates = (): void => {
  layOutLists(processPendingListUpdates());
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
