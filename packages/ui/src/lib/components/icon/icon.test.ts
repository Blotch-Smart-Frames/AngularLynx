import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { UiIcon } from './icon';
import {
  ICON_DARK_COLORS,
  ICON_LIGHT_COLORS,
  UI_ICON_COLOR,
  provideIconTheme,
} from './icon-theme';
import { ICONS, type IconName } from './icons';

@Component({
  imports: [UiIcon],
  template: `
    <ui-icon
      [name]="name()"
      [size]="size()"
      [color]="color()"
      [class]="className()"
    />
  `,
})
class IconHost {
  readonly name = signal<IconName>('check');
  readonly size = signal<'xs' | 'sm' | 'md' | 'lg'>('md');
  readonly color = signal<string | undefined>(undefined);
  readonly className = signal('');
}

const renderIcon = async (providers: Parameters<typeof render>[1] = {}) => {
  const result = await render(IconHost, providers);
  return {
    ...result,
    host: result.componentRef.instance as IconHost,
    svg: () => result.container.querySelector('svg')!,
  };
};

describe('UiIcon', () => {
  it('draws the named icon at the default size', async () => {
    const { svg } = await renderIcon();
    expect(svg().getAttribute('style')).toContain('24px');
    expect(svg().getAttribute('content')).toContain('<svg');
  });

  it('draws another icon when the name changes', async () => {
    const { host, svg } = await renderIcon();
    const check = svg().getAttribute('content');
    host.name.set('x');
    await waitForUpdate();
    expect(svg().getAttribute('content')).not.toBe(check);
  });

  it('applies the size input to the width/height style', async () => {
    const { host, svg } = await renderIcon();
    host.size.set('xs');
    await waitForUpdate();
    expect(svg().getAttribute('style')).toContain('16px');
  });

  it('substitutes currentColor with the color input value', async () => {
    // Lynx's SVG parser reads neither `currentColor` nor CSS variables.
    const { host, svg } = await renderIcon();
    host.color.set('rgb(255, 0, 0)');
    await waitForUpdate();
    expect(svg().getAttribute('content')).toContain('rgb(255, 0, 0)');
    expect(svg().getAttribute('content')).not.toContain('currentColor');
  });

  it("draws in the light theme's foreground when no color is set", async () => {
    const { svg } = await renderIcon();
    const content = svg().getAttribute('content');
    expect(content).toContain(ICON_LIGHT_COLORS['foreground']);
    expect(content).not.toContain('currentColor');
  });

  it('resolves a theme token against the active color scheme', async () => {
    const { host, svg } = await renderIcon({
      providers: [provideIconTheme({ colorScheme: 'dark' })],
    });
    host.color.set('var(--primary)');
    await waitForUpdate();
    expect(svg().getAttribute('content')).toContain(
      ICON_DARK_COLORS['primary'],
    );
  });

  it("takes its container's color when it sets none", async () => {
    const { svg } = await renderIcon({
      providers: [
        { provide: UI_ICON_COLOR, useValue: signal('var(--destructive)') },
      ],
    });
    expect(svg().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['destructive'],
    );
  });

  it('applies the class input to the svg', async () => {
    const { host, svg } = await renderIcon();
    host.className.set('mr-2');
    await waitForUpdate();
    expect(svg().getAttribute('class')).toBe('mr-2');
  });
});

describe('ICONS registry', () => {
  it('exports at least one icon', () => {
    expect(Object.keys(ICONS).length).toBeGreaterThan(0);
  });
});
