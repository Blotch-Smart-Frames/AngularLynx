import { Component, ErrorHandler, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
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

@Component({
  imports: [UiIcon],
  template: `<ui-icon name="search" class="mb-3" />`,
})
class StaticClassHost {}

describe('UiIcon on its own', () => {
  // A class on a component lands on its host too (issue #181): the host is
  // the <svg>, so the margin applies once.
  it('is one svg, with the class written on it', async () => {
    const { container } = await render(StaticClassHost);
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs).toHaveLength(1);
    expect([...container.querySelectorAll('.mb-3')]).toEqual(svgs);
  });
});

/** A one-color mark, written as an app would: no namespace. */
const ONE_COLOR_MARK =
  '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Z"/></svg>';

/** A multi-color mark, which already has the namespace. */
const TWO_COLOR_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><path fill="#4285f4" d="M0 0h1v1H0z"/><path fill="#34a853" d="M1 0h1v1H1z"/></svg>';

@Component({
  imports: [UiIcon],
  template: `<ui-icon [svg]="svg()" [color]="color()" size="lg" />`,
})
class SvgHost {
  readonly svg = signal(ONE_COLOR_MARK);
  readonly color = signal<string | undefined>(undefined);
}

const renderSvg = async (providers: Parameters<typeof render>[1] = {}) => {
  const result = await render(SvgHost, providers);
  return {
    ...result,
    host: result.componentRef.instance as SvgHost,
    content: () =>
      result.container.querySelector('svg')!.getAttribute('content')!,
  };
};

describe("UiIcon with an app's own svg", () => {
  it('draws the markup at the size given, with currentColor in the theme foreground', async () => {
    const { container, content } = await renderSvg();
    expect(container.querySelector('svg')!.getAttribute('style')).toContain(
      '32px',
    );
    expect(content()).toContain('d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Z"');
    expect(content()).toContain(`fill="${ICON_LIGHT_COLORS['foreground']}"`);
    expect(content()).not.toContain('currentColor');
  });

  it('follows the color scheme and the color input, as the set does', async () => {
    const { host, content } = await renderSvg({
      providers: [provideIconTheme({ colorScheme: 'dark' })],
    });
    expect(content()).toContain(ICON_DARK_COLORS['foreground']);

    host.color.set('var(--primary)');
    await waitForUpdate();
    expect(content()).toContain(ICON_DARK_COLORS['primary']);
  });

  it('keeps the colors a multi-color mark writes out', async () => {
    const { host, content } = await renderSvg();
    host.svg.set(TWO_COLOR_MARK);
    host.color.set('rgb(255, 0, 0)');
    await waitForUpdate();
    expect(content()).toBe(TWO_COLOR_MARK);
  });

  // The web preview draws the markup as an image, which a browser leaves
  // blank without the namespace.
  it('adds the SVG namespace when the markup has none, and only then', async () => {
    const { host, content } = await renderSvg();
    expect(content()).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 16 16">/,
    );

    host.svg.set(TWO_COLOR_MARK);
    await waitForUpdate();
    expect(content().match(/xmlns=/g)).toHaveLength(1);
  });
});

@Component({
  imports: [UiIcon],
  template: `<ui-icon [name]="name()" [svg]="svg()" />`,
})
class NameAndSvgHost {
  readonly name = signal<IconName | undefined>(undefined);
  readonly svg = signal<string | undefined>(undefined);
}

/**
 * Renders the host, keeping the errors Angular reports: an error in change
 * detection goes to the app's ErrorHandler rather than out of render().
 */
const renderNameAndSvg = async () => {
  const handleError = vi.fn();
  const result = await render(NameAndSvgHost, {
    providers: [{ provide: ErrorHandler, useValue: { handleError } }],
  });
  return {
    host: result.componentRef.instance as NameAndSvgHost,
    handleError,
  };
};

const NAME_OR_SVG = new Error('<ui-icon> needs a name or an svg, not both.');

describe('UiIcon without exactly one of name and svg', () => {
  it('reports an error with neither', async () => {
    const { handleError } = await renderNameAndSvg();
    expect(handleError).toHaveBeenCalledWith(NAME_OR_SVG);
  });

  it('reports an error with both', async () => {
    const { host, handleError } = await renderNameAndSvg();
    host.name.set('check');
    await waitForUpdate();
    handleError.mockClear();

    host.svg.set(ONE_COLOR_MARK);
    await waitForUpdate();
    expect(handleError).toHaveBeenCalledWith(NAME_OR_SVG);
  });
});

describe('ICONS registry', () => {
  it('exports at least one icon', () => {
    expect(Object.keys(ICONS).length).toBeGreaterThan(0);
  });
});
