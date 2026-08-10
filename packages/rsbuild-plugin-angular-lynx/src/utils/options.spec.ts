import { describe, expect, it } from 'vitest';
import { normalizeOptions } from './options';

describe('normalizeOptions', () => {
  it('returns all required defaults when called with no args', () => {
    const result = normalizeOptions();

    expect(result.debugInfoOutside).toBe(true);
    expect(result.enableA11y).toBe(true);
    expect(result.enableICU).toBe(false);
    expect(result.enableAccessibilityElement).toBe(false);
    expect(result.enableCSSInheritance).toBe(false);
    expect(result.enableCSSInvalidation).toBe(false);
    expect(result.enableCSSSelector).toBe(true);
    expect(result.enableNewGesture).toBe(true);
    expect(result.enableParallelElement).toBe(true);
    expect(result.defaultDisplayLinear).toBe(true);
    expect(result.enableRemoveCSSScope).toBe(false);
    expect(result.pipelineSchedulerConfig).toBe(0x00010000);
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
    const result = normalizeOptions({ enableA11y: false, enableICU: true });

    expect(result.enableA11y).toBe(false);
    expect(result.enableICU).toBe(true);
    // other defaults remain
    expect(result.debugInfoOutside).toBe(true);
    expect(result.enableCSSSelector).toBe(true);
  });

  it('supplied customCSSInheritanceList passes through', () => {
    const list = ['color', 'font-size'];
    const result = normalizeOptions({ customCSSInheritanceList: list });

    expect(result.customCSSInheritanceList).toEqual(['color', 'font-size']);
  });

  it('pipelineSchedulerConfig defaults to 65536 (0x00010000)', () => {
    const result = normalizeOptions();

    expect(result.pipelineSchedulerConfig).toBe(65536);
  });

  it('pipelineSchedulerConfig can be overridden', () => {
    const result = normalizeOptions({ pipelineSchedulerConfig: 42 });

    expect(result.pipelineSchedulerConfig).toBe(42);
  });
});
