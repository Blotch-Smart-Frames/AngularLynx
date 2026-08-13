import { describe, expect, it } from 'vitest';
import { PanGesture } from './pan-gesture';
import { GestureType } from './types';

describe('PanGesture', () => {
  it('has type GestureType.PAN', () => {
    expect(new PanGesture().type).toBe(GestureType.PAN);
  });

  it('seeds a default config (enabled + minDistance)', () => {
    expect(new PanGesture()._config).toEqual({
      enabled: true,
      minDistance: 0,
    });
  });

  describe('minDistance()', () => {
    it('sets the minDistance config value', () => {
      const g = new PanGesture();

      g.minDistance(5);

      expect(g._config['minDistance']).toBe(5);
    });

    it('returns this for chaining', () => {
      expect(new PanGesture().minDistance(5)).toBeInstanceOf(PanGesture);
    });
  });

  describe('activeOffsetX()', () => {
    it('sets activeOffsetX to a scalar', () => {
      const g = new PanGesture();

      g.activeOffsetX(10);

      expect(g._config['activeOffsetX']).toBe(10);
    });

    it('sets activeOffsetX to a range tuple', () => {
      const g = new PanGesture();

      g.activeOffsetX([-10, 10]);

      expect(g._config['activeOffsetX']).toEqual([-10, 10]);
    });

    it('returns this for chaining', () => {
      expect(new PanGesture().activeOffsetX(10)).toBeInstanceOf(PanGesture);
    });
  });

  describe('activeOffsetY()', () => {
    it('sets activeOffsetY to a scalar', () => {
      const g = new PanGesture();

      g.activeOffsetY(10);

      expect(g._config['activeOffsetY']).toBe(10);
    });

    it('sets activeOffsetY to a range tuple', () => {
      const g = new PanGesture();

      g.activeOffsetY([-10, 10]);

      expect(g._config['activeOffsetY']).toEqual([-10, 10]);
    });

    it('returns this for chaining', () => {
      expect(new PanGesture().activeOffsetY(10)).toBeInstanceOf(PanGesture);
    });
  });

  describe('failOffsetX()', () => {
    it('sets failOffsetX to a scalar', () => {
      const g = new PanGesture();

      g.failOffsetX(20);

      expect(g._config['failOffsetX']).toBe(20);
    });

    it('sets failOffsetX to a range tuple', () => {
      const g = new PanGesture();

      g.failOffsetX([-20, 20]);

      expect(g._config['failOffsetX']).toEqual([-20, 20]);
    });

    it('returns this for chaining', () => {
      expect(new PanGesture().failOffsetX(20)).toBeInstanceOf(PanGesture);
    });
  });

  describe('failOffsetY()', () => {
    it('sets failOffsetY to a scalar', () => {
      const g = new PanGesture();

      g.failOffsetY(20);

      expect(g._config['failOffsetY']).toBe(20);
    });

    it('sets failOffsetY to a range tuple', () => {
      const g = new PanGesture();

      g.failOffsetY([-20, 20]);

      expect(g._config['failOffsetY']).toEqual([-20, 20]);
    });

    it('returns this for chaining', () => {
      expect(new PanGesture().failOffsetY(20)).toBeInstanceOf(PanGesture);
    });
  });

  describe('minPointers()', () => {
    it('sets the minPointers config value', () => {
      const g = new PanGesture();

      g.minPointers(1);

      expect(g._config['minPointers']).toBe(1);
    });

    it('returns this for chaining', () => {
      expect(new PanGesture().minPointers(1)).toBeInstanceOf(PanGesture);
    });
  });

  describe('maxPointers()', () => {
    it('sets the maxPointers config value', () => {
      const g = new PanGesture();

      g.maxPointers(2);

      expect(g._config['maxPointers']).toBe(2);
    });

    it('returns this for chaining', () => {
      expect(new PanGesture().maxPointers(2)).toBeInstanceOf(PanGesture);
    });
  });

  it('supports fluent chaining of all config methods', () => {
    const g = new PanGesture();

    const result = g
      .minDistance(5)
      .activeOffsetX(10)
      .activeOffsetY(10)
      .failOffsetX(20)
      .failOffsetY(20)
      .minPointers(1)
      .maxPointers(2);

    expect(result).toBe(g);
    expect(g._config).toEqual({
      enabled: true,
      minDistance: 5,
      activeOffsetX: 10,
      activeOffsetY: 10,
      failOffsetX: 20,
      failOffsetY: 20,
      minPointers: 1,
      maxPointers: 2,
    });
  });

  it('inherits onUpdate from ContinuousGesture', () => {
    const g = new PanGesture();
    const cb = () => {};

    g.onUpdate(cb);

    expect(g._callbacks['onUpdate']).toBe(cb);
  });
});
