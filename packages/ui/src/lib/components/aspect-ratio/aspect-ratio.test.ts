import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { UiAspectRatio } from './aspect-ratio';

@Component({
  imports: [UiAspectRatio, LYNX_ELEMENTS],
  template: `
    <ui-aspect-ratio [ratio]="16 / 9" class="rounded-md">
      <text>Media</text>
    </ui-aspect-ratio>
  `,
})
class AspectRatioHost {}

@Component({
  imports: [UiAspectRatio],
  template: `<ui-aspect-ratio />`,
})
class DefaultHost {}

/**
 * The ratio the box's inline style holds. jsdom writes `aspect-ratio: 1` back
 * as `1` or, in newer versions (an app's), as `1 / 1`.
 */
const ratioOf = (box: HTMLElement) =>
  parseFloat(box.style.getPropertyValue('aspect-ratio'));

describe('UiAspectRatio', () => {
  it('renders with the default 1:1 ratio', async () => {
    const { container } = await render(DefaultHost);
    const box = container.querySelector('.overflow-hidden') as HTMLElement;
    expect(ratioOf(box)).toBe(1);
  });

  // A class on a component lands on its host too (issue #181): the host is
  // the box, so the class styles one element, the one with the ratio.
  it('is one box, with the ratio and the class written on it', async () => {
    const { container, getByText } = await render(AspectRatioHost);
    const box = getByText('Media').parentElement as HTMLElement;
    expect([...container.querySelectorAll('.rounded-md')]).toEqual([box]);
    expect(box.classList).toContain('overflow-hidden');
    expect(ratioOf(box)).toBe(16 / 9);
  });
});
