import {
  chmodSync,
  existsSync,
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
  type AdbDevice,
  SHELL_ACTIVITY,
  parseAdbDevices,
  pickAndroidDevice,
  startAndroidDevice,
} from './run.ts';

describe('parseAdbDevices', () => {
  it('reads each device, its state and its model', () => {
    expect(
      parseAdbDevices(
        [
          '* daemon not running; starting now at tcp:5037',
          '* daemon started successfully',
          'List of devices attached',
          'emulator-5554          device product:sdk_arm64 model:Android_SDK_built_for_arm64 device:emu64a transport_id:1',
          'R58M123\tunauthorized usb:1-1 transport_id:2',
          '1A2B3C        device usb:1-2 product:husky model:Pixel_8_Pro device:husky transport_id:3\r',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      {
        serial: 'emulator-5554',
        state: 'device',
        model: 'Android SDK built for arm64',
      },
      { serial: 'R58M123', state: 'unauthorized' },
      { serial: '1A2B3C', state: 'device', model: 'Pixel 8 Pro' },
    ]);
  });
});

describe('pickAndroidDevice', () => {
  const emulator = (serial: string, state = 'device'): AdbDevice => ({
    serial,
    state,
  });
  const phone: AdbDevice = {
    serial: '1A2B3C',
    state: 'device',
    model: 'Pixel 8 Pro',
  };
  const avdNames: Record<string, string> = {
    'emulator-5554': 'Pixel_API_34',
    'emulator-5556': 'Tablet_API_35',
  };
  const pick = (
    devices: AdbDevice[],
    device?: string,
    virtualDevices = ['Pixel_API_34', 'Tablet_API_35', 'Small_API_24'],
  ) =>
    pickAndroidDevice(devices, device, {
      avdName: async (serial) => avdNames[serial],
      listVirtualDevices: async () => virtualDevices,
    });

  it('uses a running emulator or phone, a ready one before one that is booting', async () => {
    expect(await pick([emulator('emulator-5554'), phone])).toEqual({
      serial: 'emulator-5554',
      label: 'the Pixel_API_34 emulator',
    });
    expect(await pick([emulator('emulator-5554', 'offline'), phone])).toEqual({
      serial: '1A2B3C',
      label: 'Pixel 8 Pro',
    });
    expect(await pick([emulator('emulator-5554', 'offline')])).toEqual({
      serial: 'emulator-5554',
      label: 'the Pixel_API_34 emulator',
    });
  });

  it('labels a device by its serial when there is nothing better', async () => {
    expect(await pick([{ serial: 'ZX1', state: 'device' }])).toEqual({
      serial: 'ZX1',
      label: 'ZX1',
    });
    expect(await pick([{ serial: 'emulator-5560', state: 'device' }])).toEqual({
      serial: 'emulator-5560',
      label: 'the emulator emulator-5560',
    });
  });

  it('otherwise starts the first virtual device', async () => {
    expect(await pick([emulator('ZX1', 'offline')])).toEqual({
      avd: 'Pixel_API_34',
      label: 'the Pixel_API_34 emulator',
    });
  });

  it('explains a phone that has not allowed USB debugging', async () => {
    await expect(pick([{ ...phone, state: 'unauthorized' }])).rejects.toThrow(
      "Pixel 8 Pro hasn't allowed USB debugging from this computer. Unlock it, accept the prompt, and build again.",
    );
  });

  it('explains a computer with nothing to run on', async () => {
    await expect(pick([], undefined, [])).rejects.toThrow(
      "No emulator is running, no phone is connected, and there's no virtual device to start. Create one in Android Studio's Device Manager, or connect a phone with USB debugging turned on.",
    );
  });

  describe('--device', () => {
    const running = [
      emulator('emulator-5554'),
      emulator('emulator-5556'),
      phone,
    ];

    it('picks a device by its serial', async () => {
      expect(await pick(running, '1A2B3C')).toEqual({
        serial: '1A2B3C',
        label: 'Pixel 8 Pro',
      });
    });

    it('picks the running emulator of a virtual device', async () => {
      expect(await pick(running, 'Tablet_API_35')).toEqual({
        serial: 'emulator-5556',
        label: 'the Tablet_API_35 emulator',
      });
    });

    it('starts a virtual device that is not running', async () => {
      expect(await pick(running, 'Small_API_24')).toEqual({
        avd: 'Small_API_24',
        label: 'the Small_API_24 emulator',
      });
    });

    it('lists what there is when nothing matches', async () => {
      await expect(pick(running, 'Pixel_9')).rejects.toThrow(
        `There's no running emulator, connected phone or virtual device named "Pixel_9". Pass one of these: emulator-5554, emulator-5556, 1A2B3C, Pixel_API_34, Tablet_API_35, Small_API_24.`,
      );
      await expect(pick([], 'Pixel_9', [])).rejects.toThrow(
        /named "Pixel_9"\. Create a virtual device in Android Studio's Device Manager\./,
      );
    });
  });
});

describe('startAndroidDevice', () => {
  let dir: string;
  let sdk: string;
  let calls: string;
  let logFile: string;
  const app = resolveAppOptions(
    { appName: 'My App', appId: 'com.example.myapp' },
    { projectName: 'my-app' },
  );
  const fast = { pollMs: 10, timeoutMs: 2000 };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-android-run-'));
    sdk = path.join(dir, 'sdk');
    calls = path.join(dir, 'calls.log');
    logFile = path.join(dir, 'logs/android.log');
    mkdirSync(path.dirname(logFile), { recursive: true });
  });
  afterEach(() => {
    // The fake emulator waits like the real one; stop it.
    const pid = path.join(dir, 'emulator.pid');
    if (existsSync(pid)) {
      try {
        process.kill(Number(readFileSync(pid, 'utf8')));
      } catch {
        // It already exited.
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const script = (file: string, body: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  };

  /**
   * A fake SDK. adb lists the lines of `devices`, says the emulator runs
   * `Pixel_API_34`, reports booted unless `booting` exists, and records every
   * call. The emulator lists two AVDs, and `-avd` adds `emulator-5556` to
   * `devices` and keeps running, unless `emulator-fails` exists.
   */
  const setup = (devices: string[] = [], { adb = '' } = {}) => {
    writeFileSync(
      path.join(dir, 'devices'),
      devices.map((d) => `${d}\n`).join(''),
    );
    script(
      path.join(sdk, 'platform-tools/adb'),
      `echo "adb $*" >> "${calls}"
${adb}
case "$*" in
  "devices -l") echo "List of devices attached"; cat "${dir}/devices" ;;
  *"emu avd name") echo "Pixel_API_34"; echo "OK" ;;
  *"getprop sys.boot_completed") [ -e "${dir}/booting" ] || echo 1 ;;
  *"install -r"*) echo "Success" ;;
  *resolve-activity*) echo "priority=0 preferredOrder=0 match=0x108000"; echo "com.example.myapp/com.example.Renamed" ;;
  *"am start"*) echo "Starting: Intent { cmp=... }"; echo "Status: ok" ;;
esac`,
    );
    script(
      path.join(sdk, 'emulator/emulator'),
      `echo "emulator $*" >> "${calls}"
if [ "$1" = "-list-avds" ]; then
  echo "INFO    | Android emulator version 36.1.9.0"
  echo "Pixel_API_34"
  echo "Small_API_24"
  exit 0
fi
[ -e "${dir}/emulator-fails" ] && { echo "PANIC: Missing emulator engine"; exit 1; }
echo "emulator-5556 device" >> "${dir}/devices"
echo $$ > "${dir}/emulator.pid"
exec sleep 30`,
    );
  };

  const start = (device?: string, messages: string[] = []) =>
    startAndroidDevice({
      device,
      logFile,
      log: (message) => messages.push(message),
      env: { ANDROID_HOME: sdk },
      timing: fast,
    });

  const recorded = () => readFileSync(calls, 'utf8').trim().split('\n');

  it('installs the app on the running emulator and opens its launcher activity', async () => {
    setup(['emulator-5554\tdevice']);
    const messages: string[] = [];
    const target = await start(undefined, messages);
    await target.launch('/dist/android/my-app.apk', app);
    expect(recorded()).toEqual([
      'adb devices -l',
      'adb -s emulator-5554 emu avd name',
      'adb -s emulator-5554 shell getprop sys.boot_completed',
      'adb -s emulator-5554 install -r /dist/android/my-app.apk',
      'adb -s emulator-5554 shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER com.example.myapp',
      'adb -s emulator-5554 shell am start -S -W -n com.example.myapp/com.example.Renamed',
    ]);
    expect(messages).toEqual([
      'Running the app on the Pixel_API_34 emulator',
      'Installing the app on the Pixel_API_34 emulator',
      'Opened My App on the Pixel_API_34 emulator',
    ]);
    expect(readFileSync(logFile, 'utf8')).toContain(
      '$ ' + path.join(sdk, 'platform-tools/adb') + ' -s emulator-5554 install',
    );
  });

  it("falls back to the shell's activity when the launcher activity can't be looked up", async () => {
    setup(['emulator-5554\tdevice'], {
      adb: 'case "$*" in *resolve-activity*) echo "No activity found"; exit 0 ;; esac',
    });
    await (await start()).launch('/my-app.apk', app);
    expect(recorded().at(-1)).toBe(
      `adb -s emulator-5554 shell am start -S -W -n com.example.myapp/${SHELL_ACTIVITY}`,
    );
  });

  it('starts the first virtual device in the background and waits for Android to boot', async () => {
    setup();
    writeFileSync(path.join(dir, 'booting'), '');
    const messages: string[] = [];
    const target = await start(undefined, messages);
    expect(messages).toEqual(['Starting the Pixel_API_34 emulator']);
    const launched = target.launch('/my-app.apk', app);
    // Booted a few polls later.
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(path.join(dir, 'booting'));
    await launched;
    expect(recorded()).toContain('emulator -avd Pixel_API_34');
    expect(recorded()).toContain('adb -s emulator-5556 install -r /my-app.apk');
    expect(messages.at(-1)).toBe('Opened My App on the Pixel_API_34 emulator');
  });

  it('starts the virtual device --device names', async () => {
    setup(['emulator-5554\tdevice']);
    await (await start('Small_API_24')).launch('/my-app.apk', app);
    expect(recorded()).toContain('emulator -avd Small_API_24');
    expect(recorded()).toContain('adb -s emulator-5556 install -r /my-app.apk');
  });

  it("explains an emulator that stops while starting, with the emulator's log", async () => {
    setup();
    writeFileSync(path.join(dir, 'emulator-fails'), '');
    const target = await start();
    await expect(target.launch('/my-app.apk', app)).rejects.toThrow(
      `The emulator stopped while starting (exit code 1). Its output is in ${path.join(dir, 'logs/emulator.log')}.`,
    );
    expect(readFileSync(path.join(dir, 'logs/emulator.log'), 'utf8')).toBe(
      'PANIC: Missing emulator engine\n',
    );
  });

  it('gives up on a device that never finishes booting', async () => {
    setup(['emulator-5554\tdevice']);
    writeFileSync(path.join(dir, 'booting'), '');
    const target = await startAndroidDevice({
      device: undefined,
      logFile,
      log: () => {},
      env: { ANDROID_HOME: sdk },
      timing: { pollMs: 5, timeoutMs: 60_000 / 1000 },
    });
    await expect(target.launch('/my-app.apk', app)).rejects.toThrow(
      "The Pixel_API_34 emulator didn't finish starting within 0.001 minutes.",
    );
  });

  it("points to the emulator's log when one it started never finishes booting", async () => {
    setup();
    writeFileSync(path.join(dir, 'booting'), '');
    const target = await startAndroidDevice({
      device: undefined,
      logFile,
      log: () => {},
      env: { ANDROID_HOME: sdk },
      timing: { pollMs: 5, timeoutMs: 60 },
    });
    await expect(target.launch('/my-app.apk', app)).rejects.toThrow(
      /didn't finish starting within .* minutes\. The emulator's output is in .*emulator\.log\./,
    );
  });

  it('explains an install over a copy signed with another key', async () => {
    setup(['emulator-5554\tdevice'], {
      adb: 'case "$*" in *"install -r"*) echo "adb: failed to install: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package signatures do not match]"; exit 1 ;; esac',
    });
    await expect((await start()).launch('/my-app.apk', app)).rejects.toThrow(
      'The Pixel_API_34 emulator has a copy of com.example.myapp signed with a different key, e.g. from before you set up signing. Uninstall it from the device, then build again.',
    );
  });

  it('passes on other install failures as they are', async () => {
    setup(['emulator-5554\tdevice'], {
      adb: 'case "$*" in *"install -r"*) echo "Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]"; exit 1 ;; esac',
    });
    await expect((await start()).launch('/my-app.apk', app)).rejects.toThrow(
      /INSTALL_FAILED_INSUFFICIENT_STORAGE/,
    );
  });

  it('reports an app that fails to open, which `am start` exits 0 for', async () => {
    setup(['emulator-5554\tdevice'], {
      adb: 'case "$*" in *"am start"*) echo "Error type 3"; echo "Error: Activity class {x} does not exist."; exit 0 ;; esac',
    });
    await expect((await start()).launch('/my-app.apk', app)).rejects.toThrow(
      `Couldn't open the app: Activity class {x} does not exist. The full log is ${logFile}.`,
    );
  });

  it('explains a missing SDK, adb or a failing adb', async () => {
    const home = process.env['HOME'];
    process.env['HOME'] = path.join(dir, 'empty-home');
    try {
      await expect(start()).rejects.toThrow(/The Android SDK was not found/);
    } finally {
      process.env['HOME'] = home;
    }

    mkdirSync(sdk, { recursive: true });
    await expect(start()).rejects.toThrow(
      `adb isn't in ${sdk}. Install Android SDK Platform-Tools in Android Studio's SDK Manager, under SDK Tools.`,
    );

    setup([], { adb: 'exit 1' });
    await expect(start()).rejects.toThrow(/devices` failed/);
  });

  it('finds no virtual devices without the emulator package', async () => {
    setup();
    rmSync(path.join(sdk, 'emulator'), { recursive: true });
    await expect(start()).rejects.toThrow(/No emulator is running/);
  });
});
