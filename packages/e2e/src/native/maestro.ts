import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../packages.ts';
import { runAllowFailure, type RunResult } from '../process.ts';

/** A Maestro flow in packages/e2e/native/, and what it proves. */
export type Flow = {
  readonly file: string;
  readonly description: string;
  /**
   * Set while a known bug makes this flow fail. A failure is then only
   * reported, and a pass fails the run, so the marker is removed together
   * with the fix (the same contract as Playwright's test.fail()).
   */
  readonly knownFailure?: string;
};

export const FLOWS: readonly Flow[] = [
  { file: 'app.yaml', description: 'renders and handles taps' },
  {
    file: 'lazy-route.yaml',
    description: 'loads lazy routes',
    knownFailure: 'BUG_LIST.md, "Lazy routes fail in production builds"',
  },
];

/** Turns a flow's exit code into a failure message, or undefined if it's fine. */
export const judgeFlow = (flow: Flow, exitCode: number): string | undefined => {
  if (flow.knownFailure) {
    if (exitCode === 0) {
      return `native/${flow.file} (the app ${flow.description}) now passes, but is marked as a known failure (${flow.knownFailure}). Remove knownFailure from src/native/maestro.ts and the bug from BUG_LIST.md.`;
    }
    console.warn(
      `! native/${flow.file} failed as expected: ${flow.knownFailure}`,
    );
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
      },
    },
  );
};
