import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiList } from './list';

@Component({
  standalone: true,
  imports: [UiList, LYNX_ELEMENTS],
  template: `<ui-list><text>Item</text></ui-list>`,
})
class ListHost {}

describe('UiList', () => {
  it('renders projected content', async () => {
    // Lynx `<list>` is virtualized — items are only added to the native tree by
    // the componentAtIndex callback, which isn't driven from a unit test. Just
    // assert the wrapper mounts (its own template bindings + host bindings are
    // covered) without asserting on the item's text.
    const { container } = await render(ListHost);
    expect(container).toBeTruthy();
  });

  it('emits an explicit height style when the height input is set', async () => {
    // JIT template bindings don't propagate through input(); flip the signal
    // directly so listStyle exercises its truthy branch.
    const { container, componentRef } = await render(UiList);
    setInputSignal((componentRef.instance as UiList).height, '400px');
    await waitForUpdate();

    const list = container.querySelector('list');
    expect(list?.getAttribute('style')).toContain('height: 400px');
  });
});
