import { callOnBackground } from '../background-call';
import { afterNextFlush } from '../lynx-element/lynx-element';

/**
 * The native module of the apps `ng build --platform` makes (`ShellModule` in
 * `packages/native/templates`), whose `reportFullyDrawn()` tells the system.
 */
const SHELL_MODULE = 'AngularLynxShell';

/** A module as main-thread code sees it (`lynx.module(name)`). */
type MainThreadModule = { invoke(method: string, ...args: unknown[]): unknown };

let reported = false;

/**
 * Tells the system that the app's first screen is fully drawn: its data has
 * loaded and what it shows is on screen, beyond the first frame. Call it once
 * the screen the app opens on is complete, for example when its list has
 * rendered the first page from the network. Only the first call counts.
 *
 * Android's startup tools measure "time to full display" from it: the shell
 * calls `Activity.reportFullyDrawn()`, which logcat prints as a `Fully drawn`
 * line and Macrobenchmark's `StartupTimingMetric` reads. On iOS the shell
 * emits an `os_signpost` event named `Fully Drawn` in the Points of Interest
 * category, which Instruments shows beside the App Launch template's phases.
 *
 * The report waits for the next flush, which carries what change detection
 * has just rendered to native, so it marks the screen being drawn, not the
 * data arriving. It's made from Lynx's main thread, where Angular runs,
 * straight to the shell's module, so it adds no hop through the background
 * thread to the time it marks. Lynx Explorer, the web and tests have no shell
 * to tell, and there it does nothing.
 *
 * @usageNotes
 * ```typescript
 * export class Inbox {
 *   readonly messages = httpResource<Message[]>(() => '/api/messages');
 *
 *   constructor() {
 *     effect(() => {
 *       if (this.messages.hasValue()) reportFullyDrawn();
 *     });
 *   }
 * }
 * ```
 */
export const reportFullyDrawn = (): void => {
  if (reported) return;
  reported = true;
  if ((globalThis as { lynxTestingEnv?: unknown }).lynxTestingEnv) return;
  afterNextFlush(() => {
    const module = shellModule();
    if (module) {
      try {
        module.invoke('reportFullyDrawn');
        return;
      } catch {
        // A shell from before reportFullyDrawn: fall through, the background
        // call is rejected the same way, and ignored.
      }
    }
    // A host without main-thread modules: through the background thread,
    // where NativeModules lives. A host without the shell's module rejects.
    callOnBackground(
      'callModule',
      'native',
      SHELL_MODULE,
      'reportFullyDrawn',
      [],
    ).catch(() => {});
  });
};

/**
 * The shell's module as main-thread code calls it, which the shells allow
 * (`enableMTSModule`, for WebGL), or null where the host has no such thing.
 */
const shellModule = (): MainThreadModule | null => {
  const lynxGlobal = (globalThis as { lynx?: { module?: unknown } }).lynx;
  if (typeof lynxGlobal?.module !== 'function') return null;
  try {
    const module = (lynxGlobal.module as (name: string) => unknown)(
      SHELL_MODULE,
    ) as Partial<MainThreadModule> | undefined;
    return typeof module?.invoke === 'function'
      ? (module as MainThreadModule)
      : null;
  } catch {
    return null;
  }
};

/** Lets a test report again, as a new process would. */
export const resetFullyDrawnForTesting = (): void => {
  reported = false;
};
