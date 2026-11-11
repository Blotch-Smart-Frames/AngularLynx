import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAppOptions } from '../options.ts';
import {
  type DevicectlDevice,
  devicectlErrors,
  explainDevicectlFailure,
  parseIPhones,
  pickIPhone,
} from './iphone.ts';
import { startIosTarget } from './run.ts';

/**
 * A phone as Xcode 27's `devicectl list devices --json-output -` lists it,
 * in the `properties` dictionary that replaced the deprecated fields.
 */
const phone = (
  name: string,
  udid: string,
  {
    pairingState = 'paired',
    developerMode = { enabled: { mode: 1 } } as unknown,
  } = {},
): DevicectlDevice => ({
  identifier: `CORE-${udid}`,
  properties: {
    hardware: {
      udid,
      platform: 'iOS',
      reality: 'physical',
      marketingName: 'iPhone 14 Pro',
    },
    connection: { pairingState },
    state: { name, developerModeStatus: developerMode },
  },
});

const simulator: DevicectlDevice = {
  identifier: 'SIM-UDID',
  properties: {
    hardware: { udid: 'SIM-UDID', platform: 'iOS', reality: 'simulated' },
    state: { name: 'iPhone 18 Pro' },
  },
};

const listOutput = (devices: readonly DevicectlDevice[]) =>
  JSON.stringify({
    info: { outcome: 'success' },
    result: { devices },
  });

/** The error devicectl wrote when installing on a locked iPhone 14 Pro. */
const LOCKED = {
  info: { outcome: 'failed' },
  error: {
    code: 12040,
    domain: 'com.apple.dt.CoreDeviceError',
    userInfo: {
      NSLocalizedDescription: {
        string: 'The developer disk image could not be mounted on this device.',
      },
      NSUnderlyingError: {
        error: {
          code: 10003,
          domain: 'com.apple.dt.CoreDeviceError',
          userInfo: {
            NSLocalizedDescription: {
              string:
                'The operation failed because the device was still locked.',
            },
            NSLocalizedFailureReason: {
              string: 'The device is currently locked.',
            },
            NSLocalizedRecoverySuggestion: {
              string: 'Unlock the device and try again.',
            },
          },
        },
      },
    },
  },
};

const failure = (description: string) => ({
  error: {
    code: 1,
    domain: 'FBSOpenApplicationServiceErrorDomain',
    userInfo: { NSLocalizedDescription: { string: description } },
  },
});

describe('parseIPhones', () => {
  it('keeps the real iOS devices and reads their pairing and Developer Mode', () => {
    expect(
      parseIPhones(
        listOutput([
          simulator,
          phone('Dolan’s iPhone', '00008120-001'),
          phone('Old', '00008120-002', {
            pairingState: 'unpaired',
            developerMode: { disabled: {} },
          }),
        ]),
      ),
    ).toEqual([
      {
        udid: '00008120-001',
        name: 'Dolan’s iPhone',
        identifier: 'CORE-00008120-001',
        model: 'iPhone 14 Pro',
        paired: true,
        developerMode: 'enabled',
      },
      {
        udid: '00008120-002',
        name: 'Old',
        identifier: 'CORE-00008120-002',
        model: 'iPhone 14 Pro',
        paired: false,
        developerMode: 'disabled',
      },
    ]);
  });

  it('reads the deprecated fields devicectl wrote before properties', () => {
    expect(
      parseIPhones(
        listOutput([
          {
            identifier: 'CORE',
            hardwareProperties: {
              udid: 'UDID',
              platform: 'iOS',
              reality: 'physical',
            },
            connectionProperties: { pairingState: 'paired' },
            deviceProperties: {
              name: 'Phone',
              developerModeStatus: 'disabled',
            },
          },
          // A watch, and a phone without a name, aren't run on.
          {
            identifier: 'WATCH',
            hardwareProperties: {
              udid: 'W',
              platform: 'watchOS',
              reality: 'physical',
            },
            deviceProperties: { name: 'Watch' },
          },
          {
            identifier: 'NAMELESS',
            hardwareProperties: {
              udid: 'N',
              platform: 'iOS',
              reality: 'physical',
            },
          },
        ]),
      ),
    ).toEqual([
      {
        udid: 'UDID',
        name: 'Phone',
        identifier: 'CORE',
        paired: true,
        developerMode: 'disabled',
      },
    ]);
  });

  it('leaves Developer Mode out when devicectl does not say', () => {
    const [parsed] = parseIPhones(
      listOutput([phone('Phone', 'UDID', { developerMode: null })]),
    );
    expect(parsed).not.toHaveProperty('developerMode');
    expect(
      parseIPhones(
        listOutput([phone('Phone', 'UDID', { developerMode: 'unknown' })]),
      )[0],
    ).not.toHaveProperty('developerMode');
    expect(parseIPhones('{}')).toEqual([]);
  });
});

describe('pickIPhone', () => {
  const phones = parseIPhones(
    listOutput([
      phone('Dolan’s iPhone', '00008120-001'),
      phone('Unpaired', '00008120-002', { pairingState: 'unpaired' }),
      phone('Locked down', '00008120-003', {
        developerMode: { disabled: {} },
      }),
    ]),
  );

  it("matches the name with a straight apostrophe for iOS's curly one, the UDID or the CoreDevice ID", () => {
    expect(pickIPhone(phones, "dolan's iphone")?.udid).toBe('00008120-001');
    expect(pickIPhone(phones, '00008120-001')?.udid).toBe('00008120-001');
    expect(pickIPhone(phones, 'core-00008120-001')?.udid).toBe('00008120-001');
    expect(pickIPhone(phones, 'iPhone 18 Pro')).toBeUndefined();
  });

  it('explains a phone that is not paired, or has Developer Mode off', () => {
    expect(() => pickIPhone(phones, 'Unpaired')).toThrow(
      "Unpaired isn't paired with this Mac. Connect it with a USB cable, unlock it and tap Trust, then build again.",
    );
    expect(() => pickIPhone(phones, 'Locked down')).toThrow(
      /^Developer Mode is off on Locked down[\s\S]*Settings → Privacy & Security → Developer Mode/,
    );
  });
});

describe('explainDevicectlFailure', () => {
  const explain = (json: unknown) =>
    explainDevicectlFailure(
      devicectlErrors(JSON.stringify(json)),
      'Phone',
      'open the app',
      '/ios.log',
    );

  it('flattens the chain of underlying errors', () => {
    expect(devicectlErrors(JSON.stringify(LOCKED))).toEqual([
      {
        domain: 'com.apple.dt.CoreDeviceError',
        code: 12040,
        messages: [
          'The developer disk image could not be mounted on this device.',
        ],
      },
      {
        domain: 'com.apple.dt.CoreDeviceError',
        code: 10003,
        messages: [
          'The operation failed because the device was still locked.',
          'The device is currently locked.',
          'Unlock the device and try again.',
        ],
      },
    ]);
    expect(devicectlErrors('not json')).toEqual([]);
    expect(devicectlErrors('{}')).toEqual([]);
    expect(devicectlErrors('{"error":{}}')).toEqual([
      { domain: undefined, code: undefined, messages: [] },
    ]);
  });

  it('says to unlock a locked phone, by code or by words', () => {
    const locked =
      'Phone is locked. Unlock it, keep it unlocked until the app opens, and build again.';
    expect(explain(LOCKED)).toBe(locked);
    expect(
      explain(
        failure('The request to open "com.example.myapp" failed. (Locked)'),
      ),
    ).toBe(locked);
  });

  it('says how to turn on Developer Mode, and to trust a free Apple ID', () => {
    expect(explain(failure('Developer Mode is disabled.'))).toMatch(
      /^Developer Mode is off on Phone/,
    );
    expect(
      explain(
        failure(
          'Unable to launch com.example.myapp because it has an invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user.',
        ),
      ),
    ).toMatch(
      /^Phone doesn't trust the app's developer yet[\s\S]*VPN & Device Management/,
    );
  });

  it("passes devicectl's own words on for anything else", () => {
    expect(explain(failure('The device is unavailable.'))).toBe(
      "Couldn't open the app on Phone. devicectl says: The device is unavailable. The full log is /ios.log.",
    );
  });
});

describe('startIosTarget', () => {
  let dir: string;
  let calls: string;
  let logFile: string;
  let originalPath: string | undefined;
  const app = resolveAppOptions(
    { appName: 'My App', appId: 'com.example.myapp' },
    { projectName: 'my-app' },
  );

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-iphone-'));
    calls = path.join(dir, 'calls.log');
    logFile = path.join(dir, 'logs/ios.log');
    originalPath = process.env['PATH'];
  });
  afterEach(() => {
    process.env['PATH'] = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A fake xcrun that records its arguments. `devicectl list` prints
   * `devicectl.json`, or fails when it's missing, as on Xcode 14. A
   * devicectl install or launch fails with `<install|launch>-error.json`
   * written to its --json-output path, the last argument, when that exists.
   * `simctl list` prints one simulator.
   */
  const setup = (devices: readonly DevicectlDevice[] | undefined) => {
    if (devices) {
      writeFileSync(path.join(dir, 'devicectl.json'), listOutput(devices));
    }
    writeFileSync(
      path.join(dir, 'simctl.json'),
      JSON.stringify({
        runtimes: [
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
            name: 'iOS 27.0',
            version: '27.0',
            platform: 'iOS',
            isAvailable: true,
          },
        ],
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
            {
              name: 'iPhone 18 Pro',
              udid: 'SIM-UDID',
              state: 'Booted',
              isAvailable: true,
              deviceTypeIdentifier: 'iPhone-18-Pro',
            },
          ],
        },
      }),
    );
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const xcrun = path.join(bin, 'xcrun');
    writeFileSync(
      xcrun,
      `#!/bin/sh
echo "xcrun $*" >> "${calls}"
for arg; do last="$arg"; done
case "$1 $2" in
  "devicectl list") cat "${dir}/devicectl.json" || exit 1 ;;
  "devicectl device")
    step=launch; [ "$3" = install ] && step=install
    if [ -e "${dir}/$step-error.json" ]; then
      cp "${dir}/$step-error.json" "$last"
      echo "ERROR: it failed" >&2
      exit 1
    fi ;;
  "simctl list") cat "${dir}/simctl.json" ;;
esac
exit 0
`,
    );
    chmodSync(xcrun, 0o755);
    process.env['PATH'] = `${bin}:${originalPath}`;
  };

  const recorded = () => readFileSync(calls, 'utf8').trim().split('\n');

  it('installs and opens the app on the iPhone --device names', async () => {
    setup([phone('Dolan’s iPhone', '00008120-001')]);
    const messages: string[] = [];
    const target = await startIosTarget({
      device: "Dolan's iPhone",
      logFile,
      log: (message) => messages.push(message),
    });
    expect(target.iPhone).toEqual({
      udid: '00008120-001',
      name: 'Dolan’s iPhone',
    });
    await target.launch('/dist/ios/MyApp-device.app', app);
    const json = path.join(dir, 'logs/devicectl.json');
    expect(recorded()).toEqual([
      'xcrun devicectl list devices --quiet --json-output -',
      `xcrun devicectl device install app --device 00008120-001 /dist/ios/MyApp-device.app --json-output ${json}`,
      `xcrun devicectl device process launch --device 00008120-001 --terminate-existing com.example.myapp --json-output ${json}`,
    ]);
    expect(messages).toEqual([
      'Running the app on Dolan’s iPhone (iPhone 14 Pro)',
      'Installing the app on Dolan’s iPhone',
      'Opened My App on Dolan’s iPhone',
    ]);
  });

  it('opens the development app on the iPhone with the dev server as an argument', async () => {
    setup([phone('Phone', 'UDID')]);
    const target = await startIosTarget({
      device: 'Phone',
      logFile,
      log: () => {},
    });
    await target.launch('/serve/ios/MyApp-device.app', app, {
      bundleUrl: 'http://192.168.1.20:3000/main.lynx.bundle',
    });
    expect(recorded().at(-1)).toBe(
      `xcrun devicectl device process launch --device UDID --terminate-existing com.example.myapp -AngularLynxDevServer http://192.168.1.20:3000/main.lynx.bundle --json-output ${path.join(dir, 'logs/devicectl.json')}`,
    );
  });

  it('explains why devicectl could not install or open the app', async () => {
    setup([phone('Phone', 'UDID')]);
    writeFileSync(path.join(dir, 'install-error.json'), JSON.stringify(LOCKED));
    const target = await startIosTarget({
      device: 'Phone',
      logFile,
      log: () => {},
    });
    await expect(target.launch('/MyApp.app', app)).rejects.toThrow(
      'Phone is locked. Unlock it, keep it unlocked until the app opens, and build again.',
    );

    rmSync(path.join(dir, 'install-error.json'));
    writeFileSync(
      path.join(dir, 'launch-error.json'),
      JSON.stringify(failure('No such app.')),
    );
    await expect(target.launch('/MyApp.app', app)).rejects.toThrow(
      /^Couldn't open the app on Phone\. devicectl says: No such app\./,
    );

    // Without a JSON error, devicectl's output is all there is.
    writeFileSync(path.join(dir, 'launch-error.json'), '{}');
    await expect(target.launch('/MyApp.app', app)).rejects.toThrow(
      /^xcrun devicectl failed \(exit code 1\)[\s\S]*ERROR: it failed/,
    );
  });

  it('uses a simulator without --device, or when --device names one', async () => {
    setup([phone('Phone', 'UDID')]);
    const target = await startIosTarget({
      device: undefined,
      logFile,
      log: () => {},
    });
    expect(target.iPhone).toBeUndefined();
    await target.launch('/MyApp-simulator.app', app);
    // Without --device, devicectl isn't asked: a phone left plugged in
    // doesn't change where --run opens the app.
    expect(recorded().filter((call) => call.includes('devicectl'))).toEqual([]);

    const named = await startIosTarget({
      device: 'iPhone 18 Pro',
      logFile,
      log: () => {},
    });
    expect(named.iPhone).toBeUndefined();
    await named.launch('/MyApp-simulator.app', app);
  });

  it('lists the paired iPhones too when --device names nothing', async () => {
    setup([phone('Phone', 'UDID')]);
    await expect(
      startIosTarget({ device: 'Nope', logFile, log: () => {} }),
    ).rejects.toThrow(
      `There's no iOS simulator or paired iPhone named "Nope". Pass the name or UDID of one of these simulators: iPhone 18 Pro; or of one of these iPhones: Phone.`,
    );
  });

  it('still reaches the simulators where devicectl is missing or prints something else', async () => {
    const run = async () => {
      const target = await startIosTarget({
        device: 'iPhone 18 Pro',
        logFile,
        log: () => {},
      });
      expect(target.iPhone).toBeUndefined();
      // Lets the simulator's boot check finish before the folder goes.
      await target.launch('/MyApp-simulator.app', app);
    };
    setup(undefined);
    await run();
    writeFileSync(path.join(dir, 'devicectl.json'), 'not json');
    await run();
  });
});
