import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { ImagesDemo } from './images-demo';

describe('ImagesDemo', () => {
  it('renders a section title', async () => {
    // 'Bundled assets' is projected content (not an input()-bound value), so it
    // survives render()'s extra tick — unlike DemoScreen's heading input, which
    // the Angular 22 zoneless JIT double-tick can reset (see render-once.ts).
    const { getByText } = await render(ImagesDemo);
    expect(getByText('Bundled assets')).toBeTruthy();
  });

  it('exposes scaling modes and toggles the conditional image', async () => {
    const { componentRef } = await render(ImagesDemo);
    const instance = componentRef.instance as ImagesDemo;

    expect(instance.modes.length).toBeGreaterThan(0);

    expect(instance.showConditional()).toBe(true);
    instance.toggleConditional();
    expect(instance.showConditional()).toBe(false);
  });
});
