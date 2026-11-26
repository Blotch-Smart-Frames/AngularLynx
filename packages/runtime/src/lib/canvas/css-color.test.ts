// cspell:words currentcolor notacolor rebeccapurple
import { describe, expect, it } from 'vitest';
import { parseColor, serializeColor } from './css-color';

describe('parseColor', () => {
  it('reads hex colors of every length', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0, 1]);
    expect(parseColor('#f008')).toEqual([255, 0, 0, 0x88 / 255]);
    expect(parseColor(' #00FF00 ')).toEqual([0, 255, 0, 1]);
    expect(parseColor('#0000ff80')).toEqual([0, 0, 255, 0x80 / 255]);
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('#ggg')).toBeNull();
  });

  it('reads named colors, transparent and currentcolor', () => {
    expect(parseColor('rebeccapurple')).toEqual([0x66, 0x33, 0x99, 1]);
    expect(parseColor('White')).toEqual([255, 255, 255, 1]);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(parseColor('currentColor')).toEqual([0, 0, 0, 1]);
    expect(parseColor('notacolor')).toBeNull();
  });

  it('reads rgb() and rgba(), in the legacy and modern syntax', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
    expect(parseColor('rgba(1,2,3,0.5)')).toEqual([1, 2, 3, 0.5]);
    expect(parseColor('rgb(100% 50% 0% / 25%)')).toEqual([255, 128, 0, 0.25]);
    expect(parseColor('rgb(none 300 -5)')).toEqual([0, 255, 0, 1]);
    expect(parseColor('rgba(0, 0, 0, 2)')).toEqual([0, 0, 0, 1]);
  });

  it('reads hsl() and hwb()', () => {
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual([0, 255, 0, 1]);
    expect(parseColor('hsla(0.5turn 100 50 / 0.5)')).toEqual([
      0, 255, 255, 0.5,
    ]);
    expect(parseColor('hsl(0rad, 100%, 25%)')).toEqual([128, 0, 0, 1]);
    expect(parseColor('hsl(200grad 0% 100%)')).toEqual([255, 255, 255, 1]);
    expect(parseColor('hsl(-120 100% 50%)')).toEqual([0, 0, 255, 1]);
    expect(parseColor('hsl(none 0% 0% / 1)')).toEqual([0, 0, 0, 1]);
    expect(parseColor('hwb(0 0% 0%)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('hwb(0 20 30)')).toEqual([179, 51, 51, 1]);
    expect(parseColor('hwb(0 60% 60%)')).toEqual([128, 128, 128, 1]);
  });

  it('follows CSS Color 4’s grammar for each syntax', () => {
    // The legacy syntax doesn't mix numbers and percentages, take `none`, or
    // hsl() saturation without a percent sign; hwb() has no legacy syntax.
    expect(parseColor('rgb(100%, 0, 0)')).toBeNull();
    expect(parseColor('rgb(none, 0, 0)')).toBeNull();
    expect(parseColor('rgb(10%, 20%, 30%)')).toEqual([26, 51, 77, 1]);
    expect(parseColor('hsl(0, 50, 50)')).toBeNull();
    expect(parseColor('hsl(0, none, 50%)')).toBeNull();
    expect(parseColor('hsl(none, 100%, 50%)')).toBeNull();
    expect(parseColor('hsl(none 100% 50%)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('rgb(a b c)')).toBeNull();
    expect(parseColor('hwb(0, 0%, 0%)')).toBeNull();
    expect(parseColor('hwb(bogus 60% 60%)')).toBeNull();
    // The modern syntax mixes them, and takes `none`.
    expect(parseColor('rgb(100% 0 none)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('hsl(0 none 50%)')).toEqual([128, 128, 128, 1]);
    // White and black past 100% together are a gray in their proportion.
    expect(parseColor('hwb(0 200% 100%)')).toEqual([170, 170, 170, 1]);
  });

  it('turns down what isn’t a color', () => {
    for (const text of [
      'rgb(1, 2)',
      'rgb(1 2 3 4)',
      'rgb(1 2 3 / )',
      'rgb(1 2 3 / 4 / 5)',
      'rgb(a, b, c)',
      'rgb(%, 2, 3)',
      'rgb(, 2, 3)',
      'hsl(red, 1%, 1%)',
      'lab(50% 0 0)',
      'rgb',
    ]) {
      expect(parseColor(text)).toBeNull();
    }
    expect(parseColor(42)).toBeNull();
    expect(parseColor(null)).toBeNull();
  });
});

describe('serializeColor', () => {
  it('writes opaque colors as hex, and the rest as rgba with a short alpha', () => {
    expect(serializeColor([255, 0, 16, 1])).toBe('#ff0010');
    expect(serializeColor([1, 2, 3, 0.5])).toBe('rgba(1, 2, 3, 0.5)');
    expect(serializeColor([1, 2, 3, 0.3])).toBe('rgba(1, 2, 3, 0.3)');
    expect(serializeColor([0, 0, 0, 0])).toBe('rgba(0, 0, 0, 0)');
    expect(serializeColor([0, 0, 0, 0x81 / 255])).toBe('rgba(0, 0, 0, 0.506)');
  });
});
