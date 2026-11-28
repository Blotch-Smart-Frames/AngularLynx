import { shell } from './shell';

/** The shell's module as main-thread code calls it (`lynx.module(name)`). */
type MainThreadModule = { invoke(method: string, ...args: unknown[]): unknown };

let marked = false;

/**
 * Marks `MountStart` as the mount screen starts rendering: the shell emits an
 * os_signpost event whose message is `MountStart` (ShellModule.swift's
 * `markEvent`; on Android, ShellModule.kt logs `Mark MountStart at <ns> ns`),
 * which the harness reads with the screen's `Fully Drawn` to
 * time the screen apart from the launch before it, as the React Native apps'
 * `MountStart` does. Once per thread.
 *
 * Call it from the screen's render. ReactLynx renders the first screen on
 * both threads: the main thread renders it as the page loads and makes its
 * elements, and the background thread renders it again to hydrate them. Each
 * marks from the thread it runs on, straight to the shell: the main thread
 * through `lynx.module()` (the shell allows main-thread modules, which
 * AngularLynx's runtime uses for its own `Fully Drawn`), the background
 * thread through NativeModules. The harness takes the earlier of the two,
 * the moment either thread starts on the screen, as AngularLynx's mark is
 * made from the main thread as its screen's component is created.
 */
export const markMountStart = (): void => {
  if (marked) return;
  marked = true;
  try {
    if (__MAIN_THREAD__) {
      const lynxGlobal = (
        globalThis as { lynx?: { module?: (name: string) => unknown } }
      ).lynx;
      const module = lynxGlobal?.module?.('AngularLynxShell') as
        | Partial<MainThreadModule>
        | undefined;
      module?.invoke?.('markEvent', 'MountStart');
    } else {
      shell().AngularLynxShell?.markEvent('MountStart');
    }
  } catch {
    // A host without the shell, such as Lynx Explorer, or a shell from
    // before markEvent: the harness then records no mount time.
  }
};
