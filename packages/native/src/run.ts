import type { ResolvedApp } from './options.ts';

/** `ng build --platform <platform> --run`'s options. */
export type RunOptions = {
  /**
   * Where to open the app. On iOS, a simulator's name or UDID; on Android, a
   * virtual device's name or an adb serial. When it's left out, a running
   * simulator, emulator or phone, or else the newest iPhone simulator or the
   * first virtual device.
   */
  readonly device?: string;
};

/**
 * A simulator, emulator or phone picked for `--run`. Picking it and starting
 * it come before the native build, so a device that doesn't exist fails in
 * seconds, and a simulator or emulator boots while Xcode or Gradle compiles.
 */
export type RunTarget = {
  /** Waits for the device to finish starting, then installs and opens the app. */
  readonly launch: (binary: string, app: ResolvedApp) => Promise<void>;
};
