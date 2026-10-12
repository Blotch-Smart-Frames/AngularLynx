import { createRequire } from 'node:module';
import path from 'node:path';

import type { RunContext } from './context.ts';
import { REPO_ROOT } from './packages.ts';
import { run, step } from './process.ts';
import type { ScaffoldedApp } from './scaffold.ts';

/**
 * Layer 3: renders the app's web bundle in Chromium through Lynx for Web, and
 * clicks through it (playwright/render.test.ts).
 */
export const renderInBrowser = async (
  app: ScaffoldedApp,
  context: RunContext,
) => {
  step('Layer 3: render the app in Chromium');
  const playwrightCli = createRequire(import.meta.url).resolve(
    '@playwright/test/cli',
  );
  await run(
    process.execPath,
    [
      playwrightCli,
      'test',
      '--config',
      path.join(REPO_ROOT, 'packages/e2e/playwright/playwright.config.ts'),
    ],
    {
      cwd: path.join(REPO_ROOT, 'packages/e2e'),
      env: {
        ...process.env,
        E2E_APP_DIST: app.distDir,
        E2E_APP_NAME: app.name,
        E2E_ARTIFACTS_DIR: context.artifactsDir,
      },
      logFile: context.logFile,
    },
  );
};
