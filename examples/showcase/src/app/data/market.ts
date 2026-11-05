import type { Gem } from './gems';
import { seedOf, seeded } from './random';

export type Point = { readonly x: number; readonly y: number };

export type Candle = {
  readonly x: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

/** Ten years of months, the longest range the market shows. */
export const MONTHS = 120;

/**
 * Illustrative: a price-per-carat series for a stone, a random walk with a
 * gentle upward drift around its reference price. The same seed gives the
 * same series on every launch.
 */
export const priceSeries = (gem: Gem): readonly Point[] => {
  const random = seeded(seedOf(`price-${gem.id}`));
  const points: Point[] = [];
  // Walk backwards from today's price so the series ends at the reference.
  let price = gem.pricePerCarat;
  for (let month = MONTHS - 1; month >= 0; month--) {
    points[month] = { x: month, y: Math.round(price) };
    const drift = -0.0035;
    const shock = (random() - 0.5) * 0.06;
    price = price * (1 + drift + shock);
  }
  return points;
};

/**
 * Illustrative: 26 weeks of rough prices, as a dealer's candlestick sheet.
 */
export const roughCandles = (gem: Gem): readonly Candle[] => {
  const random = seeded(seedOf(`rough-${gem.id}`));
  const candles: Candle[] = [];
  // Rough sells at a fraction of the cut price per carat.
  let close = gem.pricePerCarat * 0.22;
  for (let week = 0; week < 26; week++) {
    const open = close;
    const move = (random() - 0.48) * 0.09;
    close = open * (1 + move);
    const high = Math.max(open, close) * (1 + random() * 0.03);
    const low = Math.min(open, close) * (1 - random() * 0.03);
    candles.push({
      x: week,
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(close),
    });
  }
  return candles;
};
