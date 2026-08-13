import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiScrollArea } from './scroll-area';

@Component({
  standalone: true,
  imports: [UiScrollArea, LYNX_ELEMENTS],
  template: `<ui-scroll-area><text>Body</text></ui-scroll-area>`,
})
class ScrollAreaHost {}

describe('UiScrollArea', () => {
  it('renders projected content in the scroll view', async () => {
    const { getByText } = await render(ScrollAreaHost);
    expect(getByText('Body')).toBeTruthy();
  });

  it('emits an explicit height when the height input is set', async () => {
    const { componentRef, container } = await render(UiScrollArea);
    setInputSignal((componentRef.instance as UiScrollArea).height, '250px');
    await waitForUpdate();
    const scroll = container.querySelector('scroll-view');
    expect(scroll?.getAttribute('style')).toContain('height: 250px');
  });

  it('flips the content layout for horizontal orientation', async () => {
    const { componentRef, container } = await render(UiScrollArea);
    setInputSignal(
      (componentRef.instance as UiScrollArea).orientation,
      'horizontal',
    );
    await waitForUpdate();
    // The inner content wrapper picks up flex-row for the horizontal branch.
    const rowEl = container.querySelector('.flex-row');
    expect(rowEl).toBeTruthy();
  });
});
