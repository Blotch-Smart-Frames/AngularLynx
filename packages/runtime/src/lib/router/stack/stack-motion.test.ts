import { describe, expect, it } from 'vitest';
import {
  AT_REST,
  FADE_MOTION,
  IOS_MOTION,
  MATERIAL_MOTION,
  lookStyles,
  mixLooks,
} from './stack-motion';

describe('stack motion', () => {
  it("drags iOS's page with the finger, and Material's shrinks it", () => {
    expect(IOS_MOTION.dragged(0.5)).toEqual({ x: 0.5, scale: 1, opacity: 1 });
    expect(MATERIAL_MOTION.dragged(1)).toEqual({
      x: 0.05,
      scale: 0.9,
      opacity: 1,
    });
  });

  it('cross-fades in place for Reduce Motion', () => {
    expect(FADE_MOTION.covered).toEqual(AT_REST);
    expect(FADE_MOTION.offscreen).toEqual({ x: 0, scale: 1, opacity: 0 });
  });

  it('mixes two looks', () => {
    expect(
      mixLooks(
        { x: -0.3, scale: 1, opacity: 1 },
        { x: 0, scale: 0.5, opacity: 0 },
        0.5,
      ),
    ).toEqual({ x: -0.15, scale: 0.75, opacity: 0.5 });
  });

  it('writes a look in px for a known width', () => {
    expect(lookStyles({ x: -0.3, scale: 1, opacity: 1 }, 402)).toEqual({
      transform: 'translateX(-120.6px)',
      opacity: '1',
    });
    expect(lookStyles({ x: 0.05, scale: 0.9, opacity: 0.5 }, 400)).toEqual({
      transform: 'translateX(20px) scale(0.9)',
      opacity: '0.5',
    });
  });

  it("writes a look in % before the outlet's width is known", () => {
    expect(lookStyles({ x: 1, scale: 1, opacity: 1 }, 0)).toEqual({
      transform: 'translateX(100%)',
      opacity: '1',
    });
  });
});
