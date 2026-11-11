import type { ResolvedApp } from './options.ts';

/** `ng build --platform <platform> --run`'s options. */
export type RunOptions = {
  /**
   * Where to open the app. On iOS, a simulator's or a paired iPhone's name or
   * UDID; on Android, a virtual device's name or an adb serial. When it's
   * left out, a running simulator, emulator or Android phone, or else the
   * newest iPhone simulator or the first virtual device.
   */
  readonly device?: string;
};

/**
 * `ng serve --platform <platform>`'s dev server, which the development app
 * loads its bundle from instead of the copy inside it.
 */
export type DevServerOptions = {
  /**
   * The Lynx bundle's URL on the dev server, as the bundle itself names the
   * server: rspeedy builds it with this host in its asset URLs and its live
   * reload socket (`dev.assetPrefix`), and the QR code for Lynx Explorer
   * carries it. Usually the Mac's address on the local network, so a phone
   * on the same Wi-Fi reaches it.
   */
  readonly bundleUrl: string;
};

/**
 * A simulator, emulator or phone picked for `--run`. Picking it and starting
 * it come before the native build, so a device that doesn't exist fails in
 * seconds, and a simulator or emulator boots while Xcode or Gradle compiles.
 */
export type RunTarget = {
  /**
   * The real iPhone the app runs on, which takes a development-signed build
   * for the device rather than the simulator app.
   */
  readonly iPhone?: { readonly udid: string; readonly name: string };
  /**
   * The simulator the app runs on, which a development build is compiled for
   * alone, rather than for every simulator.
   */
  readonly simulator?: { readonly udid: string };
  /**
   * Waits for the device to finish starting, then installs and opens the
   * app. With `devServer`, the app is told to load its bundle from there.
   */
  readonly launch: (
    binary: string,
    app: ResolvedApp,
    devServer?: DevServerOptions,
  ) => Promise<void>;
};

/**
 * The launch argument (iOS) and intent extra (Android) that hand the
 * development app its dev server, and the one that names the host the bundle
 * was built with, when the app reaches the server under another (Android's
 * `localhost`, through `adb reverse`). The shells' DevServer reads them.
 */
export const DEV_SERVER_ARGUMENT = 'AngularLynxDevServer';
export const DEV_SERVER_ORIGIN_ARGUMENT = 'AngularLynxDevServerOrigin';

/**
 * The launch arguments that point the development app at the dev server.
 * iOS puts `-Name value` arguments in the app's UserDefaults (its argument
 * domain), where DevServer.swift reads them. A simulator shares the Mac's
 * network, and an iPhone on the same Wi-Fi reaches the Mac's address, so
 * both load the bundle from the URL it was built with.
 */
export const iosDevServerArguments = (
  devServer: DevServerOptions | undefined,
): string[] =>
  devServer ? [`-${DEV_SERVER_ARGUMENT}`, devServer.bundleUrl] : [];
