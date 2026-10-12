import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env['E2E_RENDER_PORT'] ?? 3100);
const artifactsDir =
  process.env['E2E_ARTIFACTS_DIR'] ?? path.join(here, '../artifacts');

/** Layer 3: renders the generated app's web bundle in Chromium. */
export default defineConfig({
  testDir: here,
  testMatch: 'render.test.ts',
  outputDir: path.join(artifactsDir, 'playwright'),
  // The run.ts harness owns retries; a flaky render is a bug to see, not hide.
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ${JSON.stringify(path.join(here, 'serve.ts'))}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
