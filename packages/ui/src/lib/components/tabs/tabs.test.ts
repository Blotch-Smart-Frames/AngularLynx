import { Component, signal, viewChild } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { UiTabs, UiTabsContent, UiTabsList, UiTabsTrigger } from './tabs';

@Component({
  imports: [UiTabs, UiTabsList, UiTabsTrigger, UiTabsContent, LYNX_ELEMENTS],
  template: `
    <ui-tabs [(value)]="value" (changed)="changes.push($event)" class="w-80">
      <ui-tabs-list class="mb-2">
        <ui-tabs-trigger value="account" class="px-4">Account</ui-tabs-trigger>
        <ui-tabs-trigger value="billing">Billing</ui-tabs-trigger>
        <ui-tabs-trigger value="contact">Contact</ui-tabs-trigger>
      </ui-tabs-list>
      <ui-tabs-content value="account" class="gap-2">
        <text>Account panel</text>
      </ui-tabs-content>
      <ui-tabs-content value="billing">
        <text>Billing panel</text>
      </ui-tabs-content>
      <ui-tabs-content value="contact">
        <text>Contact panel</text>
      </ui-tabs-content>
    </ui-tabs>
  `,
})
class TabsHost {
  readonly value = signal('account');
  readonly changes: string[] = [];
  readonly tabs = viewChild.required(UiTabs);
}

const renderTabs = async () => {
  const result = await render(TabsHost);
  /**
   * A trigger's own view, which holds the tap listener, around its label.
   */
  const trigger = (label: string) => result.getByText(label).parentElement!;
  /**
   * A panel's own view, which wraps its projected text.
   */
  const panel = (text: string) => result.getByText(text).parentElement!;
  return {
    ...result,
    host: result.componentRef.instance as TabsHost,
    trigger,
    panel,
    /** The display of a panel's host element, which shows or hides it. */
    displayOf: (text: string) =>
      (panel(text).parentElement as HTMLElement).style.display,
    tap: async (label: string) => {
      fireEvent.tap(trigger(label));
      await waitForUpdate();
    },
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

describe('UiTabs', () => {
  it("merges each part's class with its own", async () => {
    const { container, trigger, panel } = await renderTabs();
    // Each host element carries the given class too, so look for the view
    // that has both its own and the given class.
    expect(container.querySelector('.flex-col.w-80')).not.toBeNull();
    expect(container.querySelector('.rounded-lg.mb-2')).not.toBeNull();
    expect(trigger('Account').classList).toContain('rounded-sm');
    expect(trigger('Account').classList).toContain('px-4');
    expect(panel('Account panel').classList).toContain('mt-2');
    expect(panel('Account panel').classList).toContain('gap-2');
  });

  it("shows only the selected tab's panel, and highlights its trigger", async () => {
    const { getByText, trigger, displayOf } = await renderTabs();
    expect(displayOf('Account panel')).toBe('flex');
    expect(displayOf('Billing panel')).toBe('none');
    expect(displayOf('Contact panel')).toBe('none');

    expect(trigger('Account').classList).toContain('bg-background');
    expect(getByText('Account').classList).toContain('text-foreground');
    expect(trigger('Billing').classList).toContain('bg-transparent');
    expect(getByText('Billing').classList).toContain('text-muted-foreground');
  });

  it('selects a tab when its trigger is tapped', async () => {
    const { host, tap, trigger, displayOf } = await renderTabs();
    await tap('Billing');
    expect(host.value()).toBe('billing');
    expect(host.changes).toEqual(['billing']);
    expect(displayOf('Account panel')).toBe('none');
    expect(displayOf('Billing panel')).toBe('flex');
    expect(trigger('Billing').classList).toContain('bg-background');
    expect(trigger('Account').classList).toContain('bg-transparent');
  });

  it('shows the tab its value is set to, without reporting a change', async () => {
    const { host, displayOf } = await renderTabs();
    host.value.set('contact');
    await waitForUpdate();
    expect(displayOf('Contact panel')).toBe('flex');
    expect(displayOf('Account panel')).toBe('none');
    // `changed` reports what the user selects, not what the app sets.
    expect(host.changes).toEqual([]);
  });

  it('keeps its slide direction for a value with no trigger', async () => {
    const { host, tap } = await renderTabs();
    await tap('Contact');
    await tap('Billing');
    expect(host.tabs().direction()).toBe(-1);

    // Neither moving to nor moving from a value without a trigger has a
    // place in the tab order to slide from.
    host.value.set('archived');
    await waitForUpdate();
    expect(host.tabs().direction()).toBe(-1);
    host.value.set('contact');
    await waitForUpdate();
    expect(host.tabs().direction()).toBe(-1);
  });

  describe('animations', () => {
    // Watched per test: the testing library resets the main thread after each.
    let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
    beforeEach(() => {
      animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    });
    afterEach(() => animate.mockRestore());

    /**
     * The keyframes of the animations started on an element.
     */
    const keyframesOn = (element: Element) =>
      animate.mock.calls
        .filter(
          ([target, [operation]]) => target === element && operation === START,
        )
        .map(([, [, , keyframes]]) => keyframes);

    /**
     * The keys of the animations started on an element.
     */
    const keysOn = (element: Element) =>
      animate.mock.calls
        .filter(
          ([target, [operation]]) => target === element && operation === START,
        )
        .map(([, [, key]]) => key);

    const reveal = [
      { transform: 'translateY(6px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ];
    const slideFrom = (x: number) => [
      { transform: `translateX(${x}px)`, opacity: 0 },
      { transform: 'translateX(0px)', opacity: 1 },
    ];
    const activate = [
      { transform: 'scaleX(0.95)', opacity: 0.7 },
      { transform: 'scaleX(1)', opacity: 1 },
    ];
    const deactivate = [
      { transform: 'scaleX(1)', opacity: 1 },
      { transform: 'scaleX(0.97)', opacity: 0.7 },
    ];

    it('reveals a panel the first time it shows, then slides it in from the side of its tab', async () => {
      const { panel, tap } = await renderTabs();
      // The panel waits a macrotask so its display has applied before it
      // animates; this update lets that run.
      await waitForUpdate();
      expect(keyframesOn(panel('Account panel'))).toEqual([reveal]);

      await tap('Contact');
      await waitForUpdate();
      expect(keyframesOn(panel('Contact panel'))).toEqual([reveal]);

      // Account is left of Contact, so its panel slides in from the left.
      await tap('Account');
      await waitForUpdate();
      expect(keyframesOn(panel('Account panel'))).toEqual([
        reveal,
        slideFrom(-24),
      ]);
      // Showing it again stopped its earlier reveal first.
      const [revealKey] = keysOn(panel('Account panel'));
      expect(animate).toHaveBeenCalledWith(panel('Account panel'), [
        CANCEL,
        revealKey,
      ]);

      // Contact is right of Account, so its panel slides in from the right.
      await tap('Contact');
      await waitForUpdate();
      expect(keyframesOn(panel('Contact panel'))).toEqual([
        reveal,
        slideFrom(24),
      ]);
    });

    it('scales a trigger up when selected and down when deselected', async () => {
      const { trigger, tap } = await renderTabs();
      // Nothing changed selection yet, so no trigger animates.
      expect(keyframesOn(trigger('Account'))).toEqual([]);

      await tap('Billing');
      expect(keyframesOn(trigger('Billing'))).toEqual([activate]);
      expect(keyframesOn(trigger('Account'))).toEqual([deactivate]);

      await tap('Account');
      expect(keyframesOn(trigger('Account'))).toEqual([deactivate, activate]);
      // Each animation stops the trigger's previous one.
      const [deactivateKey] = keysOn(trigger('Account'));
      expect(animate).toHaveBeenCalledWith(trigger('Account'), [
        CANCEL,
        deactivateKey,
      ]);
    });

    it("doesn't animate a selection that changed back within one frame", async () => {
      const { host, trigger, tap } = await renderTabs();
      await tap('Billing');
      await waitForUpdate();
      animate.mockClear();

      // Two taps before the next update: Billing is selected again.
      fireEvent.tap(trigger('Contact'));
      fireEvent.tap(trigger('Billing'));
      await waitForUpdate();
      await waitForUpdate();
      expect(host.changes).toEqual(['billing', 'contact', 'billing']);
      expect(animate).not.toHaveBeenCalled();
      // The direction still points the way Billing was reached, from Account.
      expect(host.tabs().direction()).toBe(1);
    });
  });
});
