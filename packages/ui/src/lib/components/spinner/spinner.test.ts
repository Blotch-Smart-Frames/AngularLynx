import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiSpinner } from './spinner';

@Component({
  imports: [UiSpinner],
  template: `
    <ui-spinner [size]="size()" [color]="color()" [class]="className()" />
  `,
})
class SpinnerHost {
  readonly size = signal<'xs' | 'sm' | 'md' | 'lg'>('md');
  readonly color = signal<string | undefined>(undefined);
  readonly className = signal('');
}

@Component({
  imports: [UiSpinner],
  template: `<ui-spinner class="mx-2" />`,
})
class StaticClassHost {}

const renderSpinner = async () => {
  const result = await render(SpinnerHost);
  return {
    ...result,
    host: result.componentRef.instance as SpinnerHost,
    // The spinner: its host, which holds the svg.
    spinner: () => result.container.querySelector('svg')!.parentElement!,
    svgContent: () =>
      result.container.querySelector('svg')!.getAttribute('content'),
  };
};

describe('UiSpinner', () => {
  it('renders the loader at the default size', async () => {
    const { spinner } = await renderSpinner();
    expect(spinner().getAttribute('style')).toContain('width: 24px');
    expect(spinner().getAttribute('style')).toContain('height: 24px');
  });

  it('resizes for each supported size', async () => {
    const { host, spinner } = await renderSpinner();
    for (const [size, px] of [
      ['xs', 16],
      ['sm', 20],
      ['md', 24],
      ['lg', 32],
    ] as const) {
      host.size.set(size);
      await waitForUpdate();
      expect(spinner().getAttribute('style')).toContain(`width: ${px}px`);
    }
  });

  it("draws in the theme's foreground when no color is set", async () => {
    // Lynx's SVG parser reads neither `currentColor` nor CSS variables.
    const { svgContent } = await renderSpinner();
    expect(svgContent()).toContain(ICON_LIGHT_COLORS['foreground']);
    expect(svgContent()).not.toContain('currentColor');
  });

  it('draws in a literal color or a theme token', async () => {
    const { host, svgContent } = await renderSpinner();
    host.color.set('rgb(0, 0, 0)');
    await waitForUpdate();
    expect(svgContent()).toContain('rgb(0, 0, 0)');

    host.color.set('var(--primary-foreground)');
    await waitForUpdate();
    expect(svgContent()).toContain(ICON_LIGHT_COLORS['primary-foreground']);
  });

  it('takes the class input', async () => {
    const { host, spinner } = await renderSpinner();
    host.className.set('ml-2');
    await waitForUpdate();
    expect(spinner().getAttribute('class')).toBe('ml-2');
  });

  // A class on a component lands on its host too (issue #181): the host is
  // the spinner, so the margin applies once.
  it('puts a static class on one element, the spinner', async () => {
    const { container } = await render(StaticClassHost);
    expect([...container.querySelectorAll('.mx-2')]).toEqual([
      container.querySelector('svg')!.parentElement,
    ]);
  });

  it('turns continuously', async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { spinner } = await renderSpinner();
    expect(animate).toHaveBeenCalledWith(spinner(), expect.any(Array));
    animate.mockRestore();
  });
});
