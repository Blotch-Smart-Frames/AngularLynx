import { describe, expect, it } from 'vitest';
import {
  CHART_DARK_COLORS,
  CHART_LIGHT_COLORS,
  DEFAULT_CHART_THEME,
  UI_CHART_THEME,
  provideChartTheme,
  resolveChartPaint,
} from './chart-theme';

const colors = {
  foreground: 'rgba(1, 1, 1, 1)',
  background: 'rgba(2, 2, 2, 1)',
  primary: 'rgba(3, 3, 3, 1)',
};

describe('resolveChartPaint', () => {
  it('replaces a theme token with its value', () => {
    expect(resolveChartPaint('var(--primary)', colors)).toBe(colors.primary);
    expect(resolveChartPaint(' var(--primary) ', colors)).toBe(colors.primary);
  });

  it('uses the fallback of an unknown token, resolving it too', () => {
    expect(resolveChartPaint('var(--ts-chart-1, #2563eb)', colors)).toBe(
      '#2563eb',
    );
    expect(resolveChartPaint('var(--missing, var(--primary))', colors)).toBe(
      colors.primary,
    );
    // A comma inside the fallback's own parentheses isn't a separator.
    expect(
      resolveChartPaint('var(--missing, rgba(0, 0, 0, 0.5))', colors),
    ).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('falls back to the foreground for an unknown token without a fallback', () => {
    expect(resolveChartPaint('var(--missing)', colors)).toBe(colors.foreground);
    expect(resolveChartPaint('var(--missing)', {})).toBe('var(--missing)');
  });

  it('maps CSS system colors to the theme', () => {
    expect(resolveChartPaint('currentColor', colors)).toBe(colors.foreground);
    expect(resolveChartPaint('CanvasText', colors)).toBe(colors.foreground);
    expect(resolveChartPaint('Canvas', colors)).toBe(colors.background);
    expect(resolveChartPaint('currentColor', {})).toBe('currentColor');
    expect(resolveChartPaint('Canvas', {})).toBe('Canvas');
  });

  it('passes concrete colors through', () => {
    for (const paint of ['#fff', 'rgba(0, 0, 0, 1)', 'url(#g)', 'none']) {
      expect(resolveChartPaint(paint, colors)).toBe(paint);
    }
  });
});

describe('chart theme providers', () => {
  it('defaults to the light and dark tables and the token-based TanStack theme', () => {
    const factory = (
      UI_CHART_THEME as unknown as { ɵprov: { factory: () => unknown } }
    ).ɵprov.factory;
    expect(factory()).toEqual({
      light: CHART_LIGHT_COLORS,
      dark: CHART_DARK_COLORS,
      chart: DEFAULT_CHART_THEME,
    });
  });

  it('merges overrides over the defaults', () => {
    const provider = provideChartTheme({
      light: { 'chart-1': 'red' },
      chart: { palette: ['blue'] },
    }) as {
      provide: unknown;
      useValue: Record<string, Record<string, unknown>>;
    };
    expect(provider.provide).toBe(UI_CHART_THEME);
    expect(provider.useValue['light']!['chart-1']).toBe('red');
    expect(provider.useValue['light']!['primary']).toBe(
      CHART_LIGHT_COLORS['primary'],
    );
    expect(provider.useValue['dark']).toEqual(CHART_DARK_COLORS);
    expect(provider.useValue['chart']!['palette']).toEqual(['blue']);
    expect(provider.useValue['chart']!['foreground']).toBe('var(--foreground)');
  });
});
