import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from './popover';

@Component({
  imports: [LYNX_ELEMENTS, UiPopover, UiPopoverContent, UiPopoverTrigger],
  template: `
    <ui-popover
      [open]="open()"
      (openChange)="open.set($event)"
      (closed)="closed()"
    >
      @if (withTrigger()) {
        <view
          uiPopoverTrigger
          class="trigger"
          [accessibility-element]="true"
          accessibility-traits="button"
          accessibility-label="Tip"
        >
          <text>Tip</text>
        </view>
      }
      <ui-popover-content class="w-60 p-3">
        <text>Liked trips show up first.</text>
      </ui-popover-content>
    </ui-popover>
    <view class="like" (bindtap)="liked()"><text>Like</text></view>
  `,
})
class PopoverHost {
  readonly open = signal(false);
  readonly withTrigger = signal(true);
  readonly closed = vi.fn();
  readonly liked = vi.fn();
}

/**
 * The Lynx function that runs an element's UI methods, such as measuring it
 * (`boundingClientRect`). The testing library defines it on the global
 * object.
 */
type InvokeUIMethod = {
  __InvokeUIMethod: (
    element: Element,
    method: string,
    params: Record<string, unknown>,
    callback: (result: { code: number; data?: unknown }) => void,
  ) => void;
};

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

/**
 * Renders the popover on a platform (none for Material), measuring elements
 * as `boundingClientRect` would on a phone: the safe area's markers a
 * phone's screen, the content 240 by 80, and anything else, the trigger, a
 * small box near the top.
 */
const renderPopover = async (
  platform: { platform: string; osVersion: string } | null = {
    platform: 'iOS',
    osVersion: '26.0',
  },
) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  const measured: Element[] = [];
  vi.spyOn(
    globalThis as unknown as InvokeUIMethod,
    '__InvokeUIMethod',
  ).mockImplementation((element, method, _params, callback) => {
    if (method !== 'boundingClientRect') {
      callback({ code: 0 });
      return;
    }
    measured.push(element);
    const style = element.getAttribute('style') ?? '';
    const data = style.includes('safe-area-inset')
      ? { left: 0, top: 0, width: 402, height: 840 }
      : element.classList.contains('shrink-0')
        ? { left: 0, top: 0, width: 240, height: 80 }
        : { left: 16, top: 80, width: 80, height: 44 };
    callback({ code: 0, data });
  });
  const result = await render(PopoverHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const host = result.componentRef.instance as PopoverHost;
  return {
    ...result,
    host,
    measured,
    trigger: () => result.container.querySelector('.trigger') as HTMLElement,
    panel: () =>
      result.container.querySelector(
        'blur-view[ui-glass]',
      ) as HTMLElement | null,
  };
};

type Rendered = Awaited<ReturnType<typeof renderPopover>>;

/**
 * Waits until the popover has grown to its frame, its content shown.
 */
const waitForOpen = async ({ container }: Rendered) => {
  await vi.waitFor(() =>
    expect(
      (container.querySelector('.shrink-0') as HTMLElement | null)?.style
        .opacity,
    ).toBe('1'),
  );
};

/**
 * Lets Lynx's timers run: the touch check waits for the next one.
 */
const nextTimer = () => new Promise((resolve) => setTimeout(resolve, 5));

// The renderer warns that <ui-popover> and its parts aren't Lynx elements.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UiPopover', () => {
  it('opens and closes when its trigger is tapped', async () => {
    const rendered = await renderPopover();
    const { host, trigger, getByText } = rendered;

    fireEvent.tap(trigger());
    expect(host.open()).toBe(true);
    await waitForOpen(rendered);
    expect(getByText('Liked trips show up first.')).toBeTruthy();
    // It opened from the trigger.
    expect(rendered.measured[0]).toBe(trigger());

    fireEvent.tap(trigger());
    expect(host.open()).toBe(false);
    await vi.waitFor(() => expect(host.closed).toHaveBeenCalledTimes(1));
    await waitForUpdate();
    expect(rendered.panel()).toBeNull();
  });

  it('closes on a touch outside it, which still reaches what it touched', async () => {
    const rendered = await renderPopover();
    rendered.host.open.set(true);
    await waitForOpen(rendered);

    // A tap on the like button: Lynx tells the popover through its global
    // listener, and the button gets its tap as ever.
    fireLynxEvent(rendered.panel()!, 'touchstart', {}, 'global-bindEvent');
    fireEvent.tap(rendered.container.querySelector('.like')!);
    await nextTimer();
    expect(rendered.host.open()).toBe(false);
    expect(rendered.host.liked).toHaveBeenCalledTimes(1);
  });

  it("doesn't take a touch on its trigger for one outside it", async () => {
    const rendered = await renderPopover();
    rendered.host.open.set(true);
    await waitForOpen(rendered);

    fireLynxEvent(rendered.trigger(), 'touchstart', {}, 'bindEvent');
    fireLynxEvent(rendered.panel()!, 'touchstart', {}, 'global-bindEvent');
    await nextTimer();
    fireLynxEvent(rendered.trigger(), 'mousedown', {}, 'bindEvent');
    fireLynxEvent(rendered.panel()!, 'mousedown', {}, 'global-bindEvent');
    await nextTimer();
    expect(rendered.host.open()).toBe(true);
  });

  it('hides its trigger while Liquid Glass grows out of it', async () => {
    const rendered = await renderPopover();
    expect(rendered.trigger().style.opacity).toBe('');

    rendered.host.open.set(true);
    await waitForOpen(rendered);
    expect(rendered.trigger().style.opacity).toBe('0');

    rendered.host.open.set(false);
    await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());
    await waitForUpdate();
    expect(rendered.trigger().style.opacity).toBe('');
  });

  it('leaves its trigger showing beside a Material surface', async () => {
    const rendered = await renderPopover(null);
    rendered.host.open.set(true);
    await waitForOpen(rendered);

    expect(rendered.trigger().style.opacity).toBe('');
  });

  it('opens from itself when nothing is its trigger', async () => {
    const rendered = await renderPopover();
    rendered.host.withTrigger.set(false);
    await waitForUpdate();

    rendered.host.open.set(true);
    await waitForOpen(rendered);
    // The popover's own element, which holds the content's slot.
    expect(rendered.measured[0]).not.toBe(rendered.trigger());
    expect(rendered.measured[0]?.classList.contains('like')).toBe(false);
  });
});

describe('UiPopoverContent', () => {
  it('is a padded column, with its class on its own element', async () => {
    const rendered = await renderPopover();
    rendered.host.open.set(true);
    await waitForOpen(rendered);

    const content = rendered.getByText(
      'Liked trips show up first.',
    ).parentElement!;
    expect(content.classList).toContain('flex-col');
    expect(content.classList).toContain('w-60');
    expect(content.classList).toContain('p-3');
    expect(content.classList).not.toContain('p-4');
  });
});
