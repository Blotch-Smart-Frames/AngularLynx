import { describe, expect, it } from 'vitest';
import { TapGesture } from './tap-gesture';
import { GestureType } from './types';

describe('TapGesture', () => {
  it('has type GestureType.TAP', () => {
    expect(new TapGesture().type).toBe(GestureType.TAP);
  });

  it('seeds a full default config so partial configs never zero native keys', () => {
    // iOS reads absent config keys as 0 once any config is present, so every
    // key must always be sent. See ./const.
    expect(new TapGesture()._config).toEqual({
      enabled: true,
      maxDuration: 500,
      maxDistance: 10,
    });
  });

  describe('numberOfTaps()', () => {
    it('sets the numberOfTaps config value', () => {
      const g = new TapGesture();

      g.numberOfTaps(2);

      expect(g._config['numberOfTaps']).toBe(2);
    });

    it('returns this for chaining', () => {
      const g = new TapGesture();

      expect(g.numberOfTaps(1)).toBe(g);
    });
  });

  describe('maxDuration()', () => {
    it('sets the maxDuration config value in milliseconds', () => {
      const g = new TapGesture();

      g.maxDuration(300);

      expect(g._config['maxDuration']).toBe(300);
    });

    it('returns this for chaining', () => {
      const g = new TapGesture();

      expect(g.maxDuration(300)).toBe(g);
    });
  });

  describe('maxDistance()', () => {
    it('sets the maxDistance config value in pixels', () => {
      const g = new TapGesture();

      g.maxDistance(10);

      expect(g._config['maxDistance']).toBe(10);
    });

    it('returns this for chaining', () => {
      const g = new TapGesture();

      expect(g.maxDistance(10)).toBe(g);
    });
  });

  it('supports fluent chaining of all config methods', () => {
    const g = new TapGesture();

    const result = g.numberOfTaps(2).maxDuration(500).maxDistance(20);

    expect(result).toBe(g);
    expect(g._config).toEqual({
      enabled: true,
      numberOfTaps: 2,
      maxDuration: 500,
      maxDistance: 20,
    });
  });
});
