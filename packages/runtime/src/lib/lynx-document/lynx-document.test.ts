import {
  type MockInstance,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxElement } from '../lynx-element';
import { LynxListElement } from '../lynx-element/lynx-list-element';
import { LynxDocument } from './lynx-document';

/**
 * Counter for generating unique fake ElementRef handles per test.
 */
let _refCounter = 0;

/**
 * Lynx ElementRef handles are opaque objects with no runtime structure.
 * `as unknown as T` lets us hand a plain object to any branded ElementRef slot
 * without producing a real branded value (which only the native engine creates).
 */
const makeRef = <T extends ElementRef = ElementRef>(): T =>
  ({ _id: ++_refCounter }) as unknown as T;

const mock = <T>(impl: T) => vi.fn(impl as any) as unknown as T;

/**
 * Casts a global PAPI function (typed as the real signature) to a Vitest mock
 * for use in assertions. The mock() helper installs a vi.fn() at runtime;
 * this cast lets TypeScript's type checker agree.
 */
const asMock = (fn: unknown) => fn as unknown as MockInstance;

const setupGlobals = () => {
  _refCounter = 0;
  globalThis.__CreatePage = mock(() => makeRef());
  globalThis.__CreateView = mock(() => makeRef());
  globalThis.__CreateText = mock(() => makeRef());
  globalThis.__CreateRawText = mock(() => makeRef());
  globalThis.__CreateImage = mock(() => makeRef());
  globalThis.__CreateScrollView = mock(() => makeRef());
  globalThis.__CreateList = mock(() => makeRef());
  globalThis.__CreateElement = mock(() => makeRef());
  globalThis.__CreateIf = mock(() => makeRef());
  globalThis.__CreateFor = mock(() => makeRef());
  globalThis.__CreateBlock = mock(() => makeRef());
  globalThis.__CreateWrapperElement = mock(() => makeRef());
  globalThis.__CreateFrame = mock(() => makeRef());
  // Return each ref's own _id so distinct elements get distinct unique IDs —
  // a constant would make cycle checks (wouldFormCycle) treat every element as
  // the same node. Falls back to 42 for refs without an _id.
  globalThis.__GetElementUniqueID = mock(
    (ref: ElementRef) => (ref as unknown as { _id?: number })?._id ?? 42,
  );
  globalThis.__AppendElement = mock(() => makeRef());
  globalThis.__RemoveElement = mock(() => makeRef());
  globalThis.__InsertElementBefore = mock(() => makeRef());
  globalThis.__GetParent = mock(() => null);
  globalThis.__NextElement = mock(() => makeRef());
  globalThis.__SetAttribute = mock(() => {});
  globalThis.__GetAttributeByName = mock(() => null);
  globalThis.__AddInlineStyle = mock(() => {});
  globalThis.__SetInlineStyles = mock(() => {});
  globalThis.__SetClasses = mock(() => {});
  globalThis.__GetClasses = mock(() => []);
  globalThis.__AddClass = mock(() => {});
  globalThis.__SetID = mock(() => {});
  globalThis.__SetDataset = mock(() => {});
  globalThis.__FlushElementTree = mock(() => {});
  globalThis.__UpdateListCallbacks = mock(() => {});
  globalThis.__SetConfig = mock(() => {});
};

describe('LynxDocument', () => {
  beforeEach(setupGlobals);

  // ─── createRootElement ────────────────────────────────────────────────────

  describe('createRootElement', () => {
    it('calls __CreatePage with componentId "0" and cssId 0', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      expect(asMock(globalThis.__CreatePage)).toHaveBeenCalledWith('0', 0);
    });

    it('returns a LynxElement', () => {
      const doc = new LynxDocument();
      expect(doc.createRootElement()).toBeInstanceOf(LynxElement);
    });

    it('sets the page property', () => {
      const doc = new LynxDocument();
      const root = doc.createRootElement();
      expect(doc.page).toBe(root);
    });

    it('marks the root element as isRootPageElement', () => {
      const doc = new LynxDocument();
      const root = doc.createRootElement();
      expect(root.isRootPageElement).toBe(true);
    });

    it('stores the page element unique ID via __GetElementUniqueID', () => {
      globalThis.__GetElementUniqueID = mock(() => 99);
      const doc = new LynxDocument();
      doc.createRootElement();
      expect(asMock(globalThis.__GetElementUniqueID)).toHaveBeenCalled();
    });
  });

  // ─── createElement ────────────────────────────────────────────────────────

  describe('createElement', () => {
    let doc: LynxDocument;

    beforeEach(() => {
      doc = new LynxDocument();
      doc.createRootElement();
    });

    it('creates a view element', () => {
      const el = doc.createElement('view');
      expect(asMock(globalThis.__CreateView)).toHaveBeenCalled();
      expect(el).toBeInstanceOf(LynxElement);
    });

    it('creates an image element', () => {
      doc.createElement('image');
      expect(asMock(globalThis.__CreateImage)).toHaveBeenCalled();
    });

    it('creates a text element', () => {
      doc.createElement('text');
      expect(asMock(globalThis.__CreateText)).toHaveBeenCalled();
    });

    it('creates a raw-text element using the value parameter', () => {
      doc.createElement('raw-text', 'hello');
      expect(asMock(globalThis.__CreateRawText)).toHaveBeenCalledWith('hello');
    });

    it('creates a raw-text element with empty string when value is omitted', () => {
      doc.createElement('raw-text');
      expect(asMock(globalThis.__CreateRawText)).toHaveBeenCalledWith('');
    });

    it('creates a scroll-view element', () => {
      doc.createElement('scroll-view');
      expect(asMock(globalThis.__CreateScrollView)).toHaveBeenCalled();
    });

    it('creates a list and returns a LynxListElement', () => {
      const el = doc.createElement('list');
      expect(el).toBeInstanceOf(LynxListElement);
      expect(asMock(globalThis.__CreateList)).toHaveBeenCalled();
    });

    it('registers a no-op enqueueComponent callback with __CreateList', () => {
      // enqueueComponent is invoked by the native list layout pass when an
      // item scrolls offscreen. We don't run a recycle pool, so the callback
      // body is intentionally empty — but it must exist as a callable so the
      // native side can invoke it without throwing.
      doc.createElement('list');
      const call = asMock(globalThis.__CreateList).mock.calls[0];
      const enqueueComponent = call[2] as (
        ref: unknown,
        listId: number,
        eleId: number,
      ) => void;

      expect(typeof enqueueComponent).toBe('function');
      expect(() =>
        enqueueComponent({} as unknown, 1, 2),
      ).not.toThrow();
    });

    it('creates a list-item element via __CreateElement', () => {
      doc.createElement('list-item');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'list-item',
        expect.any(Number),
      );
    });

    it('creates a block element via __CreateWrapperElement', () => {
      doc.createElement('block');
      expect(asMock(globalThis.__CreateWrapperElement)).toHaveBeenCalledWith(
        expect.any(Number),
      );
    });

    it('creates an if element via __CreateElement', () => {
      doc.createElement('if');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'if',
        expect.any(Number),
      );
    });

    it('creates a for element via __CreateElement', () => {
      doc.createElement('for');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'for',
        expect.any(Number),
      );
    });

    it('creates a frame element', () => {
      doc.createElement('frame');
      expect(asMock(globalThis.__CreateFrame)).toHaveBeenCalled();
    });

    it('creates an input element via __CreateElement', () => {
      doc.createElement('input');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'input',
        expect.any(Number),
      );
    });

    it('creates a textarea element via __CreateElement', () => {
      doc.createElement('textarea');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'textarea',
        expect.any(Number),
      );
    });

    it('falls back to __CreateView for unknown tags', () => {
      const viewCallsBefore = asMock(globalThis.__CreateView).mock.calls.length;
      doc.createElement('custom-tag');
      const viewCallsAfter = asMock(globalThis.__CreateView).mock.calls.length;
      expect(viewCallsAfter).toBeGreaterThan(viewCallsBefore);
    });

    it('returns distinct elements on successive calls', () => {
      const a = doc.createElement('view');
      const b = doc.createElement('view');
      expect(a).not.toBe(b);
    });

    // ─── page tag (special case) ─────────────────────────────────────────

    describe('page tag', () => {
      it('returns the root page element', () => {
        const el = doc.createElement('page');
        expect(el).toBe(doc.page);
      });

      it('emits a warning when called more than once', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        doc.createElement('page'); // first request — no warning
        doc.createElement('page'); // second request — warning
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
      });

      it('does not warn on the first page request', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        doc.createElement('page');
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });
    });

    // ─── overlay / svg ────────────────────────────────────────────────────

    it('creates an overlay element via __CreateElement', () => {
      doc.createElement('overlay');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'overlay',
        expect.any(Number),
      );
    });

    it('creates a svg element via __CreateElement', () => {
      doc.createElement('svg');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'svg',
        expect.any(Number),
      );
    });

    it('creates a title-bar-view element via __CreateElement', () => {
      doc.createElement('title-bar-view');
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        'title-bar-view',
        expect.any(Number),
      );
    });

    // Tags below aren't Angular template primitives — they're only reachable
    // via `createElement(tag)` (typically from LynxElement's subtree-recreate
    // path), and no other spec drives them. Assert each one dispatches to its
    // native constructor so every element-creators/* file stays covered.
    it.each([
      'refresh',
      'refresh-header',
      'viewpager',
      'viewpager-item',
      'scroll-coordinator',
      'scroll-coordinator-header',
      'scroll-coordinator-toolbar',
      'scroll-coordinator-slot',
    ] as const)('creates a %s element via __CreateElement', (tag) => {
      doc.createElement(tag);
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        tag,
        expect.any(Number),
      );
    });

    it('creates a comment element via createCommentElement (__CreateView + display:none)', () => {
      // The 'comment' tag doesn't go through __CreateElement — it uses
      // __CreateView and stamps `display:none` inline. That flow is shared by
      // createNativeRefByTag('comment', ...), so covering it here covers both
      // call sites.
      doc.createElement('comment');
      expect(asMock(globalThis.__CreateView)).toHaveBeenCalled();
      expect(asMock(globalThis.__AddInlineStyle)).toHaveBeenCalledWith(
        expect.anything(),
        'display',
        'none',
      );
    });
  });

  // ─── createText ───────────────────────────────────────────────────────────

  describe('createText', () => {
    it('calls __CreateRawText with the given value', () => {
      const doc = new LynxDocument();
      doc.createText('hello');
      expect(asMock(globalThis.__CreateRawText)).toHaveBeenCalledWith('hello');
    });

    it('returns a LynxElement', () => {
      const doc = new LynxDocument();
      expect(doc.createText('hi')).toBeInstanceOf(LynxElement);
    });

    it('preserves an empty string', () => {
      const doc = new LynxDocument();
      doc.createText('');
      expect(asMock(globalThis.__CreateRawText)).toHaveBeenCalledWith('');
    });
  });

  // ─── createComment ────────────────────────────────────────────────────────

  describe('createComment', () => {
    it('creates a view via __CreateView', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      doc.createComment();
      // __CreateView is already called in createRootElement (indirectly), so
      // just verify it was called at least once more after root creation.
      expect(asMock(globalThis.__CreateView)).toHaveBeenCalled();
    });

    it('hides the comment element with display:none', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      doc.createComment();
      expect(asMock(globalThis.__AddInlineStyle)).toHaveBeenCalledWith(
        expect.anything(),
        'display',
        'none',
      );
    });

    it('returns a LynxElement', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      expect(doc.createComment()).toBeInstanceOf(LynxElement);
    });

    it('registers the element in the nonElements set (list skips it)', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      const comment = doc.createComment();

      // The nonElements WeakSet is private, but we can verify its effect:
      // when we create a list and append both a real child and the comment,
      // getUIChildren() on the list should exclude the comment.
      const list = doc.createElement('list') as LynxListElement;
      const real = doc.createElement('view') as LynxElement;
      list.appendChild(real);
      list.appendChild(comment);

      expect(list.getUIChildren()).toEqual([real.element]);
    });

    it('returns distinct elements on successive calls', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      expect(doc.createComment()).not.toBe(doc.createComment());
    });
  });

  // ─── appendChild ──────────────────────────────────────────────────────────

  describe('appendChild', () => {
    it('appends the child to the page element', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      const child = doc.createElement('view') as LynxElement;

      doc.appendChild(child);

      expect(asMock(globalThis.__AppendElement)).toHaveBeenCalledWith(
        doc.page.element,
        child.element,
      );
    });
  });
});
