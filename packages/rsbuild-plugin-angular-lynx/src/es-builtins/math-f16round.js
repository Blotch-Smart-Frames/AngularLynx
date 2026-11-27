import { definePolyfills } from './shared.js';

/**
 * Ties-to-even rounding of a non-negative number to an integer.
 */
const roundHalfEven = (value) => {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) return fraction < 0.5 ? floor : floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
};

definePolyfills(Math, {
  // ES2025 Math.f16round: the nearest half-precision float, ties to even.
  f16round(value) {
    const x = +value;
    if (x !== x || x === 0 || x === Infinity || x === -Infinity) return x;
    const magnitude = Math.abs(x);
    // A float16 has 10 fraction bits; below 2^-14 it's subnormal, with steps
    // of 2^-24. Math.log2 can be one off near a power of two.
    let exponent = Math.floor(Math.log2(magnitude));
    if (2 ** exponent > magnitude) exponent--;
    else if (2 ** (exponent + 1) <= magnitude) exponent++;
    const step = 2 ** (Math.max(exponent, -14) - 10);
    const rounded = roundHalfEven(magnitude / step) * step;
    // 65504 is the largest float16; anything that rounds above it overflows.
    const result = rounded > 65504 ? Infinity : rounded;
    return x < 0 ? -result : result;
  },
});
