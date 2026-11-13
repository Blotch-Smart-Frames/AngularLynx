import {
  createEnvironmentInjector,
  type EnvironmentInjector,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { LynxGlobalData } from '../data-flow/global-data';
import {
  colorSchemePreference,
  setColorSchemePreference,
  watchBrowserColorScheme,
} from './color-scheme';
import { DYNAMIC_COLOR_ROLES, LynxTheme, provideColorScheme } from './theme';

/**
 * A scheme with every role in one color.
 */
const scheme = (color: string) =>
  Object.fromEntries(DYNAMIC_COLOR_ROLES.map((role) => [role, color]));

/**
 * Builds a LynxTheme instance backed by a fake LynxGlobalData whose
 * `globalData` is a real signal, so LynxTheme's `computed()` reacts exactly
 * as it would against the real service.
 */
const createTheme = (globalData: ReturnType<typeof signal>): LynxTheme => {
  const injector = Injector.create({
    providers: [{ provide: LynxGlobalData, useValue: { globalData } }],
  });
  return runInInjectionContext(injector, () => new LynxTheme());
};

describe('LynxTheme', () => {
  // The app's choice and the browser's preference outlive a service: they're
  // the page's too.
  afterEach(() => {
    setColorSchemePreference('system');
    watchBrowserColorScheme(undefined);
  });

  it('reports theme "Dark" and isDarkMode true when the host sets a dark theme', () => {
    const theme = createTheme(signal({ theme: 'Dark' }));

    expect(theme.theme()).toBe('Dark');
    expect(theme.isDarkMode()).toBe(true);
  });

  it('reports theme "Light" and isDarkMode false when the host sets a light theme', () => {
    const theme = createTheme(signal({ theme: 'Light' }));

    expect(theme.theme()).toBe('Light');
    expect(theme.isDarkMode()).toBe(false);
  });

  it('falls back to "Light" when theme is absent from global data', () => {
    const theme = createTheme(signal({}));

    expect(theme.theme()).toBe('Light');
    expect(theme.isDarkMode()).toBe(false);
  });

  it('updates reactively when the underlying global data signal changes', () => {
    const globalData = signal<Record<string, unknown>>({ theme: 'Light' });
    const theme = createTheme(globalData);

    expect(theme.isDarkMode()).toBe(false);

    globalData.set({ theme: 'Dark' });

    expect(theme.theme()).toBe('Dark');
    expect(theme.isDarkMode()).toBe(true);
  });

  // The web preview, where no host sends a theme.
  it("takes the browser's color scheme where the host sends no theme", () => {
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) =>
        listeners.delete(fn),
    };
    watchBrowserColorScheme({
      matchMedia: () => query,
    } as unknown as Window);
    const theme = createTheme(signal({}));
    expect(theme.isDarkMode()).toBe(false);

    query.matches = true;
    for (const fn of listeners) fn();

    expect(theme.theme()).toBe('Dark');
    expect(theme.isDarkMode()).toBe(true);
  });

  describe('appearance', () => {
    it("is the device's while the app follows the system", () => {
      const globalData = signal<Record<string, unknown>>({ theme: 'Dark' });
      const theme = createTheme(globalData);

      expect(theme.colorScheme()).toBe('system');
      expect(theme.appearance()).toBe('dark');

      globalData.set({ theme: 'Light' });
      expect(theme.appearance()).toBe('light');
    });

    it("is the app's own choice once it makes one, whatever the device says", () => {
      const theme = createTheme(signal({ theme: 'Light' }));

      theme.setColorScheme('dark');
      expect(theme.colorScheme()).toBe('dark');
      expect(theme.appearance()).toBe('dark');
      // The device hasn't changed.
      expect(theme.isDarkMode()).toBe(false);

      theme.setColorScheme('light');
      expect(theme.appearance()).toBe('light');

      theme.setColorScheme('system');
      expect(theme.appearance()).toBe('light');
    });
  });

  describe('provideColorScheme', () => {
    it("sets the app's choice before anything renders", () => {
      const parent = Injector.create({ providers: [] }) as EnvironmentInjector;

      createEnvironmentInjector([provideColorScheme('dark')], parent);

      expect(colorSchemePreference()).toBe('dark');
    });
  });

  describe('dynamicColors', () => {
    it('is the light and dark schemes the host sends', () => {
      const light = { ...scheme('#ffffff'), primary: '#6750A4' };
      const dark = { ...scheme('#000000'), primary: '#d0bcff' };
      const theme = createTheme(signal({ dynamicColors: { light, dark } }));

      expect(theme.dynamicColors()).toEqual({ light, dark });
    });

    it('is null when the host sends none', () => {
      expect(createTheme(signal({})).dynamicColors()).toBeNull();
      expect(
        createTheme(signal({ dynamicColors: 'none' })).dynamicColors(),
      ).toBeNull();
    });

    it('is null when a scheme is missing, lacks a role or has a color that is not hex', () => {
      const light = scheme('#ffffff');
      const { primary: _, ...withoutPrimary } = light;
      for (const dynamicColors of [
        { light },
        { light, dark: null },
        { light, dark: withoutPrimary },
        { light, dark: { ...light, primary: 'rgba(0, 0, 0, 1)' } },
        { light, dark: { ...light, primary: 0x6750a4 } },
      ]) {
        expect(createTheme(signal({ dynamicColors })).dynamicColors()).toBe(
          null,
        );
      }
    });

    it('keeps the same object while the colors stay the same, and changes with them', () => {
      const globalData = signal<Record<string, unknown>>({
        dynamicColors: { light: scheme('#ffffff'), dark: scheme('#000000') },
      });
      const theme = createTheme(globalData);
      const first = theme.dynamicColors();

      // Another global prop changes, and the host sends the colors again.
      globalData.set({
        safeAreaTop: 24,
        dynamicColors: { light: scheme('#ffffff'), dark: scheme('#000000') },
      });
      expect(theme.dynamicColors()).toBe(first);

      globalData.set({
        dynamicColors: { light: scheme('#ffffff'), dark: scheme('#111111') },
      });
      expect(theme.dynamicColors()?.dark.primary).toBe('#111111');

      globalData.set({});
      expect(theme.dynamicColors()).toBeNull();
    });
  });
});
