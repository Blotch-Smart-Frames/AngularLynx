import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiRadioGroup, UiRadioGroupItem } from './radio-group';

@Component({
  standalone: true,
  imports: [UiRadioGroup, UiRadioGroupItem, LYNX_ELEMENTS],
  template: `
    <ui-radio-group [(value)]="value">
      <ui-radio-group-item value="a">A</ui-radio-group-item>
      <ui-radio-group-item value="b">B</ui-radio-group-item>
    </ui-radio-group>
  `,
})
class RadioGroupHost {
  value = 'a';
}

describe('UiRadioGroup', () => {
  it('renders each radio item', async () => {
    const { getByText } = await render(RadioGroupHost);
    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
  });

  it('select() updates the model and emits `changed`', async () => {
    const { componentRef } = await render(UiRadioGroup);
    const inst = componentRef.instance as UiRadioGroup;
    const emitted: string[] = [];
    inst.changed.subscribe((v) => emitted.push(v));
    inst.select('a');
    expect(inst.value()).toBe('a');
    inst.select('b');
    expect(inst.value()).toBe('b');
    expect(emitted).toEqual(['a', 'b']);
  });

  it('select() is a no-op when disabled', async () => {
    const { componentRef } = await render(UiRadioGroup);
    const inst = componentRef.instance as UiRadioGroup;
    setInputSignal(inst.disabled, true);
    const emitted = vi.fn();
    inst.changed.subscribe(emitted);
    inst.select('x');
    expect(inst.value()).toBe('');
    expect(emitted).not.toHaveBeenCalled();
  });
});

describe('UiRadioGroupItem', () => {
  it('select() delegates to the parent group', async () => {
    const parentResult = await render(UiRadioGroup);
    const parent = parentResult.componentRef.instance as UiRadioGroup;

    const itemResult = await render(UiRadioGroupItem, {
      providers: [{ provide: UiRadioGroup, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiRadioGroupItem;
    setInputSignal(item.itemValue, 'a');
    await waitForUpdate();

    item.select();
    expect(parent.value()).toBe('a');
  });

  it('select() is a no-op when the parent group is disabled', async () => {
    const parentResult = await render(UiRadioGroup);
    const parent = parentResult.componentRef.instance as UiRadioGroup;
    setInputSignal(parent.disabled, true);

    const itemResult = await render(UiRadioGroupItem, {
      providers: [{ provide: UiRadioGroup, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiRadioGroupItem;
    setInputSignal(item.itemValue, 'a');
    await waitForUpdate();

    item.select();
    expect(parent.value()).toBe('');
  });

  it('effect runs the popIn / popOut animation on selection change', async () => {
    // The effect skips the first run (initial mount) then swaps between popIn
    // (select) and popOut (deselect). Exercise both branches by toggling the
    // parent's value across two mounted items.
    // JIT + jsdom does not populate the `#dot` viewChild query, so
    // monkey-patch dotRef with a signal returning a fake ElementRef so the
    // `if (!el || previousSelected === undefined)` guard doesn't short-circuit.
    const parentResult = await render(UiRadioGroup);
    const parent = parentResult.componentRef.instance as UiRadioGroup;

    const itemResult = await render(UiRadioGroupItem, {
      providers: [{ provide: UiRadioGroup, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiRadioGroupItem;
    setInputSignal(item.itemValue, 'a');
    const view = itemResult.container.querySelector('view') as Element;
    (item as unknown as { dotRef: unknown }).dotRef = signal({
      nativeElement: view,
    });
    await waitForUpdate();

    // Effect first run initializes `#previousSelected`, then returns.
    // Select => popIn branch.
    parent.value.set('a');
    await waitForUpdate();
    // Deselect => popOut branch.
    parent.value.set('b');
    await waitForUpdate();
    expect(parent.value()).toBe('b');
  });
});
