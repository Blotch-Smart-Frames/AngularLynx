/**
 * Lynx drops a length whose `calc()` has another `calc()` inside it, and the
 * property falls back as if it weren't set: its evaluator
 * (`TryMakeCalcNLength` in Lynx core's renderer/css/css_style_utils.cc) skips
 * the outer `calc` and reads the rest term by term, so it takes the inner
 * `calc` for a length. Parentheses it reads as a group, and they mean the
 * same, so an inline style's nested `calc()`s are written as parentheses:
 * `calc(calc(100% - 16px) / 2)` becomes `calc((100% - 16px) / 2)`.
 *
 * The build plugin does the same to stylesheets
 * (`packages/rsbuild-plugin-angular-lynx/src/nested-calc.ts`), where
 * Tailwind 4 nests them; this one is for inline styles, which reach the
 * runtime as they're written.
 */

/** Two `calc(`s, so one may be inside the other. */
const TWO_CALCS = /calc\([\s\S]*calc\(/i;

/** A `calc(` that starts a function name, not the end of a longer one. */
const CALC_AT = /calc\(/iy;

const NAME_CHAR = /[\w-]/;

/**
 * `value` with each `calc()` inside another `calc()` written as a bare group.
 * Works on a whole `style="..."` as on one value. Anything that isn't a
 * string, or has no nested `calc()`, is returned as it is.
 */
export const withFlatCalc = <T>(value: T): T => {
  if (typeof value !== 'string' || !TWO_CALCS.test(value)) return value;
  let result = '';
  // For each open parenthesis, whether it opened a calc() (kept or not).
  const opened: boolean[] = [];
  let calcDepth = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (char === ')') {
      if (opened.pop()) calcDepth--;
    } else if (char === '(') {
      opened.push(false);
    } else if (
      (char === 'c' || char === 'C') &&
      !NAME_CHAR.test(value[i - 1] ?? '')
    ) {
      CALC_AT.lastIndex = i;
      if (CALC_AT.test(value)) {
        // Inside another calc(), the name goes and the group stays.
        if (calcDepth === 0) result += value.slice(i, i + 4);
        result += '(';
        opened.push(true);
        calcDepth++;
        i += 4;
        continue;
      }
    }
    result += char;
  }
  return result as T;
};
