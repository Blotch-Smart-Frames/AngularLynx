import { Component, signal, viewChild } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
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
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import {
  type TabsListVariant,
  UiTabs,
  UiTabsContent,
  UiTabsList,
  UiTabsTrigger,
} from './tabs';

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
    expect(
      container.querySelector('[accessibility-traits="tabbar"]'),
    ).not.toBeNull();
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

  it('reads to a screen reader as a tab bar, with the selected tab selected', async () => {
    const { getByRole, tap } = await renderTabs();
    expect(getByRole('tablist')).toBeTruthy();
    expect(
      getByRole('button', { name: 'Account', selected: true }),
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'Billing', selected: false }),
    ).toBeTruthy();
    await tap('Billing');
    expect(
      getByRole('button', { name: 'Billing', selected: true }),
    ).toBeTruthy();
  });

  it('clips a hidden panel, whose text iOS would draw from its corner', async () => {
    const { panel } = await renderTabs();
    const hostOf = (text: string) => panel(text).parentElement as HTMLElement;
    expect(hostOf('Billing panel').style.overflow).toBe('hidden');
    expect(hostOf('Account panel').style.overflow).toBe('');
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

    it('changes at once under Reduce Motion', async () => {
      const reduced = {
        reduceMotion: signal(true),
        reduceTransparency: signal(false),
        increaseContrast: signal(false),
      };
      const result = await render(TabsHost, {
        providers: [{ provide: LynxAccessibilitySettings, useValue: reduced }],
      });
      await waitForUpdate();
      // Only this test's animations: the last test's panels may still have
      // had a reveal waiting for its tick.
      animate.mockClear();
      fireEvent.tap(result.getByText('Billing').parentElement!);
      await waitForUpdate();
      await waitForUpdate();
      expect(animate).not.toHaveBeenCalled();
      expect(
        (
          result.getByText('Billing panel').parentElement!
            .parentElement as HTMLElement
        ).style.display,
      ).toBe('flex');
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

@Component({
  imports: [UiTabs, UiTabsList, UiTabsTrigger, UiTabsContent, LYNX_ELEMENTS],
  template: `
    <ui-tabs
      [value]="value()"
      (valueChange)="value.set($event)"
      (changed)="changes.push($event)"
    >
      <ui-tabs-list [variant]="variant()">
        @for (tab of tabs; track tab) {
          <ui-tabs-trigger
            [value]="tab"
            [class]="tab === 'People' ? 'flex-[2]' : ''"
            >{{ tab }}</ui-tabs-trigger
          >
        }
      </ui-tabs-list>
      @for (tab of tabs; track tab) {
        <ui-tabs-content [value]="tab"
          ><text>{{ tab }} panel</text></ui-tabs-content
        >
      }
    </ui-tabs>
  `,
})
class SegmentedTabsHost {
  readonly tabs = ['Photos', 'Albums', 'People'];
  readonly value = signal('Photos');
  readonly variant = signal<TabsListVariant>('segmented');
  readonly changes: string[] = [];
}

/**
 * A trigger outside a list, which has no segmented control to report to.
 */
@Component({
  imports: [UiTabs, UiTabsTrigger, LYNX_ELEMENTS],
  template: `
    <ui-tabs value="a">
      <ui-tabs-trigger value="a">Alone</ui-tabs-trigger>
    </ui-tabs>
  `,
})
class LoneTriggerHost {}

/** Accessibility settings, as the host app would report them. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

describe('UiTabsList, segmented', () => {
  // The indicator's selector isn't a Lynx element, so the renderer falls
  // back to a <view> for it and warns.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderSegmented = async (
    platform = { platform: 'iOS', osVersion: '26.0' },
  ) => {
    vi.stubGlobal('SystemInfo', platform);
    const result = await render(SegmentedTabsHost, {
      providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
    });
    /**
     * A trigger's own view, around its label.
     */
    const trigger = (label: string) => result.getByText(label).parentElement!;
    /**
     * A trigger's host, the track's flex item.
     */
    const slot = (label: string) => trigger(label).parentElement!;
    const track = () => slot('Photos').parentElement!;
    /**
     * The indicator's frame, which moves between the tabs.
     */
    const frame = () =>
      track().querySelector<HTMLElement>('.h-full .bottom-0.top-0');
    return {
      ...result,
      host: result.componentRef.instance as SegmentedTabsHost,
      trigger,
      slot,
      track,
      frame,
      measure: async () => {
        for (const [label, width] of [
          ['Photos', 90],
          ['Albums', 90],
          ['People', 180],
        ] as const) {
          fireEvent.layoutchange(slot(label), { detail: { width } });
        }
        await waitForUpdate();
      },
      /** The display of a panel's host element, which shows or hides it. */
      displayOf: (text: string) =>
        (result.getByText(text).parentElement!.parentElement as HTMLElement)
          .style.display,
    };
  };

  it("draws the platform's segmented control, filling its width, its tabs sharing it", async () => {
    const { track, slot, trigger, frame, getByText } = await renderSegmented();
    expect(track().classList).toContain('rounded-full');
    expect(track().classList).not.toContain('self-start');
    expect(slot('Albums').classList).toContain('flex-1');
    expect(slot('People').classList).toContain('flex-[2]');
    expect(trigger('Photos').classList).toContain('justify-center');
    expect(getByText('Photos').classList).toContain('font-medium');
    expect(getByText('Albums').classList).not.toContain('font-medium');
    expect(frame()).not.toBeNull();
  });

  it("switches panels on a tap, without the default tabs' scale animation", async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { host, trigger, displayOf, getByRole } = await renderSegmented();
    fireEvent.tap(trigger('Albums'));
    await waitForUpdate();
    expect(host.value()).toBe('Albums');
    expect(host.changes).toEqual(['Albums']);
    expect(displayOf('Albums panel')).toBe('flex');
    expect(
      getByRole('button', { name: 'Albums', selected: true }),
    ).toBeTruthy();
    expect(
      animate.mock.calls.filter(([target]) => target === trigger('Albums')),
    ).toEqual([]);
  });

  it('switches to the tab the indicator is dragged to', async () => {
    const { host, trigger, track, frame, measure } = await renderSegmented();
    await measure();
    expect(frame()!.style.left).toBe('0px');

    fireEvent.touchstart(trigger('Photos'), { touches: [{ pageX: 45 }] });
    fireEvent.touchmove(trigger('Photos'), { touches: [{ pageX: 300 }] });
    fireEvent.touchend(trigger('Photos'));
    // The tap Lynx may send as the finger lifts doesn't pick Photos again.
    fireEvent.tap(trigger('Photos'));
    await waitForUpdate();
    expect(host.value()).toBe('People');
    expect(host.changes).toEqual(['People']);
    expect(frame()!.style.left).toBe('180px');

    // Taken away, a drag goes back.
    fireEvent.touchstart(trigger('People'), { touches: [{ pageX: 270 }] });
    fireEvent.touchmove(trigger('People'), { touches: [{ pageX: 20 }] });
    fireEvent.touchcancel(trigger('People'));
    await waitForUpdate();
    expect(frame()!.style.left).toBe('180px');

    // In the web preview, with the mouse, until it leaves the row.
    fireEvent.mousedown(trigger('People'), { pageX: 270 });
    fireEvent.mousemove(trigger('Albums'), { pageX: 150 });
    fireLynxEvent(trigger('People'), 'mouseleave');
    await waitForUpdate();
    expect(frame()!.style.left).toBe('60px');
    fireLynxEvent(track(), 'mouseleave');
    await waitForUpdate();
    expect(frame()!.style.left).toBe('180px');

    fireEvent.mousedown(trigger('People'), { pageX: 270 });
    fireEvent.mousemove(trigger('Albums'), { pageX: 150 });
    fireEvent.mouseup(trigger('Albums'));
    await waitForUpdate();
    expect(host.value()).toBe('Albums');
  });

  it("is Material's connected button group on Android", async () => {
    const { trigger, getByText } = await renderSegmented({
      platform: 'Android',
      osVersion: '15',
    });
    expect(trigger('Photos').classList).toContain('bg-primary');
    expect(trigger('Photos').style.transition).toContain('background-color');
    expect(getByText('Photos').classList).toContain('text-primary-foreground');
    // A press shows Material's state layer.
    fireEvent.touchstart(trigger('Albums'), { touches: [{ pageX: 150 }] });
    await waitForUpdate();
    expect(trigger('Albums').querySelector('.opacity-10')).not.toBeNull();
  });

  it('goes back to the default tabs when the variant changes', async () => {
    const { host, track, slot, frame } = await renderSegmented();
    host.variant.set('default');
    await waitForUpdate();
    expect(track().classList).toContain('self-start');
    expect(slot('Photos').classList).not.toContain('flex-1');
    expect(frame()).toBeNull();
  });

  it('lets a trigger outside a list take touches as the default tabs do', async () => {
    const result = await render(LoneTriggerHost);
    const trigger = result.getByText('Alone').parentElement!;
    fireEvent.layoutchange(trigger.parentElement!, { detail: { width: 80 } });
    fireEvent.touchstart(trigger, { touches: [{ pageX: 10 }] });
    fireEvent.touchmove(trigger, { touches: [{ pageX: 60 }] });
    fireEvent.touchend(trigger);
    fireEvent.touchcancel(trigger);
    fireLynxEvent(trigger, 'mouseleave');
    fireEvent.tap(trigger);
    await waitForUpdate();
    expect(trigger.classList).toContain('bg-background');
    expect(trigger.parentElement!.classList).not.toContain('flex-1');
  });
});
