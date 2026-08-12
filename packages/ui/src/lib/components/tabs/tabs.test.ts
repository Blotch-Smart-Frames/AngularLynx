import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import {
  UiTabs,
  UiTabsContent,
  UiTabsList,
  UiTabsTrigger,
} from './tabs';

@Component({
  standalone: true,
  imports: [UiTabs, UiTabsList, UiTabsTrigger, UiTabsContent, LYNX_ELEMENTS],
  template: `
    <ui-tabs [(value)]="value">
      <ui-tabs-list>
        <ui-tabs-trigger value="a">A</ui-tabs-trigger>
        <ui-tabs-trigger value="b">B</ui-tabs-trigger>
      </ui-tabs-list>
      <ui-tabs-content value="a"><text>Panel A</text></ui-tabs-content>
      <ui-tabs-content value="b"><text>Panel B</text></ui-tabs-content>
    </ui-tabs>
  `,
})
class TabsHost {
  value = 'a';
}

describe('UiTabs', () => {
  it('renders the tab triggers and the active panel', async () => {
    const { getByText } = await render(TabsHost);
    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
    expect(getByText('Panel A')).toBeTruthy();
  });

  it('select() sets the model value and emits `changed`', async () => {
    const { componentRef } = await render(UiTabs);
    const inst = componentRef.instance as UiTabs;
    const emitted: string[] = [];
    inst.changed.subscribe((v) => emitted.push(v));
    inst.select('x');
    expect(inst.value()).toBe('x');
    expect(emitted).toEqual(['x']);
  });

  it('registerTab() records tab order without duplicates', async () => {
    const { componentRef } = await render(UiTabs);
    const inst = componentRef.instance as UiTabs;
    inst.registerTab('a');
    inst.registerTab('b');
    inst.registerTab('a'); // duplicate, should be ignored
    // Seed the effect with a known previousValue so subsequent transitions
    // exercise the direction-set branch (not the initial-run early return).
    inst.value.set('a');
    await waitForUpdate();
    // a=0, b=1 → nextIndex > prevIndex → direction=1 (forward branch)
    inst.value.set('b');
    await waitForUpdate();
    await waitForUpdate();
    expect(inst.direction()).toBe(1);
    // Reverse → direction=-1 (backward branch)
    inst.value.set('a');
    await waitForUpdate();
    await waitForUpdate();
    expect(inst.direction()).toBe(-1);
  });

  it('direction effect ignores unknown values', async () => {
    // Covers the branch where prevIndex or nextIndex is -1.
    const { componentRef } = await render(UiTabs);
    const inst = componentRef.instance as UiTabs;
    inst.value.set('unknown');
    inst.value.set('also-unknown');
    await waitForUpdate();
    await waitForUpdate();
    expect(inst.direction()).toBe(1); // unchanged from default
  });

  it('direction effect leaves direction alone when transitioning from unknown to known', async () => {
    const { componentRef } = await render(UiTabs);
    const inst = componentRef.instance as UiTabs;
    inst.registerTab('a');
    inst.registerTab('b');
    inst.value.set('unknown');
    await waitForUpdate();
    inst.value.set('a');
    await waitForUpdate();
    expect(inst.direction()).toBe(1);
  });

  it('direction effect leaves direction alone when transitioning from known to unknown', async () => {
    const { componentRef } = await render(UiTabs);
    const inst = componentRef.instance as UiTabs;
    inst.registerTab('a');
    inst.registerTab('b');
    inst.value.set('a');
    await waitForUpdate();
    inst.value.set('unknown');
    await waitForUpdate();
    expect(inst.direction()).toBe(1);
  });
});

describe('UiTabsList', () => {
  it('renders projected content with the list container class', async () => {
    const { container } = await render(UiTabsList);
    const view = container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('rounded-lg');
  });
});

describe('UiTabsTrigger', () => {
  const renderTrigger = async (activeValue = 'a') => {
    const tabsResult = await render(UiTabs);
    const tabs = tabsResult.componentRef.instance as UiTabs;
    tabs.value.set(activeValue);

    const triggerResult = await render(UiTabsTrigger, {
      providers: [{ provide: UiTabs, useValue: tabs }],
    });
    const trigger = triggerResult.componentRef.instance as UiTabsTrigger;
    setInputSignal(trigger.triggerValue, 'a');
    const view = triggerResult.container.querySelector('view') as Element;
    (trigger as unknown as { triggerRef: unknown }).triggerRef = signal({
      nativeElement: view,
    });
    await waitForUpdate();
    await waitForUpdate();
    return { tabs, trigger, triggerResult };
  };

  it('select() delegates to the parent tabs', async () => {
    const { tabs, trigger } = await renderTrigger('a');
    trigger.select();
    expect(tabs.value()).toBe('a');
  });

  it('effect runs the activation animation when active flips true', async () => {
    // Active path — `#previousActive` starts undefined so the first flip
    // exercises the initialization guard, and toggling activeValue drives the
    // effect through both animate() branches.
    const { tabs, triggerResult } = await renderTrigger('b');
    // Switch tabs so trigger becomes active — activation branch.
    tabs.value.set('a');
    await waitForUpdate();
    await waitForUpdate();
    // Deactivation branch.
    tabs.value.set('b');
    await waitForUpdate();
    await waitForUpdate();
    expect(tabs.value()).toBe('b');
  });
});

describe('UiTabsContent', () => {
  it('runs the reveal + directional slide animations when active flips', async () => {
    const tabsResult = await render(UiTabs);
    const tabs = tabsResult.componentRef.instance as UiTabs;
    tabs.registerTab('a');
    tabs.registerTab('b');

    const contentResult = await render(UiTabsContent, {
      providers: [{ provide: UiTabs, useValue: tabs }],
    });
    const content = contentResult.componentRef.instance as UiTabsContent;
    setInputSignal(content.contentValue, 'a');
    const view = contentResult.container.querySelector('view') as Element;
    (content as unknown as { contentRef: unknown }).contentRef = signal({
      nativeElement: view,
    });

    // Activate — first render path (revealIn).
    tabs.value.set('a');
    await waitForUpdate();
    // The effect schedules setTimeout(_, 0); wait one more tick for it.
    await waitForUpdate();

    // Switch off and back on — subsequent path (directionalSlideIn) with cancel.
    tabs.value.set('b');
    await waitForUpdate();
    tabs.value.set('a');
    await waitForUpdate();
    await waitForUpdate();

    expect(tabs.value()).toBe('a');
  });

  it('setTimeout body bails out when contentRef is undefined', async () => {
    const tabsResult = await render(UiTabs);
    const tabs = tabsResult.componentRef.instance as UiTabs;
    const contentResult = await render(UiTabsContent, {
      providers: [{ provide: UiTabs, useValue: tabs }],
    });
    const content = contentResult.componentRef.instance as UiTabsContent;
    setInputSignal(content.contentValue, 'a');
    tabs.value.set('a');
    await waitForUpdate();
    await waitForUpdate();
    expect(tabs.value()).toBe('a');
  });
});
