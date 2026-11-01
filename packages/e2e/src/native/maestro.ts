import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { REPO_ROOT } from '../../../release/src/packages.ts';
import { runAllowFailure, type RunResult } from '../process.ts';

export type Platform = 'ios' | 'android';

/**
 * What Layer 6 runs the bundle in: the app's own binary from
 * `ng build --platform` (what users ship), or Lynx Explorer opening the
 * bundle from a local server.
 */
export type NativeHost =
  | {
      readonly kind: 'shell';
      /** The .app or .apk `ng build --platform` wrote. */
      readonly binary: string;
      readonly appId: string;
      /** The iOS process name, for reading its log. */
      readonly processName: string;
    }
  | { readonly kind: 'explorer'; readonly bundleUrl: string };

/** A Maestro flow in packages/e2e/native/, and what it proves. */
export type Flow = {
  readonly file: string;
  readonly description: string;
  /**
   * Set, per platform, while a known bug makes this flow fail. A failure is
   * then only reported, and a pass fails the run, so the marker is removed
   * together with the fix (the same contract as Playwright's test.fail()).
   */
  readonly knownFailure?: Partial<Record<Platform, string>>;
  /**
   * The platform or host it runs on, or both, for a flow that can't run on
   * all of them.
   */
  readonly only?: {
    readonly platform?: Platform;
    readonly host?: NativeHost['kind'];
  };
};

// No flow is a known failure on any platform. Android used to fail both flows
// because Maestro couldn't see flattened Lynx elements, which the fixtures now
// avoid (fixtures/counter.ts), and the iOS lazy route failed because Angular's
// Router skipped every navigation without a `URL` global (now polyfilled by
// the runtime).
export const FLOWS: readonly Flow[] = [
  { file: 'app.yaml', description: 'renders and handles taps' },
  {
    file: 'lazy-route.yaml',
    description: 'loads a lazy route from a routerLink',
  },
  {
    file: 'xelement.yaml',
    description: "renders XElement's input, svg and overlay",
  },
  {
    file: 'main-thread.yaml',
    description: 'removes a main-thread handler set to null',
  },
  {
    file: 'background.yaml',
    description: 'runs Angular once and reaches the background thread',
  },
  {
    file: 'gestures.yaml',
    description: 'measures a pan from the touch and ends a fling',
  },
  {
    file: 'http.yaml',
    description: 'loads JSON with HttpClient and httpResource',
  },
  {
    file: 'back-button.yaml',
    description: 'goes back a screen with the back button',
    // Only the app's own Android build has a back handler the runtime turns
    // on (AngularLynxShell in the Android template). iOS has no back button,
    // and Lynx Explorer's leaves the page.
    only: { platform: 'android', host: 'shell' },
  },
  {
    file: 'storage.yaml',
    description: 'keeps local and secure storage after a restart',
    // Only the app's own builds have the storage modules. Lynx Explorer keeps
    // the values in memory, which a restart empties.
    only: { host: 'shell' },
  },
];

/** The flows to run on a platform's host. */
export const flowsFor = (platform: Platform, host: NativeHost): Flow[] =>
  FLOWS.filter(
    ({ only }) =>
      (only?.platform === undefined || only.platform === platform) &&
      (only?.host === undefined || only.host === host.kind),
  );

/**
 * What became of one flow in a Maestro run. A flow is `not-run` when Maestro
 * never reported on it: it hung, or it stopped before reaching the flow.
 */
export type FlowOutcome =
  | { readonly status: 'passed' }
  | { readonly status: 'failed' | 'not-run'; readonly reason: string };

/** Turns a flow's outcome into a failure message, or undefined if it's fine. */
export const judgeFlow = (
  flow: Flow,
  platform: Platform,
  outcome: FlowOutcome,
): string | undefined => {
  // A flow that never ran says nothing about the app, known failure or not.
  if (outcome.status === 'not-run') {
    return `native/${flow.file} (the app ${flow.description}) didn't run: ${outcome.reason}`;
  }
  const knownFailure = flow.knownFailure?.[platform];
  if (knownFailure) {
    if (outcome.status === 'passed') {
      return `native/${flow.file} (the app ${flow.description}) now passes on ${platform}, but is marked as a known failure (${knownFailure}). Remove it from knownFailure in src/native/maestro.ts, and the bug from BUG_LIST.md once no platform has it.`;
    }
    console.warn(`! native/${flow.file} failed as expected: ${knownFailure}`);
    return undefined;
  }
  return outcome.status === 'passed'
    ? undefined
    : `the app ${flow.description} check failed (native/${flow.file}): ${outcome.reason}`;
};

export type FlowRunOptions = {
  readonly device: string;
  readonly appId: string;
  readonly host: NativeHost;
  /**
   * Maestro writes each run's flows here, in a folder per run: every flow's
   * `takeScreenshot` images, commands and logs.
   */
  readonly outputDir: string;
  readonly logFile: string;
  /** Saves a screenshot of the device to `file`, for a run that hung. */
  readonly screenshot: (file: string) => Promise<void>;
};

/**
 * How long Maestro gives its XCTest driver to start. Its default is 15s. On
 * GitHub's macOS runners the first start (which installs the driver on the
 * fresh simulator) takes longer, and every flow then failed with "iOS driver
 * not ready in time" before touching the app.
 */
const DRIVER_STARTUP_TIMEOUT_MS = Number(
  process.env['MAESTRO_DRIVER_STARTUP_TIMEOUT'] ?? 180_000,
);

/**
 * The longest one flow may take. The slowest to pass in ten iOS and Android
 * CI jobs' logs took 97s. One that fails stops at the wait it failed on, the
 * longest of which (open-app.yaml's for Explorer, tried three times) takes
 * about 90s.
 */
const FLOW_TIMEOUT_MS = 4 * 60_000;

/**
 * How long Maestro may go without finishing a flow before the harness
 * counts it as hung and stops it: room for the driver to start, which it
 * does before the first flow, and for a flow. A hang used to run until
 * GitHub killed the job hours later, without the logs to say where: one PR's
 * iOS job sat in the Layer 6 step for over 80 minutes.
 */
const STALL_TIMEOUT_MS = DRIVER_STARTUP_TIMEOUT_MS + FLOW_TIMEOUT_MS;

/**
 * {@link STALL_TIMEOUT_MS} for messages, to a tenth of a minute.
 */
const stallMinutes = Math.round(STALL_TIMEOUT_MS / 6_000) / 10;

/**
 * The line Maestro prints for each finished flow when it runs them as a
 * suite:
 *
 *   [Passed] app (4s)
 *   [Failed] http (19s) (Assertion is false: "HTTP: pong/pong" is visible)
 *
 * The name is the flow's file name, since none of our flows sets `name:`. A
 * flow that passed with warnings ends in "(Warning)".
 */
const RESULT_LINE =
  /^\[(Passed|Failed)\] (\S+)(?: \(\d[^)]*\))?(?: \((.*)\))?$/;

/**
 * Lines that show Maestro is getting on: the driver started, or a flow
 * finished. They restart the stall timeout.
 */
const PROGRESS_LINE = /^(Waiting for flows to complete|\[(Passed|Failed)\] )/;

/**
 * What Maestro prints when its XCTest driver didn't start on the simulator in
 * time. The flows then fail before touching the app, so they say nothing
 * about the app.
 */
const DRIVER_NOT_READY = 'iOS driver not ready in time';

/**
 * How many times flows are run again when Maestro's iOS driver didn't start.
 * Once wasn't enough: on #35's CI run and the 2026-10-18 nightly (#31) the
 * driver missed its timeout twice in a row, and on #35's run a third start
 * succeeded.
 */
const DRIVER_RETRIES = 2;

/**
 * How many times the flows left over are run again after Maestro hung. Like
 * the driver errors above, the hangs seen so far were in Maestro rather than
 * the app: in 7 of 60 runs the Android job's Maestro sat 6 to 18 minutes in
 * launchApp's permission setup, talking to the emulator over adb, before it
 * launched anything (open-app.yaml now skips that). A new session gets past
 * such a hang; one that comes back fails the host.
 */
const STALL_RETRIES = 1;

/**
 * Runs `flows` against a booted simulator or emulator in one Maestro session.
 * Maestro is a standalone CLI (https://maestro.mobile.dev), installed by CI
 * with its install script; it isn't an npm package.
 *
 * One session per host rather than per flow: on GitHub's macOS runners, each
 * `maestro test` took 36 seconds (the median; up to 112) to start its XCTest
 * driver, about as long as the flow it then ran, so a session per flow cost
 * the iOS job about 9 minutes. Every flow still starts from a fresh app
 * process: they all open the app with open-app.yaml, whose launchApp stops it
 * first, as it did when each flow had its own session.
 */
const runMaestro = (
  flows: readonly Flow[],
  { device, appId, host, outputDir, logFile }: FlowRunOptions,
  run: number,
): Promise<RunResult> => {
  mkdirSync(outputDir, { recursive: true });
  return runAllowFailure(
    'maestro',
    [
      '--device',
      device,
      'test',
      // Plain result lines for RESULT_LINE.
      '--no-ansi',
      '-e',
      `APP_ID=${appId}`,
      '-e',
      `OPEN_WITH=${host.kind}`,
      '-e',
      `BUNDLE_URL=${host.kind === 'explorer' ? host.bundleUrl : ''}`,
      // Asking for a report also makes Maestro run a single flow as a suite,
      // so a retry of one flow prints the same result lines.
      '--format',
      'junit',
      '--output',
      path.join(outputDir, `report-${run}.xml`),
      // Maestro 2 saves `takeScreenshot` images here, and refuses paths
      // outside it.
      '--test-output-dir',
      outputDir,
      '--debug-output',
      outputDir,
      ...flows.map((flow) =>
        path.join(REPO_ROOT, 'packages/e2e/native', flow.file),
      ),
    ],
    {
      cwd: REPO_ROOT,
      logFile,
      env: {
        ...process.env,
        // Maestro sends usage analytics and prints promotional banners by
        // default; neither belongs in a test run.
        MAESTRO_CLI_NO_ANALYTICS: '1',
        MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
        MAESTRO_DRIVER_STARTUP_TIMEOUT: String(DRIVER_STARTUP_TIMEOUT_MS),
      },
      timeout: { ms: STALL_TIMEOUT_MS, progress: PROGRESS_LINE },
    },
  );
};

/**
 * The flows Maestro reported on in `output`, with how each went.
 */
const parseResults = (output: string, flows: readonly Flow[]) => {
  const results = new Map<Flow, FlowOutcome>();
  for (const line of stripVTControlCharacters(output).split('\n')) {
    const match = RESULT_LINE.exec(line.trim());
    const flow =
      match &&
      flows.find(
        (candidate) => path.basename(candidate.file, '.yaml') === match[2],
      );
    if (flow) {
      results.set(
        flow,
        match[1] === 'Passed'
          ? { status: 'passed' }
          : { status: 'failed', reason: match[3] ?? 'Maestro gave no reason' },
      );
    }
  }
  return results;
};

/**
 * The end of `text`, at most `count` lines.
 */
const lastLines = (text: string, count: number) =>
  text.trimEnd().split('\n').slice(-count).join('\n');

/**
 * The log of Maestro's latest session in `outputDir`. It records every
 * command as it starts, unlike Maestro's output, which has a line per
 * finished flow.
 */
const latestMaestroLog = (outputDir: string): string | undefined => {
  const sessions = path.join(outputDir, '.maestro/tests');
  if (!existsSync(sessions)) {
    return undefined;
  }
  // Session folders are named by their start time, so the last sorts last.
  const latest = readdirSync(sessions).sort().at(-1);
  const log = latest && path.join(sessions, latest, 'maestro.log');
  return log && existsSync(log) ? log : undefined;
};

/**
 * Saves what a maintainer needs to see why Maestro hung, since the CI log
 * only shows that a flow never finished: a screenshot of the device, and the
 * end of Maestro's output and log, where the last command started is the one
 * it hung on. Prints the log's end too. Returns the report's path.
 */
const reportStall = async (
  flow: Flow,
  result: RunResult,
  { outputDir, screenshot }: FlowRunOptions,
  run: number,
) => {
  const report = path.join(outputDir, `hung-${run}.log`);
  await screenshot(path.join(outputDir, `hung-${run}.png`));
  const log = latestMaestroLog(outputDir);
  const logEnd = log
    ? lastLines(readFileSync(log, 'utf8'), 80)
    : '(Maestro wrote no log.)';
  writeFileSync(
    report,
    `Maestro finished no flow for ${stallMinutes} minutes while running native/${flow.file}, so it was stopped.\n\n` +
      `The end of its output:\n${lastLines(result.output, 40)}\n\n` +
      `The end of its log (${log ?? 'none'}):\n${logEnd}\n`,
  );
  console.error(
    `\n! Maestro hung on native/${flow.file}. The end of its log:\n${lastLines(logEnd, 15)}\n(More in ${report}, with a screenshot.)`,
  );
  return report;
};

/**
 * Runs `flows` with {@link runMaestro} and returns each one's outcome, in
 * order. When Maestro stops before reporting on every flow, only the flows
 * it didn't report on run again, in a new session:
 *
 * - up to {@link DRIVER_RETRIES} times when its iOS driver didn't start.
 *   Even with the driver's startup timeout at 180s, it sometimes isn't up in
 *   time on GitHub's macOS runners (the nightly of 2026-10-14 and PR runs on
 *   2026-10-13 and 2026-10-15). It's always the first session on the fresh
 *   simulator, and the next, with the driver installed, gets going.
 * - up to {@link STALL_RETRIES} times when it hung, after saving what it was
 *   doing (see {@link reportStall}).
 *
 * Only these infrastructure errors are retried: a flow that ran and failed
 * an assertion fails the run as before.
 */
export const runFlows = async (
  flows: readonly Flow[],
  options: FlowRunOptions,
): Promise<Map<Flow, FlowOutcome>> => {
  const outcomes = new Map<Flow, FlowOutcome>();
  let driverRetries = 0;
  let stallRetries = 0;
  for (let run = 1; ; run++) {
    const pending = flows.filter((flow) => !outcomes.has(flow));
    const result = await runMaestro(pending, options, run);
    const output = result.timedOut?.output ?? result.output;
    for (const [flow, outcome] of parseResults(output, pending)) {
      // Failed before touching the app, so it runs again.
      if (
        outcome.status === 'failed' &&
        outcome.reason.includes(DRIVER_NOT_READY)
      ) {
        continue;
      }
      outcomes.set(flow, outcome);
    }
    const unfinished = pending.filter((flow) => !outcomes.has(flow));
    if (unfinished.length === 0) {
      break;
    }
    const names = unfinished.map((flow) => `native/${flow.file}`).join(', ');
    const [first] = unfinished as [Flow, ...Flow[]];
    let reason: (flow: Flow) => string;
    if (result.timedOut) {
      const report = await reportStall(first, result, options, run);
      if (stallRetries < STALL_RETRIES) {
        stallRetries++;
        console.warn(
          `! Running ${names} again in a new Maestro session (${stallRetries} of ${STALL_RETRIES}).`,
        );
        continue;
      }
      reason = (flow) =>
        flow === first
          ? `Maestro hung on it in ${STALL_RETRIES + 1} sessions, finishing no flow for ${stallMinutes} minutes each time (see ${report})`
          : `Maestro hung on native/${first.file} before it`;
    } else if (result.output.includes(DRIVER_NOT_READY)) {
      if (driverRetries < DRIVER_RETRIES) {
        driverRetries++;
        console.warn(
          `! Maestro's iOS driver didn't start in time; running ${names} again (${driverRetries} of ${DRIVER_RETRIES}).`,
        );
        continue;
      }
      reason = () =>
        `Maestro's iOS driver didn't start in time in ${DRIVER_RETRIES + 1} sessions`;
    } else {
      reason = () =>
        `Maestro exited with code ${result.code} without reporting on it (its output is above)`;
    }
    for (const flow of unfinished) {
      outcomes.set(flow, { status: 'not-run', reason: reason(flow) });
    }
    break;
  }
  return new Map(flows.map((flow) => [flow, outcomes.get(flow)!]));
};
