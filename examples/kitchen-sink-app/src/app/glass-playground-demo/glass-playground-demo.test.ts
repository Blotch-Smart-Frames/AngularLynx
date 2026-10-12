import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { GlassPlaygroundDemo } from './glass-playground-demo';

let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
});

describe('GlassPlaygroundDemo', () => {
  it('renders the draggable glass blobs inside one glass-container', async () => {
    const { container, destroy } = await renderOnce(GlassPlaygroundDemo);
    destroyDemo = destroy;
    const glassContainer = container.querySelector(
      'blur-view[blur-effect="glass-container"]',
    );
    expect(glassContainer).toBeTruthy();
    // The blobs must be children of the container for the glass to merge.
    expect(
      glassContainer?.querySelectorAll('blur-view[blur-effect="glass"]').length,
    ).toBe(3);
  });

  it('renders the text the glass refracts', async () => {
    const { container, destroy } = await renderOnce(GlassPlaygroundDemo);
    destroyDemo = destroy;
    expect(container.textContent).toContain('Liquid');
    expect(container.textContent).toContain('Refract');
  });

  it('defaults to clear, non-interactive glass with a 24 merge distance', async () => {
    const { instance, destroy } = await renderOnce(GlassPlaygroundDemo);
    destroyDemo = destroy;
    expect(instance.glassStyle()).toBe('clear');
    expect(instance.interactive()).toBe(false);
    expect(instance.spacing()).toBe(24);
  });
});
