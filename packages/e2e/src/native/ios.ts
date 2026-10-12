import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { check, run, runAllowFailure, start, step, stop } from '../process.ts';
import { EXPLORER, getExplorer } from './explorer.ts';
import { FLOWS, judgeFlow, runFlow } from './maestro.ts';

/** The simulator the E2E tests create and reuse, so a developer's own stays untouched. */
const DEVICE_NAME = 'AngularLynx E2E';

type SimctlList = {
  devices: Record<string, { name: string; udid: string; state: string }[]>;
  runtimes: {
    identifier: string;
    name: string;
    isAvailable: boolean;
    platform?: string;
    /** Newest first. */
    supportedDeviceTypes?: { identifier: string; productFamily?: string }[];
  }[];
};

const simctl = async (args: string[], logFile: string) =>
  (
    await run('xcrun', ['simctl', ...args], {
      cwd: process.cwd(),
      logFile,
      echo: false,
    })
  ).output;

/**
 * Boots the E2E simulator, creating it on the newest iOS runtime first. On
 * GitHub's runners a simulator sometimes fails to boot ("Data Migration
 * Failed"); like Lynx's own CI (run_sparkling_smoke.sh), fall back to an
 * older runtime when that happens.
 */
const bootSimulator = async (
  logFile: string,
  { wait = true }: { wait?: boolean } = {},
): Promise<string> => {
  const list = JSON.parse(
    await simctl(['list', '--json'], logFile),
  ) as SimctlList;
  const runtimes = list.runtimes
    .filter(
      (runtime) => runtime.isAvailable && runtime.identifier.includes('iOS'),
    )
    .reverse();
  check(
    runtimes.length > 0,
    'No iOS Simulator runtime is installed. Install one in Xcode → Settings → Components.',
  );

  for (const runtime of runtimes) {
    // Each runtime runs only some device types, and the global device type
    // list isn't in release order: on GitHub's macOS 15 image its last iPhone
    // was the 6s Plus, which iOS 26 can't run (`simctl create` exit 147).
    const deviceType = runtime.supportedDeviceTypes?.find(
      (type) => type.productFamily === 'iPhone',
    );
    if (!deviceType) {
      console.warn(
        `${runtime.name} supports no iPhone; trying an older runtime.`,
      );
      continue;
    }
    const device = list.devices[runtime.identifier]?.find(
      (candidate) => candidate.name === DEVICE_NAME,
    );
    const udid =
      device?.udid ??
      (
        await simctl(
          ['create', DEVICE_NAME, deviceType.identifier, runtime.identifier],
          logFile,
        )
      ).trim();
    if (device?.state === 'Booted') {
      return udid;
    }
    // Fails harmlessly when an earlier prepareIos() already started booting.
    await runAllowFailure('xcrun', ['simctl', 'boot', udid], {
      cwd: process.cwd(),
      logFile,
      echo: false,
    });
    if (!wait) {
      return udid;
    }
    const status = await runAllowFailure(
      'xcrun',
      ['simctl', 'bootstatus', udid, '-b'],
      {
        cwd: process.cwd(),
        logFile,
        echo: false,
      },
    );
    if (status.code === 0) {
      console.log(`Booted ${DEVICE_NAME} (${runtime.name}, ${udid})`);
      return udid;
    }
    console.warn(
      `${DEVICE_NAME} failed to boot on ${runtime.name}; trying an older runtime.`,
    );
    await runAllowFailure('xcrun', ['simctl', 'delete', udid], {
      cwd: process.cwd(),
      logFile,
      echo: false,
    });
  }
  check(false, `${DEVICE_NAME} failed to boot on every installed iOS runtime.`);
};

/**
 * Starts booting the simulator and downloads Explorer without waiting for the
 * boot to finish. CI runs this first, so the boot (the slowest part of the
 * iOS job) overlaps with installing Maestro and the other setup steps.
 */
export const prepareIos = async (logFile: string) => {
  step('Layer 6: start the iOS Simulator and download Lynx Explorer');
  const udid = await bootSimulator(logFile, { wait: false });
  await getExplorer('ios', logFile);
  console.log(`${DEVICE_NAME} (${udid}) is booting`);
};

/**
 * Lines in Explorer's log that mean the app's JavaScript failed. Lynx reports
 * uncaught errors and console.error through its own logger, tagged [lynx].
 */
const JS_ERROR_PATTERN =
  /\[lynx\].*\b(Uncaught|TypeError|ReferenceError|SyntaxError|RangeError|lynx_console.*error|js error)/i;

/**
 * Layer 6 on iOS: opens the app's native bundle in Lynx Explorer on the
 * simulator and runs the Maestro flows against it.
 */
export const runOnIosSimulator = async ({
  bundleUrl,
  artifactsDir,
  logFile,
  keepRunning = false,
}: {
  /** URL of main.lynx.bundle, reachable from the simulator. */
  bundleUrl: string;
  artifactsDir: string;
  logFile: string;
  keepRunning?: boolean;
}) => {
  step('Layer 6: iOS Simulator');
  const app = await getExplorer('ios', logFile);
  const udid = await bootSimulator(logFile);
  await simctl(['install', udid, app], logFile);

  // Explorer's own log, for JavaScript errors and for debugging failures.
  const explorerLog = path.join(artifactsDir, 'ios-explorer.log');
  writeFileSync(explorerLog, '');
  const logStream = start(
    'xcrun',
    [
      'simctl',
      'spawn',
      udid,
      'log',
      'stream',
      '--level',
      'debug',
      '--predicate',
      'process == "LynxExplorer"',
    ],
    { cwd: process.cwd(), logFile: explorerLog, echo: false },
  );

  const failures: string[] = [];
  try {
    for (const flow of FLOWS) {
      const result = await runFlow(flow, {
        device: udid,
        appId: EXPLORER.ios.bundleId,
        bundleUrl,
        outputDir: path.join(artifactsDir, 'ios'),
        logFile,
      });
      const failure = judgeFlow(flow, 'ios', result.code);
      if (failure) {
        failures.push(failure);
      }
    }
    await simctl(
      ['io', udid, 'screenshot', path.join(artifactsDir, 'ios-final.png')],
      logFile,
    );
  } finally {
    stop(logStream.child);
    if (!keepRunning) {
      await runAllowFailure('xcrun', ['simctl', 'shutdown', udid], {
        cwd: process.cwd(),
        logFile,
        echo: false,
      });
    }
  }

  const jsErrors = logStream
    .output()
    .split('\n')
    .filter((line) => JS_ERROR_PATTERN.test(line));
  if (jsErrors.length > 0) {
    failures.push(`Explorer logged JavaScript errors:\n${jsErrors.join('\n')}`);
  }
  return failures;
};
