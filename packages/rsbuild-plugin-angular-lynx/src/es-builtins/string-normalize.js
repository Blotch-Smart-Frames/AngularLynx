import { definePolyfills, toThisString } from './shared.js';

const NORMALIZATION_FORMS = ['NFC', 'NFD', 'NFKC', 'NFKD'];

definePolyfills(String.prototype, {
  /**
   * ES2015, but missing from the main thread all the same. three.js calls it
   * on every URL a loader is given (LoadingManager's `resolveURL()`), so
   * without it TextureLoader and GLTFLoader threw "not a function" on iOS and
   * Android. Exact for ASCII, which every form leaves as it is, so URLs and
   * keys come back right; other text comes back as given, since the Unicode
   * tables a real normalizer needs would add tens of kilobytes to every app,
   * and text is almost always stored composed (NFC) already.
   */
  normalize(form = 'NFC') {
    const string = toThisString(this);
    if (!NORMALIZATION_FORMS.includes(String(form))) {
      throw new RangeError(
        'The normalization form should be one of NFC, NFD, NFKC, NFKD.',
      );
    }
    return string;
  },
});
