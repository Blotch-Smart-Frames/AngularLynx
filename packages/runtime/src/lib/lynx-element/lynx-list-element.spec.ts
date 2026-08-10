import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from './lynx-element';
import {
  LynxListElement,
  processPendingListUpdates,
} from './lynx-list-element';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';

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
  globalThis.__AppendElement = vi.fn();
  globalThis.__AddClass = vi.fn();
  globalThis.__SetClasses = vi.fn();
  globalThis.__GetClasses = vi.fn(() => []);
  globalThis.__AddInlineStyle = vi.fn();
  globalThis.__SetInlineStyles = vi.fn();
  globalThis.__SetID = vi.fn();
  globalThis.__SetDataset = vi.fn();
};

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
    it('returns false for an unmarked ref', () => {
      const list = makeList();
      expect(list.isAppendedToNativeList(makeRef())).toBe(false);
    });

    it('returns true after marking', () => {
      const list = makeList();
      const ref = makeRef();
      list.markAppendedToNativeList(ref);
      expect(list.isAppendedToNativeList(ref)).toBe(true);
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
      list.appendChild(makeChild());
      globalThis.__GetAttributeByName = vi.fn(() => null);
      globalThis.__GetElementUniqueID = vi.fn(() => 123);

      list._processUpdate();

      const [, , payload] = (
        globalThis.__SetAttribute as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(payload.insertAction[0]['item-key']).toBe('123');
    });

    it('calls __FlushElementTree after sending update-list-info', () => {
      const list = makeList();
      list.appendChild(makeChild());

      list._processUpdate();

      expect(globalThis.__FlushElementTree).toHaveBeenCalled();
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
      list.markAppendedToNativeList(child.element);
      list._processUpdate(); // commit initial state

      list.removeVirtualChild(child);
      list._processUpdate();

      expect(list.isAppendedToNativeList(child.element)).toBe(false);
    });

    it('is a no-op after the list is destroyed', () => {
      const list = makeList();
      list.appendChild(makeChild());
      list._processUpdate(); // commit initial state
      list.remove(); // #destroyed = true
      vi.clearAllMocks();

      list._processUpdate();

      expect(globalThis.__SetAttribute).not.toHaveBeenCalled();
    });
  });
});
