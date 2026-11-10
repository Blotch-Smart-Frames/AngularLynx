import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedApp } from '../options.ts';
import { NativeBuildError, capture, run } from '../process.ts';
import type { RunTarget } from '../run.ts';

/**
 * A device in `xcrun devicectl list devices --json-output -`, as far as it's
 * read here. Xcode 27's devicectl moved everything into `properties` and
 * marks the older `deviceProperties` and friends deprecated, so both are
 * read, the new ones first.
 */
export type DevicectlDevice = {
  /** CoreDevice's own ID for the device, not its UDID. */
  readonly identifier: string;
  readonly properties?: {
    readonly hardware?: {
      readonly udid?: string;
      readonly platform?: string;
      /** `physical` for a real device, `simulated` for a simulator. */
      readonly reality?: string;
      readonly marketingName?: string;
    };
    readonly connection?: { readonly pairingState?: string };
    readonly state?: {
      readonly name?: string;
      /** e.g. `{ "enabled": { "mode": 1 } }`. */
      readonly developerModeStatus?: unknown;
    };
  };
  readonly hardwareProperties?: {
    readonly udid?: string;
    readonly platform?: string;
    readonly reality?: string;
    readonly marketingName?: string;
  };
  readonly connectionProperties?: { readonly pairingState?: string };
  readonly deviceProperties?: {
    readonly name?: string;
    /** `enabled` or `disabled`. */
    readonly developerModeStatus?: string;
  };
};

/** A real iPhone (or iPad) devicectl knows, from {@link parseIPhones}. */
export type IPhone = {
  readonly udid: string;
  /** The name set on the phone, e.g. `Dolan’s iPhone`. */
  readonly name: string;
  readonly identifier: string;
  readonly model?: string;
  readonly paired: boolean;
  /** Undefined when devicectl doesn't say, e.g. before it's connected once. */
  readonly developerMode?: 'enabled' | 'disabled';
};

/**
 * The real iOS devices in devicectl's list. devicectl lists the simulators
 * too, which `simctl` already covers, so only physical ones are kept.
 */
export const parseIPhones = (output: string): IPhone[] => {
  const devices =
    (
      JSON.parse(output) as {
        readonly result?: { readonly devices?: readonly DevicectlDevice[] };
      }
    ).result?.devices ?? [];
  return devices.flatMap((device) => {
    const hardware = {
      ...device.hardwareProperties,
      ...device.properties?.hardware,
    };
    const name =
      device.properties?.state?.name ?? device.deviceProperties?.name;
    if (
      hardware.reality !== 'physical' ||
      hardware.platform !== 'iOS' ||
      !hardware.udid ||
      !name
    ) {
      return [];
    }
    const pairingState =
      device.properties?.connection?.pairingState ??
      device.connectionProperties?.pairingState;
    const developerMode = developerModeOf(device);
    return [
      {
        udid: hardware.udid,
        name,
        identifier: device.identifier,
        ...(hardware.marketingName && { model: hardware.marketingName }),
        paired: pairingState === 'paired',
        ...(developerMode && { developerMode }),
      },
    ];
  });
};

/**
 * `properties.state.developerModeStatus` is an enum encoded as an object
 * with one key (`{ "enabled": { "mode": 1 } }`); the deprecated field is
 * that key as a string.
 */
const developerModeOf = (device: DevicectlDevice): IPhone['developerMode'] => {
  const status = device.properties?.state?.developerModeStatus;
  const key =
    status && typeof status === 'object'
      ? Object.keys(status)[0]
      : typeof status === 'string'
        ? status
        : device.deviceProperties?.developerModeStatus;
  return key === 'enabled' || key === 'disabled' ? key : undefined;
};

/**
 * Phone names come from the phone's settings, where iOS types a curly
 * apostrophe (`Dolan’s iPhone`) that a terminal rarely does, so names are
 * compared with straight quotes and without case.
 */
const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

/**
 * The iPhone `--device` names, by its name, UDID or CoreDevice identifier,
 * or undefined when it names none (it may name a simulator). Throws when the
 * phone can't take an app yet, before minutes of building.
 */
export const pickIPhone = (
  phones: readonly IPhone[],
  device: string,
): IPhone | undefined => {
  const wanted = normalizeName(device);
  const phone = phones.find(
    (candidate) =>
      candidate.udid.toLowerCase() === wanted ||
      candidate.identifier.toLowerCase() === wanted ||
      normalizeName(candidate.name) === wanted,
  );
  if (!phone) {
    return undefined;
  }
  if (!phone.paired) {
    throw new NativeBuildError(
      `${phone.name} isn't paired with this Mac. Connect it with a USB cable, unlock it and tap Trust, then build again.`,
    );
  }
  if (phone.developerMode === 'disabled') {
    throw new NativeBuildError(developerModeMessage(phone.name));
  }
  return phone;
};

const developerModeMessage = (name: string) =>
  `Developer Mode is off on ${name}, and iOS only runs apps from Xcode with it on. On the phone, open Settings → Privacy & Security → Developer Mode, turn it on and let the phone restart, then build again. The setting shows up once the phone has been connected to this Mac.`;

/**
 * The paired iPhones, or none when devicectl isn't there (Xcode 14 and
 * earlier) or fails, so `--device` still reaches the simulators.
 */
export const listIPhones = async (): Promise<IPhone[]> => {
  const output = await capture('xcrun', [
    'devicectl',
    'list',
    'devices',
    '--quiet',
    '--json-output',
    '-',
  ]);
  if (output === undefined) {
    return [];
  }
  try {
    return parseIPhones(output);
  } catch {
    return [];
  }
};

/**
 * The target for an iPhone `--device` named. The build signs the app for it
 * (see buildIos), then this installs it and opens it with devicectl, which
 * reaches the phone by USB or, once it has been paired, over Wi-Fi.
 */
export const startIPhone = ({
  phone,
  logFile,
  log,
}: {
  readonly phone: IPhone;
  readonly logFile: string;
  readonly log: (message: string) => void;
}): RunTarget => {
  log(
    `Running the app on ${phone.name}${phone.model ? ` (${phone.model})` : ''}`,
  );
  return {
    iPhone: { udid: phone.udid, name: phone.name },
    launch: async (binary: string, app: ResolvedApp) => {
      log(`Installing the app on ${phone.name}`);
      await devicectl(
        ['device', 'install', 'app', '--device', phone.udid, binary],
        { phone, action: 'install the app', logFile },
      );
      // Replaces the copy a previous `--run` left open, which would otherwise
      // stay in front, still running the old build.
      await devicectl(
        [
          'device',
          'process',
          'launch',
          '--device',
          phone.udid,
          '--terminate-existing',
          app.id,
        ],
        { phone, action: 'open the app', logFile },
      );
      log(`Opened ${app.name} on ${phone.name}`);
    },
  };
};

/**
 * Runs a devicectl command with its result written as JSON, so a failure is
 * read from the structured error rather than its indented text, and
 * explained when it's something the developer fixes on the phone.
 */
const devicectl = async (
  args: readonly string[],
  {
    phone,
    action,
    logFile,
  }: {
    readonly phone: IPhone;
    readonly action: string;
    readonly logFile: string;
  },
) => {
  const json = path.join(path.dirname(logFile), 'devicectl.json');
  rmSync(json, { force: true });
  try {
    await run('xcrun', ['devicectl', ...args, '--json-output', json], {
      cwd: process.cwd(),
      logFile,
    });
  } catch (error) {
    const reasons = existsSync(json)
      ? devicectlErrors(readFileSync(json, 'utf8'))
      : [];
    throw reasons.length > 0
      ? new NativeBuildError(
          explainDevicectlFailure(reasons, phone.name, action, logFile),
        )
      : error;
  }
};

type DevicectlError = {
  readonly domain?: string;
  readonly code?: number;
  readonly userInfo?: Readonly<
    Record<
      string,
      { readonly string?: string; readonly error?: DevicectlError } | undefined
    >
  >;
};

/** One error in devicectl's chain of underlying errors. */
export type DevicectlReason = {
  readonly domain?: string;
  readonly code?: number;
  /** The description, failure reason and recovery suggestion, in that order. */
  readonly messages: readonly string[];
};

/**
 * Flattens the error in devicectl's JSON output: the outermost error says
 * what failed ("The developer disk image could not be mounted"), and the
 * innermost usually why ("the device was still locked").
 */
export const devicectlErrors = (json: string): DevicectlReason[] => {
  let error: DevicectlError | undefined;
  try {
    error = (JSON.parse(json) as { readonly error?: DevicectlError }).error;
  } catch {
    return [];
  }
  const reasons: DevicectlReason[] = [];
  while (error) {
    const info = error.userInfo ?? {};
    reasons.push({
      domain: error.domain,
      code: error.code,
      messages: [
        'NSLocalizedDescription',
        'NSLocalizedFailureReason',
        'NSLocalizedRecoverySuggestion',
      ].flatMap((key) => info[key]?.string ?? []),
    });
    error = info['NSUnderlyingError']?.error;
  }
  return reasons;
};

/** CoreDevice's error code for a phone that's locked. */
const DEVICE_LOCKED = 10003;

/**
 * Says what to do on the phone for the failures that need it, as the
 * Android run does for USB debugging, and passes devicectl's own words on
 * for the rest.
 */
export const explainDevicectlFailure = (
  reasons: readonly DevicectlReason[],
  name: string,
  action: string,
  logFile: string,
): string => {
  const text = reasons.flatMap((reason) => reason.messages).join(' ');
  if (
    reasons.some(
      (reason) =>
        reason.domain === 'com.apple.dt.CoreDeviceError' &&
        reason.code === DEVICE_LOCKED,
    ) ||
    /\blocked\b/i.test(text)
  ) {
    return `${name} is locked. Unlock it, keep it unlocked until the app opens, and build again.`;
  }
  if (/developer mode/i.test(text)) {
    return developerModeMessage(name);
  }
  // A free Apple ID's apps don't open until the phone trusts their developer.
  if (
    /explicitly trusted|untrusted developer|invalid code signature|inadequate entitlements/i.test(
      text,
    )
  ) {
    return `${name} doesn't trust the app's developer yet, which iOS asks once for apps signed with a free Apple ID. On the phone, open Settings → General → VPN & Device Management, tap your Apple ID under Developer App, then Trust, and build again.`;
  }
  const said = [...new Set(reasons.flatMap((reason) => reason.messages))].join(
    ' ',
  );
  return `Couldn't ${action} on ${name}. devicectl says: ${said} The full log is ${logFile}.`;
};
