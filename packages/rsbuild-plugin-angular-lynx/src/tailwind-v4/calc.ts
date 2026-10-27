import valueParser, { type Node } from 'postcss-value-parser';

/** A number with its CSS unit (`''` for a plain number). */
type Dimension = {
  readonly value: number;
  readonly unit: string;
};

/**
 * Folds every `calc()` in a value whose terms are all constants, such as the
 * `calc(45deg * -1)` and `calc(calc(1 / 2 * 100%) * -1)` Tailwind writes for
 * negative and fractional transforms, into a single value (`-45deg`, `-50%`).
 *
 * Lynx evaluates `calc()` in lengths, but not everywhere a transform function
 * takes an angle, a number or a percentage, so the transform values are
 * folded before they reach it. A `calc()` with `var()` or mixed units stays
 * as it is. So does `infinity`, which Lynx doesn't read.
 */
export const foldCalc = (value: string): string => {
  if (!value.includes('calc(')) {
    return value;
  }
  const parsed = valueParser(value);
  foldNodes(parsed.nodes);
  return parsed.toString();
};

const foldNodes = (nodes: Node[]): void => {
  for (const node of nodes) {
    if (node.type !== 'function') {
      continue;
    }
    const folded =
      node.value.toLowerCase() === 'calc' ? evaluate(node.nodes) : undefined;
    if (folded) {
      Object.assign(node, { type: 'word', value: formatDimension(folded) });
    } else {
      foldNodes(node.nodes);
    }
  }
};

/**
 * What `infinity` folds to, and what a number too large for Lynx becomes. Tailwind 4 writes `rounded-full` as
 * `calc(infinity * 1px)`, which Lynx doesn't parse; Tailwind 3 wrote 9999px.
 */
const INFINITY_VALUE = 9999;

const formatDimension = ({ value, unit }: Dimension): string =>
  `${Number(value.toFixed(6))}${unit}`;

type Token = Dimension | '+' | '-' | '*' | '/';

/**
 * Evaluates a `calc()` body: `+`, `-`, `*` and `/` over numbers, one unit
 * and nested `calc()` or parentheses. Returns `undefined` for anything else.
 */
const evaluate = (nodes: Node[]): Dimension | undefined => {
  const tokens = tokenize(nodes);
  if (!tokens) {
    return undefined;
  }
  let position = 0;
  const peek = () => tokens[position];

  const factor = (): Dimension | undefined => {
    const token = tokens[position++];
    return typeof token === 'object' ? token : undefined;
  };

  const term = (): Dimension | undefined => {
    let left = factor();
    while (left && (peek() === '*' || peek() === '/')) {
      const operator = tokens[position++];
      const right = factor();
      left =
        right &&
        (operator === '*' ? multiply(left, right) : divide(left, right));
    }
    return left;
  };

  const expression = (): Dimension | undefined => {
    let left = term();
    while (left && (peek() === '+' || peek() === '-')) {
      const operator = tokens[position++];
      const right = term();
      left = right && add(left, operator === '-' ? negate(right) : right);
    }
    return left;
  };

  const result = expression();
  return position === tokens.length ? result : undefined;
};

/**
 * Flattens a `calc()` body into numbers and operators, evaluating groups.
 * Inside `calc()`, valueParser reads each operator as a word of its own.
 */
const tokenize = (nodes: Node[]): Token[] | undefined => {
  const tokens: Token[] = [];
  for (const node of nodes) {
    if (node.type === 'space' || node.type === 'comment') {
      continue;
    }
    if (node.type === 'function') {
      // A nested `calc()` or a bare parenthesized group.
      const name = node.value.toLowerCase();
      const group =
        name === 'calc' || name === '' ? evaluate(node.nodes) : undefined;
      if (!group) {
        return undefined;
      }
      tokens.push(group);
      continue;
    }
    if (node.type !== 'word') {
      return undefined;
    }
    if (['+', '-', '*', '/'].includes(node.value)) {
      tokens.push(node.value as Token);
      continue;
    }
    if (/^-?infinity$/i.test(node.value)) {
      tokens.push({
        value: node.value.startsWith('-') ? -INFINITY_VALUE : INFINITY_VALUE,
        unit: '',
      });
      continue;
    }
    const unit = valueParser.unit(node.value);
    if (!unit) {
      return undefined;
    }
    tokens.push({ value: Number(unit.number), unit: unit.unit.toLowerCase() });
  }
  return tokens;
};

const negate = ({ value, unit }: Dimension): Dimension => ({
  value: -value,
  unit,
});

const add = (a: Dimension, b: Dimension): Dimension | undefined =>
  a.unit === b.unit ? { value: a.value + b.value, unit: a.unit } : undefined;

const multiply = (a: Dimension, b: Dimension): Dimension | undefined => {
  if (a.unit && b.unit) {
    return undefined;
  }
  return { value: a.value * b.value, unit: a.unit || b.unit };
};

const divide = (a: Dimension, b: Dimension): Dimension | undefined =>
  b.unit || b.value === 0
    ? undefined
    : { value: a.value / b.value, unit: a.unit };

/**
 * Replaces a number written with an exponent of 7 or more, with the stand-in
 * for `infinity`. In a production build Tailwind minifies with Lightning CSS,
 * which folds `rounded-full`'s `calc(infinity * 1px)` to the largest float,
 * `3.40282e38px`, and Lynx doesn't read an exponent.
 */
export const clampHugeNumbers = (value: string): string =>
  value.replace(
    /(-?)\d*\.?\d+e\+?(\d+)([a-z%]*)/gi,
    (match: string, sign: string, exponent: string, unit: string) =>
      Number(exponent) >= 7 ? `${sign}${INFINITY_VALUE}${unit}` : match,
  );
