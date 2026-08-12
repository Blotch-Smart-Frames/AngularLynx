import { describe, expect, it } from 'vitest';
import { FlingGesture } from './fling-gesture';
import { FlingDirection, GestureType } from './types';

describe('FlingGesture', () => {
  it('has type GestureType.FLING', () => {
    expect(new FlingGesture().type).toBe(GestureType.FLING);
  });

  describe('direction()', () => {
    it('sets the direction config value', () => {
      const g = new FlingGesture();

      g.direction(FlingDirection.RIGHT);

      expect(g._config['direction']).toBe(FlingDirection.RIGHT);
    });

    it('accepts any FlingDirection value', () => {
      const cases: [FlingDirection, number][] = [
        [FlingDirection.RIGHT, 1],
        [FlingDirection.LEFT, 2],
        [FlingDirection.UP, 4],
        [FlingDirection.DOWN, 8],
      ];

      for (const [dir, expected] of cases) {
        const g = new FlingGesture();
        g.direction(dir);
        expect(g._config['direction']).toBe(expected);
      }
    });

    it('returns this for chaining', () => {
      expect(new FlingGesture().direction(FlingDirection.UP)).toBeInstanceOf(
        FlingGesture,
      );
    });
  });

  describe('numberOfPointers()', () => {
    it('sets the numberOfPointers config value', () => {
      const g = new FlingGesture();

      g.numberOfPointers(2);

      expect(g._config['numberOfPointers']).toBe(2);
    });

    it('returns this for chaining', () => {
      expect(new FlingGesture().numberOfPointers(1)).toBeInstanceOf(
        FlingGesture,
      );
    });
  });

  it('supports fluent chaining', () => {
    const g = new FlingGesture();

    const result = g.direction(FlingDirection.LEFT).numberOfPointers(1);

    expect(result).toBe(g);
    expect(g._config).toEqual({
      direction: FlingDirection.LEFT,
      numberOfPointers: 1,
    });
  });

  it('inherits onUpdate from ContinuousGesture', () => {
    const g = new FlingGesture();
    const cb = () => {};

    g.onUpdate(cb);

    expect(g._callbacks['onUpdate']).toBe(cb);
  });
});
