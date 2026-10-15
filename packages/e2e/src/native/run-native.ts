import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { CheckError, check, run, step } from '../process.ts';
import { serveStatic } from '../static-server.ts';
import { runOnAndroidEmulator } from './android.ts';
import { prepareIos, runOnIosSimulator } from './ios.ts';
import type { NativeHost } from './maestro.ts';

/**
 * Builds the app's own binary with `ng build --platform`, the command users
 * run, and describes it for the Maestro flows. The iOS build needs Lynx's
 * XCFrameworks: published ones, or a local folder in
 * ANGULAR_LYNX_IOS_FRAMEWORKS (see @blotch/angular-lynx-native).
 */
const buildShell = async (
  platform: 'ios' | 'android',
  appDir: string,
  logFile: string,
): Promise<NativeHost> => {
  step(`Layer 6: ng build --platform ${platform}`);
  await run('npx', ['ng', 'build', '--platform', platform], {
    cwd: appDir,
    logFile,
  });
  const angularJson = JSON.parse(
    readFileSync(path.join(appDir, 'angular.json'), 'utf8'),
  ) as {
    projects: Record<
      string,
      { architect: { build: { options: { appId: string } } } }
    >;
  };
  const appId = Object.values(angularJson.projects)[0]!.architect.build.options
    .appId;
  const outputDir = path.join(appDir, 'dist', platform);
  const binary = readdirSync(outputDir).find((file) =>
    platform === 'ios'
      ? file.endsWith('-simulator.app')
      : file.endsWith('.apk'),
  );
  check(
    binary,
    `ng build --platform ${platform} wrote no app to ${outputDir}.`,
  );
  return {
    kind: 'shell',
    binary: path.join(outputDir, binary),
    appId,
    // The executable is the .app's name without "-simulator".
    processName: binary.replace(/-simulator\.app$/, ''),
  };
};

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
  appDir,
  artifactsDir,
  port,
  keepRunning,
}: {
  platform: 'ios' | 'android';
  distDir: string;
  /**
   * The app's folder. When set, Layer 6 tests the app's own binary from
   * `ng build --platform` instead of Lynx Explorer.
   */
  appDir?: string;
  artifactsDir: string;
  port: number;
  keepRunning?: boolean;
}) => {
  mkdirSync(artifactsDir, { recursive: true });
  const logFile = path.join(artifactsDir, `${platform}-commands.log`);
  if (appDir) {
    const host = await buildShell(platform, appDir, logFile);
    const failures =
      platform === 'ios'
        ? await runOnIosSimulator({ host, artifactsDir, logFile, keepRunning })
        : await runOnAndroidEmulator({ host, port, artifactsDir, logFile });
    check(
      failures.length === 0,
      `Layer 6 (${platform}) failed:\n  - ${failures.join('\n  - ')}\nScreenshots and logs are in ${artifactsDir}.`,
    );
    console.log(`✓ Layer 6 (${platform}, the app's own build) passed`);
    return;
  }
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
            host: { kind: 'explorer', bundleUrl },
            artifactsDir,
            logFile,
            keepRunning,
          })
        : await runOnAndroidEmulator({
            host: { kind: 'explorer', bundleUrl },
            port,
            artifactsDir,
            logFile,
          });
    // Independent of the flows, which would only report that they couldn't
    // find an element: Explorer must at least have fetched the bundle.
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
      // Test the app's own binary (ng build --platform) instead of Explorer.
      app: { type: 'string' },
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
      check(
        values.dist || values.app,
        "--dist must point at the built app's dist/ folder, or --app at the app",
      );
      await runNative({
        platform: values.platform,
        distDir: values.dist ?? path.join(values.app!, 'dist'),
        appDir: values.app,
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
