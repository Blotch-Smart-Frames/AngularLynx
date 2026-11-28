import {
  type Injector,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
} from '@angular/core';

/**
 * The parts of Angular's zoneless scheduler (ChangeDetectionSchedulerImpl)
 * the frame gate reads and replaces. None of them is public API, like the
 * ones `comingTickRunner` reads (see lynx-renderer-factory2.ts).
 *
 * - `notify()` marks the app dirty and, if no tick is scheduled, schedules
 *   one with `scheduleCallbackWithRafRace` (or a microtask, right after a
 *   tick), setting `pendingRenderTaskId` and `cancelScheduledCallback`.
 * - `cancelScheduledCallback()` cancels that timer and frame; `tick()` runs
 *   the tick as they would, and cleans up after it, calling
 *   `cancelScheduledCallback` and clearing `pendingRenderTaskId`.
 * - `useMicrotaskScheduler` is true for the rest of the task a tick ran in.
 */
export type GatedScheduler = {
  notify: (source: number) => void;
  tick: () => void;
  pendingRenderTaskId: number | null;
  cancelScheduledCallback: (() => void) | null;
  useMicrotaskScheduler: boolean;
};

/**
 * Whether `scheduler` has everything the frame gate uses, under the names
 * Angular 22 gives them. A later Angular that renames one makes this false,
 * and the gate stays off: ticks run as Angular schedules them, as before the
 * gate. `frame-gate-angular.test.ts` checks Angular's own scheduler against
 * it, so a rename fails CI instead of quietly turning the gate off.
 */
export const canGateFrames = (
  scheduler: unknown,
): scheduler is GatedScheduler => {
  if (typeof scheduler !== 'object' || scheduler === null) return false;
  const candidate = scheduler as Partial<Record<keyof GatedScheduler, unknown>>;
  return (
    typeof candidate.notify === 'function' &&
    typeof candidate.tick === 'function' &&
    'pendingRenderTaskId' in candidate &&
    'cancelScheduledCallback' in candidate &&
    typeof candidate.useMicrotaskScheduler === 'boolean'
  );
};

/**
 * Makes the app tick at most once a frame after its first tick in that
 * frame, and returns what's called after each flush of the whole element
 * tree (issue #868): `LynxRendererFactory2.end()`'s, a settle flush's, and
 * the one for lists changed outside a cycle (see noteTreeFlushed).
 *
 * Angular's zoneless scheduler runs a tick from a timer or an animation
 * frame, whichever comes first. On Lynx's main thread the timer always wins,
 * and each response, socket message or timer callback is a task of its own,
 * so a burst of them a few milliseconds apart got a tick each, and end()
 * flushed and laid out the tree after each one. A browser runs those ticks
 * too, but draws once a frame however many of them changed the DOM. Lynx
 * lays out and queues the UI's operations at every flush.
 *
 * So once the tree has been flushed, until the next frame (Lynx's main-thread
 * `requestAnimationFrame` follows the screen's refresh), a tick Angular
 * schedules is moved from its timer onto that frame, where it runs once for
 * everything that changed meanwhile. The first tick of a frame still runs on
 * Angular's timer, so a tap or a lone response is drawn as soon as before.
 * A later change in a burst runs its tick, its effects and its flush up to a
 * frame later than it did, which Angular's own race allows: on the web, the
 * frame often wins. end() still flushes every cycle that wrote something, so
 * the lists' updates and the UI methods waiting for a flush go with it as
 * before.
 *
 * Any flush of the whole tree opens the window, not only a cycle's: while a
 * list scrolls, the settle flush after the rows componentAtIndex binds is
 * often the frame's first, and a response's tick then made a second flush
 * and layout in that frame.
 *
 * The ticks Angular schedules on a microtask, in the task a tick just ran in,
 * are left alone: they finish what that tick started before the task ends. A
 * tick run early by `runComingTick()` runs a moved tick too: it's the
 * scheduler's, and its cleanup cancels the frame's run.
 *
 * Without `requestAnimationFrame`, or without the scheduler's fields (see
 * canGateFrames), nothing changes. The scheduler is resolved at the first
 * flush, since it's made after the renderer factory, and kept.
 */
export const frameGate = (injector: Injector): (() => void) => {
  let scheduler: GatedScheduler | null | undefined;
  // Whether a cycle has flushed since the last frame.
  let flushedThisFrame = false;
  // Whether the frame that ends it has been asked for.
  let frameRequested = false;

  const onFrame = (): void => {
    frameRequested = false;
    flushedThisFrame = false;
  };

  const install = (found: GatedScheduler): void => {
    const notify = found.notify;
    found.notify = function (this: GatedScheduler, source: number): void {
      const wasScheduled = found.pendingRenderTaskId !== null;
      notify.call(this, source);
      if (
        !flushedThisFrame ||
        wasScheduled ||
        found.pendingRenderTaskId === null ||
        found.useMicrotaskScheduler
      ) {
        return;
      }
      // Angular has just scheduled a tick on its timer and frame race:
      // cancel both, and run it on the next frame instead. The pending task
      // Angular added for it stays, so the app isn't stable until it runs.
      //
      // The tick asks for a frame of its own, now, rather than running on
      // the one that ends the window: Lynx runs every callback asked for
      // before a frame in that frame, so it's the same frame, and a test
      // that fakes the timers after a flush asked for that one (the testing
      // library's frames are timers) still runs the tick on its fake clock.
      found.cancelScheduledCallback?.();
      let moved = true;
      const frame = requestAnimationFrame(() => {
        if (!moved) return;
        moved = false;
        // As Angular's timer would: tick() reports its errors to the app's
        // error handler, and cleans up after itself.
        found.tick();
      });
      found.cancelScheduledCallback = () => {
        moved = false;
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frame);
        }
      };
    };
  };

  const resolve = (): GatedScheduler | null => {
    if (typeof requestAnimationFrame !== 'function') return null;
    let found: unknown;
    try {
      found = injector.get(ChangeDetectionScheduler, null, { optional: true });
    } catch {
      // The app was destroyed before its first flush.
      return null;
    }
    if (!canGateFrames(found)) return null;
    install(found);
    return found;
  };

  return () => {
    if (scheduler === undefined) scheduler = resolve();
    if (!scheduler) return;
    flushedThisFrame = true;
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(onFrame);
  };
};
