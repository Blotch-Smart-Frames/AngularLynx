import { callOnBackground, isMainThread } from '../background-call';

/**
 * The native module of the apps `ng build --platform` makes (`ShellModule` in
 * `packages/native/templates`), whose `collectGarbage()` asks Lynx for a full
 * collection of the main thread's heap.
 */
const SHELL_MODULE = 'AngularLynxShell';

/**
 * How many released elements make a collection worth asking for: about a
 * screen's worth, so an `@if` that toggles a few elements now and then doesn't
 * cost one every time it does.
 */
export const RELEASES_PER_COLLECTION = 100;

/**
 * How long the app must go without releasing another element before the
 * collection runs: a navigation releases its screen in several commits, and
 * the collection pauses the main thread, so it waits for the app to settle.
 */
export const QUIET_MS = 1_000;

/**
 * The longest a collection waits for the app to settle, so one that keeps
 * releasing elements still gets its memory back.
 */
export const MAX_WAIT_MS = 10_000;

/**
 * The least time between two collections.
 */
export const MIN_INTERVAL_MS = 10_000;

let released = 0;
let releasedSinceScheduled = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let waitingSince = 0;
let lastCollection = -Infinity;
let hostCollects = true;

/**
 * Counts an element the runtime has let go of (see LynxElement's release).
 */
export const noteReleased = (): void => {
  released++;
  releasedSinceScheduled = true;
};

/**
 * Asks the host for a full collection of the main thread's heap once enough
 * elements have been released and the app has settled (see the constants
 * above). Called after each commit that may have released some.
 *
 * PrimJS, the engine that runs the main thread, collects as the app runs, but
 * those collections leave behind much of what a screen leaves when it goes:
 * switching tabs every 1.2 s, the iOS app's footprint went from 79 MB to
 * 264 MB over 600 navigations, and Android's native heap from 39 MB to 72 MB,
 * though every screen was collected. A full collection frees it and hands the
 * pages back to the system. Lynx runs one when the host app reports memory
 * pressure (`LynxEnv.trimMemory`), which the shell's `collectGarbage()` does:
 * asked for here, the footprint stayed at about 135 MB, and the native heap
 * at about 50 MB. Hosts without the module (Lynx Explorer, the web preview,
 * an app of your own) reject the first request, and are never asked again.
 * See investigations/lynx-vs-web-differences.md.
 */
export const scheduleCollection = (): void => {
  if (!releasedSinceScheduled) return;
  releasedSinceScheduled = false;
  if (!hostCollects || released < RELEASES_PER_COLLECTION) return;
  // Tests run as the main thread with no shell to ask (the testing library),
  // or as no thread at all, and a timer left behind would outlive the test.
  if (!isMainThread() || (globalThis as any).lynxTestingEnv) return;
  const now = Date.now();
  if (timer === undefined) waitingSince = now;
  else clearTimeout(timer);
  const due = Math.max(
    Math.min(now + QUIET_MS, waitingSince + MAX_WAIT_MS),
    lastCollection + MIN_INTERVAL_MS,
  );
  timer = setTimeout(collect, due - now);
};

const collect = (): void => {
  timer = undefined;
  released = 0;
  lastCollection = Date.now();
  callOnBackground(
    'callModule',
    'native',
    SHELL_MODULE,
    'collectGarbage',
    [],
  ).catch(() => {
    hostCollects = false;
  });
};
