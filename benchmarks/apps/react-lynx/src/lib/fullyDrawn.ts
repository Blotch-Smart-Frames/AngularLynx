import { runOnMainThread } from '@lynx-js/react';

import { shell } from './shell';

let reported = false;

/**
 * Marks the screen fully drawn: the shell emits an os_signpost event named
 * `Fully Drawn` (ShellModule.swift), which the harness reads like the
 * original's `TTFD`. Once per process, as the original's module does.
 *
 * Call it from an effect of the commit that renders what it marks. ReactLynx
 * renders on the background thread and sends each commit to the main thread
 * as a patch, which the main thread applies and flushes to native. An effect
 * runs once the patch is sent, not applied, so this first runs an empty
 * main-thread function: runOnMainThread's calls queue behind the patch, and
 * its promise settles once the main thread has applied and flushed it. That
 * stands in for the original's requestAnimationFrame after the commit, and
 * marks the same moment AngularLynx's reportFullyDrawn() does (after the
 * flush that carries the rows). The shell's module then gets the call on the
 * background thread, where NativeModules lives.
 */
export const reportFullyDrawn = (): void => {
  if (reported) return;
  reported = true;
  void runOnMainThread(() => {
    'main thread';
  })().then(() => {
    shell().AngularLynxShell?.reportFullyDrawn();
  });
};
