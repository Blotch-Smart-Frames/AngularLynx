// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CssColor from './css-color';
import { TRANSPARENT } from './css-color';
import { pressOf, trackPress } from './glass-press';
import {
  containerShapes,
  cornerRadius,
  glassRole,
  readShape,
} from './glass-shapes';

vi.mock('./css-color', async (importOriginal) => ({
  ...(await importOriginal<typeof CssColor>()),
  // jsdom has no canvas to normalize colors with.
  resolveCssColor: (_doc: Document, value: string | null) =>
    value ? [1, 0, 0, 0.5] : [0, 0, 0, 0],
}));

const blurView = (effect?: string) => {
  const element = document.createElement('x-blur-view');
  if (effect) element.setAttribute('blur-effect', effect);
  return element;
};

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('glassRole', () => {
  it('tells containers, lone glass and container members apart', () => {
    const container = blurView('glass-container');
    const member = blurView('glass');
    container.appendChild(member);
    const parent = document.createElement('x-view');
    const standalone = blurView('glass');
    parent.appendChild(standalone);

    expect(glassRole(container)).toBe('container');
    expect(glassRole(member)).toBe('member');
    expect(glassRole(standalone)).toBe('standalone');
    // A detached element has no parent to merge into.
    expect(glassRole(blurView('glass'))).toBe('standalone');
  });

  it('ignores plain blur effects', () => {
    expect(glassRole(blurView('light'))).toBeNull();
    expect(glassRole(blurView())).toBeNull();
  });
});

describe('containerShapes', () => {
  it('returns only the direct glass children', () => {
    const container = blurView('glass-container');
    const first = blurView('glass');
    const nested = blurView('glass');
    const plain = document.createElement('x-view');
    plain.appendChild(nested);
    container.append(first, plain, blurView('light'));
    expect(containerShapes(container)).toEqual([first]);
  });
});

describe('cornerRadius', () => {
  it('reads pixels and percentages of the shorter side', () => {
    expect(cornerRadius('12px', 100, 40)).toBe(12);
    expect(cornerRadius('25%', 100, 40)).toBe(10);
  });

  it('clamps to a circle or pill', () => {
    expect(cornerRadius('9999px', 100, 40)).toBe(20);
  });

  it('treats an unreadable value as square', () => {
    expect(cornerRadius('', 100, 40)).toBe(0);
  });
});

describe('readShape', () => {
  const shape = (attributes: Record<string, string> = {}) => {
    const element = blurView('glass');
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.style.borderTopLeftRadius = '16px';
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      rect(30, 50, 100, 60),
    );
    return element;
  };

  it('measures the shape relative to the canvas origin', () => {
    expect(readShape(shape(), rect(10, 20, 300, 300), 1, 16, true)).toEqual({
      centerX: 70,
      centerY: 60,
      halfWidth: 50,
      halfHeight: 30,
      radius: 16,
      frost: 1,
      tint: TRANSPARENT,
      press: 0,
    });
  });

  it('measures in CSS pixels when the page is drawn scaled', () => {
    // Drawn at half size: the 100×60 shape is 200×120 CSS pixels, 40 and 60
    // CSS pixels from the canvas, and its 16px radius stays 16px.
    expect(readShape(shape(), rect(10, 20, 150, 150), 0.5, 16, true)).toEqual({
      centerX: 140,
      centerY: 120,
      halfWidth: 100,
      halfHeight: 60,
      radius: 16,
      frost: 1,
      tint: TRANSPARENT,
      press: 0,
    });
  });

  it('reads clear glass and its tint', () => {
    const result = readShape(
      shape({ 'glass-style': 'clear', 'glass-tint-color': 'red' }),
      rect(0, 0, 300, 300),
      1,
      16,
      true,
    );
    expect(result.frost).toBe(0);
    expect(result.tint).toEqual([1, 0, 0, 0.5]);
  });

  it('swells a pressed shape only when it may grow', () => {
    const element = shape({ 'glass-interactive': 'true' });
    trackPress(element);
    pressOf(element)!.value = 1;
    pressOf(element)!.target = 1;

    const grown = readShape(element, rect(0, 0, 300, 300), 1, 0, true);
    expect(grown.press).toBe(1);
    expect(grown.halfWidth).toBeCloseTo(53);
    expect(grown.radius).toBeCloseTo(16.96);

    const kept = readShape(element, rect(0, 0, 300, 300), 1, 0, false);
    expect(kept.halfWidth).toBe(50);
  });
});
