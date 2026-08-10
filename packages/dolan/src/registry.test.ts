import { describe, expect, it } from 'vitest';

import { getComponentNames, getEntry, resolveDependencies } from './registry';

describe('getComponentNames', () => {
  it('returns all component names', () => {
    const names = getComponentNames();
    expect(names).toContain('button');
    expect(names).toContain('card');
    expect(names).toContain('spinner');
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('getEntry', () => {
  it('returns entry for existing component', () => {
    const entry = getEntry('button');
    expect(entry).toEqual({
      name: 'button',
      dependencies: ['spinner'],
    });
  });

  it('returns undefined for non-existent component', () => {
    expect(getEntry('nonexistent')).toBeUndefined();
  });
});

describe('resolveDependencies', () => {
  it('returns component with no dependencies', () => {
    expect(resolveDependencies(['card'])).toEqual(['card']);
  });

  it('resolves transitive dependencies in dependency-first order', () => {
    const resolved = resolveDependencies(['button']);
    expect(resolved).toEqual(['spinner', 'button']);
  });

  it('deduplicates when dependency is also explicitly listed', () => {
    const resolved = resolveDependencies(['button', 'spinner']);
    expect(resolved).toEqual(['spinner', 'button']);
  });

  it('handles empty input', () => {
    expect(resolveDependencies([])).toEqual([]);
  });

  it('resolves empty-state with its icon dependency', () => {
    const resolved = resolveDependencies(['empty-state']);
    expect(resolved).toEqual(['icon', 'empty-state']);
  });

  it('resolves select with its bottom-sheet dependency', () => {
    expect(resolveDependencies(['select'])).toEqual(['bottom-sheet', 'select']);
  });

  it('resolves sheet with its bottom-sheet dependency', () => {
    expect(resolveDependencies(['sheet'])).toEqual(['bottom-sheet', 'sheet']);
  });

  it('resolves line-chart with its cartesian-chart dependency', () => {
    expect(resolveDependencies(['line-chart'])).toEqual([
      'cartesian-chart',
      'line-chart',
    ]);
  });

  it('resolves bar-chart with its cartesian-chart dependency', () => {
    // Bar chart draws straight onto the base — the base must land first.
    expect(resolveDependencies(['bar-chart'])).toEqual([
      'cartesian-chart',
      'bar-chart',
    ]);
  });

  it('resolves scatter-chart with its cartesian-chart dependency', () => {
    // Scatter draws straight onto the base — the base must land first.
    expect(resolveDependencies(['scatter-chart'])).toEqual([
      'cartesian-chart',
      'scatter-chart',
    ]);
  });

  it('resolves candlestick-chart with its cartesian-chart dependency', () => {
    // Candlestick draws straight onto the base — the base must land first.
    expect(resolveDependencies(['candlestick-chart'])).toEqual([
      'cartesian-chart',
      'candlestick-chart',
    ]);
  });

  it('resolves area-chart with its transitive chart dependencies in order', () => {
    // area-chart → line-chart → cartesian-chart; the base must land first.
    expect(resolveDependencies(['area-chart'])).toEqual([
      'cartesian-chart',
      'line-chart',
      'area-chart',
    ]);
  });

  it('deduplicates bottom-sheet when both select and sheet are selected', () => {
    expect(resolveDependencies(['select', 'sheet'])).toEqual([
      'bottom-sheet',
      'select',
      'sheet',
    ]);
  });

  it('skips unknown component names', () => {
    expect(resolveDependencies(['nonexistent'])).toEqual([]);
  });
});
