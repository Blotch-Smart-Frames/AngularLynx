import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { BlurViewDemo } from './blur-view-demo';

let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
});

describe('BlurViewDemo', () => {
  it('renders native blur-view elements, not view fallbacks', async () => {
    const { container, destroy } = await renderOnce(BlurViewDemo);
    destroyDemo = destroy;
    // One backdrop blur, one glass-container, and three glass shapes.
    expect(container.querySelectorAll('blur-view').length).toBe(5);
    expect(
      container.querySelector('blur-view[blur-effect="glass-container"]'),
    ).toBeTruthy();
  });

  it('forwards the selected radius to the backdrop blur', async () => {
    const { instance, container, destroy } = await renderOnce(BlurViewDemo);
    destroyDemo = destroy;
    const backdrop = container.querySelector('blur-view[blur-radius]');
    expect(backdrop?.getAttribute('blur-radius')).toBe('16px');

    instance.radius.set(32);
    await new Promise((resolve) => setTimeout(resolve));
    expect(backdrop?.getAttribute('blur-radius')).toBe('32px');
  });
});
