import { describe, expect, it } from 'vitest';
import {
  AT_REST,
  FADE_MOTION,
  IOS_MOTION,
  MATERIAL_MOTION,
  SQUARE,
  cornerStyle,
  lookStyles,
  mixLooks,
  screenCorners,
  shrunkCorners,
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

  describe('corners', () => {
    const screen = { width: 400, height: 800 };

    it('rounds every corner of an outlet filling the screen', () => {
      expect(
        screenCorners({ left: 0, top: 0, width: 400, height: 800 }, screen, 62),
      ).toEqual([62, 62, 62, 62]);
    });

    it('squares the corners away from the screen’s', () => {
      // Under an app bar.
      expect(
        screenCorners(
          { left: 0, top: 100, width: 400, height: 700 },
          screen,
          62,
        ),
      ).toEqual([0, 0, 62, 62]);
      // Over a tab bar, laid out a fraction of a pixel off.
      expect(
        screenCorners(
          { left: 0.3, top: 0, width: 399.4, height: 720 },
          screen,
          62,
        ),
      ).toEqual([62, 62, 0, 0]);
      // A detail pane on the right.
      expect(
        screenCorners(
          { left: 150, top: 0, width: 250, height: 800 },
          screen,
          62,
        ),
      ).toEqual([0, 62, 62, 0]);
    });

    it('squares every corner when where the outlet is isn’t known', () => {
      const box = { left: 0, top: 0, width: 400, height: 800 };
      expect(screenCorners({ ...box, width: 0 }, screen, 62)).toBe(SQUARE);
      expect(screenCorners({ ...box, height: 0 }, screen, 62)).toBe(SQUARE);
      expect(screenCorners(box, { width: 0, height: 800 }, 62)).toBe(SQUARE);
      expect(screenCorners(box, { width: 400, height: 0 }, 62)).toBe(SQUARE);
      expect(screenCorners(box, screen, 0)).toBe(SQUARE);
    });

    it('rounds the square corners as a page shrinks', () => {
      expect(shrunkCorners([0, 0, 28, 28], 28, 0)).toEqual([0, 0, 28, 28]);
      expect(shrunkCorners([0, 0, 28, 28], 28, 0.5)).toEqual([14, 14, 28, 28]);
      expect(shrunkCorners([0, 0, 28, 28], 28, 1)).toEqual([28, 28, 28, 28]);
    });

    it('writes corners as a border-radius', () => {
      expect(cornerStyle(SQUARE)).toBeNull();
      expect(cornerStyle([62, 62, 62, 62])).toBe('62px');
      expect(cornerStyle([0, 0, 62, 62])).toBe('0px 0px 62px 62px');
      expect(cornerStyle([1 / 3, 0, 0, 0])).toBe('0.33px 0px 0px 0px');
    });
  });
});
