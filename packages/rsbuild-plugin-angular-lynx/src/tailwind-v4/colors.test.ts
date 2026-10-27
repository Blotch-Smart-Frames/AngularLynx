import { describe, expect, it } from 'vitest';

import { lowerColors } from './colors';

describe('lowerColors', () => {
  it('leaves a value without a color function alone', () => {
    expect(lowerColors('1px solid #000')).toBe('1px solid #000');
    expect(lowerColors('rgb(0 0 0 / 0.1)')).toBe('rgb(0 0 0 / 0.1)');
  });

  it("turns Tailwind's oklch() palette into the sRGB colors its docs list", () => {
    // red-500, green-500 and blue-500 are outside sRGB, so they are gamut
    // mapped: #fb2c36, #00c950 and #2b7fff.
    expect(lowerColors('oklch(63.7% 0.237 25.331)')).toBe('rgb(251, 44, 54)');
    expect(lowerColors('oklch(72.3% 0.219 149.579)')).toBe('rgb(0, 201, 80)');
    expect(lowerColors('oklch(62.3% 0.214 259.815)')).toBe('rgb(43, 127, 255)');
    // gray-200 is inside sRGB: #e5e7eb.
    expect(lowerColors('oklch(92.8% 0.006 264.531)')).toBe(
      'rgb(229, 231, 235)',
    );
  });

  it('reads lightness, chroma and hue in every unit', () => {
    expect(lowerColors('oklch(0.637 0.237 25.331deg)')).toBe(
      'rgb(251, 44, 54)',
    );
    expect(lowerColors('oklch(63.7% 59.25% 0.4421rad)')).toBe(
      'rgb(251, 44, 54)',
    );
    expect(lowerColors('oklch(63.7% 0.237 28.146grad)')).toBe(
      'rgb(251, 44, 54)',
    );
    expect(lowerColors('oklch(63.7% 0.237 0.07036turn)')).toBe(
      'rgb(251, 44, 54)',
    );
    // A missing component is 0.
    expect(lowerColors('oklch(50% none none)')).toBe('rgb(99, 99, 99)');
  });

  it('keeps the alpha, as rgba()', () => {
    expect(lowerColors('oklch(92.8% 0.006 264.531 / 50%)')).toBe(
      'rgba(229, 231, 235, 0.5)',
    );
    expect(lowerColors('oklab(0.5 0 0 / 0.25)')).toBe('rgba(99, 99, 99, 0.25)');
  });

  it('maps a color lighter than white or darker than black to white or black', () => {
    expect(lowerColors('oklch(100% 0.3 120)')).toBe('rgb(255, 255, 255)');
    expect(lowerColors('oklch(0% 0.3 120)')).toBe('rgb(0, 0, 0)');
  });

  it('turns oklab(), lab(), lch() and hwb() into rgb()', () => {
    expect(lowerColors('oklab(62.8% 0.2249 0.1258)')).toBe('rgb(255, 0, 0)');
    expect(lowerColors('oklab(0.628 56.2% 31.4%)')).toBe('rgb(255, 1, 1)');
    expect(lowerColors('lab(54.29 80.8 69.89)')).toBe('rgb(255, 0, 0)');
    expect(lowerColors('lab(54.29% 64.6% 55.9%)')).toBe('rgb(255, 1, 0)');
    expect(lowerColors('lch(54.29 106.84 40.85)')).toBe('rgb(255, 0, 0)');
    expect(lowerColors('lch(54.29 71.2% 40.85)')).toBe('rgb(255, 0, 0)');
    // Dark enough that the CIE Lab formulas take their linear branch.
    expect(lowerColors('lab(5 0 0)')).toBe('rgb(17, 17, 17)');
    expect(lowerColors('hwb(120 20% 30%)')).toBe('rgb(51, 179, 51)');
    expect(lowerColors('hwb(0 60% 60%)')).toBe('rgb(128, 128, 128)');
  });

  it('maps a lab() color outside sRGB into it', () => {
    expect(lowerColors('lab(50 120 -120)')).toBe('rgb(187, 72, 255)');
  });

  it("turns hsl() into rgb(), since Lynx can't read it with spaces", () => {
    expect(lowerColors('hsl(240 5.9% 10%)')).toBe('rgb(24, 24, 27)');
    expect(lowerColors('hsl(240, 5.9%, 10%)')).toBe('rgb(24, 24, 27)');
    expect(lowerColors('hsla(-120 100% 50% / 0.5)')).toBe(
      'rgba(0, 0, 255, 0.5)',
    );
    expect(lowerColors('hsla(0, 100%, 50%, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('rewrites each color in a longer value', () => {
    expect(
      lowerColors(
        '0 1px 2px oklch(0% 0 0 / 10%), inset 0 0 0 1px hsl(0 0% 100%)',
      ),
    ).toBe('0 1px 2px rgba(0, 0, 0, 0.1), inset 0 0 0 1px rgb(255, 255, 255)');
    expect(lowerColors('linear-gradient(to right, oklch(0% 0 0), red)')).toBe(
      'linear-gradient(to right, rgb(0, 0, 0), red)',
    );
  });

  it('leaves a color with a variable or a calculation for Lynx to drop', () => {
    for (const value of [
      'oklch(var(--l) 0.1 20)',
      'oklch(calc(50% + 1%) 0.1 20)',
      'oklch(50% 0.1)',
      'oklch(50% 0.1 20 30 40)',
      'oklch(50% 0.1 foo)',
      'hsl(0 0% 0% / var(--alpha))',
    ]) {
      expect(lowerColors(value)).toBe(value);
    }
  });

  describe('color-mix()', () => {
    it("turns Tailwind's opacity modifier into rgba()", () => {
      expect(lowerColors('color-mix(in srgb, #000 50%, transparent)')).toBe(
        'rgba(0, 0, 0, 0.5)',
      );
      expect(lowerColors('color-mix(in oklab, #fff 10%, transparent)')).toBe(
        'rgba(255, 255, 255, 0.1)',
      );
      expect(
        lowerColors(
          'color-mix(in srgb, oklch(63.7% 0.237 25.331) 50%, transparent)',
        ),
      ).toBe('rgba(251, 44, 54, 0.5)');
      expect(
        lowerColors(
          'color-mix(in oklch, oklch(63.7% 0.237 25.331) 60%, transparent)',
        ),
      ).toBe('rgba(251, 44, 54, 0.6)');
    });

    it('mixes two colors in each color space', () => {
      expect(lowerColors('color-mix(in srgb, red, blue)')).toBe(
        'rgb(128, 0, 128)',
      );
      expect(lowerColors('color-mix(in srgb, #f00, #00f)')).toBe(
        'rgb(128, 0, 128)',
      );
      expect(lowerColors('color-mix(in srgb-linear, #f00, #00f)')).toBe(
        'rgb(188, 0, 188)',
      );
      expect(lowerColors('color-mix(in oklab, #f00, #00f)')).toBe(
        'rgb(140, 83, 162)',
      );
      expect(lowerColors('color-mix(in oklch, #f00, #00f)')).toBe(
        'rgb(183, 0, 190)',
      );
      // The hue takes the shorter way round, either side of 0.
      expect(lowerColors('color-mix(in oklch shorter hue, #00f, #f00)')).toBe(
        'rgb(183, 0, 190)',
      );
      expect(lowerColors('color-mix(in oklch, #f0f, #ff0)')).toBe(
        'rgb(255, 174, 143)',
      );
      // Gray has no hue, so the mix takes the other color's.
      expect(lowerColors('color-mix(in oklch, #888, #f00)')).toBe(
        'rgb(202, 103, 89)',
      );
    });

    it('normalizes the percentages as CSS does', () => {
      // One percentage gives the other color the rest.
      expect(lowerColors('color-mix(in srgb, #000, #fff 25%)')).toBe(
        'rgb(64, 64, 64)',
      );
      expect(lowerColors('color-mix(in srgb, 25% #fff, #000)')).toBe(
        'rgb(64, 64, 64)',
      );
      // Two that add up to more than 100% are scaled down.
      expect(lowerColors('color-mix(in srgb, #000 100%, #fff 100%)')).toBe(
        'rgb(128, 128, 128)',
      );
      // Two that add up to less make the result translucent.
      expect(lowerColors('color-mix(in srgb, #000 20%, #fff 20%)')).toBe(
        'rgba(128, 128, 128, 0.4)',
      );
    });

    it('mixes alphas and leaves fully transparent mixes transparent', () => {
      expect(
        lowerColors(
          'color-mix(in srgb, rgb(0 0 0 / 0.5), rgba(255, 255, 255, 1))',
        ),
      ).toBe('rgba(170, 170, 170, 0.75)');
      expect(lowerColors('color-mix(in oklab, transparent, transparent)')).toBe(
        'rgba(0, 0, 0, 0)',
      );
    });

    it('mixes hex colors with an alpha, and channels outside 0–255', () => {
      expect(lowerColors('color-mix(in srgb, #00000080, #0008)')).toBe(
        'rgba(0, 0, 0, 0.5176)',
      );
      expect(lowerColors('color-mix(in oklab, rgb(-10 0 0) 50%, #000)')).toBe(
        'rgb(0, 0, 0)',
      );
    });

    it('mixes nested color-mix() calls', () => {
      expect(
        lowerColors(
          'color-mix(in oklab, color-mix(in oklab, #000 50%, transparent) 50%, transparent)',
        ),
      ).toBe('rgba(0, 0, 0, 0.25)');
    });

    it("leaves a mix it can't evaluate for Lynx to drop", () => {
      for (const value of [
        'color-mix(in oklab, var(--color-black) 50%, transparent)',
        'color-mix(in oklab, currentcolor 50%, transparent)',
        'color-mix(in oklab, constructor 50%, transparent)',
        'color-mix(in hsl, #000 50%, transparent)',
        'color-mix(in oklch longer hue, #000, #fff)',
        'color-mix(oklab, #000, #fff)',
        'color-mix(in oklab, #000, #fff, #f00)',
        'color-mix(in oklab, #000 0%, #fff 0%)',
        'color-mix(in oklab, #000 #fff, #f00)',
        'color-mix(in oklab, 10% 20%, #f00)',
        'color-mix(in oklab, #000 50% 50%, #f00)',
        'color-mix(in oklab, #ggg, #f00)',
        'color-mix(in oklab, rgb(0 0), #f00)',
        'color-mix(in oklab, foo(1 2 3), #f00)',
        'color-mix(in oklab, "red" 50%, #f00)',
      ]) {
        expect(lowerColors(value)).toBe(value);
      }
    });
  });

  describe('color-mix() of a variable with a channel variable', () => {
    const channels = new Set(['--primary']);

    it("writes Tailwind's opacity modifier as rgba() from the channels", () => {
      expect(
        lowerColors(
          'color-mix(in oklab, var(--primary) 50%, transparent)',
          channels,
        ),
      ).toBe('rgba(var(--primary-rgb), 0.5)');
      expect(
        lowerColors(
          'color-mix(in srgb, 20% var(--primary), transparent)',
          channels,
        ),
      ).toBe('rgba(var(--primary-rgb), 0.2)');
      expect(
        lowerColors(
          'color-mix(in srgb, var(--primary), transparent)',
          channels,
        ),
      ).toBe('rgba(var(--primary-rgb), 0.5)');
    });

    it('lowers the inner mix of a shadow color, leaving the outer one', () => {
      expect(
        lowerColors(
          'color-mix(in oklab, color-mix(in oklab, var(--primary) 20%, transparent) var(--tw-shadow-alpha), transparent)',
          channels,
        ),
      ).toBe(
        'color-mix(in oklab, rgba(var(--primary-rgb), 0.2) var(--tw-shadow-alpha), transparent)',
      );
    });

    it('leaves a mix without channels, or of anything else', () => {
      for (const value of [
        'color-mix(in oklab, var(--secondary) 50%, transparent)',
        'color-mix(in oklab, var(--primary, red) 50%, transparent)',
        'color-mix(in oklab, var(--primary) 50%, white)',
        'color-mix(in oklab, var(--primary) 50%, transparent 10%)',
        'color-mix(in oklab, var(--primary) 50% 10%, transparent)',
        'color-mix(in oklab, var(--primary) 2px, transparent)',
        'color-mix(in oklab, var(--primary) foo, transparent)',
        'color-mix(in oklab, 50%, transparent)',
        'color-mix(in oklab, var(--primary) 50%)',
      ]) {
        expect(lowerColors(value, channels)).toBe(value);
      }
    });
  });
});
