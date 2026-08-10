/**
 * Vitest setup file for AngularLynx testing library.
 *
 * Runs in the jsdom environment and:
 *   1. Creates LynxTestingEnv wrapping the existing jsdom window.
 *   2. Polyfills PAPI functions that the testing-environment doesn't implement
 *      but the AngularLynx runtime requires.
 *   3. Switches to main thread so PAPI globals are active before Angular bootstraps.
 *
 * AngularLynx runs on the main thread (__MAIN_THREAD__ = true):
 *   - LynxDocument uses PAPI functions (__CreatePage, __CreateView, …)
 *   - LynxRendererFactory2.end() calls __FlushElementTree (no-op in tests)
 *
 * Why we polyfill: the @lynx-js/testing-environment's ElementPAPI covers the
 * core PAPI surface used by React/Vue Lynx, but AngularLynx calls additional
 * PAPI functions (__GetParent, __NextElement, __QuerySelector*, etc.) that the
 * testing environment does not implement. Since testing-environment elements ARE
 * real JSDOM HTMLElements, we can implement these with native DOM methods.
 */

// Must come before @angular/platform-browser to enable JIT compilation
// in tests (TypeScript source is not pre-compiled with the Angular compiler).
import '@angular/compiler';
import '@testing-library/jest-dom/vitest';
import { LynxTestingEnv } from '@lynx-js/testing-environment';

// ─── CSS fetch intercept ─────────────────────────────────────────────────────

/**
 * Angular JIT calls fetch('./component.css') to load external styleUrls.
 * jsdom has no base URL, so relative URLs fail. Return empty 200 for .css fetches.
 */
const _originalFetch = globalThis.fetch;
globalThis.fetch = (
  url: RequestInfo | URL,
  ...args: Parameters<typeof fetch>[1][]
) => {
  if (typeof url === 'string' && url.endsWith('.css')) {
    return Promise.resolve(new Response('', { status: 200 }));
  }
  return _originalFetch(url, ...(args as any));
};

// ─── Element.prototype.animate stub ──────────────────────────────────────────

// jsdom does not implement the Web Animations API. Define a no-op stub so
// vi.spyOn(Element.prototype, 'animate') can mock it in individual tests.
if (typeof Element.prototype.animate !== 'function') {
  (Element.prototype as any).animate = (): Animation =>
    ({ cancel: () => {}, finished: Promise.resolve() }) as any;
}

// ─── Install LynxTestingEnv ──────────────────────────────────────────────────

const lynxTestingEnv = new LynxTestingEnv({ window: globalThis.window as any });
(globalThis as any).lynxTestingEnv = lynxTestingEnv;
// Expose Node so @testing-library/dom detects element types correctly.
(globalThis as any).Node = globalThis.window.Node;

// ─── Switch to main thread ───────────────────────────────────────────────────

// PAPI globals (__CreatePage, __CreateView, elementTree, …) are active on the
// main thread. AngularLynx must run here because LynxDocument uses these APIs.
lynxTestingEnv.switchToMainThread();

// ─── runWorklet polyfill ─────────────────────────────────────────────────────

// __AddEvent in the testing environment calls runWorklet(handler, [event]) when
// an event handler is registered as type:'worklet'. AngularLynx registers all
// event handlers this way (see LynxElement.addEventListener). runWorklet simply
// invokes the callback — same as the polyfill in runtime.ts for the real device.
(globalThis as any).runWorklet = (value: unknown, params: unknown[]) => {
  if (typeof value === 'function') {
    value(...params);
  }
};

// ─── Missing PAPI polyfills ──────────────────────────────────────────────────

// The testing-environment's ElementPAPI uses real JSDOM HTMLElements as the
// native element representation. So DOM traversal methods work natively on them.
// We polyfill the subset of PAPI that AngularLynx uses but testing-environment
// does not implement.

/**
 * Returns the parent of a JSDOM element (equivalent to element.parentNode).
 */
(globalThis as any).__GetParent = (e: Element) =>
  e.parentElement ?? e.parentNode;

/**
 * Returns the next sibling element.
 */
(globalThis as any).__NextElement = (e: Element) =>
  e.nextElementSibling ?? e.nextSibling;

/**
 * querySelector on a JSDOM element.
 */
(globalThis as any).__QuerySelector = (e: Element, selector: string) =>
  e.querySelector(selector);

/**
 * querySelectorAll on a JSDOM element — returns an array.
 */
(globalThis as any).__QuerySelectorAll = (e: Element, selector: string) =>
  Array.from(e.querySelectorAll(selector));

/**
 * Returns the eventMap stored on the element by __AddEvent.
 * LynxElement.addEventListener uses this to identify listeners to remove.
 */
(globalThis as any).__GetEvents = (e: any) => e.eventMap ?? {};

/**
 * Replaces the eventMap on the element. Used by the removeEventListener path.
 */
(globalThis as any).__SetEvents = (e: any, events: any[]) => {
  e.eventMap = Object.fromEntries(
    events.map((ev: any) => [ev.type + ':' + ev.name, ev.jsFunction]),
  );
};

// Element creators that @lynx-js/testing-environment doesn't implement.
// They fall back to __CreateElement (also a JSDOM element with a custom tag).
for (const tag of ['block', 'for', 'frame', 'if']) {
  (globalThis as any)[`__Create${tag.charAt(0).toUpperCase() + tag.slice(1)}`] =
    (parentComponentUniqueId: number) =>
      (globalThis as any).__CreateElement(tag, parentComponentUniqueId);
}

/**
 * __CreateNonElement creates an invisible placeholder (comment anchor).
 */
(globalThis as any).__CreateNonElement = () =>
  (globalThis as any).__CreateElement('non-element', 0);

/**
 * Class manipulation helpers.
 */
(globalThis as any).__AddClass = (e: Element, cls: string) =>
  e.classList.add(cls);
// Must return an array — LynxElement.removeClass() calls .filter() on the result.
(globalThis as any).__GetClasses = (e: Element): string[] =>
  Array.from(e.classList);
(globalThis as any).__SetClasses = (e: Element, classes: string): void => {
  e.className = classes;
};

/**
 * Returns the direct element children of a JSDOM element.
 * __CreateRawText returns a DOM TextNode (not HTMLElement), so text content
 * inside <text> elements is excluded here — matching Lynx PAPI semantics where
 * __GetChildren returns Lynx elements only, not raw-text nodes. This means
 * LynxElement.remove()'s child-parking loop becomes a no-op for <text>
 * elements, letting __RemoveElement proceed and correctly detach the element.
 */
(globalThis as any).__GetChildren = (e: Element): Element[] =>
  Array.from(e.children);

/**
 * __SetConfig is called during bootstrap to pass Lynx config; no-op in tests.
 */
(globalThis as any).__SetConfig = () => {};

/**
 * Invokes a native UI method by name (e.g. the `setValue` UIMethod that Lynx
 * inputs/textareas require for programmatic text updates — see
 * LynxElement.invoke() in the runtime). LynxElement.invoke() always passes an
 * empty result callback, so a no-op that still calls back (matching the real
 * host's async {code, data} contract) is sufficient here.
 */
(globalThis as any).__InvokeUIMethod = (
  _element: unknown,
  _methodName: string,
  _params: unknown,
  callback?: (result: { code: number; data?: unknown }) => void,
): void => {
  callback?.({ code: 0 });
};

// ─── After reset ─────────────────────────────────────────────────────────────

// lynxTestingEnv.reset() re-injects globals from scratch. Re-establish main
// thread context and restore our polyfills afterwards.
(globalThis as any).onResetLynxTestingEnv = () => {
  lynxTestingEnv.switchToMainThread();
  // runWorklet is a polyfill on globalThis; it survives reset since we set it
  // on the outer globalThis (not the per-thread globalThis).
};
