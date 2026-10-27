import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

import {
  COMPOSED_TRANSFORM,
  lowerDeclarations,
  lowerTransformVariables,
} from './declarations';

/**
 * Lowers the declarations of one rule and lists them.
 */
const lower = (declarations: string) => {
  const rule = postcss.parse(`.a { ${declarations}; }`).first as Rule;
  const { composesTransform } = lowerDeclarations(rule);
  return {
    composesTransform,
    declarations: rule.nodes.map((node) => node.toString()),
  };
};

const declarationsOf = (declarations: string) =>
  lower(declarations).declarations;

describe('lowerDeclarations', () => {
  it('lowers colors in every declaration, custom properties too', () => {
    expect(
      declarationsOf(
        'color: oklch(0% 0 0); --tw-shadow-color: color-mix(in srgb, #000 50%, transparent)',
      ),
    ).toEqual(['color: rgb(0, 0, 0)', '--tw-shadow-color: rgba(0, 0, 0, 0.5)']);
  });

  it('turns a percentage opacity into a number', () => {
    expect(declarationsOf('opacity: 50%')).toEqual(['opacity: 0.5']);
    expect(declarationsOf('opacity: 0.8')).toEqual(['opacity: 0.8']);
    expect(declarationsOf('opacity: var(--o)')).toEqual(['opacity: var(--o)']);
  });

  it('writes text-decoration-line as the text-decoration shorthand', () => {
    expect(declarationsOf('text-decoration-line: underline')).toEqual([
      'text-decoration: underline',
    ]);
  });

  it("drops the properties Lynx doesn't have, but not custom properties", () => {
    expect(
      declarationsOf(
        'text-transform: uppercase; -webkit-line-clamp: 2; --tw-x: 1; overflow: hidden',
      ),
    ).toEqual(['--tw-x: 1', 'overflow: hidden']);
  });

  it("drops the keywords Lynx doesn't take, keeping variables and global keywords", () => {
    expect(
      declarationsOf(
        'display: inline; position: static; white-space: pre-wrap; display: flex; position: STICKY; display: var(--d); display: inherit; text-align: justify',
      ),
    ).toEqual([
      'display: flex',
      'position: STICKY',
      'display: var(--d)',
      'display: inherit',
      'text-align: justify',
    ]);
  });

  it("transitions only what Lynx can, with transform in place of Tailwind's translate, rotate and scale", () => {
    expect(
      declarationsOf(
        'transition-property: color, opacity, transform, translate, scale, rotate, fill, --tw-gradient-from, backdrop-filter',
      ),
    ).toEqual(['transition-property: color, opacity, transform']);
    expect(declarationsOf('transition-property: all')).toEqual([
      'transition-property: all',
    ]);
    expect(declarationsOf('transition-property: fill, stroke')).toEqual([
      'transition-property: none',
    ]);
  });

  it('folds infinity and huge numbers, as rounded-full writes them', () => {
    expect(declarationsOf('border-radius: calc(infinity * 1px)')).toEqual([
      'border-radius: 9999px',
    ]);
    expect(declarationsOf('border-radius: 3.40282e38px')).toEqual([
      'border-radius: 9999px',
    ]);
  });

  describe('gradients', () => {
    it("drops the interpolation method Lynx's gradients don't take", () => {
      expect(
        declarationsOf(
          '--tw-gradient-position: to right in oklab; background-image: linear-gradient(var(--tw-gradient-stops))',
        ),
      ).toEqual([
        '--tw-gradient-position: to right',
        'background-image: linear-gradient(var(--tw-gradient-stops))',
      ]);
      expect(
        declarationsOf('--tw-gradient-position: 45deg in oklch longer hue'),
      ).toEqual(['--tw-gradient-position: 45deg']);
    });

    it('gives a gradient with no other position its default shape or angle', () => {
      expect(
        declarationsOf(
          '--tw-gradient-position: in oklab; background-image: radial-gradient(var(--tw-gradient-stops))',
        ),
      ).toContain('--tw-gradient-position: ellipse');
      expect(
        declarationsOf(
          '--tw-gradient-position: in oklab; background-image: conic-gradient(var(--tw-gradient-stops))',
        ),
      ).toContain('--tw-gradient-position: from 0deg');
      expect(
        declarationsOf(
          '--tw-gradient-position: in oklab; background-image: linear-gradient(var(--tw-gradient-stops))',
        ),
      ).toContain('--tw-gradient-position: to bottom');
      expect(declarationsOf('--tw-gradient-position: in oklab')).toEqual([
        '--tw-gradient-position: to bottom',
      ]);
    });
  });

  describe('logical properties', () => {
    it('writes the pairs Tailwind uses as their physical sides', () => {
      expect(
        declarationsOf(
          'padding-inline: 1rem; margin-block: 2px 4px; inset-inline: 0; border-block-width: 1px; border-inline-style: var(--tw-border-style)',
        ),
      ).toEqual([
        'padding-left: 1rem',
        'padding-right: 1rem',
        'margin-top: 2px',
        'margin-bottom: 4px',
        'left: 0',
        'right: 0',
        'border-top-width: 1px',
        'border-bottom-width: 1px',
        'border-left-style: var(--tw-border-style)',
        'border-right-style: var(--tw-border-style)',
      ]);
    });

    it('writes a calc() side as one value', () => {
      expect(
        declarationsOf('padding-block: calc(var(--spacing) * 2) !important'),
      ).toEqual([
        'padding-top: calc(var(--spacing) * 2) !important',
        'padding-bottom: calc(var(--spacing) * 2) !important',
      ]);
    });

    it('writes the logical longhands and corners as physical ones', () => {
      expect(
        declarationsOf(
          'margin-inline-start: 1px; padding-inline-end: 2px; inset-inline-start: 3px; border-inline-start-width: 4px; border-start-end-radius: 5px; border-end-start-radius: 6px',
        ),
      ).toEqual([
        'margin-left: 1px',
        'padding-right: 2px',
        'left: 3px',
        'border-left-width: 4px',
        'border-top-right-radius: 5px',
        'border-bottom-left-radius: 6px',
      ]);
    });

    it('gives both sides the whole border-inline shorthand', () => {
      expect(declarationsOf('border-block: 1px solid red')).toEqual([
        'border-top: 1px solid red',
        'border-bottom: 1px solid red',
      ]);
    });

    it('expands inset into top, right, bottom and left', () => {
      expect(declarationsOf('inset: 0px')).toEqual([
        'top: 0px',
        'right: 0px',
        'bottom: 0px',
        'left: 0px',
      ]);
      expect(declarationsOf('inset: 1px 2px 3px 4px')).toEqual([
        'top: 1px',
        'right: 2px',
        'bottom: 3px',
        'left: 4px',
      ]);
      expect(declarationsOf('inset: 1px 2px')).toEqual([
        'top: 1px',
        'right: 2px',
        'bottom: 1px',
        'left: 2px',
      ]);
    });
  });

  describe('transforms', () => {
    it("composes Tailwind's translate, rotate and scale into one transform", () => {
      expect(
        lower(
          '--tw-translate-x: 1rem; translate: var(--tw-translate-x) var(--tw-translate-y)',
        ),
      ).toEqual({
        composesTransform: true,
        declarations: [
          '--tw-translate-x: 1rem',
          `transform: ${COMPOSED_TRANSFORM}`,
        ],
      });
      expect(
        declarationsOf(
          '--tw-scale-x: 95%; scale: var(--tw-scale-x) var(--tw-scale-y)',
        ),
      ).toEqual(['--tw-scale-x: 95%', `transform: ${COMPOSED_TRANSFORM}`]);
    });

    it('sets the variables for rotate and the none values', () => {
      expect(declarationsOf('rotate: calc(45deg * -1)')).toEqual([
        '--tw-rotate: -45deg',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
      expect(declarationsOf('rotate: none')).toEqual([
        '--tw-rotate: 0deg',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
      expect(declarationsOf('translate: none')).toEqual([
        '--tw-translate-x: 0',
        '--tw-translate-y: 0',
        '--tw-translate-z: 0',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
      expect(declarationsOf('scale: none')).toEqual([
        '--tw-scale-x: 1',
        '--tw-scale-y: 1',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
    });

    it('sets the variables from arbitrary values', () => {
      expect(declarationsOf('translate: 10px')).toEqual([
        '--tw-translate-x: 10px',
        '--tw-translate-y: 0',
        '--tw-translate-z: 0',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
      expect(declarationsOf('translate: 1px 2px 3px')).toEqual([
        '--tw-translate-x: 1px',
        '--tw-translate-y: 2px',
        '--tw-translate-z: 3px',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
      expect(declarationsOf('scale: 50% 2')).toEqual([
        '--tw-scale-x: 0.5',
        '--tw-scale-y: 2',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
      expect(declarationsOf('scale: 1.5')).toEqual([
        '--tw-scale-x: 1.5',
        '--tw-scale-y: 1.5',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
    });

    it("joins rotate-x and skew's composed transform", () => {
      expect(
        declarationsOf(
          '--tw-skew-x: skewX(12deg); transform: var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)',
        ),
      ).toEqual([
        '--tw-skew-x: skewX(12deg)',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
    });

    it('writes the composed transform once, where the last part was', () => {
      expect(
        declarationsOf(
          'rotate: 45deg; color: red; scale: var(--tw-scale-x) var(--tw-scale-y)',
        ),
      ).toEqual([
        '--tw-rotate: 45deg',
        'color: red',
        `transform: ${COMPOSED_TRANSFORM}`,
      ]);
    });

    it('leaves a raw transform and an axis rotation alone', () => {
      expect(lower('transform: rotate(5deg)')).toEqual({
        composesTransform: false,
        declarations: ['transform: rotate(5deg)'],
      });
      expect(declarationsOf('transform: none')).toEqual(['transform: none']);
      // `rotate: x 45deg` has no Lynx property to become, so it's dropped.
      expect(declarationsOf('rotate: x 45deg')).toEqual([]);
    });
  });

  it('skips comments', () => {
    expect(declarationsOf('/* c */ opacity: 50%')).toEqual([
      '/* c */',
      'opacity: 0.5',
    ]);
  });
});

describe('lowerTransformVariables', () => {
  it("folds the transform variables' values once their variables are resolved", () => {
    const root = postcss.parse(
      '.a { --tw-translate-x: calc(0.25rem * 2); --tw-scale-x: calc(50% * -1); --tw-rotate-x: rotateX(calc(45deg * -1)); --tw-other: calc(1px * 2); }',
    );
    lowerTransformVariables(root);
    expect((root.first as Rule).nodes.map(String)).toEqual([
      '--tw-translate-x: 0.5rem',
      '--tw-scale-x: -0.5',
      '--tw-rotate-x: rotateX(-45deg)',
      '--tw-other: calc(1px * 2)',
    ]);
  });
});
