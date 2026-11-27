import { definePolyfills } from './shared.js';

// ES2026 Math.sumPrecise: the exact sum, rounded once. `partials` hold the
// running sum exactly, as non-overlapping doubles, smallest first, the way
// Python's exact float sum does; `overflow` counts the 2^1024s that partial
// sums overflowed by, as the proposal's reference polyfill does.
const MAX_ULP = 2 ** 971;
const twoSum = (x, y) => {
  // Needs |x| >= |y|. `low` is what rounding `x + y` to `high` lost.
  const high = x + y;
  return { high, low: y - (high - x) };
};
const sumPartials = (partials, overflow) => {
  let n = partials.length - 1;
  let high = 0;
  let low = 0;
  if (overflow !== 0) {
    const next = n >= 0 ? partials[n] : 0;
    n--;
    if (
      Math.abs(overflow) > 1 ||
      (overflow > 0 && next > 0) ||
      (overflow < 0 && next < 0)
    ) {
      return overflow > 0 ? Infinity : -Infinity;
    }
    // Halved so the arithmetic doesn't overflow.
    ({ high, low } = twoSum(overflow * 2 ** 1023, next / 2));
    low *= 2;
    if (Math.abs(2 * high) === Infinity) {
      // Half an ulp short of 2^1024 rounds to Infinity (ties go to the even
      // neighbor, and Number.MAX_VALUE is odd), unless the next partial pulls
      // it down.
      if (high > 0) {
        return high === 2 ** 1023 &&
          low === -(MAX_ULP / 2) &&
          n >= 0 &&
          partials[n] < 0
          ? Number.MAX_VALUE
          : Infinity;
      }
      return high === -(2 ** 1023) &&
        low === MAX_ULP / 2 &&
        n >= 0 &&
        partials[n] > 0
        ? -Number.MAX_VALUE
        : -Infinity;
    }
    if (low !== 0) {
      partials[++n] = low;
      low = 0;
    }
    high *= 2;
  }
  // Add the partials from the largest until one doesn't fit exactly.
  while (n >= 0) {
    ({ high, low } = twoSum(high, partials[n--]));
    if (low !== 0) break;
  }
  // A remainder of exactly half an ulp rounds to even, unless the next
  // partial has the same sign and so tips it the other way.
  if (
    n >= 0 &&
    ((low < 0 && partials[n] < 0) || (low > 0 && partials[n] > 0))
  ) {
    const y = low * 2;
    const x = high + y;
    if (y === x - high) high = x;
  }
  return high;
};

definePolyfills(Math, {
  sumPrecise(items) {
    if (items == null) throw new TypeError('Expected an iterable of numbers');
    const partials = [];
    let overflow = 0;
    // NaN or an infinity once one turns up (both infinities make NaN), and
    // whether every number so far was -0, which sums to -0.
    let special = 0;
    let onlyMinusZero = true;
    for (const value of items) {
      if (typeof value !== 'number') {
        throw new TypeError('Math.sumPrecise expects only numbers');
      }
      if (special !== special) continue;
      if (value !== value) {
        special = NaN;
      } else if (value === Infinity || value === -Infinity) {
        special = special === -value ? NaN : value;
      } else if (special === 0 && !Object.is(value, -0)) {
        onlyMinusZero = false;
        let x = value;
        let used = 0;
        for (let index = 0; index < partials.length; index++) {
          let y = partials[index];
          if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
          let { high, low } = twoSum(x, y);
          if (Math.abs(high) === Infinity) {
            const sign = high > 0 ? 1 : -1;
            overflow += sign;
            x = x - sign * 2 ** 1023 - sign * 2 ** 1023;
            if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
            ({ high, low } = twoSum(x, y));
          }
          if (low !== 0) partials[used++] = low;
          x = high;
        }
        partials.length = used;
        if (x !== 0) partials.push(x);
      }
    }
    if (special !== 0) return special;
    return onlyMinusZero ? -0 : sumPartials(partials, overflow);
  },
});
