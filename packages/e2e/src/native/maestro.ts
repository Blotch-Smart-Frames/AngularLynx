import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../packages.ts';
import { runAllowFailure, type RunResult } from '../process.ts';

export type Platform = 'ios' | 'android';

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

const ANDROID_ACCESSIBILITY =
  'BUG_LIST.md, "Maestro can\'t see Lynx elements on Android"';

export const FLOWS: readonly Flow[] = [
  {
    file: 'app.yaml',
    description: 'renders and handles taps',
    knownFailure: { android: ANDROID_ACCESSIBILITY },
  },
  {
    file: 'lazy-route.yaml',
    description: 'loads lazy routes',
    knownFailure: {
      ios: 'BUG_LIST.md, "Lazy routes fail in production builds"',
      android: ANDROID_ACCESSIBILITY,
    },
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
export const runFlow = (
  flow: Flow,
  {
    device,
    appId,
    bundleUrl,
    outputDir,
    logFile,
  }: {
    device: string;
    appId: string;
    bundleUrl: string;
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
      `BUNDLE_URL=${bundleUrl}`,
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
