// cspell:words keyevent
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { run, runAllowFailure, start, step, stop } from '../process.ts';
import { HTTP_DATA } from '../static-server.ts';
import { EXPLORER, getExplorer } from './explorer.ts';
import {
  flowsFor,
  type NativeHost,
  judgeFlow,
  LIBRARY_PHOTO,
  runFlows,
} from './maestro.ts';
import { countColors } from './png.ts';

/**
 * Layer 6 on Android: installs the app's own APK, or Lynx Explorer, on the
 * running emulator (CI starts it with android-emulator-runner) and runs the
 * same Maestro flows as iOS. `adb reverse` makes the host's static server,
 * which serves Explorer's bundle and the counter fixture's JSON, reachable at
 * the same localhost URL as on iOS.
 */
export const runOnAndroidEmulator = async ({
  host,
  port,
  artifactsDir,
  logFile,
}: {
  host: NativeHost;
  port: number;
  artifactsDir: string;
  logFile: string;
}) => {
  step(
    `Layer 6: Android emulator (${host.kind === 'shell' ? "the app's own build" : 'Lynx Explorer'})`,
  );
  const apk =
    host.kind === 'shell' ? host.binary : await getExplorer('android', logFile);
  const appId =
    host.kind === 'shell' ? host.appId : EXPLORER.android.packageName;
  const adb = (args: string[]) =>
    run('adb', args, { cwd: process.cwd(), logFile, echo: false });
  await adb(['wait-for-device']);
  await adb(['install', '-r', apk]);
  // The emulator's library is empty. MediaProvider indexes a file pushed to
  // shared storage when it's written; the broadcast covers older Androids.
  const photo = '/sdcard/Pictures/angular-lynx-e2e.jpg';
  await adb(['push', LIBRARY_PHOTO, photo]);
  await adb([
    'shell',
    'am',
    'broadcast',
    '-a',
    'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
    '-d',
    `file://${photo}`,
  ]);
  for (const reversed of new Set([port, HTTP_DATA.port])) {
    await adb(['reverse', `tcp:${reversed}`, `tcp:${reversed}`]);
  }
  await adb(['logcat', '-c']);
  const logcat = start('adb', ['logcat', '-v', 'time'], {
    cwd: process.cwd(),
    logFile: path.join(artifactsDir, `android-${host.kind}-logcat.log`),
    echo: false,
  });

  /**
   * For a Maestro run that hung. The PNG is written on the emulator and
   * pulled, because the harness reads a command's output as text, which
   * `adb exec-out screencap` would garble. Only a debugging aid, so it never
   * fails the host, and has a limit in case the emulator stopped answering.
   */
  const screenshot = async (file: string) => {
    const onDevice = '/data/local/tmp/angular-lynx-e2e.png';
    const options = {
      cwd: process.cwd(),
      logFile,
      echo: false,
      timeout: { ms: 60_000 },
    };
    let result = await runAllowFailure(
      'adb',
      ['shell', 'screencap', '-p', onDevice],
      options,
    );
    if (result.code === 0) {
      result = await runAllowFailure('adb', ['pull', onDevice, file], options);
    }
    if (result.code !== 0) {
      console.warn(
        `The screenshot ${path.basename(file)} failed (adb exited with code ${result.code}).`,
      );
    }
  };

  const failures: string[] = [];
  try {
    const device = (await adb(['get-serialno'])).output.trim();
    const outcomes = await runFlows(flowsFor('android', host), {
      device,
      appId,
      host,
      outputDir: path.join(artifactsDir, `android-${host.kind}`),
      logFile,
      screenshot,
    });
    for (const [flow, outcome] of outcomes) {
      const failure = judgeFlow(flow, 'android', outcome);
      if (failure) {
        failures.push(failure);
      }
    }
    if (host.kind === 'shell') {
      const failure = await checkColorsAfterKeyPress({
        adb,
        appId,
        screenshot,
        file: path.join(artifactsDir, `android-${host.kind}-key-press.png`),
      });
      if (failure) {
        failures.push(failure);
      }
    }
  } finally {
    stop(logcat.child);
    await runAllowFailure('adb', ['reverse', '--remove-all'], {
      cwd: process.cwd(),
      logFile,
      echo: false,
    });
  }

  const jsErrors = logcat
    .output()
    .split('\n')
    .filter(
      (line) =>
        /lynx/i.test(line) &&
        /\b(Uncaught|TypeError|ReferenceError|SyntaxError|RangeError)\b/.test(
          line,
        ),
    );
  if (jsErrors.length > 0) {
    failures.push(`The app logged JavaScript errors:\n${jsErrors.join('\n')}`);
  }
  return failures;
};

/**
 * The counter fixture's buttons' gray, `#e0e0e0`, and the same gray darkened
 * by Android's default focus highlight: a 12% black (`#1F000000`).
 */
const BUTTON_GRAY = '224,224,224';
const HIGHLIGHTED_BUTTON_GRAY = '197,197,197';

/**
 * Checks that the shell draws the page's own colors after a key press (issue
 * #362). A key press takes the display out of touch mode, and the focusable
 * LynxView then takes focus. Android 8 and later draw a default focus
 * highlight over a focused view that doesn't style its own focus, which over
 * a full-screen LynxView made every color about 12% darker. Maestro can't
 * read colors, so this reads the screenshot itself: the buttons' `#e0e0e0`
 * must be on screen, and not darkened. (Darkened, the page's white would be
 * `#e0e0e0` too, so the first alone wouldn't do.)
 */
const checkColorsAfterKeyPress = async ({
  adb,
  appId,
  screenshot,
  file,
}: {
  adb: (args: string[]) => Promise<{ output: string }>;
  appId: string;
  screenshot: (file: string) => Promise<void>;
  file: string;
}): Promise<string | undefined> => {
  const component = (
    await adb([
      'shell',
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      appId,
    ])
  ).output
    .trim()
    .split('\n')
    .at(-1)!
    .trim();
  await adb(['shell', 'am', 'start', '-S', '-W', '-n', component]);
  // Enter, as the keyboard's Enter key sends it: any typing or navigation key
  // leaves touch mode.
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_ENTER']);
  let gray = 0;
  let highlighted = 0;
  // The page takes a moment to draw after the activity starts.
  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(2_000);
    await screenshot(file);
    let colors: Map<string, number>;
    try {
      colors = countColors(readFileSync(file));
    } catch {
      // screenshot() has said why it failed; try again.
      continue;
    }
    gray = colors.get(BUTTON_GRAY) ?? 0;
    highlighted = colors.get(HIGHLIGHTED_BUTTON_GRAY) ?? 0;
    if (gray > 2_000 && highlighted < 500) {
      return undefined;
    }
  }
  return `after a key press, the app's colors were darkened: the buttons' #e0e0e0 covered ${gray} pixels and #c5c5c5, the same gray under Android's 12% black focus highlight, ${highlighted} (issue #362). The screenshot is ${path.basename(file)}.`;
};
