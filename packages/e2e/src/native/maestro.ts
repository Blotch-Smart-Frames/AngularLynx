import { mkdirSync } from 'node:fs';
import path from 'node:path';

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
};

// No flow is a known failure on any platform. Android used to fail both flows
// because Maestro couldn't see flattened Lynx elements, which the fixtures now
// avoid (fixtures/counter.ts), and the iOS lazy route failed because Angular's
// Router skipped every navigation without a `URL` global (now polyfilled by
// the runtime).
export const FLOWS: readonly Flow[] = [
  { file: 'app.yaml', description: 'renders and handles taps' },
  { file: 'lazy-route.yaml', description: 'loads lazy routes' },
  {
    file: 'xelement.yaml',
    description: "renders XElement's input, svg and overlay",
  },
];

/** Turns a flow's exit code into a failure message, or undefined if it's fine. */
export const judgeFlow = (
  flow: Flow,
  platform: Platform,
  exitCode: number,
): string | undefined => {
  const knownFailure = flow.knownFailure?.[platform];
  if (knownFailure) {
    if (exitCode === 0) {
      return `native/${flow.file} (the app ${flow.description}) now passes on ${platform}, but is marked as a known failure (${knownFailure}). Remove it from knownFailure in src/native/maestro.ts, and the bug from BUG_LIST.md once no platform has it.`;
    }
    console.warn(`! native/${flow.file} failed as expected: ${knownFailure}`);
    return undefined;
  }
  return exitCode === 0
    ? undefined
    : `the app ${flow.description} check failed (native/${flow.file})`;
};

/**
 * Runs one Maestro flow against a booted simulator or emulator. Maestro is a
 * standalone CLI (https://maestro.mobile.dev), installed by CI with its
 * install script; it isn't an npm package.
 */
const runFlowOnce = (
  flow: Flow,
  {
    device,
    appId,
    host,
    outputDir,
    logFile,
  }: {
    device: string;
    appId: string;
    host: NativeHost;
    outputDir: string;
    logFile: string;
  },
): Promise<RunResult> => {
  const flowOutput = path.join(outputDir, path.basename(flow.file, '.yaml'));
  mkdirSync(flowOutput, { recursive: true });
  return runAllowFailure(
    'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `APP_ID=${appId}`,
      '-e',
      `OPEN_WITH=${host.kind}`,
      '-e',
      `BUNDLE_URL=${host.kind === 'explorer' ? host.bundleUrl : ''}`,
      // Maestro 2 saves `takeScreenshot` images here, and refuses paths
      // outside it.
      '--test-output-dir',
      flowOutput,
      '--debug-output',
      flowOutput,
      path.join(REPO_ROOT, 'packages/e2e/native', flow.file),
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
        // Maestro gives its XCTest driver 15s to start by default. On GitHub's
        // macOS runners the first start (which installs the driver on the
        // fresh simulator) takes longer, and every flow then failed with "iOS
        // driver not ready in time" before touching the app.
        MAESTRO_DRIVER_STARTUP_TIMEOUT:
          process.env['MAESTRO_DRIVER_STARTUP_TIMEOUT'] ?? '180000',
      },
    },
  );
};

/**
 * What Maestro prints when its XCTest driver didn't start on the simulator in
 * time. The flow then fails before touching the app, so it says nothing about
 * the app.
 */
const DRIVER_NOT_READY = 'iOS driver not ready in time';

/**
 * {@link runFlowOnce}, run again once if Maestro's iOS driver didn't start.
 *
 * Even with MAESTRO_DRIVER_STARTUP_TIMEOUT at 180s, the driver sometimes
 * isn't up in time on GitHub's macOS runners (the nightly of 2026-10-14 and
 * PR runs on 2026-10-13 and 2026-10-15). It's always the first flow on the
 * fresh simulator, and the next flow, with the driver installed, passes. Only
 * this infrastructure error is retried: a flow that ran and failed an
 * assertion fails the run as before.
 */
export const runFlow = async (
  flow: Flow,
  options: Parameters<typeof runFlowOnce>[1],
): Promise<RunResult> => {
  const result = await runFlowOnce(flow, options);
  if (result.code === 0 || !result.output.includes(DRIVER_NOT_READY)) {
    return result;
  }
  console.warn(
    `! Maestro's iOS driver didn't start in time for native/${flow.file}; running it again.`,
  );
  return runFlowOnce(flow, options);
};
