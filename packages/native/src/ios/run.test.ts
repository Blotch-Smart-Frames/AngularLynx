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
import { type SimctlList, pickSimulator, startIosSimulator } from './run.ts';

const IPHONE_18_PRO = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
const IPHONE_17 = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17';
const IPAD = 'com.apple.CoreSimulator.SimDeviceType.iPad-Air';

const runtime = (version: string, iPhones = [IPHONE_18_PRO, IPHONE_17]) => ({
  identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace('.', '-')}`,
  name: `iOS ${version}`,
  version,
  platform: 'iOS',
  isAvailable: true,
  supportedDeviceTypes: [
    ...iPhones.map((identifier) => ({
      identifier,
      name: identifier.split('.').at(-1)!.replace(/-/g, ' '),
      productFamily: 'iPhone',
    })),
    { identifier: IPAD, name: 'iPad Air', productFamily: 'iPad' },
  ],
});

const simulator = (
  name: string,
  deviceTypeIdentifier: string,
  options: { state?: string; lastUsedAt?: string; isAvailable?: boolean } = {},
) => ({
  name,
  udid: `UDID-${name}`,
  state: 'Shutdown',
  isAvailable: true,
  deviceTypeIdentifier,
  ...options,
});

const ios26 = runtime('26.4');
const ios27 = runtime('27.0');

/**
 * A `simctl list` of iOS 26.4 and 27.0, listed oldest first as simctl does.
 */
const list = (
  devices: Record<string, ReturnType<typeof simulator>[]>,
  runtimes: SimctlList['runtimes'] = [ios26, ios27],
): SimctlList => ({
  runtimes,
  devices: Object.fromEntries(
    Object.entries(devices).map(([version, entries]) => [
      runtime(version).identifier,
      entries,
    ]),
  ),
});

describe('pickSimulator', () => {
  it('uses a simulator that is already started, the most recently used one first', () => {
    const picked = pickSimulator(
      list({
        '26.4': [
          simulator('Old', IPHONE_17, {
            state: 'Booted',
            lastUsedAt: '2026-10-29T10:00:00Z',
          }),
        ],
        '27.0': [
          simulator('iPhone 18 Pro', IPHONE_18_PRO),
          simulator('iPad Air', IPAD, {
            state: 'Booted',
            lastUsedAt: '2026-10-29T11:00:00Z',
          }),
        ],
      }),
      undefined,
    );
    expect(picked).toMatchObject({
      udid: 'UDID-iPad Air',
      booted: true,
      runtime: ios27,
    });
  });

  it("otherwise starts the newest iPhone on the newest runtime, Xcode's own simulator of it first", () => {
    const picked = pickSimulator(
      list({
        '26.4': [simulator('iPhone 18 Pro', IPHONE_18_PRO)],
        '27.0': [
          simulator('iPad Air', IPAD),
          simulator('iPhone 17', IPHONE_17),
          simulator('My tests', IPHONE_18_PRO),
          simulator('iPhone 18 Pro', IPHONE_18_PRO),
        ],
      }),
      undefined,
    );
    expect(picked).toMatchObject({
      udid: 'UDID-iPhone 18 Pro',
      booted: false,
      runtime: ios27,
    });
  });

  it('takes any simulator of the newest iPhone, then older iPhones, then older runtimes', () => {
    expect(
      pickSimulator(
        list({ '27.0': [simulator('My tests', IPHONE_18_PRO)] }),
        undefined,
      ).udid,
    ).toBe('UDID-My tests');
    expect(
      pickSimulator(
        list({ '27.0': [simulator('iPhone 17', IPHONE_17)] }),
        undefined,
      ).udid,
    ).toBe('UDID-iPhone 17');
    expect(
      pickSimulator(
        list({
          '26.4': [simulator('iPhone 17', IPHONE_17)],
          '27.0': [simulator('iPad Air', IPAD)],
        }),
        undefined,
      ),
    ).toMatchObject({ udid: 'UDID-iPhone 17', runtime: ios26 });
  });

  it('creates the newest iPhone when there is no iPhone simulator', () => {
    expect(
      pickSimulator(list({ '27.0': [simulator('iPad Air', IPAD)] }), undefined),
    ).toEqual({
      name: 'iPhone 18 Pro',
      deviceTypeIdentifier: IPHONE_18_PRO,
      runtime: ios27,
      booted: false,
    });
  });

  it('skips simulators and runtimes that are unavailable, and runtimes for other platforms', () => {
    const watchOS = {
      ...runtime('12.0'),
      identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-12-0',
      platform: 'watchOS',
    };
    const picked = pickSimulator(
      {
        runtimes: [ios26, { ...runtime('27.0'), isAvailable: false }, watchOS],
        devices: {
          [ios26.identifier]: [
            simulator('Broken', IPHONE_18_PRO, { isAvailable: false }),
            simulator('iPhone 17', IPHONE_17),
          ],
          [ios27.identifier]: [simulator('iPhone 18 Pro', IPHONE_18_PRO)],
          [watchOS.identifier]: [
            simulator('Watch', IPHONE_18_PRO, { state: 'Booted' }),
          ],
        },
      },
      undefined,
    );
    expect(picked.udid).toBe('UDID-iPhone 17');
  });

  it('reads the platform from the identifier when simctl leaves it out', () => {
    const { platform: _, ...older } = ios27;
    expect(
      pickSimulator(
        {
          runtimes: [older],
          devices: { [ios27.identifier]: [simulator('iPhone 17', IPHONE_17)] },
        },
        undefined,
      ).udid,
    ).toBe('UDID-iPhone 17');
  });

  it('explains a Mac without an iOS runtime, or without an iPhone in any', () => {
    expect(() => pickSimulator(list({}, []), undefined)).toThrow(
      /No iOS Simulator runtime is installed\. Install one with `xcodebuild -downloadPlatform iOS`/,
    );
    const iPadOnly = { ...ios27, supportedDeviceTypes: undefined };
    expect(() => pickSimulator(list({}, [iPadOnly]), undefined)).toThrow(
      'No installed iOS runtime runs an iPhone simulator (iOS 27.0).',
    );
  });

  describe('--device', () => {
    const devices = list({
      '26.4': [
        simulator('iPhone 17', IPHONE_17),
        simulator('iPhone 18 Pro', IPHONE_18_PRO, { state: 'Booted' }),
      ],
      '27.0': [
        simulator('iPhone 17', IPHONE_17),
        simulator('iPhone 18 Pro', IPHONE_18_PRO),
      ],
    });

    it('picks the simulator of that name on the newest runtime, unless an older one is started', () => {
      expect(pickSimulator(devices, 'iphone 17')).toMatchObject({
        udid: 'UDID-iPhone 17',
        runtime: ios27,
      });
      expect(pickSimulator(devices, 'iPhone 18 Pro')).toMatchObject({
        runtime: ios26,
        booted: true,
      });
    });

    it('picks the simulator with that UDID', () => {
      expect(pickSimulator(devices, 'udid-iphone 17').name).toBe('iPhone 17');
    });

    it('lists the simulators there are when none matches', () => {
      expect(() => pickSimulator(devices, 'iPhone 99')).toThrow(
        `There's no iOS simulator named "iPhone 99". Pass the name or UDID of one of these: iPhone 17, iPhone 18 Pro. Or create one in Xcode's DeviceHub.`,
      );
    });
  });
});

describe('startIosSimulator', () => {
  let dir: string;
  let calls: string;
  let logFile: string;
  let originalPath: string | undefined;
  const app = resolveAppOptions(
    { appName: 'My App', appId: 'com.example.myapp' },
    { projectName: 'my-app' },
  );

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-ios-run-'));
    calls = path.join(dir, 'calls.log');
    logFile = path.join(dir, 'logs/ios.log');
    originalPath = process.env['PATH'];
  });
  afterEach(() => {
    process.env['PATH'] = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  const script = (name: string, body: string) => {
    const file = path.join(dir, 'bin', name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  };

  /**
   * Fake xcrun, xcode-select and open that record their arguments. xcrun
   * prints `simctl.json` for `simctl list` and a new UDID for `simctl
   * create`; `bootstatus` fails when `boot-fails` exists.
   */
  const setup = (
    simctl: SimctlList,
    xcode: 'device-hub' | 'simulator' | 'none' = 'device-hub',
  ) => {
    writeFileSync(path.join(dir, 'simctl.json'), JSON.stringify(simctl));
    script(
      'xcrun',
      `echo "xcrun $*" >> "${calls}"
case "$2" in
  list) cat "${dir}/simctl.json" ;;
  create) echo "NEW-UDID" ;;
  bootstatus) [ -e "${dir}/boot-fails" ] && { echo "Unable to boot" >&2; exit 149; } ;;
esac
exit 0`,
    );
    const developerDir = path.join(dir, 'Xcode.app/Contents/Developer');
    script('xcode-select', `echo "${developerDir}"`);
    script('open', `echo "open $*" >> "${calls}"`);
    if (xcode === 'device-hub') {
      mkdirSync(
        path.join(dir, 'Xcode.app/Contents/Applications/DeviceHub.app'),
        {
          recursive: true,
        },
      );
    } else if (xcode === 'simulator') {
      mkdirSync(path.join(developerDir, 'Applications/Simulator.app'), {
        recursive: true,
      });
    }
    process.env['PATH'] = `${path.join(dir, 'bin')}:${originalPath}`;
    return { developerDir };
  };

  const recorded = () => readFileSync(calls, 'utf8').trim().split('\n');

  it('boots the simulator during the build, then shows it in DeviceHub, installs the app and opens it', async () => {
    setup(list({ '27.0': [simulator('iPhone 18 Pro', IPHONE_18_PRO)] }));
    const messages: string[] = [];
    const target = await startIosSimulator({
      device: undefined,
      logFile,
      log: (message) => messages.push(message),
    });
    expect(messages).toEqual([
      'Starting the iPhone 18 Pro (iOS 27.0) simulator',
    ]);

    await target.launch('/dist/ios/MyApp-simulator.app', app);
    expect(recorded()).toEqual([
      'xcrun simctl list --json devices runtimes',
      'xcrun simctl bootstatus UDID-iPhone 18 Pro -b',
      `open -a ${path.join(dir, 'Xcode.app/Contents/Applications/DeviceHub.app')} devices://device/open?id=UDID-iPhone 18 Pro`,
      'xcrun simctl install UDID-iPhone 18 Pro /dist/ios/MyApp-simulator.app',
      'xcrun simctl launch --terminate-running-process UDID-iPhone 18 Pro com.example.myapp',
    ]);
    expect(messages).toEqual([
      'Starting the iPhone 18 Pro (iOS 27.0) simulator',
      'Installing the app on iPhone 18 Pro',
      'Opened My App on iPhone 18 Pro',
    ]);
    // simctl's output goes to the build log, as xcodebuild's does.
    expect(readFileSync(logFile, 'utf8')).toContain(
      '$ xcrun simctl install UDID-iPhone 18 Pro',
    );
  });

  it('says when it uses a simulator that is already running', async () => {
    setup(
      list({
        '27.0': [simulator('iPhone 17', IPHONE_17, { state: 'Booted' })],
      }),
    );
    const messages: string[] = [];
    const target = await startIosSimulator({
      device: undefined,
      logFile,
      log: (message) => messages.push(message),
    });
    expect(messages).toEqual([
      'Running the app on the iPhone 17 (iOS 27.0) simulator',
    ]);
    await target.launch('/MyApp.app', app);
  });

  it('creates the simulator when there is none to start', async () => {
    setup(list({ '27.0': [] }));
    const target = await startIosSimulator({
      device: undefined,
      logFile,
      log: () => {},
    });
    await target.launch('/MyApp.app', app);
    expect(recorded()).toContain(
      `xcrun simctl create iPhone 18 Pro ${IPHONE_18_PRO} ${ios27.identifier}`,
    );
    expect(recorded()).toContain('xcrun simctl bootstatus NEW-UDID -b');
  });

  it('opens the Simulator app on Xcode versions that have it', async () => {
    const { developerDir } = setup(
      list({ '27.0': [simulator('iPhone 17', IPHONE_17)] }),
      'simulator',
    );
    const target = await startIosSimulator({
      device: 'iPhone 17',
      logFile,
      log: () => {},
    });
    await target.launch('/MyApp.app', app);
    expect(recorded()).toContain(
      `open -a ${path.join(developerDir, 'Applications/Simulator.app')} --args -CurrentDeviceUDID UDID-iPhone 17`,
    );
  });

  it('still opens the app when no window app is found, or opening it fails', async () => {
    setup(list({ '27.0': [simulator('iPhone 17', IPHONE_17)] }), 'none');
    let messages: string[] = [];
    const log = (message: string) => messages.push(message);
    await (
      await startIosSimulator({ device: undefined, logFile, log })
    ).launch('/MyApp.app', app);
    expect(messages).toContain(
      "Couldn't find Xcode's DeviceHub or Simulator app to show the simulator. The app runs on it anyway.",
    );
    expect(recorded().at(-1)).toContain('simctl launch');

    messages = [];
    setup(list({ '27.0': [simulator('iPhone 17', IPHONE_17)] }));
    script('open', 'echo "LSOpenURLsWithRole() failed" >&2; exit 1');
    await (
      await startIosSimulator({ device: undefined, logFile, log })
    ).launch('/MyApp.app', app);
    expect(messages).toContainEqual(
      expect.stringMatching(
        /^Couldn't show the simulator's window: open -a failed \(exit code 1\)/,
      ),
    );
    expect(messages.at(-1)).toBe('Opened My App on iPhone 17');
  });

  it('reports a failed boot when the app is ready to install, not while xcodebuild runs', async () => {
    setup(list({ '27.0': [simulator('iPhone 17', IPHONE_17)] }));
    writeFileSync(path.join(dir, 'boot-fails'), '');
    const target = await startIosSimulator({
      device: undefined,
      logFile,
      log: () => {},
    });
    // Long enough for bootstatus to fail; an unhandled rejection would fail
    // the test run.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(target.launch('/MyApp.app', app)).rejects.toThrow(
      /xcrun simctl failed \(exit code 149\)[\s\S]*Unable to boot/,
    );
  });

  it('explains a Mac where simctl does not work', async () => {
    setup(list({}));
    script('xcrun', 'exit 72');
    await expect(
      startIosSimulator({ device: undefined, logFile, log: () => {} }),
    ).rejects.toThrow(/Couldn't list the iOS simulators with `xcrun simctl`/);
  });
});
