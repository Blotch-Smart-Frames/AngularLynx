import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';
import { INHERITANCE_CLASS } from './text-flow';
import { processPendingListUpdates } from './list-updates';
import {
  type ListItemAttributes,
  type ListSlot,
  LynxListElement,
  type LynxListItemSource,
} from './lynx-list-element';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import { seededBelow, untrimmedListDiff } from '../testing/untrimmed-list-diff';

/**
 * Fake ElementRef — the Lynx PAPI handles have no runtime structure. Each carries
 * a distinct __uid so the __GetElementUniqueID mock can return a stable, unique
 * number per element. That mirrors the real engine, where _processUpdate()'s diff
 * keys on __GetElementUniqueID (a number) rather than element-object identity — a
 * constant ID would make distinct elements collide and break the diff.
 */
let uidCounter = 0;
const makeRef = (): ElementRef => ({ __uid: ++uidCounter }) as ElementRef;
const makeChild = (): LynxElement => new LynxElement(makeRef());
const makeList = (): LynxListElement => new LynxListElement(makeRef());

/**
 * All globals that any code path in LynxListElement / LynxElement can reach.
 */
const setupGlobals = () => {
  globalThis.__SetAttribute = vi.fn();
  globalThis.__GetAttributeByName = vi.fn(() => null);
  globalThis.__GetElementUniqueID = vi.fn(
    (ref: { __uid?: number }) => ref?.__uid ?? 42,
  );
  globalThis.__FlushElementTree = vi.fn();
  globalThis.__RemoveElement = vi.fn();
  globalThis.__GetParent = vi.fn(() => null);
  // An element moved into a list from another parent leaves that parent at
  // the end of the cycle, and its native element with it, so it's rebuilt
  // (see LynxElement's #rebuildDeadListItems): as on a device, where the
  // removal reads the parent the element was put in.
  globalThis.__CreateView = vi.fn(() => makeRef());
  globalThis.__CreateText = vi.fn(() => makeRef());
  globalThis.__AppendElement = vi.fn();
  globalThis.__AddClass = vi.fn();
  globalThis.__SetClasses = vi.fn();
  globalThis.__GetClasses = vi.fn(() => []);
  globalThis.__AddInlineStyle = vi.fn();
  globalThis.__SetInlineStyles = vi.fn();
  globalThis.__SetID = vi.fn();
  globalThis.__SetDataset = vi.fn();
};

/**
 * The items the list last told native about, by native index.
 */
const committedSlots = (list: LynxListElement): ListSlot[] => {
  const slots: ListSlot[] = [];
  for (let slot = list.committedSlot(0); slot;) {
    slots.push(slot);
    slot = list.committedSlot(slots.length);
  }
  return slots;
};

/**
 * The update-list-info payloads the list sent since the mock was cleared.
 */
const sentInfo = (): unknown[] =>
  vi
    .mocked(globalThis.__SetAttribute)
    .mock.calls.filter(([, name]) => name === 'update-list-info')
    .map(([, , info]) => info);

describe('LynxListElement', () => {
  beforeEach(setupGlobals);
  // _processUpdate() defers all of its work while the first bootstrap render is
  // still pending (see lynx-render-lifecycle). These are unit tests of the diff
  // itself, so flip the first-render latch to "done" up front — otherwise every
  // update would be parked on a setTimeout and nothing would ever flush.
  beforeEach(() => markFirstRenderComplete());

  // Drain any pending updates after each test so module-level state doesn't
  // leak between tests. The set is checked before processing to avoid
  // unexpected _processUpdate calls on already-destroyed lists.
  afterEach(() => processPendingListUpdates());

  // ─── Virtual tree: appendChild ────────────────────────────────────────────

  describe('appendChild', () => {
    it('skips root page elements', () => {
      const list = makeList();
      const child = makeChild();
      child.isRootPageElement = true;

      list.appendChild(child);

      expect(list.getUIChildren()).toHaveLength(0);
    });

    it('sets virtualParent/Prev/Next for the first child', () => {
      const list = makeList();
      const child = makeChild();

      list.appendChild(child);

      expect(child._virtualParent).toBe(list);
      expect(child._virtualPrev).toBeNull();
      expect(child._virtualNext).toBeNull();
    });

    it('links two children in order', () => {
      const list = makeList();
      const first = makeChild();
      const second = makeChild();

      list.appendChild(first);
      list.appendChild(second);

      expect(first._virtualNext).toBe(second);
      expect(second._virtualPrev).toBe(first);
      expect(second._virtualNext).toBeNull();
    });

    it('maintains correct chain for three children', () => {
      const list = makeList();
      const a = makeChild();
      const b = makeChild();
      const c = makeChild();

      list.appendChild(a);
      list.appendChild(b);
      list.appendChild(c);

      expect(a._virtualNext).toBe(b);
      expect(b._virtualPrev).toBe(a);
      expect(b._virtualNext).toBe(c);
      expect(c._virtualPrev).toBe(b);
      expect(c._virtualNext).toBeNull();
    });
  });

  // ─── Passing text styles down ─────────────────────────────────────────────

  describe('text styles for the HTML text inside', () => {
    // What an item's own appendChild reads of the native tree: nothing yet.
    beforeEach(() => {
      vi.stubGlobal('__FirstElement', () => null);
      vi.stubGlobal('__NextElement', () => null);
      vi.stubGlobal('__GetTag', () => 'view');
    });
    afterEach(() => vi.unstubAllGlobals());

    /**
     * Whether `el` was given the class the build's copies of text styles to
     * variables apply to (see LynxElement's #passTextStyles).
     */
    const passes = (el: LynxElement): boolean =>
      vi
        .mocked(globalThis.__AddClass)
        .mock.calls.some(
          ([ref, name]) => ref === el.element && name === INHERITANCE_CLASS,
        );

    /**
     * An item with an HTML text tag (a `<p>`) inside.
     */
    const itemWithText = (): LynxElement => {
      const item = makeChild();
      const p = makeChild();
      p.tagName = 'text';
      p.markWebText(false);
      item.appendChild(p);
      return item;
    };

    it('passes them through an appended item', () => {
      const list = makeList();
      const item = itemWithText();

      list.appendChild(item);

      expect(passes(item)).toBe(true);
      expect(passes(list)).toBe(true);
    });

    it('passes them through an item inserted before another', () => {
      const list = makeList();
      const ref = makeChild();
      list.appendChild(ref);
      const item = itemWithText();

      list.insertBefore(item, ref);

      expect(passes(list)).toBe(true);
    });

    it('passes them through an HTML text tag that is an item itself', () => {
      const list = makeList();
      const p = makeChild();
      p.markWebText(false);

      list.appendChild(p);

      expect(passes(list)).toBe(true);
    });

    it("passes them through a list source's item", () => {
      const list = makeList();
      const item = itemWithText();
      item._ownedByListSource = true;

      list.appendChild(item);

      expect(passes(list)).toBe(true);
    });

    it('passes them through an item that moved in from a view, once text goes in', () => {
      const view = makeChild();
      const item = makeChild();
      view.appendChild(item);
      const list = makeList();
      list.appendChild(item);
      const p = makeChild();
      p.tagName = 'text';
      p.markWebText(false);

      item.appendChild(p);

      expect(passes(list)).toBe(true);
    });

    it('passes none through an item with no HTML text inside', () => {
      const list = makeList();

      list.appendChild(makeChild());

      expect(passes(list)).toBe(false);
    });
  });

  // ─── Virtual tree: insertBefore ───────────────────────────────────────────

  describe('insertBefore', () => {
    it('skips root page elements', () => {
      const list = makeList();
      const ref = makeChild();
      list.appendChild(ref);
      const child = makeChild();
      child.isRootPageElement = true;

      list.insertBefore(child, ref);

      expect(list.getUIChildren()).toHaveLength(1);
    });

    it('delegates to appendChild when refChild is null', () => {
      const list = makeList();
      const child = makeChild();

      list.insertBefore(child, null);

      expect(child._virtualParent).toBe(list);
    });

    it('inserts before the head element', () => {
      const list = makeList();
      const existing = makeChild();
      list.appendChild(existing);
      const newChild = makeChild();

      list.insertBefore(newChild, existing);

      expect(newChild._virtualPrev).toBeNull();
      expect(newChild._virtualNext).toBe(existing);
      expect(existing._virtualPrev).toBe(newChild);
    });

    it('inserts in the middle of the list', () => {
      const list = makeList();
      const first = makeChild();
      const last = makeChild();
      list.appendChild(first);
      list.appendChild(last);
      const middle = makeChild();

      list.insertBefore(middle, last);

      expect(first._virtualNext).toBe(middle);
      expect(middle._virtualPrev).toBe(first);
      expect(middle._virtualNext).toBe(last);
      expect(last._virtualPrev).toBe(middle);
    });
  });

  // ─── Virtual tree: removeVirtualChild ─────────────────────────────────────

  describe('removeVirtualChild', () => {
    it('removes the only child and clears its pointers', () => {
      const list = makeList();
      const child = makeChild();
      list.appendChild(child);

      list.removeVirtualChild(child);

      expect(child._virtualParent).toBeNull();
      expect(child._virtualPrev).toBeNull();
      expect(child._virtualNext).toBeNull();
      expect(list.getUIChildren()).toHaveLength(0);
    });

    it('removes the head of a two-child list', () => {
      const list = makeList();
      const first = makeChild();
      const second = makeChild();
      list.appendChild(first);
      list.appendChild(second);

      list.removeVirtualChild(first);

      expect(second._virtualPrev).toBeNull();
      expect(list.getUIChildren()).toEqual([second.element]);
    });

    it('removes the tail of a two-child list', () => {
      const list = makeList();
      const first = makeChild();
      const second = makeChild();
      list.appendChild(first);
      list.appendChild(second);

      list.removeVirtualChild(second);

      expect(first._virtualNext).toBeNull();
      expect(list.getUIChildren()).toEqual([first.element]);
    });

    it('removes a middle element from a three-child list', () => {
      const list = makeList();
      const first = makeChild();
      const middle = makeChild();
      const last = makeChild();
      list.appendChild(first);
      list.appendChild(middle);
      list.appendChild(last);

      list.removeVirtualChild(middle);

      expect(first._virtualNext).toBe(last);
      expect(last._virtualPrev).toBe(first);
      expect(list.getUIChildren()).toEqual([first.element, last.element]);
    });

    it('does not call __RemoveElement (list children are managed via update-list-info)', () => {
      const list = makeList();
      const child = makeChild();
      list.appendChild(child);
      processPendingListUpdates();
      vi.clearAllMocks();

      list.removeVirtualChild(child);
      processPendingListUpdates();

      expect(globalThis.__RemoveElement).not.toHaveBeenCalled();
    });
  });

  // ─── getUIChildren ────────────────────────────────────────────────────────

  describe('getUIChildren', () => {
    it('returns empty array for an empty list', () => {
      expect(makeList().getUIChildren()).toEqual([]);
    });

    it('returns ElementRefs for all normal children', () => {
      const list = makeList();
      const a = makeChild();
      const b = makeChild();
      list.appendChild(a);
      list.appendChild(b);

      expect(list.getUIChildren()).toEqual([a.element, b.element]);
    });

    it('excludes comment anchors (tagName === "comment") from UI children', () => {
      const list = makeList();
      const real = makeChild();
      const comment = makeChild();
      // NoneElements are the invisible <view>s LynxDocument.createComment()
      // makes for @for/@if anchors; they are identified solely by tagName.
      comment.tagName = 'comment';

      list.appendChild(real);
      list.appendChild(comment);

      expect(list.getUIChildren()).toEqual([real.element]);
    });
  });

  // ─── isAppendedToNativeList / markAppendedToNativeList ───────────────────

  describe('isAppendedToNativeList / markAppendedToNativeList', () => {
    it('returns false for an unmarked element', () => {
      const list = makeList();
      expect(list.isAppendedToNativeList(makeChild().uniqueId)).toBe(false);
    });

    it('returns true after marking', () => {
      const list = makeList();
      const { uniqueId } = makeChild();
      list.markAppendedToNativeList(uniqueId);
      expect(list.isAppendedToNativeList(uniqueId)).toBe(true);
    });

    it('keeps the mark off the element ref, which on Lynx keeps no property', () => {
      const list = makeList();
      const child = makeChild();
      Object.freeze(child.element);

      list.markAppendedToNativeList(child.uniqueId);

      expect(list.isAppendedToNativeList(child.uniqueId)).toBe(true);
      expect(list.holdsInNativeList(child)).toBe(true);
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('prevents _processUpdate from running after destruction', () => {
      const list = makeList();
      list.appendChild(makeChild()); // adds list to pendingListUpdates
      const spy = vi.spyOn(list, '_processUpdate');

      list.remove(); // marks destroyed, removes from pendingListUpdates
      processPendingListUpdates();

      expect(spy).not.toHaveBeenCalled();
    });

    it('prevents further scheduling after destruction', () => {
      const list = makeList();
      list.remove();
      const spy = vi.spyOn(list, '_processUpdate');

      list.appendChild(makeChild()); // #scheduleUpdate checks #destroyed first
      processPendingListUpdates();

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ─── processPendingListUpdates ────────────────────────────────────────────

  describe('processPendingListUpdates', () => {
    it('is a no-op when there are no pending updates', () => {
      expect(() => processPendingListUpdates()).not.toThrow();
    });

    it('calls _processUpdate on every pending list', () => {
      const listA = makeList();
      const listB = makeList();
      const spyA = vi.spyOn(listA, '_processUpdate');
      const spyB = vi.spyOn(listB, '_processUpdate');

      listA.appendChild(makeChild());
      listB.appendChild(makeChild());
      processPendingListUpdates();

      expect(spyA).toHaveBeenCalledOnce();
      expect(spyB).toHaveBeenCalledOnce();
    });

    it('clears the pending set so a second call is a no-op', () => {
      const list = makeList();
      const spy = vi.spyOn(list, '_processUpdate');

      list.appendChild(makeChild());
      processPendingListUpdates();
      processPendingListUpdates(); // second call — set is already empty

      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ─── _processUpdate ───────────────────────────────────────────────────────

  describe('_processUpdate', () => {
    it('sends insertAction for newly added children', () => {
      const list = makeList();
      const child = makeChild();
      list.appendChild(child);
      globalThis.__GetElementUniqueID = vi.fn(() => 99);

      list._processUpdate();

      const [, attr, payload] = (
        globalThis.__SetAttribute as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(attr).toBe('update-list-info');
      expect(payload.insertAction).toHaveLength(1);
      expect(payload.insertAction[0].position).toBe(0);
      expect(payload.insertAction[0].type).toBe('list-item');
      expect(payload.removeAction).toHaveLength(0);
    });

    /**
     * A `<list-item>` element child, as a template's makes one.
     */
    const makeItem = (): LynxElement => {
      const item = makeChild();
      item.tagName = 'list-item';
      return item;
    };

    it("sends an element item's layout attributes, which native reads only from update-list-info", () => {
      const list = makeList();
      const plain = makeItem();
      const header = makeItem();
      // As a template sets them: a static attribute's string, a binding's
      // boolean or number.
      header.setAttribute('full-span', 'true');
      header.setAttribute('sticky-top', true);
      header.setAttribute('estimated-main-axis-size-px', '120');
      header.setAttribute('recyclable', 'false');
      // They're set on the element all the same.
      expect(globalThis.__SetAttribute).toHaveBeenCalledWith(
        header.element,
        'full-span',
        'true',
      );
      list.appendChild(header);
      list.appendChild(plain);
      vi.clearAllMocks();

      list._processUpdate();

      const [info] = sentInfo() as {
        insertAction: Record<string, unknown>[];
      }[];
      expect(info!.insertAction[0]).toMatchObject({
        position: 0,
        type: 'list-item',
        'full-span': true,
        'sticky-top': true,
        'estimated-main-axis-size-px': 120,
        recyclable: false,
      });
      // An item without any sends only what it did.
      expect(Object.keys(info!.insertAction[1]!).sort()).toEqual([
        'item-key',
        'position',
        'type',
      ]);
    });

    it("updates an element item in place when its layout attributes change, and leaves another element's alone", () => {
      const list = makeList();
      const item = makeItem();
      const view = makeChild();
      list.appendChild(item);
      list.appendChild(view);
      list._processUpdate();
      vi.clearAllMocks();

      // A <view> isn't an item native lays out by them.
      view.setAttribute('full-span', true);
      expect(processPendingListUpdates).not.toThrow();
      expect(sentInfo()).toEqual([]);

      item.setAttribute('full-span', true);
      processPendingListUpdates();
      const [info] = sentInfo() as {
        insertAction: unknown[];
        updateAction: Record<string, unknown>[];
      }[];
      expect(info!.insertAction).toEqual([]);
      expect(info!.updateAction).toEqual([
        expect.objectContaining({
          from: 0,
          to: 0,
          flush: false,
          'full-span': true,
        }),
      ]);

      // Taking it away updates it again, without it.
      vi.clearAllMocks();
      item.setAttribute('full-span', null);
      processPendingListUpdates();
      const [after] = sentInfo() as {
        updateAction: Record<string, unknown>[];
      }[];
      expect(after!.updateAction[0]).not.toHaveProperty('full-span');
    });

    it('sends the attributes an item had before it joined the list, a bare one as true', () => {
      const item = makeItem();
      // A bare `sticky-bottom` in a template arrives as an empty string.
      item.setAttribute('sticky-bottom', '');
      const list = makeList();
      list.appendChild(item);
      vi.clearAllMocks();

      list._processUpdate();

      const [info] = sentInfo() as {
        insertAction: Record<string, unknown>[];
      }[];
      expect(info!.insertAction[0]).toMatchObject({ 'sticky-bottom': true });
    });

    it('sends removeAction for children removed since last commit', () => {
      const list = makeList();
      const child = makeChild();
      list.appendChild(child);
      list._processUpdate(); // commit initial state
      vi.clearAllMocks();

      list.removeVirtualChild(child);
      list._processUpdate();

      const [, attr, payload] = (
        globalThis.__SetAttribute as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(attr).toBe('update-list-info');
      expect(payload.removeAction).toEqual([0]);
      expect(payload.insertAction).toHaveLength(0);
    });

    it('skips sending update-list-info when the diff is empty', () => {
      const list = makeList();
      const child = makeChild();
      list.appendChild(child);
      list._processUpdate(); // commit initial state
      vi.clearAllMocks();

      list._processUpdate(); // nothing changed

      const updateListInfoCalls = (
        globalThis.__SetAttribute as ReturnType<typeof vi.fn>
      ).mock.calls.filter(([, name]) => name === 'update-list-info');
      expect(updateListInfoCalls).toHaveLength(0);
    });

    it('uses the item-key attribute when present', () => {
      const list = makeList();
      list.appendChild(makeChild());
      globalThis.__GetAttributeByName = vi.fn(() => 'my-key');

      list._processUpdate();

      const [, , payload] = (
        globalThis.__SetAttribute as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(payload.insertAction[0]['item-key']).toBe('my-key');
    });

    it('falls back to the element unique ID as item-key when attribute is absent', () => {
      const list = makeList();
      globalThis.__GetAttributeByName = vi.fn(() => null);
      globalThis.__GetElementUniqueID = vi.fn(() => 123);
      list.appendChild(makeChild());

      list._processUpdate();

      const [, , payload] = (
        globalThis.__SetAttribute as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(payload.insertAction[0]['item-key']).toBe('123');
    });

    it('says whether it sent update-list-info, and leaves the flush to its caller', () => {
      const list = makeList();
      list.appendChild(makeChild());

      expect(list._processUpdate()).toBe(true);
      // Nothing changed since: nothing to send.
      expect(list._processUpdate()).toBe(false);
      // One flush lays out every list sent with it, and the rest of the tree
      // (see flushTreeWithListUpdates).
      expect(globalThis.__FlushElementTree).not.toHaveBeenCalled();
    });

    it('does NOT write a trailing empty update-list-info (clearing corrupts native state)', () => {
      const list = makeList();
      list.appendChild(makeChild());

      list._processUpdate();

      // Exactly one update-list-info write — the computed diff — and never an
      // empty { insertAction: [], removeAction: [] } "reset" afterward. Native
      // consumes the diff once during the flush; a follow-up empty write leaves
      // every cell stuck "binding" (see lynx-vs-web-differences.md). React Lynx
      // never clears it either.
      const updateListInfoCalls = (
        globalThis.__SetAttribute as ReturnType<typeof vi.fn>
      ).mock.calls.filter(([, name]) => name === 'update-list-info');
      expect(updateListInfoCalls).toHaveLength(1);
      const [, , payload] = updateListInfoCalls[0];
      expect(payload.insertAction).toHaveLength(1);
      expect(payload.removeAction).toHaveLength(0);
    });

    it('removes removed items from appendedToNativeList so they can be re-appended', () => {
      const list = makeList();
      const child = makeChild();
      list.appendChild(child);
      list.markAppendedToNativeList(child.uniqueId);
      list._processUpdate(); // commit initial state

      list.removeVirtualChild(child);
      list._processUpdate();

      expect(list.isAppendedToNativeList(child.uniqueId)).toBe(false);
    });

    it('is a no-op after the list is destroyed', () => {
      const list = makeList();
      list.appendChild(makeChild());
      list._processUpdate(); // commit initial state
      list.remove(); // #destroyed = true
      vi.clearAllMocks();

      expect(list._processUpdate()).toBe(false);

      expect(globalThis.__SetAttribute).not.toHaveBeenCalled();
    });

    it('re-registers the list callbacks alongside every update-list-info', () => {
      // The native engine (unlike the web polyfill) does not invoke
      // componentAtIndex for a fresh update-list-info unless the callbacks are
      // re-registered too — mirrors React Lynx's flush() behavior.
      globalThis.__UpdateListCallbacks = vi.fn();

      const list = makeList();
      const componentAtIndex = vi.fn();
      const enqueueComponent = vi.fn();
      const componentAtIndexes = vi.fn();
      list.setCallbacks(componentAtIndex, enqueueComponent, componentAtIndexes);

      list.appendChild(makeChild());
      list._processUpdate();

      expect(globalThis.__UpdateListCallbacks).toHaveBeenCalledWith(
        list.element,
        componentAtIndex,
        enqueueComponent,
        componentAtIndexes,
      );
    });

    it('does not re-register when the list has no callbacks (defensive branch)', () => {
      // setCallbacks was never called, so the if-guard short-circuits and
      // __UpdateListCallbacks is not invoked. Prevents a crash on lists that
      // are appended-to before their creator wires up the callbacks.
      globalThis.__UpdateListCallbacks = vi.fn();

      const list = makeList();
      list.appendChild(makeChild());
      list._processUpdate();

      expect(globalThis.__UpdateListCallbacks).not.toHaveBeenCalled();
    });
  });

  describe('moves', () => {
    it('removes a reordered child from where it was and inserts it where it is', () => {
      const list = makeList();
      const [a, b, c] = [makeChild(), makeChild(), makeChild()];
      list.appendChild(a);
      list.appendChild(b);
      list.appendChild(c);
      list._processUpdate();
      list.markAppendedToNativeList(c.uniqueId);
      vi.mocked(globalThis.__SetAttribute).mockClear();

      // Angular moves a view by taking it out and putting it back.
      c.remove();
      list.insertBefore(c, a);
      list._processUpdate();

      const [, , payload] = vi
        .mocked(globalThis.__SetAttribute)
        .mock.calls.find(([, name]) => name === 'update-list-info')!;
      const info = payload as {
        insertAction: Array<{ position: number }>;
        removeAction: number[];
      };
      // a and b keep their order: only c moves.
      expect(info.removeAction).toEqual([2]);
      expect(info.insertAction.map((action) => action.position)).toEqual([0]);
      // Still appended: native asks for it again, by the same element.
      expect(list.isAppendedToNativeList(c.uniqueId)).toBe(true);
    });
  });

  describe('the unchanged ends', () => {
    /** A run of items the test edits, as `*lynxListFor` would. */
    type TestRun = {
      readonly id: number;
      readonly anchor: LynxElement;
      keys: string[];
      types: string[];
      attributes: Array<ListItemAttributes | undefined>;
    };

    it('sends what the diff over every item sent, over random edits', () => {
      const below = seededBelow(20261116);
      // Some elements have an item-key of their own.
      globalThis.__GetAttributeByName = vi.fn(
        (ref: ElementRef) => (ref as { itemKey?: string }).itemKey ?? null,
      );
      const list = makeList();
      /** The list's children in order: elements, and the runs' anchors. */
      const children: LynxElement[] = [];
      const runs: TestRun[] = [1, 2].map((id) => {
        const anchor = makeChild();
        anchor.tagName = 'comment';
        list.appendChild(anchor);
        children.push(anchor);
        const run: TestRun = {
          id,
          anchor,
          keys: [],
          types: [],
          attributes: [],
        };
        const source: LynxListItemSource = {
          id,
          // A new run each time, as `*lynxListFor` makes.
          commit: () => ({
            keys: [...run.keys],
            types: [...run.types],
            attributes: [...run.attributes],
          }),
          bind: () => null,
          enqueue: () => false,
          elementIds: () => [],
        };
        list.attachItemSource(anchor, source);
        return run;
      });
      let nextKey = 1;

      const elements = () =>
        children.filter((child) => child.tagName !== 'comment');
      const place = (child: LynxElement) => {
        const index = below(children.length + 1);
        list.insertBefore(child, children[index] ?? null);
        children.splice(index, 0, child);
      };
      const takeOut = (child: LynxElement) => {
        list.removeVirtualChild(child);
        children.splice(children.indexOf(child), 1);
      };
      const someRun = () => runs[below(runs.length)]!;
      const someAttributes = (): ListItemAttributes | undefined =>
        [
          undefined,
          { 'estimated-main-axis-size-px': 40 },
          { 'estimated-main-axis-size-px': 80 },
          { 'full-span': true, 'sticky-top': true },
        ][below(4)];
      const putItem = (run: TestRun, at: number, item: [string, string]) => {
        run.keys.splice(at, 0, item[0]);
        run.types.splice(at, 0, item[1]);
        run.attributes.splice(at, 0, someAttributes());
      };
      const takeItem = (run: TestRun, at: number): [string, string] => {
        const [key] = run.keys.splice(at, 1);
        const [type] = run.types.splice(at, 1);
        run.attributes.splice(at, 1);
        return [key!, type!];
      };
      const edits: Array<() => void> = [
        // An element comes, at the end or anywhere.
        () => {
          if (elements().length >= 12) return;
          const child = makeChild();
          if (below(3) === 0) {
            (child.element as { itemKey?: string }).itemKey = `e${nextKey++}`;
          }
          list.appendChild(child);
          children.push(child);
        },
        () => {
          if (elements().length < 12) place(makeChild());
        },
        // One goes.
        () => {
          const all = elements();
          if (all.length > 0) takeOut(all[below(all.length)]!);
        },
        // One moves, as Angular moves a view: out, then in again.
        () => {
          const all = elements();
          if (all.length === 0) return;
          const child = all[below(all.length)]!;
          takeOut(child);
          place(child);
        },
        // A run moves with its anchor.
        () => {
          const { anchor } = someRun();
          takeOut(anchor);
          place(anchor);
        },
        // A run's item comes, goes or moves.
        () => {
          const run = someRun();
          if (run.keys.length >= 10) return;
          const type = below(4) === 0 ? 'header' : 'list-item';
          putItem(run, below(run.keys.length + 1), [`k${nextKey++}`, type]);
        },
        () => {
          const run = someRun();
          if (run.keys.length > 0) takeItem(run, below(run.keys.length));
        },
        () => {
          const run = someRun();
          if (run.keys.length === 0) return;
          const item = takeItem(run, below(run.keys.length));
          putItem(run, below(run.keys.length + 1), item);
        },
        // A run's item gets other layout attributes, at either end or
        // between, or another type, which makes it a new item to native.
        () => {
          const run = someRun();
          if (run.keys.length === 0) return;
          run.attributes[below(run.keys.length)] = someAttributes();
        },
        () => {
          const run = someRun();
          if (run.keys.length === 0) return;
          const at = below(run.keys.length);
          run.types[at] = run.types[at] === 'header' ? 'list-item' : 'header';
        },
      ];

      /**
       * The ids the list should have committed, from the test's model.
       */
      const modelIds = () =>
        children.flatMap((child) => {
          const run = runs.find((r) => r.anchor === child);
          if (!run) return [`#${__GetElementUniqueID(child.element)}`];
          return run.keys.map((key, i) => `${run.id}|${run.types[i]}|${key}`);
        });
      // Where the updates landed, against the items before the first change
      // and after the last: the cases trimming the ends has to keep.
      const updatesAt = { before: 0, between: 0, after: 0 };

      for (let step = 0; step < 3000; step++) {
        const count = 1 + below(3);
        for (let e = 0; e < count; e++) edits[below(edits.length)]!();
        const before = committedSlots(list);
        for (const slot of before) {
          if (slot.ref) {
            list.markAppendedToNativeList(__GetElementUniqueID(slot.ref));
          }
        }
        vi.mocked(globalThis.__SetAttribute).mockClear();

        list._processUpdate();

        const after = committedSlots(list);
        expect(after.map((slot) => slot.id)).toEqual(modelIds());
        const expected = untrimmedListDiff(before, after);
        expect(sentInfo()).toStrictEqual(expected ? [expected.info] : []);
        for (const slot of before) {
          if (!slot.ref) continue;
          expect(
            list.isAppendedToNativeList(__GetElementUniqueID(slot.ref)),
          ).toBe(!expected?.noLongerAppended.includes(slot.ref));
        }

        let start = 0;
        while (
          start < Math.min(before.length, after.length) &&
          before[start]!.id === after[start]!.id
        ) {
          start++;
        }
        let end = 0;
        while (
          end < Math.min(before.length, after.length) - start &&
          before[before.length - 1 - end]!.id ===
            after[after.length - 1 - end]!.id
        ) {
          end++;
        }
        for (const action of expected?.info.updateAction ?? []) {
          const position = action['position'] as number;
          if (position < start) updatesAt.before++;
          else if (position >= after.length - end) updatesAt.after++;
          else updatesAt.between++;
        }
      }

      expect(updatesAt.before).toBeGreaterThan(50);
      expect(updatesAt.between).toBeGreaterThan(50);
      expect(updatesAt.after).toBeGreaterThan(50);
    });

    it('asks native for an element’s unique id once, not on every update', () => {
      const list = makeList();
      for (let i = 0; i < 1000; i++) list.appendChild(makeChild());
      list._processUpdate();
      vi.mocked(globalThis.__GetElementUniqueID).mockClear();
      vi.mocked(globalThis.__SetAttribute).mockClear();

      // Its LynxElement asks once, as it's made, and the list takes the id
      // from it: none for the 1,000 the list knows already, nor for this one.
      const child = makeChild();
      list.appendChild(child);
      list._processUpdate();

      expect(globalThis.__GetElementUniqueID).toHaveBeenCalledTimes(1);
      expect(sentInfo()).toEqual([
        {
          insertAction: [
            {
              position: 1000,
              type: 'list-item',
              'item-key': String(__GetElementUniqueID(child.element)),
            },
          ],
          removeAction: [],
          updateAction: [],
        },
      ]);
    });

    it('diffs an element made again by the unique id of its new native element', () => {
      const list = makeList();
      const child = makeChild();
      list.appendChild(child);
      list._processUpdate();
      vi.mocked(globalThis.__SetAttribute).mockClear();

      // LynxElement swaps in a new native element when it makes one again
      // (#recreateSubtree), whose unique id is its own.
      const fresh = makeRef();
      Object.defineProperty(child, 'element', { get: () => fresh });
      Object.defineProperty(child, 'uniqueId', {
        get: () => __GetElementUniqueID(fresh),
      });
      list._processUpdate();

      expect(sentInfo()).toEqual([
        {
          insertAction: [
            {
              position: 0,
              type: 'list-item',
              'item-key': String(__GetElementUniqueID(fresh)),
            },
          ],
          removeAction: [0],
          updateAction: [],
        },
      ]);
    });
  });

  describe('item sources', () => {
    it('lets go of an element of no source as before', () => {
      const list = makeList();
      expect(() => list.enqueue(123)).not.toThrow();
    });

    it('asks each source in turn whose an element native let go of is', () => {
      const list = makeList();
      const anchor = makeChild();
      anchor.tagName = 'comment';
      list.appendChild(anchor);
      const first = {
        id: 1,
        commit: () => ({ keys: [], types: [], attributes: [] }),
        bind: () => null,
        enqueue: vi.fn(() => false),
        elementIds: () => [],
      };
      const second = { ...first, id: 2, enqueue: vi.fn(() => true) };
      list.attachItemSource(anchor, first);
      list.attachItemSource(anchor, second);

      list.enqueue(7);
      expect(first.enqueue).toHaveBeenCalledWith(7);
      expect(second.enqueue).toHaveBeenCalledWith(7);

      list.detachItemSource(second);
      second.enqueue.mockClear();
      list.enqueue(8);
      expect(second.enqueue).not.toHaveBeenCalled();
    });

    it('forgets that it appended a source’s elements when the source leaves', () => {
      const list = makeList();
      const anchor = makeChild();
      anchor.tagName = 'comment';
      list.appendChild(anchor);
      const [built, other] = [makeChild(), makeChild()];
      const source: LynxListItemSource = {
        id: 1,
        commit: () => ({ keys: [], types: [], attributes: [] }),
        bind: () => null,
        enqueue: () => false,
        elementIds: () => [built.uniqueId],
      };
      list.attachItemSource(anchor, source);
      list.markAppendedToNativeList(built.uniqueId);
      list.markAppendedToNativeList(other.uniqueId);

      list.detachItemSource(source);

      expect(list.isAppendedToNativeList(built.uniqueId)).toBe(false);
      expect(list.isAppendedToNativeList(other.uniqueId)).toBe(true);
    });

    it('keeps a source’s item element out of its children', () => {
      const list = makeList();
      const item = makeChild();
      item._ownedByListSource = true;

      list.insertBefore(item, makeChild());

      expect(list.virtualChildren()).toEqual([]);
      expect(item.parentNode()).toBe(list);
      item.remove();
      expect(item._virtualParent).toBeNull();
    });
  });

  describe('committedSlot', () => {
    it('exposes the committed items by native index for componentAtIndex', () => {
      // componentAtIndex reads from this method (never getUIChildren, which
      // walks the children inside native's layout pass).
      const list = makeList();
      const a = makeChild();
      const b = makeChild();
      list.appendChild(a);
      list.appendChild(b);
      list._processUpdate();

      expect(list.committedSlot(0)?.ref).toBe(a.element);
      expect(list.committedSlot(1)?.ref).toBe(b.element);
      expect(list.committedSlot(2)).toBeUndefined();
    });
  });
});
