/**
 * Extend this interface to type the raw data passed from native before processing.
 *
 * @example
 * declare module '@blotch/angular-lynx' {
 *   interface InitDataRaw { userId: string; }
 * }
 */
// oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for module augmentation
export interface InitDataRaw extends Record<string, unknown> {}

/**
 * Extend this interface to type the processed init data used throughout the app.
 *
 * @example
 * declare module '@blotch/angular-lynx' {
 *   interface InitData { userId: string; }
 * }
 */
// oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for module augmentation
export interface InitData extends Record<string, unknown> {}

/**
 * Extend this interface to type the global data passed from the native host.
 *
 * @example
 * declare module '@blotch/angular-lynx' {
 *   interface GlobalData { theme: 'light' | 'dark'; }
 * }
 */
// oxlint-disable-next-line typescript/consistent-type-definitions -- interface required for module augmentation
export interface GlobalData extends Record<string, unknown> {}

export type DataProcessorDefinition = {
  /**
   * Transform raw native init data before it is stored in LynxInitData.
   */
  defaultDataProcessor?: (rawInitData: InitDataRaw) => InitData;
  /**
   * Named processors callable by the native side via processData(data, processorName).
   */
  dataProcessors?: Record<string, (...args: any[]) => any>;
};
