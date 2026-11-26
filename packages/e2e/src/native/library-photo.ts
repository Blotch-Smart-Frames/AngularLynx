import { spawn } from 'node:child_process';
import {
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { check, CheckError, runAllowFailure, waitFor } from '../process.ts';
import { LIBRARY_PHOTO } from './maestro.ts';

/**
 * How the background job prepareIos() starts is getting on, in a file named
 * for the simulator. The job writes it: `adding` as it starts, then how it
 * ended. A file per simulator, because Layer 6 falls back to another
 * runtime, with a new simulator, when the first one fails to boot.
 */
type PhotoJob =
  | { readonly status: 'adding'; readonly pid: number }
  | { readonly status: 'added'; readonly seconds: number }
  | { readonly status: 'failed'; readonly message: string };

const jobFile = (udid: string) =>
  path.join(tmpdir(), 'angular-lynx-e2e', `library-photo-${udid}.json`);

const writeJob = (udid: string, job: PhotoJob) => {
  const file = jobFile(udid);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(job));
};

const readJob = (udid: string): PhotoJob | undefined => {
  try {
    return JSON.parse(readFileSync(jobFile(udid), 'utf8')) as PhotoJob;
  } catch {
    // No job, or one that died partway through writing.
    return undefined;
  }
};

const isRunning = (pid: number) => {
  try {
    // Signal 0 only checks that the process exists.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** One try's limit. See addLibraryPhoto() for why it's so long. */
const TRY_MS = 300_000;
const TRIES = 2;
const PAUSE_MS = 5_000;

/**
 * Adds the photo photo.yaml picks, newest in the library, so it's the first
 * the picker shows. On a freshly booted GitHub runner simulator, `simctl
 * addmedia` is slow: 67 to 174 seconds when it worked, and it has also crashed
 * after a minute (exit 133). On the xcode-27 image, the first call often
 * hangs instead, and the second, started after this one is stopped, finishes
 * in 4 seconds to 2 minutes (#624). A try stopped at its limit starts over,
 * so a short limit only adds tries that can't finish: four 90-second tries all
 * failed in one run. That's why CI runs this in the background from the
 * moment the simulator starts booting (startAddingLibraryPhoto()), where the
 * time it takes overlaps with the boot, the wait for build-app and the
 * shell's build, rather than coming out of Layer 6's 30 minutes.
 */
export const addLibraryPhoto = async (udid: string, logFile: string) => {
  for (let attempt = 1; ; attempt++) {
    const { code } = await runAllowFailure(
      'xcrun',
      ['simctl', 'addmedia', udid, LIBRARY_PHOTO],
      {
        cwd: process.cwd(),
        logFile,
        echo: false,
        timeout: { ms: TRY_MS },
      },
    );
    if (code === 0) {
      return;
    }
    check(
      attempt < TRIES,
      `\`xcrun simctl addmedia\` failed ${TRIES} times (last exit code ${code}).`,
    );
    console.log(
      `simctl addmedia exited with code ${code}; trying again (${attempt + 1} of ${TRIES}).`,
    );
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
};

/**
 * The longest the background job's boot wait may take. The CI step that
 * starts the boot allows 10 minutes; a boot that takes longer has failed,
 * and Layer 6 boots another runtime.
 */
const BOOT_MS = 600_000;

/**
 * Starts adding the library photo in a process of its own, which waits for
 * `udid` to finish booting first and outlives the caller: CI's "Start the
 * iOS Simulator" step runs prepareIos() and ends long before Layer 6, its
 * last step, needs the photo. GitHub stops a job's leftover processes only
 * once the job ends. The job's output goes to ios-photo.log next to
 * `logFile`, and its commands' output to `logFile`, as Layer 6's own do.
 */
export const startAddingLibraryPhoto = (udid: string, logFile: string) => {
  // A job left by an earlier run on the same simulator says nothing about
  // this one.
  rmSync(jobFile(udid), { force: true });
  const output = openSync(
    path.join(path.dirname(logFile), 'ios-photo.log'),
    'a',
  );
  const child = spawn(
    process.execPath,
    [import.meta.filename, udid, logFile],
    // Its own process group, so it isn't stopped with the caller's.
    { detached: true, stdio: ['ignore', output, output] },
  );
  child.unref();
  console.log(
    `Adding the library photo in the background (pid ${child.pid}); see ios-photo.log`,
  );
};

/**
 * Makes sure the library photo is on `udid` before photo.yaml runs. Waits for
 * the job startAddingLibraryPhoto() started, if it's still going. Adds the
 * photo here, as before the job existed, when there's no job (a local run,
 * or a simulator Layer 6 booted after the first failed) or the job failed.
 */
export const ensureLibraryPhoto = async (udid: string, logFile: string) => {
  const job = readJob(udid);
  if (job?.status === 'adding' && isRunning(job.pid)) {
    console.log(
      `Waiting for the library photo, which the background job (pid ${job.pid}) is adding.`,
    );
    try {
      await waitFor(
        'the background job to add the library photo',
        () => readJob(udid)?.status !== 'adding' || !isRunning(job.pid),
        // Its tries, with a minute to spare. Its boot wait is over by now:
        // Layer 6 waited for the same boot before calling this.
        { timeoutMs: TRIES * (TRY_MS + PAUSE_MS) + 60_000, intervalMs: 2_000 },
      );
    } catch (error) {
      try {
        process.kill(-job.pid, 'SIGKILL');
      } catch {
        // It ended just now.
      }
      throw error;
    }
  }
  const outcome = readJob(udid);
  rmSync(jobFile(udid), { force: true });
  if (outcome?.status === 'added') {
    console.log(
      `The background job added the library photo ${outcome.seconds}s after it started.`,
    );
    return;
  }
  if (outcome?.status === 'failed') {
    console.log(
      `The background job couldn't add the library photo (${outcome.message}); adding it now.`,
    );
  } else if (outcome?.status === 'adding') {
    console.log(
      'The background job stopped before adding the library photo; adding it now.',
    );
  }
  await addLibraryPhoto(udid, logFile);
};

// The background job: node library-photo.ts <udid> <logFile>
if (import.meta.main) {
  const [udid, logFile] = process.argv.slice(2) as [string, string];
  writeJob(udid, { status: 'adding', pid: process.pid });
  const started = Date.now();
  try {
    const boot = await runAllowFailure(
      'xcrun',
      ['simctl', 'bootstatus', udid, '-b'],
      { cwd: process.cwd(), logFile, echo: false, timeout: { ms: BOOT_MS } },
    );
    check(
      boot.code === 0,
      `the simulator didn't finish booting (simctl bootstatus exited with code ${boot.code})`,
    );
    await addLibraryPhoto(udid, logFile);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`Added the library photo ${seconds}s after the boot started.`);
    writeJob(udid, { status: 'added', seconds });
  } catch (error) {
    const message = error instanceof CheckError ? error.message : String(error);
    console.error(message);
    writeJob(udid, { status: 'failed', message });
  }
}
