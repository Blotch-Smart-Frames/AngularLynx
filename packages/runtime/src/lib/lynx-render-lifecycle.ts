// cspell:words ULLONG
/**
 * Tracks whether we're still inside the native engine's very first
 * LoadTemplate → renderPage call, and lets callers defer work until it's
 * safely finished.
 *
 * Why this exists: a `<list>`'s `componentAtIndex` callback (registered via
 * `__CreateList`) always runs in the main-thread "Lepus" QuickJS context,
 * invoked synchronously and reentrantly by native's own list layout pass
 * whenever the list's data changes and a layout tick runs. That reentrancy is
 * fine in steady state (React Lynx relies on it on every scroll). We defer the
 * list's FIRST `update-list-info` + layout-triggering flush out of the initial
 * bootstrap so it doesn't run while still nested inside native's very first
 * `renderPage()` call — React Lynx likewise performs its first list flush from
 * a normal task after the initial render, not synchronously within it. Native
 * performs its own implicit flush once `renderPage()` returns, so nothing is
 * lost by waiting; we only avoid driving a list layout from inside a call
 * frame native hasn't finished unwinding.
 *
 * (Historical note: earlier revisions of this file blamed a stack-depth
 * overflow — Lynx's Lepus context runs with `LEPUS_SetMaxStackSize(ULLONG_MAX)`,
 * so its JS stack-overflow guard is disabled. That turned out NOT to be the
 * first-render crash: the actual trigger was a `WeakSet.has()` call on the
 * `componentAtIndex` path (see create-list-element.ts / lynx-list-element.ts),
 * which crashed identically even from a shallow, freshly-scheduled task. This
 * deferral is retained as correct lifecycle ordering, not as a stack-depth
 * workaround.)
 *
 * Note a Promise/`await` continuation does NOT escape the nesting: LEPUS
 * drains all pending microtasks before a native→JS call frame unwinds, so even
 * `bootstrapApplication`'s `await firstValueFrom(pageReady)` still executes
 * nested inside the original `renderPage()` call, not after it returns. The
 * only genuine escape is a macrotask: `setTimeout` schedules a fresh top-level
 * task that native's message loop invokes only after the current call frame
 * (and all its microtasks) have fully unwound — a primitive this runtime
 * already relies on (see runtime.ts's zoneless CD scheduler polyfill).
 */
// Module-level so the flag is shared across every element/renderer in the app:
// there is exactly one initial renderPage() call per page, so a single global
// latch (rather than per-list state) correctly gates ALL first-render work.
// Starts true and only ever flips to false once — it never resets, because
// "first render" happens exactly once per bootstrap (HMR re-bootstraps go
// through the `prev` path in runtime.ts, not this latch).
let firstRenderPending = true;
const deferredCallbacks: Array<() => void> = [];

/**
 * True until the initial bootstrap render has fully returned. Callers on the
 * re-entrant list path (LynxListElement._processUpdate, LynxRendererFactory2.end)
 * check this to decide whether it's safe to drive a layout-triggering flush
 * now, or whether they must defer — see this file's top doc comment.
 */
export const isFirstRenderPending = (): boolean => firstRenderPending;

/**
 * Called exactly once by bootstrapApplication() after Angular's bootstrap
 * resolves. Flips the latch so all subsequent updates run inline, then drains
 * anything parked via runAfterFirstRender() during bootstrap.
 *
 * The drain uses setTimeout(0), NOT queueMicrotask: the parked work (a list's
 * first layout flush) must run on a call stack that has genuinely unwound past
 * native's original renderPage() call. A microtask would still execute nested
 * inside it — LEPUS drains all microtasks before a native→JS frame unwinds —
 * so only a macrotask provides the clean top-level task we need (see this
 * file's top doc comment for the full reasoning).
 */
export const markFirstRenderComplete = (): void => {
  firstRenderPending = false;
  if (deferredCallbacks.length === 0) return;
  const callbacks = deferredCallbacks.splice(0);
  setTimeout(() => {
    for (const callback of callbacks) callback();
  }, 0);
};

/**
 * Runs `callback` immediately if the first render has already completed,
 * or queues it to run once it has (see markFirstRenderComplete()).
 */
export const runAfterFirstRender = (callback: () => void): void => {
  if (!firstRenderPending) {
    callback();
    return;
  }
  deferredCallbacks.push(callback);
};

// True only while a renderer begin()/end() change-detection cycle is executing
// (set by LynxRendererFactory2). Native element creation/attachment that happens
// while this is FALSE is happening OUTSIDE Angular's change-detection flush —
// the canonical case is a lazy-loaded route component instantiated by
// RouterOutlet DURING navigation, before Angular's next tick. end() only flushes
// per CD cycle, so such content is committed to the fiber tree yet never laid out
// or painted until an unrelated later CD flushes (e.g. a tap). The <list> path
// already guards this (LynxListElement.#scheduleUpdate); scheduleSettleFlush()
// in lynx-element.ts is the equivalent guard for every other element, and it
// reads this flag to know a flush is not already coming from end().
let insideChangeDetection = false;

export const setInsideChangeDetection = (value: boolean): void => {
  insideChangeDetection = value;
};

export const isInsideChangeDetection = (): boolean => insideChangeDetection;
