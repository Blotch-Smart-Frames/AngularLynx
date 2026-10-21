import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import {
  getComponentNames,
  getEntry,
  resolveDependencies,
  resolvePackages,
} from './registry';

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

  it.each([
    'line-chart',
    'area-chart',
    'bar-chart',
    'scatter-chart',
    'candlestick-chart',
  ])('resolves %s with the chart it builds on first', (preset) => {
    expect(resolveDependencies([preset])).toEqual(['chart', preset]);
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

describe('resolvePackages', () => {
  it('collects the npm packages of the given components, once each', () => {
    const packages = resolvePackages(['chart', 'line-chart', 'card']);
    expect(packages.map((spec) => spec.replace(/@[^@]*$/, ''))).toEqual([
      '@tanstack/charts',
      'd3-shape',
    ]);
    expect(resolvePackages(['card', 'nonexistent'])).toEqual([]);
  });

  it('asks for the versions packages/ui builds against', () => {
    const ui = JSON.parse(
      readFileSync(new URL('../../ui/package.json', import.meta.url), 'utf-8'),
    ) as { dependencies: Record<string, string> };
    for (const spec of getEntry('chart')!.packages!) {
      const at = spec.lastIndexOf('@');
      expect(ui.dependencies[spec.slice(0, at)]).toBe(spec.slice(at + 1));
    }
  });
});
