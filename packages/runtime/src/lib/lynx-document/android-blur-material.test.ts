import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  androidBlurMaterialStyle,
  BLUR_BACKGROUND_IMAGE_VARIABLE,
  BLUR_BACKGROUND_VARIABLE,
  BLUR_BOX_SHADOW_VARIABLE,
  usesAndroidBlurMaterials,
} from './android-blur-material';

const style = (attrs: Record<string, unknown>) =>
  androidBlurMaterialStyle(new Map(Object.entries(attrs)));

afterEach(() => {
  vi.unstubAllGlobals();
});

const material = (background: string, image = 'none', boxShadow = 'none') =>
  `${BLUR_BACKGROUND_VARIABLE}: ${background}; ` +
  `${BLUR_BACKGROUND_IMAGE_VARIABLE}: ${image}; ` +
  `${BLUR_BOX_SHADOW_VARIABLE}: ${boxShadow}`;
const NONE = material('transparent');

describe('androidBlurMaterialStyle', () => {
  it('tints each material', () => {
    expect(style({ 'blur-radius': '16px' })).toBe(
      material('rgba(255, 255, 255, 0.3)'),
    );
    expect(style({ 'blur-radius': 16, 'blur-effect': 'extra-light' })).toBe(
      material('rgba(255, 255, 255, 0.75)'),
    );
    expect(style({ 'blur-radius': '16px', 'blur-effect': 'dark' })).toBe(
      material('rgba(0, 0, 0, 0.6)'),
    );
  });

  it('treats an unknown effect as light, as iOS does', () => {
    expect(style({ 'blur-radius': '8px', 'blur-effect': 'sepia' })).toBe(
      style({ 'blur-radius': '8px', 'blur-effect': 'light' }),
    );
  });

  it('shows no material without a blur radius, as on iOS', () => {
    expect(style({})).toBe(NONE);
    expect(style({ 'blur-effect': 'dark', 'blur-radius': '0px' })).toBe(NONE);
  });

  it('frosts glass, with or without a blur radius', () => {
    const glass = style({ 'blur-effect': 'glass' });
    expect(glass).toContain(
      `${BLUR_BACKGROUND_VARIABLE}: rgba(255, 255, 255, 0.3);`,
    );
    expect(glass).toContain(`${BLUR_BACKGROUND_IMAGE_VARIABLE}: none;`);
    expect(glass).toContain(`${BLUR_BOX_SHADOW_VARIABLE}: inset`);
    expect(style({ 'blur-effect': 'glass', 'glass-style': 'clear' })).toContain(
      `${BLUR_BACKGROUND_VARIABLE}: rgba(255, 255, 255, 0.1);`,
    );
  });

  it('lays glass-tint-color over the sheen', () => {
    const tinted = style({
      'blur-effect': 'glass',
      'glass-tint-color': 'rgba(59, 130, 246, 0.35)',
    });
    expect(tinted).toContain(
      `${BLUR_BACKGROUND_VARIABLE}: rgba(255, 255, 255, 0.3);`,
    );
    expect(tinted).toContain(
      `${BLUR_BACKGROUND_IMAGE_VARIABLE}: linear-gradient(rgba(59, 130, 246, 0.35), rgba(59, 130, 246, 0.35));`,
    );
  });

  it('adds no tint for a transparent or empty glass-tint-color', () => {
    const plain = style({ 'blur-effect': 'glass' });
    for (const tint of ['transparent', '']) {
      expect(style({ 'blur-effect': 'glass', 'glass-tint-color': tint })).toBe(
        plain,
      );
    }
  });

  it('leaves a glass-container bare', () => {
    expect(
      style({ 'blur-effect': 'glass-container', 'blur-radius': '16px' }),
    ).toBe(NONE);
  });
});

describe('usesAndroidBlurMaterials', () => {
  it('is true on Android’s native renderer only', () => {
    vi.stubGlobal('__WEB__', false);
    vi.stubGlobal('SystemInfo', { platform: 'Android' });
    expect(usesAndroidBlurMaterials()).toBe(true);
    vi.stubGlobal('SystemInfo', { platform: 'iOS' });
    expect(usesAndroidBlurMaterials()).toBe(false);
  });

  it('is false on web, which draws its own materials', () => {
    vi.stubGlobal('__WEB__', true);
    vi.stubGlobal('SystemInfo', { platform: 'Android' });
    expect(usesAndroidBlurMaterials()).toBe(false);
  });
});
