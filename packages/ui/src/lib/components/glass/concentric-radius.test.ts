import { describe, expect, it } from 'vitest';
import { concentricRadius } from './concentric-radius';

describe('concentricRadius', () => {
  it('takes the inset off the outer radius, so the corners share a center', () => {
    expect(concentricRadius(24, 8)).toBe(16);
    expect(concentricRadius(20, 0)).toBe(20);
  });

  it('gives square corners rather than a negative radius', () => {
    expect(concentricRadius(8, 12)).toBe(0);
  });
});
