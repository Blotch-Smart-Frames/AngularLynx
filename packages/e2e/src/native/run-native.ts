import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { CheckError, check } from '../process.ts';
import { serveStatic } from '../static-server.ts';
import { runOnAndroidEmulator } from './android.ts';
import { prepareIos, runOnIosSimulator } from './ios.ts';

/**
 * Layer 6: runs an already-built app on a native platform.
 *
 *   node packages/e2e/src/native/run-native.ts --platform ios --dist <app>/dist
 *
 * CI builds the app once on Linux and passes its dist/ to the macOS and
 * Android jobs; `npm run e2e -- --ios` calls runNative() with the app it just
 * built.
 */
export const runNative = async ({
  platform,
  distDir,
  artifactsDir,
  port,
  keepRunning,
}: {
  platform: 'ios' | 'android';
  distDir: string;
  artifactsDir: string;
  port: number;
  keepRunning?: boolean;
}) => {
  mkdirSync(artifactsDir, { recursive: true });
  const logFile = path.join(artifactsDir, `${platform}-commands.log`);
  // The simulator shares the Mac's network, and the emulator reaches the host
  // through `adb reverse`, so both load the bundle from localhost. Explorer
  // allows plain HTTP.
  // Which bundles the app actually requested is the first question when a
  // native check fails, and Explorer doesn't log it.
  const requestLog = path.join(artifactsDir, `${platform}-requests.log`);
  writeFileSync(requestLog, '');
  const server = await serveStatic(
    [{ prefix: '/', dir: path.resolve(distDir) }],
    {
      port,
      host: '127.0.0.1',
      onRequest: (line) =>
        appendFileSync(requestLog, `${new Date().toISOString()} ${line}\n`),
    },
  );
  // Explorer 4.1.0 reads everything after `url=` as-is, so the bundle URL is
  // passed unencoded. (The router on Lynx's main branch URL-decodes it;
  // re-check when bumping EXPLORER.version.)
  const bundleUrl = `http://127.0.0.1:${port}/main.lynx.bundle`;
  try {
    const failures =
      platform === 'ios'
        ? await runOnIosSimulator({
            bundleUrl,
            artifactsDir,
            logFile,
            keepRunning,
          })
        : await runOnAndroidEmulator({
            bundleUrl,
            port,
            artifactsDir,
            logFile,
          });
    // Independent of the flows, which can't read the screen on Android (see
    // FLOWS): Explorer must at least have fetched the bundle.
    if (
      !readFileSync(requestLog, 'utf8').includes('200 GET /main.lynx.bundle')
    ) {
      failures.push(
        `Lynx Explorer never fetched ${bundleUrl}; the deep link didn't open it (see ${platform}-requests.log).`,
      );
    }
    check(
      failures.length === 0,
      `Layer 6 (${platform}) failed:\n  - ${failures.join('\n  - ')}\nScreenshots and logs are in ${artifactsDir}.`,
    );
    console.log(`✓ Layer 6 (${platform}) passed`);
  } finally {
    server.close();
  }
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      dist: { type: 'string' },
      'artifacts-dir': { type: 'string' },
      port: { type: 'string', default: '3210' },
      // Start the simulator booting and download Explorer, then exit. A later
      // run with --dist finds the simulator booted or booting.
      prepare: { type: 'boolean', default: false },
    },
  });
  try {
    check(
      values.platform === 'ios' || values.platform === 'android',
      '--platform must be ios or android',
    );
    const artifactsDir =
      values['artifacts-dir'] ??
      path.join(import.meta.dirname, '../../artifacts');
    if (values.prepare) {
      check(
        values.platform === 'ios',
        '--prepare only applies to --platform ios',
      );
      mkdirSync(artifactsDir, { recursive: true });
      await prepareIos(path.join(artifactsDir, 'ios-commands.log'));
    } else {
      check(values.dist, "--dist must point at the built app's dist/ folder");
      await runNative({
        platform: values.platform,
        distDir: values.dist,
        artifactsDir,
        port: Number(values.port),
      });
    }
  } catch (error) {
    console.error(
      `\n✗ ${error instanceof CheckError ? error.message : (error as Error).stack}`,
    );
    process.exit(1);
  }
}
