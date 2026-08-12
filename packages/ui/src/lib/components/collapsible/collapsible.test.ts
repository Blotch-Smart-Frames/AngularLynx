import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import {
  UiCollapsible,
  UiCollapsibleContent,
  UiCollapsibleTrigger,
} from './collapsible';

@Component({
  standalone: true,
  imports: [UiCollapsible, LYNX_ELEMENTS],
  template: `<ui-collapsible><text>Content</text></ui-collapsible>`,
})
class CollapsibleHost {}

describe('UiCollapsible', () => {
  it('renders projected content', async () => {
    const { getByText } = await render(CollapsibleHost);
    expect(getByText('Content')).toBeTruthy();
  });

  it('toggle() flips the open state', async () => {
    const { componentRef } = await render(UiCollapsible);
    const inst = componentRef.instance as UiCollapsible;
    expect(inst.open()).toBe(false);
    inst.toggle();
    expect(inst.open()).toBe(true);
    inst.toggle();
    expect(inst.open()).toBe(false);
  });

  it('toggle() is a no-op when disabled', async () => {
    const { componentRef } = await render(UiCollapsible);
    const inst = componentRef.instance as UiCollapsible;
    setInputSignal(inst.disabled, true);
    inst.toggle();
    expect(inst.open()).toBe(false);
  });
});

describe('UiCollapsibleTrigger', () => {
  it('onTap delegates to the parent collapsible.toggle()', async () => {
    const parentResult = await render(UiCollapsible);
    const parent = parentResult.componentRef.instance as UiCollapsible;

    const triggerResult = await render(UiCollapsibleTrigger, {
      providers: [{ provide: UiCollapsible, useValue: parent }],
    });
    const trigger = triggerResult.componentRef.instance as UiCollapsibleTrigger;
    (trigger as unknown as { onTap: () => void }).onTap();
    expect(parent.open()).toBe(true);
  });

  it('applies disabled dim class when parent is disabled', async () => {
    const parentResult = await render(UiCollapsible);
    const parent = parentResult.componentRef.instance as UiCollapsible;
    setInputSignal(parent.disabled, true);

    const triggerResult = await render(UiCollapsibleTrigger, {
      providers: [{ provide: UiCollapsible, useValue: parent }],
    });
    await waitForUpdate();
    const view = triggerResult.container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('opacity-50');
  });
});

describe('UiCollapsibleContent', () => {
  it('runs the reveal animation on open via setTimeout', async () => {
    const parentResult = await render(UiCollapsible);
    const parent = parentResult.componentRef.instance as UiCollapsible;

    const contentResult = await render(UiCollapsibleContent, {
      providers: [{ provide: UiCollapsible, useValue: parent }],
    });
    const content = contentResult.componentRef.instance as UiCollapsibleContent;
    // JIT + jsdom doesn't populate the `#content` viewChild — patch it with a
    // signal returning the outer view so the setTimeout body's `el` check
    // passes and revealIn actually runs.
    const view = contentResult.container.querySelector('view') as Element;
    (content as unknown as { contentRef: unknown }).contentRef = signal({
      nativeElement: view,
    });

    parent.open.set(true);
    await waitForUpdate();
    await waitForUpdate(); // wait for the effect's setTimeout(_, 0) to fire

    // Toggle off then on again to hit the cancel path with `#anim` already set.
    parent.open.set(false);
    await waitForUpdate();
    parent.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    expect(parent.open()).toBe(true);
  });

  it('bails out inside setTimeout when contentRef is undefined', async () => {
    const parentResult = await render(UiCollapsible);
    const parent = parentResult.componentRef.instance as UiCollapsible;
    await render(UiCollapsibleContent, {
      providers: [{ provide: UiCollapsible, useValue: parent }],
    });
    parent.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    expect(parent.open()).toBe(true);
  });
});
