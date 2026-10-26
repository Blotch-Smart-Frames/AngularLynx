import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiIcon } from './icon';
import {
  ICON_DARK_COLORS,
  ICON_LIGHT_COLORS,
  UI_ICON_COLOR,
  provideIconTheme,
} from './icon-theme';
import { ICONS, type IconName } from './icons';

@Component({
  imports: [UiIcon, LYNX_ELEMENTS],
  template: `<ui-icon [name]="name" [size]="size" [color]="color" />`,
})
class IconHost {
  name: IconName = 'check';
  size: 'xs' | 'sm' | 'md' | 'lg' = 'md';
  color?: string;
}

describe('UiIcon', () => {
  it('renders the requested icon at default size', async () => {
    const { container } = await render(IconHost);
    expect(container).toBeTruthy();
  });

  it('applies the size input to the width/height style', async () => {
    // JIT template bindings are inert against `input()` — drive the signals
    // directly so sizeStyle and svgContent both re-run.
    const { componentRef, container } = await render(UiIcon);
    setInputSignal((componentRef.instance as UiIcon).name, 'check' as IconName);
    setInputSignal((componentRef.instance as UiIcon).size, 'xs');
    await waitForUpdate();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('style')).toContain('16px');
  });

  it('substitutes currentColor with the color input value', async () => {
    const { componentRef, container } = await render(UiIcon);
    setInputSignal((componentRef.instance as UiIcon).name, 'check' as IconName);
    setInputSignal((componentRef.instance as UiIcon).color, 'rgb(255, 0, 0)');
    await waitForUpdate();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('content')).toContain('rgb(255, 0, 0)');
    expect(svg?.getAttribute('content')).not.toContain('currentColor');
  });

  it("draws in the light theme's foreground when no color is set", async () => {
    const { componentRef, container } = await render(UiIcon);
    setInputSignal((componentRef.instance as UiIcon).name, 'check' as IconName);
    await waitForUpdate();
    const content = container.querySelector('svg')?.getAttribute('content');
    expect(content).toContain(ICON_LIGHT_COLORS['foreground']);
    expect(content).not.toContain('currentColor');
  });

  it('resolves a theme token against the active color scheme', async () => {
    const { componentRef, container } = await render(UiIcon, {
      providers: [provideIconTheme({ colorScheme: 'dark' })],
    });
    const icon = componentRef.instance as UiIcon;
    setInputSignal(icon.name, 'check' as IconName);
    setInputSignal(icon.color, 'var(--primary)');
    await waitForUpdate();
    expect(container.querySelector('svg')?.getAttribute('content')).toContain(
      ICON_DARK_COLORS['primary'],
    );
  });

  it("takes its container's color when it sets none", async () => {
    const { componentRef, container } = await render(UiIcon, {
      providers: [
        { provide: UI_ICON_COLOR, useValue: signal('var(--destructive)') },
      ],
    });
    setInputSignal((componentRef.instance as UiIcon).name, 'x' as IconName);
    await waitForUpdate();
    expect(container.querySelector('svg')?.getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['destructive'],
    );
  });

  it('applies the class input to the svg', async () => {
    const { componentRef, container } = await render(UiIcon);
    const icon = componentRef.instance as UiIcon;
    setInputSignal(icon.name, 'check' as IconName);
    setInputSignal(icon.userClass, 'mr-2');
    await waitForUpdate();
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('mr-2');
  });
});

describe('ICONS registry', () => {
  it('exports at least one icon', () => {
    expect(Object.keys(ICONS).length).toBeGreaterThan(0);
  });
});
