// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawnScale } from './drawn-scale';

const drawn = (width: number, offsetWidth: number) => {
  const element = document.createElement('x-view');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width,
  } as DOMRect);
  vi.spyOn(element, 'offsetWidth', 'get').mockReturnValue(offsetWidth);
  return element;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('drawnScale', () => {
  it('is the drawn width over the laid-out width', () => {
    expect(drawnScale(drawn(180, 360))).toBe(0.5);
    expect(drawnScale(drawn(720, 360))).toBe(2);
  });

  it('is 1 when the difference is offsetWidth’s rounding', () => {
    expect(drawnScale(drawn(359.6, 360))).toBe(1);
    expect(drawnScale(drawn(360.4, 360))).toBe(1);
  });

  it('is 1 for an element that isn’t laid out', () => {
    expect(drawnScale(drawn(0, 0))).toBe(1);
  });
});
