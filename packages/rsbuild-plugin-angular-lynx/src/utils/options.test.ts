import { describe, expect, it } from 'vitest';
import {
  deprecatedOptionsIn,
  inheritsFontSize,
  inheritsMoreThanFontSize,
  normalizeOptions,
} from './options';

describe('normalizeOptions', () => {
  it('returns all required defaults when called with no args', () => {
    const result = normalizeOptions();

    expect(result.debugInfoOutside).toBe(true);
    expect(result.enableA11y).toBe(true);
    expect(result.enableAccessibilityElement).toBe(false);
    expect(result.enableCSSInheritance).toBe(true);
    expect(result.enableCSSInvalidation).toBe(true);
    expect(result.enableCSSSelector).toBe(true);
    expect(result.enableNewGesture).toBe(true);
    expect(result.defaultDisplayLinear).toBe(true);
    expect(result.enableRemoveCSSScope).toBe(false);
    expect(result.targetSdkVersion).toBe('3.2');
    expect(result.defaultOverflowVisible).toBe(true);
    expect(result.removeDescendantSelectorScope).toBe(false);
    expect(result.experimental_isLazyBundle).toBe(false);
    expect(result.preferredFps).toBe('high');
  });

  // A <text> with no size of its own takes its parent's, as on the web, and
  // nothing else inherits (issue #685).
  it('inherits only font-size by default', () => {
    const result = normalizeOptions();

    expect(result.customCSSInheritanceList).toEqual(['font-size']);
    expect(inheritsFontSize(result)).toBe(true);
  });

  // An app that turns inheritance on itself asked for Lynx's whole list, as
  // the option always meant.
  it("inherits Lynx's whole list when the app turns inheritance on without one", () => {
    const result = normalizeOptions({ enableCSSInheritance: true });

    expect(result.enableCSSInheritance).toBe(true);
    expect(result.customCSSInheritanceList).toBeUndefined();
    expect(inheritsFontSize(result)).toBe(true);
  });

  it('inherits nothing when the app turns inheritance off', () => {
    const result = normalizeOptions({ enableCSSInheritance: false });

    expect(inheritsFontSize(result)).toBe(false);
  });

  it("tells whether an app's own list passes font-size down", () => {
    expect(
      inheritsFontSize(
        normalizeOptions({ customCSSInheritanceList: ['color'] }),
      ),
    ).toBe(false);
    // An empty list is Lynx's own, which has font-size.
    expect(
      inheritsFontSize(normalizeOptions({ customCSSInheritanceList: [] })),
    ).toBe(true);
  });

  it('tells whether more than font-size inherits', () => {
    expect(inheritsMoreThanFontSize(normalizeOptions())).toBe(false);
    expect(
      inheritsMoreThanFontSize(
        normalizeOptions({ enableCSSInheritance: true }),
      ),
    ).toBe(true);
    expect(
      inheritsMoreThanFontSize(
        normalizeOptions({ customCSSInheritanceList: ['color'] }),
      ),
    ).toBe(true);
    expect(
      inheritsMoreThanFontSize(
        normalizeOptions({
          enableCSSInheritance: false,
          customCSSInheritanceList: ['color'],
        }),
      ),
    ).toBe(false);
  });

  it('partial overrides merge correctly', () => {
    const result = normalizeOptions({
      enableA11y: false,
      defaultOverflowVisible: false,
    });

    expect(result.enableA11y).toBe(false);
    expect(result.defaultOverflowVisible).toBe(false);
    // other defaults remain
    expect(result.debugInfoOutside).toBe(true);
    expect(result.enableCSSSelector).toBe(true);
  });

  it('supplied customCSSInheritanceList passes through', () => {
    const list = ['color', 'font-size'];
    const result = normalizeOptions({ customCSSInheritanceList: list });

    expect(result.customCSSInheritanceList).toEqual(['color', 'font-size']);
  });

  it('leaves out the deprecated options, with or without defaults', () => {
    const defaults = normalizeOptions();
    const set = normalizeOptions({
      enableICU: true,
      enableParallelElement: true,
      pipelineSchedulerConfig: 0x00010000,
    });

    for (const result of [defaults, set]) {
      expect(result).not.toHaveProperty('enableICU');
      expect(result).not.toHaveProperty('enableParallelElement');
      expect(result).not.toHaveProperty('pipelineSchedulerConfig');
    }
  });

  it("doesn't change the options it's given", () => {
    const options = { enableICU: true };

    normalizeOptions(options);

    expect(options).toEqual({ enableICU: true });
  });
});

describe('deprecatedOptionsIn', () => {
  it('names each deprecated option that is set, even to a falsy value', () => {
    expect(
      deprecatedOptionsIn({
        enableICU: false,
        enableParallelElement: true,
        pipelineSchedulerConfig: 0,
        enableA11y: false,
      }),
    ).toEqual([
      'enableICU',
      'enableParallelElement',
      'pipelineSchedulerConfig',
    ]);
  });

  it('is empty without options or deprecated ones', () => {
    expect(deprecatedOptionsIn()).toEqual([]);
    expect(deprecatedOptionsIn({ enableA11y: false })).toEqual([]);
  });
});
