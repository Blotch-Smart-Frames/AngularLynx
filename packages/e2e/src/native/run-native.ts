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

type Platform = 'ios' | 'android';

/**
 * Describes the app's own binary from `ng build --platform`, the command users
 * run, for the Maestro flows. It runs the build first unless `prebuilt`: CI
 * builds the Android app in another job, before the emulator starts, and
 * hands this one the app's folder with the APK in `dist/android`. The iOS
 * build needs Lynx's XCFrameworks: published ones, or a local folder in
 * ANGULAR_LYNX_IOS_FRAMEWORKS (see packages/native/README.md).
 */
const shellHost = async (
  platform: Platform,
  appDir: string,
  logFile: string,
  prebuilt: boolean,
): Promise<NativeHost> => {
  if (!prebuilt) {
    step(`Layer 6: ng build --platform ${platform}`);
    await run('npx', ['ng', 'build', '--platform', platform], {
      cwd: appDir,
      logFile,
    });
  }
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
 * Runs the flows in `host` on the platform's simulator or emulator. Returns
 * the failures.
 */
const runFlows = (
  platform: Platform,
  host: NativeHost,
  {
    artifactsDir,
    logFile,
    port,
    keepRunning,
  }: {
    artifactsDir: string;
    logFile: string;
    port: number;
    keepRunning: boolean;
  },
) =>
  platform === 'ios'
    ? runOnIosSimulator({ host, artifactsDir, logFile, keepRunning })
    : runOnAndroidEmulator({ host, port, artifactsDir, logFile });

/**
 * Lynx Explorer opening the app's bundle from a local static server: the dev
 * path, where `ng serve` hands Explorer a bundle URL. Returns the failures.
 */
const runInExplorer = async (
  platform: Platform,
  distDir: string,
  options: Parameters<typeof runFlows>[2],
): Promise<string[]> => {
  const { artifactsDir, port } = options;
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
    const failures = await runFlows(
      platform,
      { kind: 'explorer', bundleUrl },
      options,
    );
    // Independent of the flows, which would only report that they couldn't
    // find an element: Explorer must at least have fetched the bundle.
    if (
      !readFileSync(requestLog, 'utf8').includes('200 GET /main.lynx.bundle')
    ) {
      failures.push(
        `Lynx Explorer never fetched ${bundleUrl}; the deep link didn't open it (see ${platform}-requests.log).`,
      );
    }
    return failures;
  } finally {
    server.close();
  }
};

const HOST_NAMES = {
  shell: "the app's own build",
  explorer: 'Lynx Explorer',
} as const;

/**
 * Layer 6: runs an already-built app on a native platform, in the app's own
 * binary from `ng build --platform` (what users ship), in Lynx Explorer (what
 * `ng serve` uses), or in both.
 *
 *   node packages/e2e/src/native/run-native.ts --platform ios --dist <app>/dist
 *   node packages/e2e/src/native/run-native.ts --platform ios --app <app> --explorer
 *
 * CI's iOS job calls runNative() through `run.ts --ios --shell --explorer`
 * with the app it just built on the Mac; the Android job runs this script
 * with the app folder (and APK) the Linux build job made.
 */
export const runNative = async ({
  platform,
  distDir,
  appDir,
  explorer = !appDir,
  prebuilt = false,
  artifactsDir,
  port,
  keepRunning = false,
}: {
  platform: Platform;
  /** The built app's dist/, which Explorer loads. Defaults to `<appDir>/dist`. */
  distDir?: string;
  /**
   * The app's folder. When set, Layer 6 tests the app's own binary from
   * `ng build --platform`.
   */
  appDir?: string;
  /** Also (or, without `appDir`, only) test in Lynx Explorer. */
  explorer?: boolean;
  /** Use the binary already in `<appDir>/dist/<platform>` instead of building it. */
  prebuilt?: boolean;
  artifactsDir: string;
  port: number;
  keepRunning?: boolean;
}) => {
  mkdirSync(artifactsDir, { recursive: true });
  const logFile = path.join(artifactsDir, `${platform}-commands.log`);
  const bundleDir = distDir ?? (appDir && path.join(appDir, 'dist'));
  // The shell first: it's what users ship, and its build is the step most
  // likely to break. A failure in one host still lets the other run, so one
  // CI run reports both.
  const hosts = [
    ...(appDir ? (['shell'] as const) : []),
    ...(explorer ? (['explorer'] as const) : []),
  ];
  check(hosts.length > 0, 'Nothing to test: pass --app, --dist or both.');
  const failures: string[] = [];
  for (const [index, kind] of hosts.entries()) {
    const options = {
      artifactsDir,
      logFile,
      port,
      // The next host reuses the booted simulator instead of booting it again.
      keepRunning: keepRunning || index < hosts.length - 1,
    };
    try {
      const hostFailures =
        kind === 'shell'
          ? await runFlows(
              platform,
              await shellHost(platform, appDir!, logFile, prebuilt),
              options,
            )
          : await runInExplorer(platform, bundleDir!, options);
      failures.push(
        ...hostFailures.map((failure) => `${HOST_NAMES[kind]}: ${failure}`),
      );
    } catch (error) {
      if (!(error instanceof CheckError)) {
        throw error;
      }
      failures.push(`${HOST_NAMES[kind]}: ${error.message}`);
    }
  }
  const tested = hosts.map((kind) => HOST_NAMES[kind]).join(' and ');
  check(
    failures.length === 0,
    `Layer 6 (${platform}, ${tested}) failed:\n  - ${failures.join('\n  - ')}\nScreenshots and logs are in ${artifactsDir}.`,
  );
  console.log(`✓ Layer 6 (${platform}, ${tested}) passed`);
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      // Test in Lynx Explorer, which loads this dist/ from a local server.
      dist: { type: 'string' },
      // Test the app's own binary (ng build --platform).
      app: { type: 'string' },
      // With --app, also test in Explorer, with the app's dist/.
      explorer: { type: 'boolean', default: false },
      // With --app, use the binary ng build --platform already wrote.
      prebuilt: { type: 'boolean', default: false },
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
      check(
        !values.prebuilt || values.app,
        '--prebuilt needs --app, the folder holding the built app',
      );
      await runNative({
        platform: values.platform,
        distDir: values.dist,
        appDir: values.app,
        explorer: !values.app || values.explorer || !!values.dist,
        prebuilt: values.prebuilt,
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
