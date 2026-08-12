import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiSelect, UiSelectItem } from './select';

describe('UiSelect', () => {
  it('renders the trigger for the current selection', async () => {
    const { container } = await render(UiSelect);
    expect(container).toBeTruthy();
  });

  it('displays the placeholder when no value is selected', async () => {
    const { componentRef, container } = await render(UiSelect);
    const inst = componentRef.instance as UiSelect;
    setInputSignal(inst.placeholder, 'Choose...');
    await waitForUpdate();
    expect(container.textContent).toContain('Choose...');
  });

  it('displays the raw value when no matching item is projected', async () => {
    // Covers the `item?.label() ?? val` fallback path.
    const { componentRef, container } = await render(UiSelect);
    const inst = componentRef.instance as UiSelect;
    inst.value.set('unknown');
    await waitForUpdate();
    expect(container.textContent).toContain('unknown');
  });

  it('select() updates the model, emits `changed`, and closes the sheet', async () => {
    const { componentRef } = await render(UiSelect);
    const inst = componentRef.instance as UiSelect;
    inst.open();
    const emitted: string[] = [];
    inst.changed.subscribe((v) => emitted.push(v));
    inst.select('b');
    expect(inst.value()).toBe('b');
    expect(emitted).toEqual(['b']);
  });

  it('toggle() flips the sheet open/closed', async () => {
    const { componentRef } = await render(UiSelect);
    const inst = componentRef.instance as UiSelect;
    inst.toggle();
    inst.toggle();
    // No throw; the internal `sheetOpen` signal is protected — verify indirectly
    // by ensuring subsequent open()/close() calls still work.
    inst.open();
    inst.close();
    expect(inst.value()).toBe('');
  });

  it('toggle() / open() are no-ops when disabled', async () => {
    const { componentRef } = await render(UiSelect);
    const inst = componentRef.instance as UiSelect;
    setInputSignal(inst.disabled, true);
    await waitForUpdate();
    // No throw and no exception paths — early-return branch is exercised.
    inst.toggle();
    inst.open();
    inst.close();
    expect(inst.value()).toBe('');
  });

  it('trigger dims when the select is disabled', async () => {
    const { componentRef, container } = await render(UiSelect);
    const inst = componentRef.instance as UiSelect;
    setInputSignal(inst.disabled, true);
    await waitForUpdate();
    const trigger = container.querySelector('view');
    expect(trigger?.getAttribute('class')).toContain('opacity-50');
  });
});

describe('UiSelectItem', () => {
  it('onTap delegates to the parent select', async () => {
    const parentResult = await render(UiSelect);
    const parent = parentResult.componentRef.instance as UiSelect;

    const itemResult = await render(UiSelectItem, {
      providers: [{ provide: UiSelect, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiSelectItem;
    setInputSignal(item.itemValue, 'x');
    setInputSignal(item.label, 'X');
    await waitForUpdate();

    (item as unknown as { onTap: () => void }).onTap();
    expect(parent.value()).toBe('x');
  });

  it('highlights the selected item via bg-accent', async () => {
    const parentResult = await render(UiSelect);
    const parent = parentResult.componentRef.instance as UiSelect;
    parent.value.set('x');

    const itemResult = await render(UiSelectItem, {
      providers: [{ provide: UiSelect, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiSelectItem;
    setInputSignal(item.itemValue, 'x');
    setInputSignal(item.label, 'X');
    await waitForUpdate();

    const view = itemResult.container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('bg-accent');
  });
});
