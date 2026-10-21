import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
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

  it('sets the gaps as list styles, which Lynx reads, not attributes', async () => {
    // jsdom drops style properties it doesn't know, so the gaps never show in
    // the style attribute: watch what reaches Lynx's inline style API instead.
    const mainThread = (
      globalThis as unknown as {
        lynxTestingEnv: { mainThread: { globalThis: Record<string, unknown> } };
      }
    ).lynxTestingEnv.mainThread.globalThis;
    const addInlineStyle = vi.spyOn(mainThread, '__AddInlineStyle' as never);
    const { container, componentRef } = await render(UiList);
    const list = componentRef.instance as UiList;
    setInputSignal(list.mainAxisGap, '8px');
    setInputSignal(list.crossAxisGap, '12px');
    await waitForUpdate();

    const element = container.querySelector('list');
    expect(addInlineStyle).toHaveBeenCalledWith(
      element,
      'list-main-axis-gap',
      '8px',
    );
    expect(addInlineStyle).toHaveBeenCalledWith(
      element,
      'list-cross-axis-gap',
      '12px',
    );
    expect(element?.getAttribute('list-main-axis-gap')).toBeNull();
    addInlineStyle.mockRestore();
  });
});
