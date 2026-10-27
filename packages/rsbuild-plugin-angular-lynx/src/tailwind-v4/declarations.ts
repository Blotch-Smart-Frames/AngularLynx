import type { Declaration, Root, Rule } from 'postcss';
import valueParser from 'postcss-value-parser';

import { clampHugeNumbers, foldCalc } from './calc.js';
import { lowerColors } from './colors.js';
import { LYNX_KEYWORDS, LYNX_PROPERTIES } from './lynx-properties.js';

/**
 * Rewrites the declarations Tailwind CSS 4 writes into ones Lynx reads. Each
 * rewrite keeps what the declaration means on the web, so the web preview
 * and the native app keep matching.
 */

/**
 * The single `transform` the `translate-*`, `rotate-*`, `scale-*`, `skew-*`
 * and `rotate-{x,y,z}-*` utilities all write, composed from the variables
 * each of them sets.
 *
 * Tailwind 4 writes the `translate`, `rotate` and `scale` properties, which
 * Lynx doesn't have, so the utilities would do nothing on device. Lynx's own
 * Tailwind 3 preset composes the same way. The order is the one CSS applies
 * the individual properties in: translate, rotate, scale, then `transform`.
 */
export const COMPOSED_TRANSFORM = [
  'translate3d(var(--tw-translate-x), var(--tw-translate-y), var(--tw-translate-z))',
  'rotate(var(--tw-rotate))',
  'scale(var(--tw-scale-x), var(--tw-scale-y))',
  'var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)',
].join(' ');

/**
 * The starting values of the variables {@link COMPOSED_TRANSFORM} reads that
 * must be set for it to parse. The others have empty fallbacks.
 */
export const TRANSFORM_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ['--tw-translate-x', '0'],
  ['--tw-translate-y', '0'],
  ['--tw-translate-z', '0'],
  ['--tw-rotate', '0deg'],
  ['--tw-scale-x', '1'],
  ['--tw-scale-y', '1'],
]);

/** What lowering a rule's declarations found, for the defaults rule. */
export type LoweredRule = {
  /** Whether the rule now writes {@link COMPOSED_TRANSFORM}. */
  readonly composesTransform: boolean;
};

/**
 * Lowers every declaration of one rule. Works on the rule as a whole because
 * the transform properties collapse into one declaration. `channelVariables`
 * are the colors the stylesheet gives a `-rgb` channel variable (see
 * colors.ts).
 */
export const lowerDeclarations = (
  rule: Rule,
  channelVariables: ReadonlySet<string> = new Set(),
): LoweredRule => {
  const composed: Declaration[] = [];
  // A copy: the loop inserts and removes declarations as it goes.
  for (const declaration of rule.nodes.slice()) {
    if (declaration.type !== 'decl') {
      continue;
    }
    declaration.value = lowerColors(declaration.value, channelVariables);
    if (lowerTransformProperty(declaration)) {
      composed.push(declaration);
      continue;
    }
    lowerValue(declaration);
    expandLogical(declaration);
  }
  if (composed.length > 0) {
    composed[composed.length - 1]!.before({
      prop: 'transform',
      value: COMPOSED_TRANSFORM,
    });
    for (const declaration of composed) {
      declaration.remove();
    }
  }
  dropUnsupportedProperties(rule);
  return { composesTransform: composed.length > 0 };
};

const TRANSFORM_VARIABLES =
  /^--tw-(?:translate-[xyz]|rotate(?:-[xyz])?|skew-[xy]|scale-[xyz])$/;

/**
 * Lowers the values of the transform variables, once the variables in them
 * are resolved (see variables.ts): `calc(0.25rem * 2)` folds to `0.5rem`.
 */
export const lowerTransformVariables = (root: Root): void => {
  root.walkDecls(TRANSFORM_VARIABLES, (declaration) => {
    declaration.value = transformValue(declaration.prop, declaration.value);
  });
};

/**
 * Turns `translate`, `rotate` and `scale`, and the `transform` Tailwind
 * composes for `rotate-x-*` and `skew-*`, into the variables that
 * {@link COMPOSED_TRANSFORM} reads. Returns whether the declaration is now
 * part of it, so the caller replaces it.
 */
const lowerTransformProperty = (declaration: Declaration): boolean => {
  const { prop } = declaration;
  const values = splitSpaces(declaration.value);
  switch (prop) {
    case 'translate':
      if (!isTailwindComposition(values, '--tw-translate-')) {
        const [x, y = '0', z = '0'] =
          values[0] === 'none' ? ['0', '0', '0'] : values;
        setVariables(declaration, {
          '--tw-translate-x': x,
          '--tw-translate-y': y,
          '--tw-translate-z': z,
        });
      }
      break;
    case 'rotate':
      if (values.length !== 1) {
        // An axis rotation (`rotate: x 45deg`) has no Lynx equivalent here.
        return false;
      }
      setVariables(declaration, {
        '--tw-rotate': values[0] === 'none' ? '0deg' : values[0]!,
      });
      break;
    case 'scale':
      if (!isTailwindComposition(values, '--tw-scale-')) {
        const [x, y = x] = values[0] === 'none' ? ['1', '1'] : values;
        setVariables(declaration, {
          '--tw-scale-x': x!,
          '--tw-scale-y': y!,
        });
      }
      break;
    case 'transform':
      if (!isTailwindComposition(values, '--tw-')) {
        return false;
      }
      break;
    default:
      return false;
  }
  return true;
};

/**
 * Whether every term of a value is a `var()` of one of Tailwind's own variables.
 */
const isTailwindComposition = (values: string[], prefix: string): boolean =>
  values.length > 0 &&
  values.every((value) => value.startsWith(`var(${prefix}`));

/**
 * Sets transform variables before `declaration`, lowering their values.
 */
const setVariables = (
  declaration: Declaration,
  variables: Record<string, string>,
): void => {
  for (const [prop, value] of Object.entries(variables)) {
    declaration.before({ prop, value: transformValue(prop, value) });
  }
};

/**
 * Folds the `calc()` Tailwind writes for negative and fractional values, and
 * turns a scale percentage into the number `scale()` takes on Lynx.
 */
const transformValue = (prop: string, value: string): string => {
  const folded = foldCalc(value);
  if (!prop.startsWith('--tw-scale-')) {
    return folded;
  }
  const unit = valueParser.unit(folded);
  return unit && unit.unit === '%' ? String(Number(unit.number) / 100) : folded;
};

/**
 * Splits a value on its top-level spaces, keeping functions whole.
 */
const splitSpaces = (value: string): string[] =>
  valueParser(value)
    .nodes.filter((node) => node.type !== 'space' && node.type !== 'comment')
    .map((node) => valueParser.stringify(node));

/**
 * Lowers a value that Lynx reads differently from the web.
 */
const lowerValue = (declaration: Declaration): void => {
  switch (declaration.prop) {
    case 'opacity': {
      // Lynx ignores a percentage opacity (`opacity-50` is `opacity: 50%`).
      const unit = valueParser.unit(declaration.value);
      if (unit && unit.unit === '%') {
        declaration.value = String(Number(unit.number) / 100);
      }
      break;
    }
    case 'text-decoration-line':
      // Lynx only has the `text-decoration` shorthand.
      declaration.prop = 'text-decoration';
      break;
    case 'transition-property':
      declaration.value = lowerTransitionProperty(declaration.value);
      break;
    case '--tw-gradient-position':
      declaration.value = lowerGradientPosition(declaration);
      break;
    default:
      // `rounded-full` is `calc(infinity * 1px)`, or `3.40282e38px` once
      // Tailwind has minified it.
      if (/\binfinity\b/i.test(declaration.value)) {
        declaration.value = foldCalc(declaration.value);
      }
      declaration.value = clampHugeNumbers(declaration.value);
      break;
  }
};

/**
 * Transitions `transform` in place of `translate`, `rotate` and `scale`,
 * which the composed transform replaces, and leaves out what Lynx can't
 * transition: properties it doesn't have, and Tailwind's custom properties.
 * `none` when nothing is left.
 */
const lowerTransitionProperty = (value: string): string => {
  const properties = value
    .split(',')
    .map((property) => {
      const name = property.trim().toLowerCase();
      return ['translate', 'rotate', 'scale'].includes(name)
        ? 'transform'
        : name;
    })
    .filter(
      (name) => name === 'all' || name === 'none' || LYNX_PROPERTIES.has(name),
    );
  return [...new Set(properties)].join(', ') || 'none';
};

/**
 * Drops the color interpolation method (`in oklab`) from a gradient's
 * position: Lynx's gradients don't take one, and drop the whole gradient.
 * Tailwind writes one alone for `bg-radial` and `bg-conic`, which leaves the
 * position empty, so it becomes the gradient's default shape or angle.
 */
const lowerGradientPosition = (declaration: Declaration): string => {
  const position = declaration.value
    .replace(
      /\s*\bin\s+[a-z0-9-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?/gi,
      '',
    )
    .trim();
  if (position) {
    return position;
  }
  let gradient = 'linear';
  declaration.parent?.walkDecls('background-image', ({ value }) => {
    gradient = /^(radial|conic)-gradient\(/.exec(value)?.[1] ?? gradient;
  });
  return { linear: 'to bottom', radial: 'ellipse', conic: 'from 0deg' }[
    gradient
  ]!;
};

/**
 * The logical properties Tailwind writes, with the physical ones they stand
 * for in left-to-right text. A pair takes one or two values (start, end); a
 * box (`inset`) takes one to four.
 *
 * Lynx drops the logical shorthands (`padding-inline`, which every `px-*`
 * writes), and on device it ignores the longhands it does list
 * (`margin-inline-start`), so `px-4` and `ms-2` did nothing.
 */
const LOGICAL_PAIRS: Record<string, readonly [string, string]> = {
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'inset-inline': ['left', 'right'],
  'inset-block': ['top', 'bottom'],
  'border-inline-width': ['border-left-width', 'border-right-width'],
  'border-block-width': ['border-top-width', 'border-bottom-width'],
  'border-inline-style': ['border-left-style', 'border-right-style'],
  'border-block-style': ['border-top-style', 'border-bottom-style'],
  'border-inline-color': ['border-left-color', 'border-right-color'],
  'border-block-color': ['border-top-color', 'border-bottom-color'],
};

/** Logical shorthands that set both sides to their whole value. */
const LOGICAL_BOTH_SIDES: Record<string, readonly [string, string]> = {
  'border-inline': ['border-left', 'border-right'],
  'border-block': ['border-top', 'border-bottom'],
};

/** Logical longhands, each standing for one physical property. */
const LOGICAL_LONGHANDS: Record<string, string> = {
  'padding-inline-start': 'padding-left',
  'padding-inline-end': 'padding-right',
  'padding-block-start': 'padding-top',
  'padding-block-end': 'padding-bottom',
  'margin-inline-start': 'margin-left',
  'margin-inline-end': 'margin-right',
  'margin-block-start': 'margin-top',
  'margin-block-end': 'margin-bottom',
  'inset-inline-start': 'left',
  'inset-inline-end': 'right',
  'inset-block-start': 'top',
  'inset-block-end': 'bottom',
  'border-inline-start': 'border-left',
  'border-inline-end': 'border-right',
  'border-block-start': 'border-top',
  'border-block-end': 'border-bottom',
  'border-inline-start-width': 'border-left-width',
  'border-inline-end-width': 'border-right-width',
  'border-block-start-width': 'border-top-width',
  'border-block-end-width': 'border-bottom-width',
  'border-inline-start-style': 'border-left-style',
  'border-inline-end-style': 'border-right-style',
  'border-block-start-style': 'border-top-style',
  'border-block-end-style': 'border-bottom-style',
  'border-inline-start-color': 'border-left-color',
  'border-inline-end-color': 'border-right-color',
  'border-block-start-color': 'border-top-color',
  'border-block-end-color': 'border-bottom-color',
  'border-start-start-radius': 'border-top-left-radius',
  'border-start-end-radius': 'border-top-right-radius',
  'border-end-start-radius': 'border-bottom-left-radius',
  'border-end-end-radius': 'border-bottom-right-radius',
};

/**
 * Rewrites a logical property, and the `inset` shorthand, as physical ones.
 */
const expandLogical = (declaration: Declaration): void => {
  const { prop, value, important } = declaration;
  const longhand = LOGICAL_LONGHANDS[prop];
  if (longhand) {
    declaration.prop = longhand;
    return;
  }
  let expanded: [string, string][] | undefined;
  const pair = LOGICAL_PAIRS[prop];
  const bothSides = LOGICAL_BOTH_SIDES[prop];
  if (pair) {
    const [start, end = start] = splitSpaces(value);
    expanded = [
      [pair[0], start!],
      [pair[1], end!],
    ];
  } else if (bothSides) {
    expanded = [
      [bothSides[0], value],
      [bothSides[1], value],
    ];
  } else if (prop === 'inset') {
    // Lynx has no `inset` shorthand (every `inset-*` utility writes it).
    const [top, right = top, bottom = top, left = right] = splitSpaces(value);
    expanded = [
      ['top', top!],
      ['right', right!],
      ['bottom', bottom!],
      ['left', left!],
    ];
  }
  if (!expanded) {
    return;
  }
  for (const [physical, physicalValue] of expanded) {
    declaration.before({ prop: physical, value: physicalValue, important });
  }
  declaration.remove();
};

/**
 * Removes the declarations of properties Lynx doesn't have, and of keywords
 * it doesn't take (see lynx-properties.ts), so the web preview doesn't show
 * them either. A keyword other than these, such as `inherit`, or a value with
 * a `var()`, stays.
 */
const dropUnsupportedProperties = (rule: Rule): void => {
  rule.each((node) => {
    if (node.type !== 'decl' || node.prop.startsWith('--')) {
      return;
    }
    const prop = node.prop.toLowerCase();
    const keywords = LYNX_KEYWORDS.get(prop);
    const value = node.value.trim().toLowerCase();
    if (
      !LYNX_PROPERTIES.has(prop) ||
      (keywords !== undefined &&
        /^[a-z-]+$/.test(value) &&
        !GLOBAL_KEYWORDS.has(value) &&
        !keywords.has(value))
    ) {
      node.remove();
    }
  });
};

const GLOBAL_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert']);
