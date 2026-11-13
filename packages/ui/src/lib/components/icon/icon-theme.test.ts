import {
  Injector,
  type Provider,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { LynxTheme } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  ICON_DARK_COLORS,
  ICON_LIGHT_COLORS,
  UI_ICON_COLOR,
  UI_ICON_THEME,
  UI_THEME_COLORS,
  injectColorScheme,
  injectIconColor,
  provideIconTheme,
  resolveIconColor,
  type ThemeColors,
} from './icon-theme';

const LIGHT_FOREGROUND = ICON_LIGHT_COLORS['foreground'];
const DARK_FOREGROUND = ICON_DARK_COLORS['foreground'];

/** The appearance the app is drawn in, as `LynxTheme.appearance` gives it. */
type Appearance = 'light' | 'dark';

/**
 * Runs injectIconColor() against the appearance the app is drawn in and
 * extra providers. A plain Injector has no root scope, so it gets the default
 * theme explicitly; the token's own factory is covered by the component
 * tests.
 */
const setup = (
  providers: Provider[] = [],
  appearance = signal<Appearance>('light'),
) => {
  const injector = Injector.create({
    providers: [
      { provide: LynxTheme, useValue: { appearance } },
      {
        provide: UI_ICON_THEME,
        useValue: { light: ICON_LIGHT_COLORS, dark: ICON_DARK_COLORS },
      },
      ...providers,
    ],
  });
  return runInInjectionContext(injector, () => injectIconColor());
};

describe('resolveIconColor', () => {
  it('passes a literal color through', () => {
    expect(resolveIconColor('#2563eb', ICON_LIGHT_COLORS)).toBe('#2563eb');
    expect(resolveIconColor(' rgba(1, 2, 3, 1) ', ICON_LIGHT_COLORS)).toBe(
      'rgba(1, 2, 3, 1)',
    );
  });

  it('swaps a theme token for its value', () => {
    expect(resolveIconColor('var(--primary)', ICON_LIGHT_COLORS)).toBe(
      ICON_LIGHT_COLORS['primary'],
    );
    expect(resolveIconColor('var( --destructive )', ICON_DARK_COLORS)).toBe(
      ICON_DARK_COLORS['destructive'],
    );
  });

  it("falls back to the var()'s fallback for an unknown token", () => {
    expect(resolveIconColor('var(--brand, #ff0000)', ICON_LIGHT_COLORS)).toBe(
      '#ff0000',
    );
    // The fallback may itself be a token.
    expect(
      resolveIconColor('var(--brand, var(--primary))', ICON_LIGHT_COLORS),
    ).toBe(ICON_LIGHT_COLORS['primary']);
  });

  it('falls back to the foreground for an unknown token with no fallback', () => {
    expect(resolveIconColor('var(--brand)', ICON_LIGHT_COLORS)).toBe(
      LIGHT_FOREGROUND,
    );
  });

  it('leaves an unknown token as it is when the table has no foreground', () => {
    expect(resolveIconColor('var(--brand)', {})).toBe('var(--brand)');
  });
});

describe('provideIconTheme', () => {
  it('merges the overrides over the default tables', () => {
    const provider = provideIconTheme({
      light: { primary: '#123456' },
      colorScheme: 'dark',
    }) as { provide: unknown; useValue: Record<string, unknown> };
    expect(provider.provide).toBe(UI_ICON_THEME);
    expect(provider.useValue['light']).toEqual({
      ...ICON_LIGHT_COLORS,
      primary: '#123456',
    });
    expect(provider.useValue['dark']).toEqual(ICON_DARK_COLORS);
    expect(provider.useValue['colorScheme']).toBe('dark');
  });
});

describe('injectColorScheme', () => {
  const scheme = (
    providers: Provider[],
    appearance = signal<Appearance>('light'),
  ) =>
    runInInjectionContext(
      Injector.create({
        providers: [
          { provide: LynxTheme, useValue: { appearance } },
          {
            provide: UI_ICON_THEME,
            useValue: { light: ICON_LIGHT_COLORS, dark: ICON_DARK_COLORS },
          },
          ...providers,
        ],
      }),
      () => injectColorScheme(),
    );

  it('is the appearance the app is drawn in, unless the theme says otherwise', () => {
    // The page has the theme's `dark` class while the app is drawn dark, so
    // what can't read the CSS follows the same appearance by default.
    const appearance = signal<Appearance>('light');
    const followed = scheme([], appearance);
    expect(followed()).toBe('light');
    appearance.set('dark');
    expect(followed()).toBe('dark');

    // A fixed scheme stays, whatever the app is drawn in.
    expect(
      scheme([provideIconTheme({ colorScheme: 'light' })], signal('dark'))(),
    ).toBe('light');
    expect(scheme([provideIconTheme({ colorScheme: 'dark' })])()).toBe('dark');
  });

  it("follows the appearance with 'system', or the app's own state", () => {
    const appearance = signal<Appearance>('light');
    const system = scheme(
      [provideIconTheme({ colorScheme: 'system' })],
      appearance,
    );
    expect(system()).toBe('light');
    appearance.set('dark');
    expect(system()).toBe('dark');

    const own = signal<'light' | 'dark'>('dark');
    expect(scheme([provideIconTheme({ colorScheme: () => own() })])()).toBe(
      'dark',
    );
  });
});

describe('injectIconColor', () => {
  it("draws with the foreground of the app's appearance by default", () => {
    const appearance = signal<Appearance>('light');
    const resolve = setup([], appearance);
    expect(resolve(undefined)).toBe(LIGHT_FOREGROUND);
    appearance.set('dark');
    expect(resolve(undefined)).toBe(DARK_FOREGROUND);
  });

  it('keeps to the light table in an app that fixes the scheme to light', () => {
    const resolve = setup(
      [provideIconTheme({ colorScheme: 'light' })],
      signal('dark'),
    );
    expect(resolve(undefined)).toBe(LIGHT_FOREGROUND);
  });

  it('resolves an explicit color against the active table', () => {
    const resolve = setup([provideIconTheme({ colorScheme: 'dark' })]);
    expect(resolve('var(--primary)')).toBe(ICON_DARK_COLORS['primary']);
    expect(resolve('#00ff00')).toBe('#00ff00');
  });

  it("follows the app's appearance with 'system'", () => {
    const appearance = signal<Appearance>('light');
    const resolve = setup(
      [provideIconTheme({ colorScheme: 'system' })],
      appearance,
    );
    expect(resolve(undefined)).toBe(LIGHT_FOREGROUND);
    appearance.set('dark');
    expect(resolve(undefined)).toBe(DARK_FOREGROUND);
  });

  it("reads the app's own theme state from a function", () => {
    const scheme = signal<'light' | 'dark'>('dark');
    const resolve = setup([provideIconTheme({ colorScheme: () => scheme() })]);
    expect(resolve(undefined)).toBe(DARK_FOREGROUND);
    scheme.set('light');
    expect(resolve(undefined)).toBe(LIGHT_FOREGROUND);
  });

  it("uses the container's color when the icon sets none", () => {
    const inherited = signal<string | undefined>('var(--destructive)');
    const resolve = setup([{ provide: UI_ICON_COLOR, useValue: inherited }]);
    expect(resolve(undefined)).toBe(ICON_LIGHT_COLORS['destructive']);
    // The icon's own color still wins.
    expect(resolve('var(--primary)')).toBe(ICON_LIGHT_COLORS['primary']);
    // A container that sets no color leaves the foreground.
    inherited.set(undefined);
    expect(resolve(undefined)).toBe(LIGHT_FOREGROUND);
  });
});

describe('UI_THEME_COLORS', () => {
  it('replaces the table’s colors for the active scheme, and only those it sets', () => {
    const replaced = signal<ThemeColors>({
      light: { primary: 'rgba(103, 80, 164, 1)' },
      dark: { primary: 'rgba(208, 188, 255, 1)' },
    });
    const appearance = signal<Appearance>('light');
    const resolve = setup(
      [
        provideIconTheme({ colorScheme: 'system' }),
        { provide: UI_THEME_COLORS, useValue: replaced },
      ],
      appearance,
    );
    expect(resolve('var(--primary)')).toBe('rgba(103, 80, 164, 1)');
    expect(resolve(undefined)).toBe(LIGHT_FOREGROUND);

    appearance.set('dark');
    expect(resolve('var(--primary)')).toBe('rgba(208, 188, 255, 1)');

    // An element with no colors to set leaves the theme's.
    replaced.set({});
    expect(resolve('var(--primary)')).toBe(ICON_DARK_COLORS['primary']);
  });
});
