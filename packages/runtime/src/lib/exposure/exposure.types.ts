/**
 * Wire format for individual exposure/disexposure event entries.
 * Dual-cased fields (kebab and camel) match the Lynx engine's output exactly.
 */
export type ExposureEventDetail = {
  'exposure-id': string;
  'exposure-scene': string;
  exposureID: string;
  exposureScene: string;
  /**
   * Identifies the native element. Lynx documents it as a string, which iOS
   * and Android send; the web sends the element's numeric unique ID.
   */
  'unique-id': string | number;
};

/**
 * The Lynx engine batches element visibility changes at ~20fps and dispatches
 * them as arrays via GlobalEventEmitter ('exposure' / 'disexposure' events).
 */
export type GlobalExposureEvent = ExposureEventDetail[];

export type ObserverFrameRateOptions = {
  forPageRect?: number;
  forExposureCheck?: number;
};
