import { scheduleSettleFlush } from '../lynx-element';
import type { ElementRef } from '../types/lynx';
import type { WebGestureArena } from './web/arena';

/**
 * The gesture PAPIs LynxGestureDetector and GestureStateManager call: Lynx's
 * own on iOS and Android, and on Lynx for Web, whose web-core recognizes no
 * gestures, the runtime's port of Lynx's gesture arena (see web/arena.ts).
 */

type DetectorConfig = {
  callbacks: Array<{ name: string; callback: unknown }>;
  config?: Record<string, unknown>;
};

let arena: WebGestureArena | undefined;
let loading: Promise<WebGestureArena> | undefined;

/**
 * Runs `use` with the page's arena (each `<lynx-view>` has its own main
 * thread), loading it first if this is the first gesture. Calls made while
 * it loads run in order once it has; after that, at once, so that a
 * callback's `fail()` takes effect before the next handler sees the event.
 *
 * `__WEB__` is a compile-time define, and the import sits in a branch it
 * kills on native, so native bundles don't include the arena. A static
 * import wouldn't do: the minifier can't prove the arena's classes side
 * effect free once they're compiled for the main thread, and keeps them (as
 * create-blur-view-element.ts found for the web glass). Only the main thread
 * runs Angular, so only it needs the arena.
 */
const withArena = (use: (arena: WebGestureArena) => void): void => {
  if (arena) {
    use(arena);
    return;
  }
  if (__WEB__ && __MAIN_THREAD__) {
    loading ??= import('./web/arena').then(
      ({ WebGestureArena }) =>
        (arena = new WebGestureArena(scheduleSettleFlush)),
    );
    void loading.then(use);
  }
};

export const setGestureDetector = (
  node: ElementRef,
  id: number,
  type: number,
  config: DetectorConfig,
  relations: Record<string, number[]>,
): void => {
  if (__WEB__) {
    withArena((web) => web.setDetector(node, id, type, config, relations));
  } else {
    __SetGestureDetector(node, id, type, config, relations);
  }
};

export const removeGestureDetector = (node: ElementRef, id: number): void => {
  if (__WEB__) withArena((web) => web.removeDetector(node, id));
  else __RemoveGestureDetector(node, id);
};

export const setGestureState = (
  node: ElementRef,
  id: number,
  state: number,
): void => {
  if (__WEB__) withArena((web) => web.setState(node, id, state));
  else __SetGestureState(node, id, state);
};

/**
 * On the web, does nothing: consuming and intercepting decide whether a
 * gesture shares the touch with native scroll views and ancestors' native
 * gestures, and the arena has none to share it with.
 */
export const consumeGesture = (
  node: ElementRef,
  id: number,
  options: Record<string, boolean>,
): void => {
  if (!__WEB__) __ConsumeGesture(node, id, options);
};
