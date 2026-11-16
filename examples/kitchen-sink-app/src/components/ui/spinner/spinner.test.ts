import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '@blotch/dolan/testing/lynx-main-thread';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiSpinner } from './spinner';

/**
 * The parts of an element's inline `animation`, sorted, with `0.0` written as
 * `0`. jsdom 31 writes the shorthand back in an order of its own, with `0.0`
 * as `0`, and fills in `animation-name` and the rest; jsdom 30, which
 * `ng new` installs, keeps it as it was set and leaves those empty.
 */
const animationOf = (element: Element) =>
  (element as HTMLElement).style
    .getPropertyValue('animation')
    .replace(/\b0\.0\b/g, '0')
    .split(/ (?![^(]*\))/)
    .sort();

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
    // The spinner: its host, marked with its tag's class, which holds the
    // view that turns the svg.
    spinner: () => result.container.querySelector('._ngtag-ui-spinner')!,
    turner: () => result.container.querySelector('svg')!.parentElement!,
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
      container.querySelector('._ngtag-ui-spinner'),
    ]);
  });

  // Core Animation and Android's animators turn it, so it keeps turning
  // while Angular builds a screen, which is when a spinner shows. Lynx's own
  // animator ticks on Angular's thread, and stood still meanwhile.
  it("turns the drawing on the platform's animator", async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { turner } = await renderSpinner();
    expect(turner().getAttribute('enable-new-animator')).toBe('false');
    // Android rotates only a view of its own.
    expect(turner().getAttribute('flatten')).toBe('false');
    const { style } = turner() as HTMLElement;
    expect(animationOf(turner())).toEqual(
      ['ui-spinner-turn', '1600ms', 'linear', 'infinite'].sort(),
    );
    // It fills the spinner.
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
    // animate() does nothing on an element the platform animates.
    expect(animate).not.toHaveBeenCalled();
    animate.mockRestore();
  });

  // animate() does nothing on an element the platform animates, so the
  // spinner itself stays on Lynx's animator for an app to fade it in or out.
  it("leaves the spinner on Lynx's animator, for the app to animate", async () => {
    const { spinner } = await renderSpinner();
    expect(spinner().hasAttribute('enable-new-animator')).toBe(false);
    expect(spinner().hasAttribute('flatten')).toBe(false);
  });

  it('turns a full turn', () => {
    expect(componentStyles(UiSpinner)).toMatch(
      /@keyframes ui-spinner-turn\s*\{\s*from\s*\{\s*transform:\s*rotate\(0deg\);?\s*\}\s*to\s*\{\s*transform:\s*rotate\(360deg\);?\s*\}/,
    );
  });
});
