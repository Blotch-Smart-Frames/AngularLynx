import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiSpinner } from './spinner';

/**
 * The CSS a component brings, which the build adds to the app's.
 */
const componentStyles = (component: unknown): string =>
  (component as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');

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
    // Next to the `_ngtag-` class the renderer gives a component's host, so
    // type selectors naming the component match it.
    expect(spinner().getAttribute('class')?.split(' ')).toContain('ml-2');
  });

  // A class on a component lands on its host too (issue #181): the host is
  // the spinner, so the margin applies once.
  it('puts a static class on one element, the spinner', async () => {
    const { container } = await render(StaticClassHost);
    expect([...container.querySelectorAll('.mx-2')]).toEqual([
      container.querySelector('svg')!.parentElement,
    ]);
  });

  // Core Animation and Android's animators turn it, so it keeps turning
  // while Angular builds a screen, which is when a spinner shows. Lynx's own
  // animator ticks on Angular's thread, and stood still meanwhile.
  it("turns on the platform's animator", async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { spinner } = await renderSpinner();
    expect(spinner().getAttribute('enable-new-animator')).toBe('false');
    // Android rotates only a view of its own.
    expect(spinner().getAttribute('flatten')).toBe('false');
    // animate() does nothing on an element the platform animates.
    expect(animate).not.toHaveBeenCalled();
    animate.mockRestore();
  });

  it('turns once every 1.6 seconds, for as long as it shows', () => {
    const css = componentStyles(UiSpinner);
    expect(css).toMatch(
      /@keyframes ui-spinner-turn\s*\{\s*from\s*\{\s*transform:\s*rotate\(0deg\);?\s*\}\s*to\s*\{\s*transform:\s*rotate\(360deg\);?\s*\}/,
    );
    // The host is the box that turns: the build matches `ui-spinner` to the
    // class the runtime gives it, so the app's classes stay its own.
    expect(css).toMatch(
      /ui-spinner\s*\{\s*animation:\s*ui-spinner-turn 1600ms linear infinite;?\s*\}/,
    );
  });
});
