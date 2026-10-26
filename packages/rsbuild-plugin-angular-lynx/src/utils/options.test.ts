import { describe, expect, it } from 'vitest';
import { deprecatedOptionsIn, normalizeOptions } from './options';

describe('normalizeOptions', () => {
  it('returns all required defaults when called with no args', () => {
    const result = normalizeOptions();

    expect(result.debugInfoOutside).toBe(true);
    expect(result.enableA11y).toBe(true);
    expect(result.enableAccessibilityElement).toBe(false);
    expect(result.enableCSSInheritance).toBe(false);
    expect(result.enableCSSInvalidation).toBe(false);
    expect(result.enableCSSSelector).toBe(true);
    expect(result.enableNewGesture).toBe(true);
    expect(result.defaultDisplayLinear).toBe(true);
    expect(result.enableRemoveCSSScope).toBe(false);
    expect(result.targetSdkVersion).toBe('3.2');
    expect(result.defaultOverflowVisible).toBe(true);
    expect(result.removeDescendantSelectorScope).toBe(false);
    expect(result.experimental_isLazyBundle).toBe(false);
  });

  it('customCSSInheritanceList defaults to undefined', () => {
    const result = normalizeOptions();

    expect(result.customCSSInheritanceList).toBeUndefined();
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
