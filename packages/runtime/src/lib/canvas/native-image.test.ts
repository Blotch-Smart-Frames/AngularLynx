import { describe, expect, it } from 'vitest';
import { NATIVE_IMAGE, nativeImageOf, nextNativeImageId } from './native-image';

describe('native images', () => {
  it('finds the pixels an image source holds', () => {
    const image = { id: 1, width: 2, height: 3, bakedOptions: true };
    expect(nativeImageOf({ [NATIVE_IMAGE]: image })).toBe(image);
    expect(nativeImageOf({})).toBeNull();
    expect(nativeImageOf(null)).toBeNull();
    expect(nativeImageOf('image')).toBeNull();
  });

  it('hands out a new id each time', () => {
    expect(nextNativeImageId()).not.toBe(nextNativeImageId());
  });
});
