import type { StateStorage } from 'zustand/middleware';

import { shell } from '../lib/shell';

/**
 * The favourites' persistent storage: the shell's `AngularLynxLocalStorage`
 * module, a UserDefaults suite on iOS, which AngularLynx's `LynxLocalStorage`
 * also writes to. Lynx itself only keeps session storage
 * (`lynx.setSessionStorageItem`), which a relaunch empties, so this takes the
 * place of the original's AsyncStorage.
 *
 * The bundle runs on both of Lynx's threads. On the main thread, which draws
 * the first screen before the background thread starts, there's no
 * NativeModules: it reads as empty, and the background thread's store, the
 * one the app's handlers change, reads the saved value.
 */
export const lynxLocalStorage: StateStorage = {
  getItem: (key) =>
    new Promise((resolve) => {
      const storage = shell().AngularLynxLocalStorage;
      if (!storage) return resolve(null);
      storage.getItem(key, (result) => resolve(result?.value ?? null));
    }),
  setItem: (key, value) =>
    new Promise<void>((resolve) => {
      const storage = shell().AngularLynxLocalStorage;
      if (!storage) return resolve();
      storage.setItem(key, value, () => resolve());
    }),
  removeItem: (key) =>
    new Promise<void>((resolve) => {
      const storage = shell().AngularLynxLocalStorage;
      if (!storage) return resolve();
      storage.removeItem(key, () => resolve());
    }),
};
