// cspell:words dumpsys
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * How often the watcher looks for a dialog. A look takes about 50 ms, and a
 * dialog up for 5 seconds fails no flow: each waits 20 seconds for the page.
 */
const INTERVAL_MS = 5_000;

/**
 * The window Android shows an app's "isn't responding" dialog in, as
 * `dumpsys window windows` lists it, titled with the hung process's name. A
 * process name is its package's, with `:<name>` after it for a second
 * process, so the package is what comes before any colon.
 */
const ANR_WINDOW =
  /Window #\d+ Window\{\S+ u\d+ Application Not Responding: ([\w.]+)/g;

/**
 * Closes another app's "isn't responding" dialog whenever one is up while the
 * flows run, until the returned function is called.
 *
 * Android shows the dialog over the app in front, and Maestro, which reads
 * only the focused window, then finds none of the app's elements. The dialog
 * stays until it's answered, so every flow after it fails: on PR #427's first
 * run, Pixel Launcher stopped responding as the emulator booted, and its
 * dialog failed all 24 flows of both hosts, the app drawn fine behind it.
 *
 * Force-stopping the hung app closes its dialog, as the dialog's "Close app"
 * does, and leaves the app in front as it was (checked on the API 34
 * emulator CI runs). The app under test's own dialog stays up: that hang is
 * one the flows are there to catch. adb runs through execFile, not run(),
 * which would print every look to the CI log; only a dialog closed is logged.
 */
export const watchAnrDialogs = ({
  appId,
  logFile,
}: {
  appId: string;
  logFile: string;
}): (() => Promise<void>) => {
  const adb = (args: string[]) =>
    // The limit keeps an emulator that stopped answering from holding up the
    // stop: the flows report that themselves.
    execFileAsync('adb', args, { timeout: 30_000 });
  const closeDialogs = async () => {
    const { stdout } = await adb(['shell', 'dumpsys', 'window', 'windows']);
    const hung = new Set(
      Array.from(stdout.matchAll(ANR_WINDOW), ([, process]) => process!),
    );
    hung.delete(appId);
    for (const app of hung) {
      await adb(['shell', 'am', 'force-stop', app]);
      const message = `! ${app} wasn't responding, and its dialog covered the app; force-stopped it to close the dialog.`;
      console.warn(message);
      appendFileSync(logFile, `\n${message}\n`);
    }
  };

  const stopped = new AbortController();
  const watching = (async () => {
    while (!stopped.signal.aborted) {
      try {
        await closeDialogs();
      } catch {
        // adb failed, as it does when the emulator stops answering. The
        // flows fail on that with a better message than this could give.
      }
      try {
        await delay(INTERVAL_MS, undefined, { signal: stopped.signal });
      } catch {
        // Stopped.
      }
    }
  })();
  return async () => {
    stopped.abort();
    await watching;
  };
};
