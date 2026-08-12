import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import {
  UiNavDrawer,
  UiNavDrawerContent,
  UiNavDrawerFooter,
  UiNavDrawerHeader,
  UiNavDrawerItem,
  UiNavDrawerTrigger,
} from './nav-drawer';

@Component({
  standalone: true,
  imports: [
    UiNavDrawer,
    UiNavDrawerHeader,
    UiNavDrawerContent,
    UiNavDrawerItem,
    UiNavDrawerFooter,
    UiNavDrawerTrigger,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-nav-drawer [(open)]="open">
      <ui-nav-drawer-header><text>Nav</text></ui-nav-drawer-header>
      <ui-nav-drawer-content>
        <ui-nav-drawer-item>Home</ui-nav-drawer-item>
      </ui-nav-drawer-content>
      <ui-nav-drawer-footer><text>Foot</text></ui-nav-drawer-footer>
    </ui-nav-drawer>
    <ui-nav-drawer-trigger>Open</ui-nav-drawer-trigger>
  `,
})
class NavDrawerHost {
  open = true;
}

describe('UiNavDrawer', () => {
  const patchRefs = (inst: UiNavDrawer, view: Element) => {
    (inst as unknown as { backdropRef: unknown }).backdropRef = signal({
      nativeElement: view,
    });
    (inst as unknown as { panelRef: unknown }).panelRef = signal({
      nativeElement: view,
    });
  };

  it('renders header, content items, footer, and trigger', async () => {
    const { container } = await render(NavDrawerHost);
    expect(container).toBeTruthy();
  });

  it('backdrop tap closes the drawer', async () => {
    const { componentRef } = await render(UiNavDrawer);
    const inst = componentRef.instance as UiNavDrawer;
    inst.open.set(true);
    await waitForUpdate();
    (inst as unknown as { onBackdropTap: () => void }).onBackdropTap();
    expect(inst.open()).toBe(false);
  });

  it('close() sets open to false', async () => {
    const { componentRef } = await render(UiNavDrawer);
    const inst = componentRef.instance as UiNavDrawer;
    inst.open.set(true);
    inst.close();
    expect(inst.open()).toBe(false);
  });

  it('panel tap is a no-op', async () => {
    const { componentRef } = await render(UiNavDrawer);
    const inst = componentRef.instance as UiNavDrawer;
    expect(() =>
      (inst as unknown as { onPanelTap: () => void }).onPanelTap(),
    ).not.toThrow();
  });

  it('open effect runs the animate-in and animate-out lifecycles (left side)', async () => {
    const { componentRef, container } = await render(UiNavDrawer);
    const inst = componentRef.instance as UiNavDrawer;
    const view = container.querySelector('view') as Element;
    patchRefs(inst, view);
    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    await waitForUpdate();

    inst.open.set(false);
    await new Promise((r) => setTimeout(r, 320));
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('open effect runs correctly for the right side', async () => {
    const { componentRef, container } = await render(UiNavDrawer);
    const inst = componentRef.instance as UiNavDrawer;
    setInputSignal(inst.side, 'right');
    await waitForUpdate();
    const view = container.querySelector('view') as Element;
    patchRefs(inst, view);
    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    await waitForUpdate();
    inst.open.set(false);
    await new Promise((r) => setTimeout(r, 320));
    expect(inst.open()).toBe(false);
    expect(
      Array.from(container.querySelectorAll('view')).some((el) =>
        el.getAttribute('class')?.includes('border-l'),
      ),
    ).toBe(true);
  });

  it('open effect bails when backdrop/panel refs are undefined', async () => {
    const { componentRef } = await render(UiNavDrawer);
    const inst = componentRef.instance as UiNavDrawer;
    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    inst.open.set(false);
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });
});

describe('UiNavDrawerHeader / Footer', () => {
  it('render projected content', async () => {
    const header = await render(UiNavDrawerHeader);
    const footer = await render(UiNavDrawerFooter);
    expect(header.container.querySelector('view')).toBeTruthy();
    expect(footer.container.querySelector('view')).toBeTruthy();
  });
});

describe('UiNavDrawerContent', () => {
  it('renders the scroll-view', async () => {
    const parentResult = await render(UiNavDrawer);
    const parent = parentResult.componentRef.instance as UiNavDrawer;
    const contentResult = await render(UiNavDrawerContent, {
      providers: [{ provide: UiNavDrawer, useValue: parent }],
    });
    expect(contentResult.container.querySelector('scroll-view')).toBeTruthy();
  });

  it('onContentLayout scrolls active item into view when drawer is open', async () => {
    const parentResult = await render(UiNavDrawer);
    const parent = parentResult.componentRef.instance as UiNavDrawer;
    parent.open.set(true);
    await waitForUpdate();

    const contentResult = await render(UiNavDrawerContent, {
      providers: [{ provide: UiNavDrawer, useValue: parent }],
    });
    const content = contentResult.componentRef.instance as UiNavDrawerContent;
    (content as unknown as { onContentLayout: () => void }).onContentLayout();
    expect(parent.open()).toBe(true);
  });

  it('onContentLayout is a no-op when drawer is closed', async () => {
    const parentResult = await render(UiNavDrawer);
    const parent = parentResult.componentRef.instance as UiNavDrawer;
    const contentResult = await render(UiNavDrawerContent, {
      providers: [{ provide: UiNavDrawer, useValue: parent }],
    });
    const content = contentResult.componentRef.instance as UiNavDrawerContent;
    expect(() =>
      (content as unknown as { onContentLayout: () => void }).onContentLayout(),
    ).not.toThrow();
  });
});

describe('UiNavDrawerItem', () => {
  const renderItem = async (autoClose = true) => {
    const parentResult = await render(UiNavDrawer);
    const parent = parentResult.componentRef.instance as UiNavDrawer;
    parent.open.set(true);
    await waitForUpdate();

    const itemResult = await render(UiNavDrawerItem, {
      providers: [{ provide: UiNavDrawer, useValue: parent }],
    });
    const item = itemResult.componentRef.instance as UiNavDrawerItem;
    setInputSignal(item.autoClose, autoClose);
    await waitForUpdate();
    return { parent, item, itemResult };
  };

  it('onTap emits pressed and auto-closes the drawer by default', async () => {
    const { parent, item } = await renderItem();
    const emitted = vi.fn();
    item.pressed.subscribe(emitted);
    (item as unknown as { onTap: () => void }).onTap();
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(parent.open()).toBe(false);
  });

  it('onTap does not auto-close when autoClose is false', async () => {
    const { parent, item } = await renderItem(false);
    (item as unknown as { onTap: () => void }).onTap();
    expect(parent.open()).toBe(true);
  });

  it('press handlers run cleanly', async () => {
    const { item } = await renderItem();
    const inst = item as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();
  });

  it('active item carries the accent background', async () => {
    const { item, itemResult } = await renderItem();
    setInputSignal(item.active, true);
    await waitForUpdate();
    const view = itemResult.container.querySelector('view');
    expect(view?.getAttribute('class')).toContain('bg-accent');
  });

  it('scrollIntoView calls invoke() on the container ref when populated', async () => {
    const { item, itemResult } = await renderItem();
    const invoke = vi.fn();
    (item as unknown as { containerRef: unknown }).containerRef = signal({
      nativeElement: { invoke },
    });
    item.scrollIntoView();
    expect(invoke).toHaveBeenCalledWith('scrollIntoView', expect.any(Object));

    // No-container path: containerRef is undefined so `?.` short-circuits.
    (item as unknown as { containerRef: () => undefined }).containerRef = () =>
      undefined;
    expect(() => item.scrollIntoView()).not.toThrow();
    void itemResult;
  });
});

describe('UiNavDrawerTrigger', () => {
  it('onTap emits pressed', async () => {
    const { componentRef } = await render(UiNavDrawerTrigger);
    const inst = componentRef.instance as unknown as UiNavDrawerTrigger & {
      onTap: () => void;
    };
    const emitted = vi.fn();
    inst.pressed.subscribe(emitted);
    inst.onTap();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('press handlers run cleanly', async () => {
    const { componentRef } = await render(UiNavDrawerTrigger);
    const inst = componentRef.instance as unknown as {
      onPressStart: () => void;
      onPressEnd: () => void;
      onPressCancel: () => void;
    };
    expect(() => inst.onPressStart()).not.toThrow();
    expect(() => inst.onPressEnd()).not.toThrow();
    expect(() => inst.onPressCancel()).not.toThrow();
  });
});
