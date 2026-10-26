import path from 'node:path';

import { run, runAllowFailure, start, step, stop } from '../process.ts';
import { HTTP_DATA } from '../static-server.ts';
import { EXPLORER, getExplorer } from './explorer.ts';
import { flowsFor, type NativeHost, judgeFlow, runFlow } from './maestro.ts';

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
  for (const reversed of new Set([port, HTTP_DATA.port])) {
    await adb(['reverse', `tcp:${reversed}`, `tcp:${reversed}`]);
  }
  await adb(['logcat', '-c']);
  const logcat = start('adb', ['logcat', '-v', 'time'], {
    cwd: process.cwd(),
    logFile: path.join(artifactsDir, `android-${host.kind}-logcat.log`),
    echo: false,
  });

  const failures: string[] = [];
  try {
    const device = (await adb(['get-serialno'])).output.trim();
    for (const flow of flowsFor('android', host)) {
      const result = await runFlow(flow, {
        device,
        appId,
        host,
        outputDir: path.join(artifactsDir, `android-${host.kind}`),
        logFile,
      });
      const failure = judgeFlow(flow, 'android', result.code);
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
