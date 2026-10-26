import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiScrollArea } from './scroll-area';

@Component({
  imports: [UiScrollArea, LYNX_ELEMENTS],
  template: `<ui-scroll-area><text>Body</text></ui-scroll-area>`,
})
class ScrollAreaHost {}

/**
 * The values each boolean reached Lynx with, through `__SetAttribute`.
 */
const watchAttributes = () => {
  const mainThread = (
    globalThis as unknown as {
      lynxTestingEnv: { mainThread: { globalThis: Record<string, unknown> } };
    }
  ).lynxTestingEnv.mainThread.globalThis;
  const setAttribute = vi.spyOn(mainThread, '__SetAttribute' as never);
  return {
    last: (name: string): unknown =>
      (setAttribute.mock.calls as unknown[][])
        .filter((call) => call[1] === name)
        .at(-1)?.[2],
    restore: () => setAttribute.mockRestore(),
  };
};

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

  it('hands Lynx real booleans, so the defaults that are on can be turned off', async () => {
    // A false used to remove the attribute, which leaves Lynx's default: on.
    const attributes = watchAttributes();
    const { componentRef } = await render(UiScrollArea);
    const inst = componentRef.instance as UiScrollArea;
    expect(attributes.last('bounces')).toBe(true);
    expect(attributes.last('scroll-bar-enable')).toBe(true);
    setInputSignal(inst.bounces, false);
    setInputSignal(inst.scrollBar, false);
    setInputSignal(inst.nestedScroll, true);
    await waitForUpdate();
    expect(attributes.last('bounces')).toBe(false);
    expect(attributes.last('scroll-bar-enable')).toBe(false);
    expect(attributes.last('enable-nested-scroll')).toBe(true);
    attributes.restore();
  });
});
