// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pressOf, stepPress, trackPress, type PressState } from './glass-press';

const pointer = (type: string, clientX = 0, clientY = 0) =>
  new MouseEvent(type, { clientX, clientY });

const tracked = (interactive: boolean) => {
  const element = document.createElement('x-blur-view');
  if (interactive) element.setAttribute('glass-interactive', 'true');
  trackPress(element);
  return { element, state: pressOf(element)! };
};

describe('trackPress', () => {
  it('starts every element at rest', () => {
    expect(tracked(true).state).toEqual({ target: 0, value: 0, x: 0, y: 0 });
  });

  it('ignores presses on glass that is not interactive', () => {
    const { element, state } = tracked(false);
    element.dispatchEvent(pointer('pointerdown', 10, 20));
    expect(state.target).toBe(0);
  });

  it('follows a press on interactive glass until it is released', () => {
    const { element, state } = tracked(true);
    element.dispatchEvent(pointer('pointerdown', 10, 20));
    expect(state).toMatchObject({ target: 1, x: 10, y: 20 });

    element.dispatchEvent(pointer('pointermove', 30, 40));
    expect(state).toMatchObject({ x: 30, y: 40 });

    element.dispatchEvent(pointer('pointerup'));
    expect(state.target).toBe(0);
    // Moves after release no longer move the glow.
    element.dispatchEvent(pointer('pointermove', 50, 60));
    expect(state).toMatchObject({ x: 30, y: 40 });
  });

  it.each(['pointercancel', 'pointerleave'])('releases on %s', (type) => {
    const { element, state } = tracked(true);
    element.dispatchEvent(pointer('pointerdown'));
    element.dispatchEvent(pointer(type));
    expect(state.target).toBe(0);
  });

  it('knows nothing about elements it does not track', () => {
    expect(pressOf(document.createElement('div'))).toBeUndefined();
  });
});

describe('stepPress', () => {
  const state = (target: number, value: number): PressState => ({
    target,
    value,
    x: 0,
    y: 0,
  });

  it('eases toward a press faster than back from it', () => {
    const pressing = state(1, 0);
    const releasing = state(0, 1);
    stepPress(pressing, 16);
    stepPress(releasing, 16);
    expect(pressing.value).toBeGreaterThan(1 - releasing.value);
  });

  it('snaps to the target once the difference is invisible', () => {
    const pressing = state(1, 0);
    expect(stepPress(pressing, 10_000)).toBe(1);
    expect(stepPress(state(0, 0.0005), 0)).toBe(0);
  });
});
