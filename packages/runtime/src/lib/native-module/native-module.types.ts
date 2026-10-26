/**
 * Extensible map of custom native modules declared by the host app.
 *
 * App developers augment this interface to get type-safe access
 * via {@link LynxNativeModule.getNativeModule}. Describe each module's
 * methods as the host implements them; `getNativeModule()` turns their
 * return values into promises (see {@link NativeModuleProxy}):
 *
 * ```typescript
 * // This export makes the file a module, so the block below adds to
 * // @blotch/angular-lynx's types instead of replacing them.
 * export {};
 *
 * declare module '@blotch/angular-lynx' {
 *   interface NativeModuleMap {
 *     NativeLocalStorageModule: {
 *       setStorageItem(key: string, value: string): void;
 *       getStorageItem(key: string, callback: (value: string) => void): void;
 *       clearStorage(): void;
 *     };
 *   }
 * }
 * ```
 */
// An interface, not a type alias: only interfaces merge with the app's
// `declare module` block. A type alias made that block a duplicate identifier.
// oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for module augmentation
export interface NativeModuleMap {}

/**
 * A native module as {@link LynxNativeModule.getNativeModule} returns it on
 * the main thread, where Angular runs.
 *
 * Native modules exist only on the background thread, so each method call is
 * relayed there: the method returns a promise of its result (copied as JSON),
 * and function arguments are called back on the main thread. Only methods
 * cross; other properties of the module aren't reachable.
 */
export type NativeModuleProxy<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => unknown
    ? K
    : never]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};
