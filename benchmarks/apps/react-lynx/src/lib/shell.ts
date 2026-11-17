/**
 * The native modules of the shell `@blotch/angular-lynx-native` generates
 * (packages/native/templates/ios/App), which this app runs in exactly as an
 * AngularLynx app does. They live on the background thread's NativeModules,
 * where ReactLynx runs the app's effects and event handlers.
 */
type Callback = (result: { value?: string }) => void;

type ShellModules = {
  AngularLynxShell?: {
    hideSplashScreen(): void;
    reportFullyDrawn(): void;
  };
  AngularLynxLocalStorage?: {
    getItem(key: string, callback: Callback): void;
    setItem(key: string, value: string, callback: Callback): void;
    removeItem(key: string, callback: Callback): void;
  };
};

/**
 * The shell's modules, or an empty object on the main thread (where
 * ReactLynx renders the first screen and NativeModules doesn't exist) and in
 * hosts without the shell, such as Lynx Explorer.
 */
export const shell = (): ShellModules =>
  typeof NativeModules === 'undefined' ? {} : (NativeModules as unknown as ShellModules);
