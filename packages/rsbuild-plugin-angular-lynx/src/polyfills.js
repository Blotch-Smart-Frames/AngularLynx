// Angular Router v21+ uses AbortController in its navigation pipeline
// (NavigationTransitions.setupNavigations). Lynx's PrimJS runtime lacks
// this Web Platform API. Without it, the Router's switchMap throws a
// ReferenceError that is silently swallowed by subscribe({ error: e => {} }),
// causing the entire navigation pipeline to die — zero events, navigated
// stays false, navigateByUrl() hangs forever.
if (typeof AbortController === 'undefined') {
  class LynxAbortSignal {
    constructor() {
      this.aborted = false;
      this.reason = undefined;
      this._listeners = [];
    }
    addEventListener(type, listener) {
      if (type === 'abort') this._listeners.push(listener);
    }
    removeEventListener(type, listener) {
      if (type === 'abort') {
        this._listeners = this._listeners.filter((l) => l !== listener);
      }
    }
    dispatchEvent(event) {
      if (event.type === 'abort') {
        for (const listener of this._listeners.slice()) {
          listener(event);
        }
      }
      return true;
    }
    throwIfAborted() {
      if (this.aborted) throw this.reason;
    }
  }
  globalThis.AbortSignal = LynxAbortSignal;
  globalThis.AbortController = class LynxAbortController {
    constructor() {
      this.signal = new LynxAbortSignal();
    }
    abort(reason) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      // Standard default is DOMException('AbortError'), but DOMException is
      // unavailable in Lynx. A plain Error with name='AbortError' works —
      // Angular only does signal.reason + '' (string coercion).
      if (reason === undefined) {
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';
        reason = err;
      }
      this.signal.reason = reason;
      this.signal.dispatchEvent({ type: 'abort' });
    }
  };
}

// Angular 22's getSimpleChangesStore (ngOnChanges lifecycle machinery) uses
// Object.hasOwn() to check if a SimpleChanges store is already attached to
// the directive instance. Lynx's PrimJS engine is ES2015-era and lacks this
// ES2022 static method. Without it, any component/directive that implements
// ngOnChanges (including FormField from @angular/forms/signals) crashes at
// instantiation with "Object.hasOwn is not a function".
if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = (obj, prop) =>
    Object.prototype.hasOwnProperty.call(obj, prop);
}

// Angular's `@defer` block (triggerDeferBlock -> triggerResourceLoading) calls
// Promise.allSettled() to await all dependency-loading promises before showing
// the loaded content. Lynx's PrimJS engine is ES2015-era and lacks this ES2020
// method entirely (not a partial implementation — `typeof` check is enough).
// Without it, every @defer block throws "Promise.allSettled is not a function"
// as soon as its trigger fires.
if (typeof Promise.allSettled !== 'function') {
  Promise.allSettled = (promises) =>
    Promise.all(
      Array.from(promises, (p) =>
        Promise.resolve(p).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
      ),
    );
}

if (typeof performance === 'undefined') {
  globalThis.performance = undefined;
}
if (typeof queueMicrotask === 'undefined') {
  globalThis.queueMicrotaskPromiseCache = Promise.resolve();
  globalThis.queueMicrotask = (cb) =>
    globalThis.queueMicrotaskPromiseCache.then(cb);
}

// Angular's i18n runtime (applyCreateOpCodes / applyMutableOpCodes /
// createNodeWithoutHydration in @angular/core) branches on the DOM `Node`
// interface's node-type constants — Node.COMMENT_NODE / Node.TEXT_NODE /
// Node.ELEMENT_NODE — to decide whether each i18n opcode creates a comment,
// text, or element node. Every component carrying an `i18n` attribute or a
// `$localize` string emits these opcodes at bootstrap (ɵɵi18n → ɵɵi18nStart →
// applyCreateOpCodes). Lynx's PrimJS runtime has no DOM, so `Node` is undefined
// and the first opcode throws "Node is not defined", aborting bootstrap before
// anything paints.
//
// A class (not a plain object) is required: a few dev/debug paths in Angular do
// `x instanceof Node`, which throws if the right-hand side isn't callable. As a
// class, `instanceof` correctly returns false for Lynx elements (they are not
// DOM nodes) while the static constants resolve to their standard spec values —
// which is all the i18n opcode dispatcher actually reads. Deprecated node types
// (ENTITY_*, NOTATION_NODE) are omitted; Angular never references them.
//
// The shim alone is the complete fix. The constants are pure discriminators, so
// once `Node` resolves the opcodes dispatch to renderer.createComment() /
// createText() — already implemented and exercised by @if/@for anchors and
// {{ }} interpolation, so nothing downstream is missing. The
// `typeof Node === 'undefined'` guard makes this a no-op in the web bundle
// (where `Node` is the real DOM global), which is why preEntry can run it
// unconditionally on both the main and background threads.
if (typeof Node === 'undefined') {
  try {
    class LynxNode {}
    Object.assign(LynxNode, {
      ELEMENT_NODE: 1,
      ATTRIBUTE_NODE: 2,
      TEXT_NODE: 3,
      CDATA_SECTION_NODE: 4,
      PROCESSING_INSTRUCTION_NODE: 7,
      COMMENT_NODE: 8,
      DOCUMENT_NODE: 9,
      DOCUMENT_TYPE_NODE: 10,
      DOCUMENT_FRAGMENT_NODE: 11,
      DOCUMENT_POSITION_DISCONNECTED: 1,
      DOCUMENT_POSITION_PRECEDING: 2,
      DOCUMENT_POSITION_FOLLOWING: 4,
      DOCUMENT_POSITION_CONTAINS: 8,
      DOCUMENT_POSITION_CONTAINED_BY: 16,
      DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
    });
    globalThis.Node = LynxNode;
  } catch {
    // Read-only in some environments (e.g. web main thread where Node is a
    // non-configurable global) — Node already exists there, nothing to do.
  }
}

// Lynx runtime doesn't have browser globals. Mock them early (before Angular
// platform initialization) so BrowserPlatformLocation's constructor doesn't
// crash when accessing window.location / window.history.
try {
  if (typeof document === 'undefined') {
    globalThis.document = {
      defaultView: globalThis,
      querySelector: () => null,
    };
  }
} catch {
  // Read-only in Web Worker — document already exists
}
// In native Lynx, window doesn't exist — assign globalThis as a stub.
// In web bundles, the code runs inside lynx-view which shadows window=void 0
// but globalThis IS the Window object (where 'window' is a read-only getter).
try {
  if (typeof window === 'undefined') {
    globalThis.window = globalThis;
  }
} catch {
  // Read-only in web environment — window already exists on globalThis
}
// Angular's DefaultValueAccessor (from @angular/forms) is instantiated on every
// <input [formControl]> / <textarea [formControl]> element — even when a custom
// ControlValueAccessor is the *selected* accessor. Its constructor calls
// _isAndroid() → getDOM().getUserAgent() → BrowserDomAdapter.getUserAgent(),
// which reads window.navigator.userAgent. Lynx has no navigator global, so this
// throws a TypeError that crashes the component mid-creation and blanks the page.
try {
  if (typeof navigator === 'undefined') {
    globalThis.navigator = { userAgent: '' };
  }
} catch {
  // Read-only in Web Worker — navigator already exists
}
// BrowserPlatformLocation reads window.location and window.history in its
// constructor. Even though LynxPlatformLocation replaces it via DI, Angular
// may still construct BrowserPlatformLocation as a transitive dependency
// (e.g. through providedIn:'platform' factories). These stubs prevent the
// constructor from crashing with "cannot read property 'pathname' of undefined".
try {
  if (typeof globalThis.location === 'undefined') {
    globalThis.location = {
      href: 'lynx://app/',
      protocol: 'lynx:',
      host: 'app',
      hostname: 'app',
      port: '',
      pathname: '/',
      search: '',
      hash: '',
      origin: 'lynx://app',
      assign: () => {},
      reload: () => {},
      replace: () => {},
      toString: () => 'lynx://app/',
    };
  }
} catch {
  // Read-only in Web Worker — location already exists
}
try {
  if (typeof globalThis.history === 'undefined') {
    globalThis.history = {
      length: 1,
      state: null,
      scrollRestoration: 'auto',
      back: () => {},
      forward: () => {},
      go: () => {},
      pushState: () => {},
      replaceState: () => {},
    };
  }
} catch {
  // Read-only in Web Worker — history already exists
}
if (typeof globalThis.addEventListener !== 'function') {
  globalThis.addEventListener = () => {};
}
if (typeof globalThis.removeEventListener !== 'function') {
  globalThis.removeEventListener = () => {};
}
