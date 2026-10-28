// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BLUR_VIEW_LAYOUT_CSS, applyBlurViewLayout } from './blur-view-layout';

describe('applyBlurViewLayout', () => {
  it('maps Lynx’s layout variables onto the host, like x-view', () => {
    const element = document.createElement('x-blur-view');
    const root = element.attachShadow({ mode: 'open' });
    applyBlurViewLayout(element);
    const style = root.querySelector('style');
    expect(style?.textContent).toBe(BLUR_VIEW_LAYOUT_CSS);
    expect(BLUR_VIEW_LAYOUT_CSS).toMatch(/^:host\{/);
    expect(BLUR_VIEW_LAYOUT_CSS).toContain(
      'flex-direction:var(--lynx-display-linear,var(--linear-flex-direction)) var(--lynx-display-flex,var(--flex-direction))',
    );
  });

  it("hands the host's layout to the slot, where its children's flex rules look", () => {
    expect(BLUR_VIEW_LAYOUT_CSS).toContain(
      'slot{--lynx-display:inherit;--lynx-linear-orientation:inherit;--lynx-linear-weight-sum:inherit}',
    );
  });

  it('does nothing without a shadow root', () => {
    const element = document.createElement('x-blur-view');
    expect(() => applyBlurViewLayout(element)).not.toThrow();
  });
});
