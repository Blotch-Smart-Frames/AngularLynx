import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appearanceOf,
  colorSchemeChanges,
  colorSchemePreference,
  setColorSchemePreference,
  systemThemeOf,
  watchBrowserColorScheme,
} from './color-scheme';

/**
 * A media query list a test can flip, like a browser's.
 */
const fakeQuery = (matches: boolean) => {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener: vi.fn((_type: string, fn: () => void) =>
      listeners.add(fn),
    ),
    removeEventListener: vi.fn((_type: string, fn: () => void) =>
      listeners.delete(fn),
    ),
    flip(next: boolean) {
      this.matches = next;
      for (const fn of listeners) fn();
    },
  };
};

/**
 * A window whose `prefers-color-scheme: dark` query is `query`.
 */
const windowWith = (query: ReturnType<typeof fakeQuery>): Window =>
  ({
    matchMedia: vi.fn((text: string) =>
      text === '(prefers-color-scheme: dark)' ? query : undefined,
    ),
  }) as unknown as Window;

describe('color scheme', () => {
  afterEach(() => {
    setColorSchemePreference('system');
    watchBrowserColorScheme(undefined);
  });

  describe('systemThemeOf', () => {
    it("is the host's theme when it sends one", () => {
      expect(systemThemeOf({ theme: 'Dark' })).toBe('Dark');
      expect(systemThemeOf({ theme: 'Light' })).toBe('Light');
    });

    it('is light where no host sends a theme and no browser prefers dark', () => {
      expect(systemThemeOf({})).toBe('Light');
      expect(systemThemeOf(undefined)).toBe('Light');
      expect(systemThemeOf(null)).toBe('Light');
    });

    // The web preview: no host there sends a theme.
    it("is the browser's preference where no host sends a theme", () => {
      watchBrowserColorScheme(windowWith(fakeQuery(true)));

      expect(systemThemeOf({})).toBe('Dark');
    });

    // A page that embeds the app can set the theme itself.
    it("keeps the host's theme over the browser's preference", () => {
      watchBrowserColorScheme(windowWith(fakeQuery(true)));

      expect(systemThemeOf({ theme: 'Light' })).toBe('Light');
    });
  });

  describe('watchBrowserColorScheme', () => {
    it('follows the preference as it changes, and says so', () => {
      const query = fakeQuery(false);
      const changed = vi.fn();
      const subscription = colorSchemeChanges.subscribe(changed);
      watchBrowserColorScheme(windowWith(query));

      query.flip(true);

      expect(systemThemeOf({})).toBe('Dark');
      expect(changed).toHaveBeenCalledTimes(1);
      subscription.unsubscribe();
    });

    // A hot update's new app watches the same window again.
    it("stops the last call's listener", () => {
      const first = fakeQuery(false);
      watchBrowserColorScheme(windowWith(first));

      watchBrowserColorScheme(windowWith(fakeQuery(false)));
      first.flip(true);

      expect(first.removeEventListener).toHaveBeenCalledTimes(1);
      expect(systemThemeOf({})).toBe('Light');
    });

    // Native Lynx has no windows, and an old browser no media queries.
    it('counts the browser as light without a window or media queries', () => {
      watchBrowserColorScheme(windowWith(fakeQuery(true)));

      watchBrowserColorScheme({} as Window);
      expect(systemThemeOf({})).toBe('Light');

      watchBrowserColorScheme(undefined);
      expect(systemThemeOf({})).toBe('Light');
    });
  });

  describe("the app's choice", () => {
    it('follows the system until the app chooses', () => {
      expect(colorSchemePreference()).toBe('system');
      expect(appearanceOf({ theme: 'Dark' })).toBe('dark');
      expect(appearanceOf({ theme: 'Light' })).toBe('light');
      expect(appearanceOf(undefined)).toBe('light');
    });

    it('keeps to light or dark whatever the device says', () => {
      setColorSchemePreference('dark');
      expect(colorSchemePreference()).toBe('dark');
      expect(appearanceOf({ theme: 'Light' })).toBe('dark');

      setColorSchemePreference('light');
      expect(appearanceOf({ theme: 'Dark' })).toBe('light');
    });

    it('tells the page when it changes, and only then', () => {
      const changed = vi.fn();
      const subscription = colorSchemeChanges.subscribe(changed);

      setColorSchemePreference('dark');
      setColorSchemePreference('dark');

      expect(changed).toHaveBeenCalledTimes(1);
      subscription.unsubscribe();
    });
  });
});
