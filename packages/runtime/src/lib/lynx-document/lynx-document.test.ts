// JIT-compiles the test components, which registerHostElement reads the
// selectors of.
import '@angular/compiler';
import { Component } from '@angular/core';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ElementRef } from '../types/lynx';
import { LynxCanvasElement } from '../canvas/canvas-element';
import { globalEvents } from '../global-events';
import { LynxElement } from '../lynx-element';
import { LynxListElement } from '../lynx-element/lynx-list-element';
import { ANDROID_BLUR_CAPTURE_TARGET } from './android-blur-capture';
import { registerHostElement } from './host-elements';
import { LynxDocument } from './lynx-document';
import {
  __pageElementRef,
  handOverPageToNextApp,
  setPageElementRef,
} from './page-ref';

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
  globalThis.__GetChildren = mock(() => []);
  globalThis.__AddEvent = mock(() => {});
  // Each test is a first boot: no previous app left a page to take over.
  setPageElementRef(null);
};

describe('LynxDocument', () => {
  beforeEach(setupGlobals);

  // ─── createRootElement ────────────────────────────────────────────────────

  describe('createRootElement', () => {
    // Only SystemInfo is stubbed; setupGlobals assigns the PAPI globals.
    afterEach(() => vi.unstubAllGlobals());

    it('calls __CreatePage with componentId "0" and cssId 0', () => {
      const doc = new LynxDocument();
      doc.createRootElement();
      expect(asMock(globalThis.__CreatePage)).toHaveBeenCalledWith('0', 0);
    });

    // document: and window: listeners hear touches from the page, and the
    // window follows its size.
    it('is the page the document and window hear the screen from', () => {
      const root = new LynxDocument().createRootElement();

      expect(globalEvents().page).toBe(root);
      expect(asMock(globalThis.__AddEvent)).toHaveBeenCalledWith(
        root.element,
        'bindEvent',
        'resize',
        expect.anything(),
      );
      expect(globalEvents().targetFor(__GetElementUniqueID(root.element))).toBe(
        root,
      );
    });

    // A hot update bootstraps the app again, in a new document. A second
    // __CreatePage() would give it a page Lynx never shows, while the old
    // app's elements, whose views are gone, stayed on screen.
    describe('when a re-bootstrap hands the page over', () => {
      it('takes it over, without the old elements', () => {
        const page = new LynxDocument().createRootElement().element;
        const oldChildren = [makeRef(), makeRef()];
        globalThis.__GetChildren = mock(() => oldChildren);
        asMock(globalThis.__CreatePage).mockClear();

        handOverPageToNextApp();
        const root = new LynxDocument().createRootElement();

        expect(asMock(globalThis.__CreatePage)).not.toHaveBeenCalled();
        expect(root.element).toBe(page);
        expect(__pageElementRef).toBe(page);
        expect(asMock(globalThis.__RemoveElement).mock.calls).toEqual([
          [page, oldChildren[0]],
          [page, oldChildren[1]],
        ]);
      });

      it('takes over a page Lynx reports no children for', () => {
        const page = new LynxDocument().createRootElement().element;
        globalThis.__GetChildren = mock(() => null);

        handOverPageToNextApp();
        const root = new LynxDocument().createRootElement();

        expect(root.element).toBe(page);
        expect(asMock(globalThis.__RemoveElement)).not.toHaveBeenCalled();
      });

      it('takes it over once', () => {
        new LynxDocument().createRootElement();
        handOverPageToNextApp();
        new LynxDocument().createRootElement();
        asMock(globalThis.__CreatePage).mockClear();

        new LynxDocument().createRootElement();

        expect(asMock(globalThis.__CreatePage)).toHaveBeenCalled();
      });

      it('creates the first page as usual', () => {
        handOverPageToNextApp();

        new LynxDocument().createRootElement();

        expect(asMock(globalThis.__CreatePage)).toHaveBeenCalled();
      });
    });

    // Each test's render() creates an app in a fresh Lynx environment, where
    // the page from the last one is gone.
    it('creates a new page for any other new app', () => {
      new LynxDocument().createRootElement();
      asMock(globalThis.__CreatePage).mockClear();

      new LynxDocument().createRootElement();

      expect(asMock(globalThis.__CreatePage)).toHaveBeenCalled();
      expect(asMock(globalThis.__RemoveElement)).not.toHaveBeenCalled();
    });

    // env(safe-area-inset-*) reads a generated app's insets from the page's
    // variables (see page-safe-area.ts), from the first frame on.
    it("gives the page the shell's safe-area insets", () => {
      vi.stubGlobal('lynx', {
        __globalProps: {
          edgeToEdge: true,
          safeAreaTop: 62,
          safeAreaBottom: 34,
        },
      });

      const root = new LynxDocument().createRootElement();
      vi.stubGlobal('lynx', undefined);
      // The next test's page starts without them.
      new LynxDocument().createRootElement();

      expect(asMock(globalThis.__SetInlineStyles)).toHaveBeenCalledWith(
        root.element,
        [
          '--angular-lynx-safe-area-inset-top: 62px',
          '--angular-lynx-safe-area-inset-right: 0px',
          '--angular-lynx-safe-area-inset-bottom: 34px',
          '--angular-lynx-safe-area-inset-left: 0px',
        ].join('; '),
      );
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

    it('names the page on Android, for blur-views to blur', () => {
      vi.stubGlobal('SystemInfo', { platform: 'Android' });
      const doc = new LynxDocument();
      const root = doc.createRootElement();
      expect(asMock(globalThis.__SetID)).toHaveBeenCalledWith(
        root.element,
        ANDROID_BLUR_CAPTURE_TARGET,
      );
    });

    it('leaves the page unnamed on other platforms', () => {
      vi.stubGlobal('SystemInfo', { platform: 'iOS' });
      new LynxDocument().createRootElement();
      expect(asMock(globalThis.__SetID)).not.toHaveBeenCalled();
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

    it("leaves an image's mode at Lynx's default", () => {
      doc.createElement('image');
      expect(asMock(globalThis.__SetAttribute)).not.toHaveBeenCalled();
    });

    it('creates a text element', () => {
      doc.createElement('text');
      expect(asMock(globalThis.__CreateText)).toHaveBeenCalled();
    });

    // registerHostElement: a component's host can be an element other than
    // a view.
    it("creates the element a component's tag is registered as", () => {
      @Component({ selector: 'doc-test-title', template: '' })
      class DocTestTitle {}
      registerHostElement(DocTestTitle, 'text');

      const el = doc.createElement('doc-test-title') as LynxElement;

      expect(asMock(globalThis.__CreateText)).toHaveBeenCalled();
      expect(asMock(globalThis.__CreateView)).not.toHaveBeenCalled();
      expect(el.tagName).toBe('text');
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
      expect(() => enqueueComponent({} as unknown, 1, 2)).not.toThrow();
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

    it('gives inputs no inline styles, which would beat their classes', () => {
      doc.createElement('input');
      doc.createElement('textarea');
      expect(asMock(globalThis.__AddInlineStyle)).not.toHaveBeenCalled();
      expect(asMock(globalThis.__SetInlineStyles)).not.toHaveBeenCalled();
    });

    it('falls back to __CreateView for unknown tags', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const viewCallsBefore = asMock(globalThis.__CreateView).mock.calls.length;
      doc.createElement('custom-tag');
      const viewCallsAfter = asMock(globalThis.__CreateView).mock.calls.length;
      expect(viewCallsAfter).toBeGreaterThan(viewCallsBefore);
      expect(warn).toHaveBeenCalledWith(
        'Unknown element tag "custom-tag". Falling back to view element.',
      );
      warn.mockRestore();
    });

    it('makes an HTML tag the Lynx element it renders as, without a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const div = doc.createElement('div');
      const span = doc.createElement('span');
      expect(div.tagName).toBe('view');
      expect(span.tagName).toBe('text');
      expect(asMock(globalThis.__CreateView)).toHaveBeenCalled();
      expect(asMock(globalThis.__CreateText)).toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('sizes an <img> to its picture, as a browser does', () => {
      const img = doc.createElement('img');
      expect(img.tagName).toBe('image');
      expect(asMock(globalThis.__CreateImage)).toHaveBeenCalled();
      expect(asMock(globalThis.__SetAttribute)).toHaveBeenCalledWith(
        img.element,
        'auto-size',
        true,
      );
    });

    it('leaves a Lynx <image> its own size', () => {
      doc.createElement('image');
      expect(asMock(globalThis.__SetAttribute)).not.toHaveBeenCalledWith(
        expect.anything(),
        'auto-size',
        expect.anything(),
      );
    });

    it('makes angular-three’s tags views, without a warning each', () => {
      // provideNgtRenderer() asks for an element for every `ngt-*` tag.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      doc.createElement('ngt-mesh');
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('makes a <canvas> with its own element, as HTMLCanvasElement', () => {
      // Without the shell's WebGL module (as here) the canvas is a view.
      globalThis.__AddEvent = mock(() => {});
      globalThis.__InvokeUIMethod = mock(() => []);
      const canvas = doc.createElement('canvas');
      expect(canvas).toBeInstanceOf(LynxCanvasElement);
      expect(canvas.tagName).toBe('canvas');
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
      'scroll-coordinator-slot-drag',
      'inline-truncation',
    ] as const)('creates a %s element via __CreateElement', (tag) => {
      doc.createElement(tag);
      expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
        tag,
        expect.any(Number),
      );
    });

    // Each of these must reach the native engine under its OWN tag. Before
    // they had explicit cases they hit the unknown-tag fallback and became
    // plain views, so their attributes (blur-radius, src, …) did nothing.
    it.each(['blur-view', 'webview', 'video', 'cover-view'] as const)(
      'creates a native %s element instead of falling back to a view',
      (tag) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const viewCallsBefore = asMock(globalThis.__CreateView).mock.calls
          .length;
        doc.createElement(tag);
        expect(asMock(globalThis.__CreateElement)).toHaveBeenCalledWith(
          tag,
          expect.any(Number),
        );
        expect(asMock(globalThis.__CreateView).mock.calls.length).toBe(
          viewCallsBefore,
        );
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      },
    );

    it('gives a new blur-view its material on Android', () => {
      vi.stubGlobal('SystemInfo', { platform: 'Android' });
      const el = doc.createElement('blur-view');
      expect(asMock(globalThis.__SetInlineStyles)).toHaveBeenCalledWith(
        el.element,
        expect.stringContaining('--angular-lynx-blur-background: transparent'),
      );
      vi.unstubAllGlobals();
    });

    it('gives a new scroll-view or list a scroll handler from the start on iOS, and only there', () => {
      /**
       * iOS hands a scroll-view's scroll events only to the handlers it had
       * when its UI was made, so one added later must find one there.
       */
      const scrollHandlers = () =>
        asMock(globalThis.__AddEvent).mock.calls.filter(
          ([, type, name]) => type === 'bindEvent' && name === 'scroll',
        );
      vi.stubGlobal('SystemInfo', { platform: 'iOS' });
      const scroller = doc.createElement('scroll-view');
      const list = doc.createElement('list');
      doc.createElement('view');
      expect(scrollHandlers().map(([element]) => element)).toEqual([
        scroller.element,
        list.element,
      ]);
      // A listener added later shares the handler: nothing more to register.
      const listener = vi.fn();
      scroller.addEventListener('bindscroll', listener);
      expect(scrollHandlers()).toHaveLength(2);
      scrollHandlers()[0][3].value({ type: 'scroll' });
      expect(listener).toHaveBeenCalledOnce();

      asMock(globalThis.__AddEvent).mockClear();
      vi.stubGlobal('SystemInfo', { platform: 'Android' });
      doc.createElement('scroll-view');
      doc.createElement('list');
      expect(scrollHandlers()).toHaveLength(0);
      vi.unstubAllGlobals();
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
