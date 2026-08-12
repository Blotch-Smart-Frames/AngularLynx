import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import {
  UiAccordion,
  UiAccordionContent,
  UiAccordionItem,
  UiAccordionTrigger,
} from './accordion';

@Component({
  standalone: true,
  imports: [
    UiAccordion,
    UiAccordionItem,
    UiAccordionTrigger,
    UiAccordionContent,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-accordion [type]="type">
      <ui-accordion-item value="a">
        <ui-accordion-trigger>A</ui-accordion-trigger>
        <ui-accordion-content><text>Alpha</text></ui-accordion-content>
      </ui-accordion-item>
      <ui-accordion-item value="b">
        <ui-accordion-trigger>B</ui-accordion-trigger>
        <ui-accordion-content><text>Beta</text></ui-accordion-content>
      </ui-accordion-item>
    </ui-accordion>
  `,
})
class AccordionHost {
  type: 'single' | 'multiple' = 'single';
}

describe('UiAccordion', () => {
  it('renders each item trigger', async () => {
    const { getByText } = await render(AccordionHost);
    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
  });

  it('toggle() in single mode replaces the expanded value', async () => {
    const { componentRef } = await render(UiAccordion);
    const acc = componentRef.instance as UiAccordion;
    acc.toggle('a');
    expect(acc.isExpanded('a')).toBe(true);
    acc.toggle('b');
    expect(acc.isExpanded('a')).toBe(false);
    expect(acc.isExpanded('b')).toBe(true);
    acc.toggle('b');
    expect(acc.isExpanded('b')).toBe(false);
  });

  it('renders type="multiple" host without throwing', async () => {
    @Component({
      standalone: true,
      imports: [UiAccordion, LYNX_ELEMENTS],
      template: `<ui-accordion type="multiple" />`,
    })
    class MultiHost {}
    const { container } = await render(MultiHost);
    expect(container).toBeTruthy();
  });

  it('type="multiple" retains previously expanded items', async () => {
    // Directly exercises the multiple-mode branch of `toggle()`. Without this,
    // the `.clear()`-skip branch stays uncovered.
    const { componentRef } = await render(UiAccordion);
    const acc = componentRef.instance as UiAccordion;
    setInputSignal(acc.type, 'multiple');
    await waitForUpdate();
    acc.toggle('a');
    acc.toggle('b');
    expect(acc.isExpanded('a')).toBe(true);
    expect(acc.isExpanded('b')).toBe(true);
  });
});

describe('UiAccordionItem / Trigger / Content', () => {
  /**
   * Render UiAccordionItem directly with a UiAccordion instance provided via
   * DI. Using `render(UiAccordionItem, { providers: [...] })` alone would fail
   * because the required `value` input has no template binding and the
   * component's initial computed reads it — so we set the input before any
   * effect fires. The parent instance comes from rendering UiAccordion (which
   * sets up the internal injection context inputs) and stashing its instance.
   */
  const renderItemWithParent = async () => {
    // Render the accordion first so we have an instance with initialized signals.
    const parentResult = await render(UiAccordion);
    const parent = parentResult.componentRef.instance as UiAccordion;

    // Now render the child with the parent as a DI value. This unmounts the
    // previous render but the parent instance object (a plain JS class) still
    // holds its signals.
    const childResult = await render(UiAccordionItem, {
      providers: [{ provide: UiAccordion, useValue: parent }],
    });
    const item = childResult.componentRef.instance as UiAccordionItem;
    setInputSignal(item.itemValue, 'a');
    await waitForUpdate();
    return { parent, item, result: childResult };
  };

  it('item.toggle() delegates to the parent accordion', async () => {
    const { parent, item } = await renderItemWithParent();
    item.toggle();
    expect(parent.isExpanded('a')).toBe(true);
  });

  it('trigger onTap toggles the parent item', async () => {
    // The trigger injects UiAccordionItem (not UiAccordion) — same pattern.
    const parentResult = await render(UiAccordion);
    const parent = parentResult.componentRef.instance as UiAccordion;

    const itemResult = await render(UiAccordionItem, {
      providers: [{ provide: UiAccordion, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiAccordionItem;
    setInputSignal(item.itemValue, 'a');
    await waitForUpdate();

    const triggerResult = await render(UiAccordionTrigger, {
      providers: [{ provide: UiAccordionItem, useValue: item }],
    });
    const trigger = triggerResult.componentRef.instance as UiAccordionTrigger;
    (trigger as unknown as { onTap: () => void }).onTap();
    expect(parent.isExpanded('a')).toBe(true);
  });

  describe('content effect', () => {
    it('runs the reveal animation after expansion via setTimeout', async () => {
      const parentResult = await render(UiAccordion);
      const parent = parentResult.componentRef.instance as UiAccordion;

      const itemResult = await render(UiAccordionItem, {
        providers: [{ provide: UiAccordion, useValue: parent }],
      });
      const item = itemResult.componentRef.instance as UiAccordionItem;
      setInputSignal(item.itemValue, 'a');
      await waitForUpdate();

      const contentResult = await render(UiAccordionContent, {
        providers: [{ provide: UiAccordionItem, useValue: item }],
      });
      const content = contentResult.componentRef.instance as UiAccordionContent;
      // JIT + jsdom doesn't populate the `#content` viewChild — patch it with a
      // signal returning the outer view so the setTimeout body's `el` check
      // passes and revealIn/cancel actually run.
      const view = contentResult.container.querySelector('view') as Element;
      (content as unknown as { contentRef: unknown }).contentRef = signal({
        nativeElement: view,
      });

      parent.toggle('a');
      await waitForUpdate();
      await waitForUpdate(); // wait for the effect's setTimeout(_, 0) to fire

      // Cancellation path: toggle off then on to re-schedule with `#anim` set.
      parent.toggle('a');
      await waitForUpdate();
      parent.toggle('a');
      await waitForUpdate();
      await waitForUpdate();
      expect(parent.isExpanded('a')).toBe(true);
    });

    it('returns early inside setTimeout when contentRef is undefined', async () => {
      // Covers the `if (!el) return;` true branch — no monkey-patch here, so
      // the viewChild is unresolved and the setTimeout body bails out.
      const parentResult = await render(UiAccordion);
      const parent = parentResult.componentRef.instance as UiAccordion;

      const itemResult = await render(UiAccordionItem, {
        providers: [{ provide: UiAccordion, useValue: parent }],
      });
      const item = itemResult.componentRef.instance as UiAccordionItem;
      setInputSignal(item.itemValue, 'a');
      await waitForUpdate();

      await render(UiAccordionContent, {
        providers: [{ provide: UiAccordionItem, useValue: item }],
      });
      parent.toggle('a');
      await waitForUpdate();
      await waitForUpdate();
      expect(parent.isExpanded('a')).toBe(true);
    });
  });
});
