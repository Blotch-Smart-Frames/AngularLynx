import { describe, expect, it } from 'vitest';
import { computeLineSegments } from './line-chart';

describe('computeLineSegments', () => {
  it('produces a horizontal segment (angle 0)', () => {
    const segments = computeLineSegments([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].x).toBe(0);
    expect(segments[0].y).toBe(10);
    expect(segments[0].length).toBeCloseTo(100);
    expect(segments[0].angle).toBeCloseTo(0);
  });

  it('measures a vertical segment as 90 degrees (screen y-down)', () => {
    const segments = computeLineSegments([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ]);
    expect(segments[0].length).toBeCloseTo(50);
    expect(segments[0].angle).toBeCloseTo(90);
  });

  it('measures a 45-degree diagonal', () => {
    const segments = computeLineSegments([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(segments[0].length).toBeCloseTo(Math.sqrt(200));
    expect(segments[0].angle).toBeCloseTo(45);
  });

  it('emits one segment per consecutive pair', () => {
    const segments = computeLineSegments([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
    expect(segments).toHaveLength(2);
  });

  it('skips zero-length (duplicate) points', () => {
    const segments = computeLineSegments([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].x).toBe(5);
    expect(segments[0].length).toBeCloseTo(5);
  });

  it('returns no segments for fewer than two points', () => {
    expect(computeLineSegments([])).toEqual([]);
    expect(computeLineSegments([{ x: 1, y: 1 }])).toEqual([]);
  });
});
