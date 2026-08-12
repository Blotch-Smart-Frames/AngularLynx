import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { LynxGlobalData } from '../data-flow/global-data';
import { LynxTheme } from './theme';

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
});
