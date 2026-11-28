// cspell:words currentcolor
import { describe, expect, it } from 'vitest';
import { FILTER_STEP, NO_FILTER, parseFilter } from './css-filter';

const { blur: BLUR, matrix: MATRIX, dropShadow: SHADOW } = FILTER_STEP;

/**
 * A color matrix applied to a color not premultiplied, as the shells do.
 */
const applyMatrix = (
  m: readonly number[],
  [r, g, b, a]: readonly number[],
): number[] => {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [0, 1, 2, 3].map((row) =>
    clamp(
      m[row * 5] * r +
        m[row * 5 + 1] * g +
        m[row * 5 + 2] * b +
        m[row * 5 + 3] * a +
        m[row * 5 + 4],
    ),
  );
};

/**
 * The one color matrix a filter string makes.
 */
const matrixOf = (value: string): number[] => {
  const filter = parseFilter(value);
  expect(filter?.steps[0]).toBe(MATRIX);
  expect(filter?.steps.length).toBe(21);
  return filter!.steps.slice(1) as number[];
};

const close = (actual: number[], expected: number[]) =>
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]));

describe('parseFilter', () => {
  it('takes none as no filter', () => {
    expect(parseFilter('none')).toBe(NO_FILTER);
    expect(parseFilter('  NONE ')).toBe(NO_FILTER);
    expect(NO_FILTER).toEqual({ steps: [] });
  });

  it('turns a blur into its deviation in pixels', () => {
    expect(parseFilter('blur(4px)')).toEqual({ steps: [BLUR, 4] });
    expect(parseFilter('blur()')).toEqual({ steps: [BLUR, 0] });
    expect(parseFilter('blur(0)')).toEqual({ steps: [BLUR, 0] });
    expect(parseFilter('blur(1em)')?.steps).toEqual([BLUR, 16]);
    expect(parseFilter('blur(1rem)')?.steps).toEqual([BLUR, 16]);
    expect(parseFilter('blur(3pt)')?.steps).toEqual([BLUR, 4]);
    expect(parseFilter('blur(1in)')?.steps).toEqual([BLUR, 96]);
    expect(parseFilter('blur(.5px)')?.steps).toEqual([BLUR, 0.5]);
    expect(parseFilter('blur(1e1px)')?.steps).toEqual([BLUR, 10]);
  });

  it('sends a huge blur whole, for the shells to fit their layers to', () => {
    expect(parseFilter('blur(500px)')).toEqual({ steps: [BLUR, 500] });
  });

  it('rejects a blur that isn’t a length that’s not negative', () => {
    for (const value of [
      'blur(-1px)',
      'blur(2)',
      'blur(50%)',
      'blur(2px 3px)',
      'blur(2vw)',
      'blur(px)',
    ]) {
      expect(parseFilter(value)).toBeNull();
    }
  });

  it('makes the color functions’ matrices as Filter Effects gives them', () => {
    const red = [1, 0, 0, 1];
    close(
      applyMatrix(matrixOf('grayscale(1)'), red),
      [0.2126, 0.2126, 0.2126, 1],
    );
    close(applyMatrix(matrixOf('grayscale(0)'), red), red);
    close(applyMatrix(matrixOf('sepia(1)'), red), [0.393, 0.349, 0.272, 1]);
    close(applyMatrix(matrixOf('sepia(0)'), red), red);
    close(applyMatrix(matrixOf('saturate(0)'), red), [0.213, 0.213, 0.213, 1]);
    close(applyMatrix(matrixOf('saturate(1)'), red), red);
    close(
      applyMatrix(matrixOf('invert(1)'), [0.25, 0.5, 1, 1]),
      [0.75, 0.5, 0, 1],
    );
    close(
      applyMatrix(matrixOf('invert(0.5)'), [0.25, 0.5, 1, 1]),
      [0.5, 0.5, 0.5, 1],
    );
    close(applyMatrix(matrixOf('opacity(0.25)'), red), [1, 0, 0, 0.25]);
    close(
      applyMatrix(matrixOf('brightness(0.5)'), [0.5, 1, 0, 1]),
      [0.25, 0.5, 0, 1],
    );
    close(
      applyMatrix(matrixOf('contrast(2)'), [0.25, 0.5, 0.75, 1]),
      [0, 0.5, 1, 1],
    );
    close(applyMatrix(matrixOf('contrast(0)'), red), [0.5, 0.5, 0.5, 1]);
  });

  it('turns hue-rotate()’s angle in any unit to radians', () => {
    const red = [1, 0, 0, 1];
    close(applyMatrix(matrixOf('hue-rotate(0deg)'), red), red);
    close(applyMatrix(matrixOf('hue-rotate(0)'), red), red);
    close(applyMatrix(matrixOf('hue-rotate()'), red), red);
    close(applyMatrix(matrixOf('hue-rotate(1turn)'), red), red);
    for (const angle of ['180deg', '200grad', `${Math.PI}rad`, '0.5turn']) {
      close(
        applyMatrix(matrixOf(`hue-rotate(${angle})`), red),
        applyMatrix(matrixOf('hue-rotate(-180deg)'), red),
      );
    }
    expect(parseFilter('hue-rotate(90)')).toBeNull();
    expect(parseFilter('hue-rotate(x)')).toBeNull();
    expect(parseFilter('hue-rotate(90px)')).toBeNull();
    expect(parseFilter('hue-rotate(1deg 2deg)')).toBeNull();
  });

  it('takes a number or a percentage, defaults to 1, and clamps the ones that stop at 100%', () => {
    expect(matrixOf('grayscale(50%)')).toEqual(matrixOf('grayscale(0.5)'));
    expect(matrixOf('grayscale()')).toEqual(matrixOf('grayscale(1)'));
    expect(matrixOf('brightness()')).toEqual(matrixOf('brightness(1)'));
    for (const name of ['grayscale', 'invert', 'opacity', 'sepia']) {
      expect(matrixOf(`${name}(250%)`)).toEqual(matrixOf(`${name}(1)`));
    }
    // brightness, contrast and saturate go past 1.
    close(
      applyMatrix(matrixOf('brightness(200%)'), [0.25, 0, 0, 1]),
      [0.5, 0, 0, 1],
    );
    for (const value of [
      'grayscale(-1)',
      'opacity(1px)',
      'saturate(1 2)',
      'sepia(x)',
    ]) {
      expect(parseFilter(value)).toBeNull();
    }
  });

  it('reads drop-shadow()’s offset, deviation and color, in either order', () => {
    expect(parseFilter('drop-shadow(2px 3px 4px red)')).toEqual({
      steps: [SHADOW, 2, 3, 4, 255, 0, 0, 1],
    });
    expect(parseFilter('drop-shadow(rgba(0, 0, 255, 0.5) -5px 1px)')).toEqual({
      steps: [SHADOW, -5, 1, 0, 0, 0, 255, 0.5],
    });
    // The canvas's currentcolor: black.
    expect(parseFilter('drop-shadow(1px 1px)')?.steps).toEqual([
      SHADOW,
      1,
      1,
      0,
      0,
      0,
      0,
      1,
    ]);
    for (const value of [
      'drop-shadow()',
      'drop-shadow(1px)',
      'drop-shadow(1px 2px 3px 4px)',
      'drop-shadow(1px 2px -3px)',
      'drop-shadow(1px red 2px)',
      'drop-shadow(red blue 1px 2px)',
      'drop-shadow(1px 2px nope)',
    ]) {
      expect(parseFilter(value)).toBeNull();
    }
  });

  it('takes any whitespace between the arguments', () => {
    expect(parseFilter('drop-shadow( 1px\n\t 2px )')?.steps).toEqual(
      parseFilter('drop-shadow(1px 2px)')?.steps,
    );
  });

  it('chains the functions in order, with or without spaces', () => {
    expect(parseFilter('blur(2px) drop-shadow(0 0 1px)grayscale(1)')).toEqual({
      steps: [
        BLUR,
        2,
        SHADOW,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        MATRIX,
        ...matrixOf('grayscale(1)'),
      ],
    });
  });

  it('takes url() but applies nothing, as no SVG filter is there to find', () => {
    expect(parseFilter('url(#shadow)')).toBe(NO_FILTER);
    expect(parseFilter('blur(2px) url(filters.svg#a)')).toBe(NO_FILTER);
  });

  it('rejects what isn’t a filter list', () => {
    for (const value of [
      '',
      '   ',
      'blur',
      'blur(2px',
      'nope(1)',
      'constructor()',
      'tostring(1)',
      'blur(1constructor)',
      'hue-rotate(1constructor)',
      'drop-shadow(1constructor 2px)',
      'blur(2px) none',
      'inherit',
      '2px',
      undefined,
      null,
    ]) {
      expect(parseFilter(value)).toBeNull();
    }
  });
});
