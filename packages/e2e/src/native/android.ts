import path from 'node:path';

import { run, runAllowFailure, start, step, stop } from '../process.ts';
import { EXPLORER, getExplorer } from './explorer.ts';
import { FLOWS, judgeFlow, runFlow } from './maestro.ts';

/**
 * Layer 6 on Android: installs Lynx Explorer on the running emulator (CI
 * starts it with android-emulator-runner) and runs the same Maestro flows as
 * iOS. `adb reverse` makes the host's static server reachable at the same
 * localhost URL as on iOS.
 */
export const runOnAndroidEmulator = async ({
  bundleUrl,
  port,
  artifactsDir,
  logFile,
}: {
  bundleUrl: string;
  port: number;
  artifactsDir: string;
  logFile: string;
}) => {
  step('Layer 6: Android emulator');
  const apk = await getExplorer('android', logFile);
  const adb = (args: string[]) =>
    run('adb', args, { cwd: process.cwd(), logFile, echo: false });
  await adb(['wait-for-device']);
  await adb(['install', '-r', apk]);
  await adb(['reverse', `tcp:${port}`, `tcp:${port}`]);
  await adb(['logcat', '-c']);
  const logcat = start('adb', ['logcat', '-v', 'time'], {
    cwd: process.cwd(),
    logFile: path.join(artifactsDir, 'android-logcat.log'),
    echo: false,
  });

  const failures: string[] = [];
  try {
    const device = (await adb(['get-serialno'])).output.trim();
    for (const flow of FLOWS) {
      const result = await runFlow(flow, {
        device,
        appId: EXPLORER.android.packageName,
        bundleUrl,
        outputDir: path.join(artifactsDir, 'android'),
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
    failures.push(`Explorer logged JavaScript errors:\n${jsErrors.join('\n')}`);
  }
  return failures;
};
