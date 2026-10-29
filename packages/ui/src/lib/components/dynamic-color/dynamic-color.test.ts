import { Component, computed, signal } from '@angular/core';
import {
  DYNAMIC_COLOR_ROLES,
  LYNX_ELEMENTS,
  LynxTheme,
  type DynamicColors,
  type DynamicColorScheme,
} from '@blotch/angular-lynx';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import {
  ICON_LIGHT_COLORS,
  injectIconColor,
  provideIconTheme,
} from '../icon/icon-theme';
import {
  DYNAMIC_THEME_ROLES,
  UiDynamicColor,
  dynamicThemeColors,
} from './dynamic-color';

/**
 * A scheme in one color, with a primary of its own.
 */
const scheme = (color: string, primary: string): DynamicColorScheme =>
  ({
    ...Object.fromEntries(DYNAMIC_COLOR_ROLES.map((role) => [role, color])),
    primary,
  }) as DynamicColorScheme;

const WALLPAPER: DynamicColors = {
  light: { ...scheme('#fef7ff', '#6750a4'), onSurface: '#1d1b20' },
  dark: { ...scheme('#141218', '#d0bcff'), onSurface: '#e6e0e9' },
};

/**
 * What an icon inside the element draws `var(--primary)` with.
 */
@Component({
  selector: 'test-swatch',
  imports: [LYNX_ELEMENTS],
  template: `<text class="swatch">{{ primary() }}</text>`,
})
class Swatch {
  readonly #resolve = injectIconColor();
  protected readonly primary = computed(() => this.#resolve('var(--primary)'));
}

@Component({
  imports: [LYNX_ELEMENTS, UiDynamicColor, Swatch],
  template: `
    <view class="root" style="height: 100%" uiDynamicColor>
      <test-swatch />
    </view>
  `,
})
class Host {}

const setup = async (colors: DynamicColors | null) => {
  const dynamicColors = signal(colors);
  const colorScheme = signal<'light' | 'dark'>('light');
  const result = await render(Host, {
    providers: [
      { provide: LynxTheme, useValue: { dynamicColors } },
      provideIconTheme({ colorScheme: () => colorScheme() }),
    ],
  });
  const root = result.container.querySelector('.root') as HTMLElement;
  const swatch = () => result.container.querySelector('.swatch')?.textContent;
  return { dynamicColors, colorScheme, root, swatch };
};

describe('dynamicThemeColors', () => {
  it('gives each theme color its role’s color, and the ring’s subtle form at 40%', () => {
    const colors = dynamicThemeColors(WALLPAPER.light);
    expect(colors['primary']).toBe('rgba(103, 80, 164, 1)');
    expect(colors['ring']).toBe('rgba(103, 80, 164, 1)');
    expect(colors['ring-subtle']).toBe('rgba(103, 80, 164, 0.4)');
    expect(colors['foreground']).toBe('rgba(29, 27, 32, 1)');
    expect(colors['background']).toBe('rgba(254, 247, 255, 1)');
  });

  it('leaves the destructive and chart colors to the theme', () => {
    const colors = dynamicThemeColors(WALLPAPER.light);
    expect(Object.keys(colors)).not.toContain('destructive');
    expect(Object.keys(colors)).not.toContain('chart-1');
    expect(Object.keys(colors)).not.toContain('glass-dim');
  });

  it('only maps theme colors that exist', () => {
    for (const token of Object.keys(DYNAMIC_THEME_ROLES)) {
      expect(ICON_LIGHT_COLORS[token]).toBeDefined();
    }
  });
});

describe('UiDynamicColor', () => {
  it('sets the theme’s variables and their -rgb twins to the wallpaper’s colors', async () => {
    const { root } = await setup(WALLPAPER);
    expect(root.style.getPropertyValue('--primary')).toBe(
      'rgba(103, 80, 164, 1)',
    );
    expect(root.style.getPropertyValue('--primary-rgb')).toBe('103, 80, 164');
    expect(root.style.getPropertyValue('--foreground-rgb')).toBe('29, 27, 32');
    expect(root.style.getPropertyValue('--ring-subtle')).toBe(
      'rgba(103, 80, 164, 0.4)',
    );
    expect(root.style.getPropertyValue('--ring-subtle-rgb')).toBe('');
    // The element's own style stays.
    expect(root.style.getPropertyValue('height')).toBe('100%');
  });

  it('sets the scheme the app is in', async () => {
    const { root, colorScheme } = await setup(WALLPAPER);
    colorScheme.set('dark');
    await waitForUpdate();
    expect(root.style.getPropertyValue('--primary')).toBe(
      'rgba(208, 188, 255, 1)',
    );
  });

  it('gives icons inside it the same colors', async () => {
    const { swatch, colorScheme } = await setup(WALLPAPER);
    expect(swatch()).toBe('rgba(103, 80, 164, 1)');
    colorScheme.set('dark');
    await waitForUpdate();
    expect(swatch()).toBe('rgba(208, 188, 255, 1)');
  });

  it('leaves the theme as it is where the host sends no colors, and when they go', async () => {
    const { root, swatch, dynamicColors } = await setup(null);
    expect(root.style.getPropertyValue('--primary')).toBe('');
    expect(swatch()).toBe(ICON_LIGHT_COLORS['primary']);

    dynamicColors.set(WALLPAPER);
    await waitForUpdate();
    expect(swatch()).toBe('rgba(103, 80, 164, 1)');

    dynamicColors.set(null);
    await waitForUpdate();
    expect(root.style.getPropertyValue('--primary')).toBe('');
    expect(swatch()).toBe(ICON_LIGHT_COLORS['primary']);
  });
});
