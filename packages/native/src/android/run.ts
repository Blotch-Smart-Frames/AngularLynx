import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedApp } from '../options.ts';
import { NativeBuildError, capture, run } from '../process.ts';
import type { RunTarget } from '../run.ts';
import { findAndroidSdk } from './project.ts';

/**
 * The activity the shell template declares: its manifest names `.MainActivity`
 * in the `dev.angularlynx.shell` namespace, whatever the app's ID is.
 */
export const SHELL_ACTIVITY = 'dev.angularlynx.shell.MainActivity';

export type AdbDevice = {
  readonly serial: string;
  /** `device` when it's ready; also `offline`, `unauthorized`, ... */
  readonly state: string;
  /** The phone's model from `adb devices -l`, with spaces for its underscores. */
  readonly model?: string;
};

/**
 * Parses `adb devices -l`: a header, then one line per emulator or phone,
 * e.g. `1A2B3C  device usb:1-2 product:husky model:Pixel_8 ...`.
 */
export const parseAdbDevices = (output: string): AdbDevice[] =>
  output.split('\n').flatMap((line) => {
    const match = /^(\S+)\s+(\S+)(.*)$/.exec(line.trim());
    if (!match || line.startsWith('List of devices') || line.startsWith('*')) {
      return [];
    }
    const model = /\bmodel:(\S+)/.exec(match[3]!)?.[1]?.replace(/_/g, ' ');
    return [{ serial: match[1]!, state: match[2]!, ...(model && { model }) }];
  });

const isEmulator = (device: AdbDevice) => device.serial.startsWith('emulator-');

/** Where `--run` opens the app: a running device, or a virtual device to start. */
export type AndroidChoice =
  | { readonly serial: string; readonly label: string }
  | { readonly avd: string; readonly label: string };

/**
 * Chooses the device `ng build --platform android --run` opens the app on.
 *
 * With `--device`, the running emulator or phone with that adb serial, the
 * running emulator of that virtual device, or else that virtual device,
 * started. Otherwise the first running emulator or connected phone (one
 * that's still booting counts), or else the first virtual device, started.
 */
export const pickAndroidDevice = async (
  devices: readonly AdbDevice[],
  device: string | undefined,
  {
    avdName,
    listVirtualDevices,
  }: {
    /** The virtual device a running emulator runs, from its console. */
    readonly avdName: (serial: string) => Promise<string | undefined>;
    readonly listVirtualDevices: () => Promise<readonly string[]>;
  },
): Promise<AndroidChoice> => {
  const running = async (candidate: AdbDevice) => {
    if (candidate.state === 'unauthorized') {
      throw new NativeBuildError(
        `${candidate.model ?? candidate.serial} hasn't allowed USB debugging from this computer. Unlock it, accept the prompt, and build again.`,
      );
    }
    const avd = isEmulator(candidate)
      ? await avdName(candidate.serial)
      : undefined;
    return {
      serial: candidate.serial,
      label: avd
        ? `the ${avd} emulator`
        : isEmulator(candidate)
          ? `the emulator ${candidate.serial}`
          : (candidate.model ?? candidate.serial),
    };
  };
  const usable = devices.filter(
    (candidate) =>
      candidate.state === 'device' ||
      candidate.state === 'unauthorized' ||
      // An emulator that's still booting: launch() waits for it.
      (isEmulator(candidate) && candidate.state === 'offline'),
  );

  if (device) {
    const bySerial = usable.find((candidate) => candidate.serial === device);
    if (bySerial) {
      return running(bySerial);
    }
    for (const candidate of usable.filter(isEmulator)) {
      if ((await avdName(candidate.serial)) === device) {
        return running(candidate);
      }
    }
    const virtualDevices = await listVirtualDevices();
    if (virtualDevices.includes(device)) {
      return { avd: device, label: `the ${device} emulator` };
    }
    const known = [
      ...usable.map((candidate) => candidate.serial),
      ...virtualDevices,
    ];
    throw new NativeBuildError(
      `There's no running emulator, connected phone or virtual device named "${device}". ${
        known.length > 0
          ? `Pass one of these: ${known.join(', ')}.`
          : "Create a virtual device in Android Studio's Device Manager."
      }`,
    );
  }

  // A ready one before one that's booting, and before a phone that hasn't
  // allowed debugging yet, which only gets a message saying so.
  const first =
    usable.find((candidate) => candidate.state === 'device') ??
    usable.find((candidate) => candidate.state === 'offline') ??
    usable[0];
  if (first) {
    return running(first);
  }
  const [avd] = await listVirtualDevices();
  if (avd) {
    return { avd, label: `the ${avd} emulator` };
  }
  throw new NativeBuildError(
    "No emulator is running, no phone is connected, and there's no virtual device to start. Create one in Android Studio's Device Manager, or connect a phone with USB debugging turned on.",
  );
};

/** How long `--run` waits for an emulator to boot, and how often it checks. */
const TIMING = { pollMs: 1000, timeoutMs: 5 * 60_000 };

/**
 * Picks the device for `--run` and, when it's a virtual device that isn't
 * running, starts its emulator, so it boots while Gradle builds. The returned
 * target installs and opens the app once it's built.
 *
 * adb and the emulator are run from the SDK the build already found, so
 * nobody has to put the SDK's folders on their PATH.
 */
export const startAndroidDevice = async ({
  device,
  logFile,
  log,
  env = process.env,
  timing = TIMING,
}: {
  readonly device: string | undefined;
  readonly logFile: string;
  readonly log: (message: string) => void;
  readonly env?: NodeJS.ProcessEnv;
  readonly timing?: typeof TIMING;
}): Promise<RunTarget> => {
  const sdk = findAndroidSdk(env);
  if (!sdk) {
    throw new NativeBuildError(
      'The Android SDK was not found. Install Android Studio (which installs the SDK), or set ANDROID_HOME to an existing SDK.',
    );
  }
  const exe = process.platform === 'win32' ? '.exe' : '';
  const adbPath = path.join(sdk, 'platform-tools', `adb${exe}`);
  const emulatorPath = path.join(sdk, 'emulator', `emulator${exe}`);
  if (!existsSync(adbPath)) {
    throw new NativeBuildError(
      `adb isn't in ${sdk}. Install Android SDK Platform-Tools in Android Studio's SDK Manager, under SDK Tools.`,
    );
  }
  const adb = (args: readonly string[]) =>
    run(adbPath, args, { cwd: process.cwd(), logFile });
  const listDevices = async () => {
    const output = await capture(adbPath, ['devices', '-l']);
    if (output === undefined) {
      throw new NativeBuildError(
        `\`${adbPath} devices\` failed. Run it yourself to see why.`,
      );
    }
    return parseAdbDevices(output);
  };

  const before = await listDevices();
  const choice = await pickAndroidDevice(before, device, {
    avdName: async (serial) =>
      (await capture(adbPath, ['-s', serial, 'emu', 'avd', 'name']))
        ?.split('\n')[0]
        ?.trim(),
    listVirtualDevices: async () =>
      existsSync(emulatorPath)
        ? ((await capture(emulatorPath, ['-list-avds'])) ?? '')
            .split('\n')
            .map((line) => line.trim())
            // AVD names are letters, digits, dots, dashes and underscores;
            // this drops the INFO lines some emulator versions print.
            .filter((line) => /^[\w.-]+$/.test(line))
        : [],
  });

  let emulator: { readonly stopped: () => string | undefined } | undefined;
  if ('avd' in choice) {
    log(`Starting ${choice.label}`);
    emulator = startEmulator(emulatorPath, choice.avd, logFile);
  } else {
    log(`Running the app on ${choice.label}`);
  }
  const emulatorLog = emulatorLogFile(logFile);

  return {
    launch: async (binary: string, app: ResolvedApp) => {
      const serials = new Set(before.map((candidate) => candidate.serial));
      let serial = 'serial' in choice ? choice.serial : undefined;
      // An emulator shows up in `adb devices` a few seconds after it starts,
      // and answers `sys.boot_completed` once Android has started, which
      // takes from seconds (from a snapshot) to minutes (a cold boot).
      const deadline = Date.now() + timing.timeoutMs;
      for (;;) {
        const stopped = emulator?.stopped();
        if (stopped) {
          throw new NativeBuildError(
            `The emulator stopped while starting (${stopped}). Its output is in ${emulatorLog}.`,
          );
        }
        serial ??= (await listDevices()).find(
          (candidate) =>
            isEmulator(candidate) && !serials.has(candidate.serial),
        )?.serial;
        const bootCompleted =
          serial &&
          (await capture(adbPath, [
            '-s',
            serial,
            'shell',
            'getprop',
            'sys.boot_completed',
          ]));
        if (bootCompleted && bootCompleted.trim() === '1') {
          break;
        }
        if (Date.now() > deadline) {
          throw new NativeBuildError(
            `${capitalize(choice.label)} didn't finish starting within ${timing.timeoutMs / 60_000} minutes.${
              emulator ? ` The emulator's output is in ${emulatorLog}.` : ''
            }`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, timing.pollMs));
      }

      log(`Installing the app on ${choice.label}`);
      await adb(['-s', serial!, 'install', '-r', binary]).catch(
        (error: Error) => {
          throw error.message.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE')
            ? new NativeBuildError(
                `${capitalize(choice.label)} has a copy of ${app.id} signed with a different key, e.g. from before you set up signing. Uninstall it from the device, then build again.`,
              )
            : error;
        },
      );
      // By component, because neither `monkey -p` nor an `am start` by
      // package opened the shell on an API 34 emulator. The launcher
      // activity is looked up rather than assumed, for an ejected project
      // whose activity was renamed.
      const resolved = await capture(adbPath, [
        '-s',
        serial!,
        'shell',
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.LAUNCHER',
        app.id,
      ]);
      const component = resolved?.trim().split('\n').at(-1)?.trim();
      // -S stops the copy a previous `--run` left open first, as iOS's
      // --terminate-running-process does.
      const output = await adb([
        '-s',
        serial!,
        'shell',
        'am',
        'start',
        '-S',
        '-W',
        '-n',
        component?.includes('/') ? component : `${app.id}/${SHELL_ACTIVITY}`,
      ]);
      // `am start` exits with 0 even when it fails, and says why on stdout,
      // last: `Error type 3`, then `Error: Activity class ... does not exist.`
      const failure = output
        .split('\n')
        .filter((line) => line.startsWith('Error'))
        .at(-1);
      if (failure) {
        throw new NativeBuildError(
          `Couldn't open the app: ${failure.replace(/^Error:\s*/, '').trim()} The full log is ${logFile}.`,
        );
      }
      log(`Opened ${app.name} on ${choice.label}`);
    },
  };
};

const capitalize = (text: string) => text[0]!.toUpperCase() + text.slice(1);

const emulatorLogFile = (logFile: string) =>
  path.join(path.dirname(logFile), 'emulator.log');

/**
 * Starts the emulator in the background, detached, so it keeps running after
 * `ng build` exits and Ctrl+C in the terminal doesn't close it. Its output
 * goes to a log file next to the build's, read if it stops while starting.
 */
const startEmulator = (emulatorPath: string, avd: string, logFile: string) => {
  const output = openSync(emulatorLogFile(logFile), 'w');
  const child = spawn(emulatorPath, ['-avd', avd], {
    detached: true,
    stdio: ['ignore', output, output],
  });
  closeSync(output);
  let stopped: string | undefined;
  child.on('error', (error) => (stopped = error.message));
  child.on('exit', (code, signal) => (stopped = `exit code ${code ?? signal}`));
  child.unref();
  return { stopped: () => stopped };
};
