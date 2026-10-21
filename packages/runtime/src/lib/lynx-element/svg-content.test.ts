import { describe, expect, it } from 'vitest';
import { normalizeDashArray, sanitizeSvgContent } from './svg-content';

describe('normalizeDashArray', () => {
  it('keeps bare numbers, space- or comma-separated', () => {
    expect(normalizeDashArray('4 2')).toBe('4 2');
    expect(normalizeDashArray(' 4, 2 ,1.5 ')).toBe('4 2 1.5');
    expect(normalizeDashArray('.5 -1 +2 1e1')).toBe('.5 -1 +2 1e1');
  });

  it('turns px lengths into user units', () => {
    expect(normalizeDashArray('4px 2PX')).toBe('4 2');
  });

  it('rejects anything ServalSVG would loop forever on', () => {
    for (const value of ['none', 'inherit', '10%', '1em 2em', '4 auto', '']) {
      expect(normalizeDashArray(value)).toBeNull();
    }
  });
});

describe('sanitizeSvgContent', () => {
  it('returns content without a dash array untouched', () => {
    const icon = '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>';
    expect(sanitizeSvgContent(icon)).toBe(icon);
  });

  it("drops a stroke-dasharray attribute the engine can't parse", () => {
    expect(
      sanitizeSvgContent(
        `<svg><rect fill="red" stroke-dasharray="none"/><path stroke-dasharray = 'inherit' d="M0 0"/></svg>`,
      ),
    ).toBe(`<svg><rect fill="red"/><path d="M0 0"/></svg>`);
  });

  it('normalizes a parseable one', () => {
    expect(
      sanitizeSvgContent(`<svg><path stroke-dasharray="4px, 2px"/></svg>`),
    ).toBe(`<svg><path stroke-dasharray="4 2"/></svg>`);
  });

  it('rewrites declarations inside an inline style', () => {
    expect(
      sanitizeSvgContent(
        `<svg><path style="stroke-dasharray:4px 2px"/><path style="fill:red;stroke-dasharray: none;stroke:blue"/></svg>`,
      ),
    ).toBe(
      `<svg><path style="stroke-dasharray:4 2;"/><path style="fill:red;stroke:blue"/></svg>`,
    );
  });
});
