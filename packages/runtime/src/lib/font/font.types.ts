/**
 * Configuration for a custom font face to register dynamically via `lynx.addFont()`.
 *
 * Only `fontFamily` and `src` are supported by the Lynx engine.
 * Platform formats: Android (TTF, OTF, TTC), iOS (TTF, OTF, WOFF, WOFF2).
 */
export type LynxFontFaceConfig = {
  fontFamily: string;
  src: string;
};

export type LynxFontStatus = 'idle' | 'loading' | 'loaded' | 'error';

export type LynxFontEntry = {
  fontFamily: string;
  src: string;
  status: LynxFontStatus;
  error?: Error;
};
