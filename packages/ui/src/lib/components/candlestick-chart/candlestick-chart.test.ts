import { describe, expect, it, vi } from 'vitest';

// Mock Angular (and the transitively-loaded cartesian-chart Angular usage) so
// importing the module needs no framework runtime. Only the exported pure
// `computeCandles` is exercised; the components are never built.
vi.mock('@angular/core', () => ({
  Component: () => () => {},
  ViewEncapsulation: { None: 0 },
  computed: () => () => {},
  inject: () => ({}),
  input: () => () => {},
  output: () => () => {},
}));

vi.mock('@blotch/angular-lynx', () => ({
  LYNX_ELEMENTS: [],
  // cartesian-chart (imported transitively) registers these in its decorator.
  LynxGestureDetector: class {},
  PanGesture: class {},
  PinchGesture: class {},
  Gesture: { Simultaneous: () => ({}) },
}));

const { computeCandles } = await import('./candlestick-chart');

// A rising candle centered at cx=50. Screen y grows downward, so the projected
// highY (top of the wick) is the smallest pixel value and lowY the largest.
// close is above open (up), so closeY < openY in pixels.
const upCandle = {
  cx: 50,
  highY: 10, // high price → top of plot
  lowY: 90, // low price → bottom of plot
  openY: 70,
  closeY: 30,
  up: true,
};

describe('computeCandles', () => {
  it('draws the wick spanning high to low, centered on cx', () => {
    const [shape] = computeCandles([upCandle], 12);
    expect(shape.wick.top).toBe(10); // min(highY, lowY)
    expect(shape.wick.height).toBe(80); // |lowY - highY|
    expect(shape.wick.width).toBe(1); // default wickWidth
    // Centered: left = cx - wickWidth/2.
    expect(shape.wick.left).toBe(50 - 0.5);
  });

  it('draws the body between open and close, centered on cx', () => {
    const [shape] = computeCandles([upCandle], 12);
    expect(shape.body.top).toBe(30); // min(openY, closeY) — the higher price
    expect(shape.body.height).toBe(40); // |closeY - openY|
    expect(shape.body.width).toBe(12);
    expect(shape.body.left).toBe(50 - 6); // cx - bodyWidth/2
    expect(shape.up).toBe(true);
  });

  it('marks a falling candle as down and still tops the body at the higher price', () => {
    // close below open: closeY (pixels) is BELOW openY, i.e. larger.
    const downCandle = {
      cx: 20,
      highY: 5,
      lowY: 95,
      openY: 30,
      closeY: 60,
      up: false,
    };
    const [shape] = computeCandles([downCandle], 10);
    expect(shape.up).toBe(false);
    expect(shape.body.top).toBe(30); // min(openY, closeY) = openY here
    expect(shape.body.height).toBe(30);
  });

  it('clamps a doji (open === close) to the minimum body height', () => {
    const doji = {
      cx: 0,
      highY: 0,
      lowY: 100,
      openY: 50,
      closeY: 50,
      up: true,
    };
    // Zero-height body would be invisible; the floor keeps it a thin line.
    expect(computeCandles([doji], 12)[0].body.height).toBe(1);
    expect(computeCandles([doji], 12, 1, 3)[0].body.height).toBe(3);
  });

  it('honors a custom wick width', () => {
    const [shape] = computeCandles([upCandle], 12, 3);
    expect(shape.wick.width).toBe(3);
    expect(shape.wick.left).toBe(50 - 1.5);
  });

  it('returns an empty array for no candles', () => {
    expect(computeCandles([], 12)).toEqual([]);
  });
});
