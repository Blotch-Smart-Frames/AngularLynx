import { describe, expect, it } from 'vitest';
import { ComposedGesture, Gesture } from './composition';
import { TapGesture } from './tap-gesture';
import { PanGesture } from './pan-gesture';
import { PinchGesture } from './pinch-gesture';

describe('ComposedGesture', () => {
  it('stores gestures and compositionType', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();
    const composed = new ComposedGesture([g1, g2], 'race');

    expect(composed.gestures).toEqual([g1, g2]);
    expect(composed.compositionType).toBe('race');
  });
});

describe('Gesture.Simultaneous', () => {
  it('returns a ComposedGesture with compositionType "simultaneous"', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    const result = Gesture.Simultaneous(g1, g2);

    expect(result).toBeInstanceOf(ComposedGesture);
    expect(result.compositionType).toBe('simultaneous');
  });

  it('includes all gestures in the result', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    const result = Gesture.Simultaneous(g1, g2);

    expect(result.gestures).toEqual([g1, g2]);
  });

  it('adds each gesture to the simultaneousWith list of every other gesture', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();
    const g3 = new PinchGesture();

    Gesture.Simultaneous(g1, g2, g3);

    expect(g1._simultaneousWith).toEqual(expect.arrayContaining([g2, g3]));
    expect(g2._simultaneousWith).toEqual(expect.arrayContaining([g1, g3]));
    expect(g3._simultaneousWith).toEqual(expect.arrayContaining([g1, g2]));
  });

  it('does not add a gesture to its own simultaneousWith list', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    Gesture.Simultaneous(g1, g2);

    expect(g1._simultaneousWith).not.toContain(g1);
    expect(g2._simultaneousWith).not.toContain(g2);
  });

  it('works with a single gesture without throwing', () => {
    const g = new TapGesture();

    const result = Gesture.Simultaneous(g);

    expect(result.gestures).toEqual([g]);
    expect(g._simultaneousWith).toEqual([]);
  });
});

describe('Gesture.Exclusive', () => {
  it('returns a ComposedGesture with compositionType "exclusive"', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    const result = Gesture.Exclusive(g1, g2);

    expect(result).toBeInstanceOf(ComposedGesture);
    expect(result.compositionType).toBe('exclusive');
  });

  it('includes all gestures in the result', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    const result = Gesture.Exclusive(g1, g2);

    expect(result.gestures).toEqual([g1, g2]);
  });

  it('makes each gesture wait for all preceding gestures', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();
    const g3 = new PinchGesture();

    Gesture.Exclusive(g1, g2, g3);

    // g1 (index 0) waits for nothing
    expect(g1._waitFor).toEqual([]);
    // g2 (index 1) waits for g1
    expect(g2._waitFor).toEqual([g1]);
    // g3 (index 2) waits for g1 and g2
    expect(g3._waitFor).toEqual(expect.arrayContaining([g1, g2]));
  });

  it('does not set waitFor on the first gesture', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    Gesture.Exclusive(g1, g2);

    expect(g1._waitFor).toEqual([]);
  });

  it('works with a single gesture without throwing', () => {
    const g = new TapGesture();

    const result = Gesture.Exclusive(g);

    expect(result.gestures).toEqual([g]);
    expect(g._waitFor).toEqual([]);
  });
});

describe('Gesture.Race', () => {
  it('returns a ComposedGesture with compositionType "race"', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    const result = Gesture.Race(g1, g2);

    expect(result).toBeInstanceOf(ComposedGesture);
    expect(result.compositionType).toBe('race');
  });

  it('includes all gestures in the result', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    const result = Gesture.Race(g1, g2);

    expect(result.gestures).toEqual([g1, g2]);
  });

  it('does not set any relation dependencies between gestures', () => {
    const g1 = new TapGesture();
    const g2 = new PanGesture();

    Gesture.Race(g1, g2);

    expect(g1._waitFor).toEqual([]);
    expect(g1._simultaneousWith).toEqual([]);
    expect(g2._waitFor).toEqual([]);
    expect(g2._simultaneousWith).toEqual([]);
  });
});
