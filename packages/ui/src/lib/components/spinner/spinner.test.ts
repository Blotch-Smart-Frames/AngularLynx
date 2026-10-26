import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiSpinner } from './spinner';

describe('UiSpinner', () => {
  it('renders the SVG at the default size', async () => {
    const { container } = await render(UiSpinner);
    expect(container).toBeTruthy();
    // The default size is 'md' → sizeStyle should render at 24px.
    const view = container.querySelector('view');
    expect(view?.getAttribute('style')).toContain('24px');
  });

  it('substitutes currentColor when the color input is set', async () => {
    const { container, componentRef } = await render(UiSpinner);
    setInputSignal((componentRef.instance as UiSpinner).color, 'rgb(0, 0, 0)');
    // Flush CD so the computed re-runs and the `content` attribute updates.
    await waitForUpdate();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('content')).toContain('rgb(0, 0, 0)');
    expect(svg?.getAttribute('content')).not.toContain('currentColor');
  });

  it("draws in the theme's foreground when no color is set", async () => {
    const { container } = await render(UiSpinner);
    const content = container.querySelector('svg')?.getAttribute('content');
    expect(content).toContain(ICON_LIGHT_COLORS['foreground']);
    expect(content).not.toContain('currentColor');
  });

  it('resolves a theme token color', async () => {
    const { container, componentRef } = await render(UiSpinner);
    setInputSignal(
      (componentRef.instance as UiSpinner).color,
      'var(--primary-foreground)',
    );
    await waitForUpdate();
    expect(container.querySelector('svg')?.getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['primary-foreground'],
    );
  });

  it('applies the class input to the spinner', async () => {
    const { container, componentRef } = await render(UiSpinner);
    setInputSignal((componentRef.instance as UiSpinner).userClass, 'ml-2');
    await waitForUpdate();
    expect(container.querySelector('view')?.getAttribute('class')).toBe('ml-2');
  });

  it('resizes for each supported size', async () => {
    const { componentRef, container } = await render(UiSpinner);
    for (const [size, px] of [
      ['xs', 16],
      ['sm', 20],
      ['md', 24],
      ['lg', 32],
    ] as const) {
      setInputSignal((componentRef.instance as UiSpinner).size, size);
      await waitForUpdate();
      const view = container.querySelector('view');
      expect(view?.getAttribute('style')).toContain(`${px}px`);
    }
  });
});
