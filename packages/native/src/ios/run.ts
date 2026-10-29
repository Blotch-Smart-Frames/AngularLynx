import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedApp } from '../options.ts';
import { NativeBuildError, capture, run } from '../process.ts';
import type { RunTarget } from '../run.ts';

/** What `xcrun simctl list --json devices runtimes` prints, as far as it's read here. */
export type SimctlList = {
  readonly devices: Readonly<Record<string, readonly SimctlDevice[]>>;
  readonly runtimes: readonly SimctlRuntime[];
};

type SimctlDevice = {
  readonly name: string;
  readonly udid: string;
  /** `Shutdown`, `Booting`, `Booted` or `Shutting Down`. */
  readonly state: string;
  readonly isAvailable: boolean;
  readonly deviceTypeIdentifier: string;
  readonly lastUsedAt?: string;
};

type SimctlRuntime = {
  readonly identifier: string;
  /** e.g. `iOS 27.0`. */
  readonly name: string;
  readonly version: string;
  readonly platform?: string;
  readonly isAvailable: boolean;
  /** Newest first. */
  readonly supportedDeviceTypes?: readonly {
    readonly identifier: string;
    readonly name: string;
    readonly productFamily?: string;
  }[];
};

/** The simulator to run on: an existing one, or one to create. */
export type Simulator = {
  /** Undefined when the simulator has to be created first. */
  readonly udid?: string;
  readonly name: string;
  readonly deviceTypeIdentifier: string;
  readonly runtime: SimctlRuntime;
  readonly booted: boolean;
  readonly lastUsedAt?: string;
};

/**
 * Chooses the simulator `ng build --platform ios --run` opens the app on.
 *
 * With `--device`, the simulator of that name or UDID. Otherwise one that's
 * already started, so the app opens where the developer is looking, and the
 * most recently used one if several are. Otherwise the newest iPhone on the
 * newest iOS runtime, preferring a simulator that exists (Xcode creates one
 * of each iPhone) over creating one.
 */
export const pickSimulator = (
  list: SimctlList,
  device: string | undefined,
): Simulator => {
  const runtimes = list.runtimes
    .filter(
      (runtime) =>
        runtime.isAvailable &&
        (runtime.platform
          ? runtime.platform === 'iOS'
          : runtime.identifier.includes('.iOS-')),
    )
    .sort((a, b) => compareVersions(b.version, a.version));
  if (runtimes.length === 0) {
    throw new NativeBuildError(
      "No iOS Simulator runtime is installed. Install one with `xcodebuild -downloadPlatform iOS`, or in Xcode's settings under Components.",
    );
  }
  // Newest runtime first, as `runtimes` is.
  const simulators: Simulator[] = runtimes.flatMap((runtime) =>
    (list.devices[runtime.identifier] ?? [])
      .filter((candidate) => candidate.isAvailable)
      .map((candidate) => ({
        udid: candidate.udid,
        name: candidate.name,
        deviceTypeIdentifier: candidate.deviceTypeIdentifier,
        runtime,
        // `bootstatus` waits for one that's still booting.
        booted: candidate.state === 'Booted' || candidate.state === 'Booting',
        lastUsedAt: candidate.lastUsedAt,
      })),
  );

  if (device) {
    const wanted = device.toLowerCase();
    const matches = simulators.filter(
      (simulator) =>
        simulator.udid!.toLowerCase() === wanted ||
        simulator.name.toLowerCase() === wanted,
    );
    const match = matches.find((simulator) => simulator.booted) ?? matches[0];
    if (!match) {
      const names = [...new Set(simulators.map((simulator) => simulator.name))];
      throw new NativeBuildError(
        `There's no iOS simulator named "${device}". Pass the name or UDID of one of these: ${names.join(', ')}. Or create one in Xcode's DeviceHub.`,
      );
    }
    return match;
  }

  const booted = simulators
    .filter((simulator) => simulator.booted)
    .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
  if (booted[0]) {
    return booted[0];
  }

  for (const runtime of runtimes) {
    for (const type of iPhonesOf(runtime)) {
      const ofType = simulators.filter(
        (simulator) =>
          simulator.runtime === runtime &&
          simulator.deviceTypeIdentifier === type.identifier,
      );
      const existing =
        ofType.find((simulator) => simulator.name === type.name) ?? ofType[0];
      if (existing) {
        return existing;
      }
    }
  }
  for (const runtime of runtimes) {
    const [newest] = iPhonesOf(runtime);
    if (newest) {
      return {
        name: newest.name,
        deviceTypeIdentifier: newest.identifier,
        runtime,
        booted: false,
      };
    }
  }
  throw new NativeBuildError(
    `No installed iOS runtime runs an iPhone simulator (${runtimes.map((runtime) => runtime.name).join(', ')}).`,
  );
};

const iPhonesOf = (runtime: SimctlRuntime) =>
  runtime.supportedDeviceTypes?.filter(
    (type) => type.productFamily === 'iPhone',
  ) ?? [];

/**
 * Orders runtime versions number by number: `27.0` > `26.4` > `26.0.1`.
 */
const compareVersions = (a: string, b: string) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
};

/**
 * Picks the simulator for `--run` and starts booting it, so it boots while
 * xcodebuild compiles. The returned target installs and opens the app once
 * it's built.
 */
export const startIosSimulator = async ({
  device,
  logFile,
  log,
}: {
  readonly device: string | undefined;
  readonly logFile: string;
  readonly log: (message: string) => void;
}): Promise<RunTarget> => {
  const output = await capture('xcrun', [
    'simctl',
    'list',
    '--json',
    'devices',
    'runtimes',
  ]);
  if (output === undefined) {
    throw new NativeBuildError(
      "Couldn't list the iOS simulators with `xcrun simctl`. Install Xcode and open it once, so it installs its command-line tools and the iOS platform.",
    );
  }
  const simulator = pickSimulator(JSON.parse(output) as SimctlList, device);
  const xcrun = (args: readonly string[]) =>
    run('xcrun', args, { cwd: process.cwd(), logFile });

  const label = `${simulator.name} (${simulator.runtime.name})`;
  log(
    simulator.booted
      ? `Running the app on the ${label} simulator`
      : `Starting the ${label} simulator`,
  );
  const udid =
    simulator.udid ??
    (
      await xcrun([
        'simctl',
        'create',
        simulator.name,
        simulator.deviceTypeIdentifier,
        simulator.runtime.identifier,
      ])
    ).trim();
  // Boots the simulator if it isn't, and waits until it is. Awaited only
  // after the build; the empty catch keeps a failed boot from being an
  // unhandled rejection while xcodebuild runs, and the await still throws it.
  const booted = xcrun(['simctl', 'bootstatus', udid, '-b']);
  booted.catch(() => {});

  return {
    launch: async (binary: string, app: ResolvedApp) => {
      await booted;
      await showSimulator(udid, logFile, log);
      log(`Installing the app on ${simulator.name}`);
      await xcrun(['simctl', 'install', udid, binary]);
      // Replaces the copy a previous `--run` left open, which would otherwise
      // stay in front, still running the old build.
      await xcrun([
        'simctl',
        'launch',
        '--terminate-running-process',
        udid,
        app.id,
      ]);
      log(`Opened ${app.name} on ${simulator.name}`);
    },
  };
};

/**
 * Shows the simulator's screen. `simctl` boots a simulator without a
 * window, and where the window comes from depends on Xcode's version:
 *
 * - Xcode 27.1 and later have no Simulator app. Its replacement, DeviceHub,
 *   opens to a list of devices and doesn't show a simulator because it
 *   booted, but its `devices://device/open?id=<UDID>` URL opens that
 *   simulator in a window of its own, launching DeviceHub if it isn't
 *   running. With its "Stop simulators on quit" setting on, quitting
 *   DeviceHub shuts this simulator down too, though `simctl` booted it; the
 *   next `--run` boots it again.
 * - Earlier versions show every booted simulator in the Simulator app.
 *   `-CurrentDeviceUDID` picks the one it shows first when it isn't open yet.
 *
 * Both are looked up in the Xcode that `xcode-select` (or DEVELOPER_DIR)
 * selects, the one that built the app. The app runs whether the window opens
 * or not, so a failure here is only reported.
 */
const showSimulator = async (
  udid: string,
  logFile: string,
  log: (message: string) => void,
) => {
  const developerDir = (await capture('xcode-select', ['-p']))?.trim() ?? '';
  const deviceHub = path.join(developerDir, '../Applications/DeviceHub.app');
  const simulatorApp = path.join(developerDir, 'Applications/Simulator.app');
  const args =
    developerDir && existsSync(deviceHub)
      ? ['-a', deviceHub, `devices://device/open?id=${udid}`]
      : developerDir && existsSync(simulatorApp)
        ? ['-a', simulatorApp, '--args', '-CurrentDeviceUDID', udid]
        : undefined;
  if (!args) {
    log(
      "Couldn't find Xcode's DeviceHub or Simulator app to show the simulator. The app runs on it anyway.",
    );
    return;
  }
  await run('open', args, { cwd: process.cwd(), logFile }).catch(
    (error: Error) =>
      log(`Couldn't show the simulator's window: ${error.message}`),
  );
};
