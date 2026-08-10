/**
 * Extensible map of custom native modules declared by the host app.
 *
 * App developers augment this interface to get type-safe access
 * via {@link LynxNativeModule.getNativeModule}:
 *
 * ```typescript
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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NativeModuleMap = {};
