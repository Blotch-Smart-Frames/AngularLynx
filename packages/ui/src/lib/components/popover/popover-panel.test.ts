import {
  ApplicationRef,
  Component,
  type ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { type MenuPlacement, type MenuRect } from '../menu/menu-placement';
import {
  ARROW_HEIGHT,
  ARROW_WIDTH,
  type PopoverAnchor,
  UiPopoverPanel,
  popoverArrow,
} from './popover-panel';

@Component({
  imports: [LYNX_ELEMENTS, UiPopoverPanel],
  template: `
    <view #anchor class="anchor"><text>Tip</text></view>
    <ui-popover-panel
      #panel
      [open]="open()"
      [anchor]="anchorView().nativeElement"
      [width]="width()"
      (dismissed)="dismissed()"
      (closed)="closed()"
    >
      <view class="body"><text>Liked trips show up first.</text></view>
    </ui-popover-panel>
  `,
})
class PanelHost {
  readonly open = signal(false);
  readonly width = signal<number | undefined>(undefined);
  readonly anchorView = viewChild.required<ElementRef<PopoverAnchor>>('anchor');
  readonly panel = viewChild.required<UiPopoverPanel>('panel');
  readonly dismissed = vi.fn();
  readonly closed = vi.fn();
}

/**
 * The Lynx function that runs an element's UI methods, such as measuring it
 * (`boundingClientRect`). The testing library defines it on the global
 * object, and answers without a box.
 */
type InvokeUIMethod = {
  __InvokeUIMethod: (
    element: Element,
    method: string,
    params: Record<string, unknown>,
    callback: (result: { code: number; data?: unknown }) => void,
  ) => void;
};

/** A phone's screen inside its safe area: 62pt down from the top. */
const AREA: MenuRect = { left: 0, top: 62, width: 402, height: 778 };
/** The marker from the top of the page to the bottom of the safe area. */
const PAGE: MenuRect = { left: 0, top: 0, width: 0, height: 840 };
/** The popover's content at its natural size. */
const CONTENT = { left: 0, top: 0, width: 240, height: 80 };

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };

/**
 * Renders the host on a platform, with the elements answering
 * `boundingClientRect` as on a phone: the anchor at `anchorRect`, the
 * markers at AREA and PAGE, and the content CONTENT. `held` keeps the
 * answers back for the anchor or the rest until `release()`, or makes every
 * measurement fail.
 */
const renderPanel = async ({
  platform = IOS_26,
  anchorRect = { left: 16, top: 200, width: 80, height: 44 },
  area = AREA,
  page = PAGE,
}: {
  /** `SystemInfo`, or null for none, as in a test, where design is Material. */
  platform?: { platform: string; osVersion: string } | null;
  anchorRect?: MenuRect;
  area?: MenuRect;
  page?: MenuRect;
} = {}) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  const pending: (() => void)[] = [];
  const held = { anchor: false, rest: false, measure: true };
  const invoke = vi
    .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
    .mockImplementation((element, method, _params, callback) => {
      if (method !== 'boundingClientRect') {
        callback({ code: 0 });
        return;
      }
      const isAnchor = element.classList.contains('anchor');
      const style = element.getAttribute('style') ?? '';
      const box = !held.measure
        ? undefined
        : isAnchor
          ? anchorRect
          : style.includes('safe-area-inset-right')
            ? area
            : style.includes('safe-area-inset-bottom')
              ? page
              : CONTENT;
      const answer = () => callback({ code: 0, data: box });
      if (isAnchor ? held.anchor : held.rest) pending.push(answer);
      else answer();
    });
  const result = await render(PanelHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const host = result.componentRef.instance as PanelHost;
  const appRef = result.componentRef.injector.get(ApplicationRef);
  const query = (selector: string) =>
    result.container.querySelector(selector) as HTMLElement | null;
  return {
    ...result,
    host,
    invoke,
    held,
    /** Answers the measurements `held` kept back. */
    release: () => {
      for (const answer of pending.splice(0)) answer();
    },
    /** Runs change detection and effects now. */
    tick: () => appRef.tick(),
    /** The panel, the glass with the content in it. */
    panel: () => query('blur-view[ui-glass]:not(.absolute)'),
    content: () => query('.shrink-0')!,
    /** The arrow's box, before iOS 26. */
    arrow: () => query('view.overflow-hidden'),
    area: () =>
      [...result.container.querySelectorAll('view')].find((view) =>
        view.getAttribute('style')?.includes('safe-area-inset-right'),
      )!,
  };
};

type Rendered = Awaited<ReturnType<typeof renderPanel>>;

const style = (element: Element, name: string) =>
  (element as HTMLElement).style.getPropertyValue(name);

/**
 * The box an element's inline style puts it in.
 */
const box = (element: Element) => ({
  left: parseFloat(style(element, 'left')),
  top: parseFloat(style(element, 'top')),
  width: parseFloat(style(element, 'width')),
  height: parseFloat(style(element, 'height')),
});

/**
 * Opens the panel and stops at its start frame, which it leaves after a
 * frame: the measurements are held back, then answered at once.
 */
const toStartFrame = async (rendered: Rendered) => {
  rendered.held.rest = true;
  rendered.host.open.set(true);
  await vi.waitFor(() => expect(rendered.panel()).not.toBeNull());
  rendered.held.rest = false;
  rendered.release();
  await settle();
  expect(rendered.host.panel().phase()).toBe('from');
  rendered.tick();
};

/**
 * Opens the panel and stops while it's measured, before it lays out: the
 * anchor's measurement is held back, then answered.
 */
const toMeasuring = async (rendered: Rendered) => {
  rendered.held.anchor = true;
  rendered.host.open.set(true);
  await waitForUpdate();
  rendered.held.anchor = false;
  rendered.release();
  await settle();
  expect(rendered.host.panel().phase()).toBe('measuring');
};

/**
 * Opens the panel and waits until it has grown to its frame.
 */
const openPanel = async (rendered: Rendered) => {
  rendered.host.open.set(true);
  await vi.waitFor(() => expect(rendered.host.panel().phase()).toBe('open'));
  await waitForUpdate();
};

/**
 * Closes the panel and waits for its close animation to finish.
 */
const closePanel = async (rendered: Rendered) => {
  rendered.host.open.set(false);
  await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());
  await waitForUpdate();
};

/**
 * Lets every pending promise callback run.
 */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/**
 * Lets Lynx's timers run: the touch check waits for the next one.
 */
const nextTimer = () => new Promise((resolve) => setTimeout(resolve, 5));

// The renderer warns that <ui-popover-panel> isn't a Lynx element.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
});

describe('UiPopoverPanel', () => {
  it('is hidden until opened, with only its markers in the page', async () => {
    const { panel, invoke, host } = await renderPanel();

    expect(panel()).toBeNull();
    expect(host.panel().phase()).toBe('closed');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('grows Liquid Glass out of its anchor, over it, on iOS 26', async () => {
    const rendered = await renderPanel();
    const { host, panel, content } = rendered;

    rendered.held.rest = true;
    host.open.set(true);
    // Measured off screen at its natural size first.
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(style(panel()!, 'left')).toBe('-10000px');
    expect(style(panel()!, 'width')).toBe('');
    expect(style(panel()!, 'transition')).toBe('none');
    expect(host.panel().coversAnchor()).toBe(false);
    rendered.held.rest = false;
    rendered.release();
    await settle();
    rendered.tick();

    // Then it sits on the anchor, where it is on the page.
    expect(host.panel().phase()).toBe('from');
    expect(box(panel()!)).toEqual({
      left: 16,
      top: 200,
      width: 80,
      height: 44,
    });
    expect(host.panel().coversAnchor()).toBe(true);

    // ...and grows to its frame, from the anchor's top edge, its content
    // fading in.
    await openPanel(rendered);
    expect(box(panel()!)).toEqual({
      left: 16,
      top: 200,
      width: 240,
      height: 80,
    });
    expect(style(panel()!, 'transition')).toContain('width 350ms');
    expect(style(panel()!, 'opacity')).toBe('1');
    expect(style(panel()!, 'position')).toBe('fixed');
    expect(style(panel()!, 'border-radius')).toBe('24px');
    expect(style(panel()!, 'justify-content')).toBe('flex-start');
    expect(style(panel()!, 'align-items')).toBe('flex-start');
    expect(panel()!.getAttribute('blur-effect')).toBe('glass');
    expect(style(content(), 'opacity')).toBe('1');
    expect(style(content(), 'width')).toBe('240px');
    expect(style(content(), 'height')).toBe('80px');
    // Glass has no arrow.
    expect(rendered.arrow()).toBeNull();

    // Closing shrinks it back into the anchor, quicker.
    host.open.set(false);
    await waitForUpdate();
    expect(box(panel()!).width).toBe(80);
    expect(style(panel()!, 'transition')).toContain('width 250ms');
    await closePanel(rendered);
    expect(panel()).toBeNull();
    expect(host.panel().coversAnchor()).toBe(false);
    expect(host.closed).toHaveBeenCalledTimes(1);
  });

  it('moves a screen reader into the panel once it opens', async () => {
    const rendered = await renderPanel();
    await openPanel(rendered);

    expect(rendered.invoke).toHaveBeenCalledWith(
      rendered.panel(),
      'requestAccessibilityFocus',
      expect.anything(),
      expect.any(Function),
    );
  });

  it('opens upward from its anchor near the bottom of the screen', async () => {
    const rendered = await renderPanel({
      anchorRect: { left: 300, top: 780, width: 90, height: 44 },
    });
    await openPanel(rendered);

    // Lined up with the anchor's bottom and right edges, and pinned there.
    expect(box(rendered.panel()!)).toEqual({
      left: 150,
      top: 824 - 80,
      width: 240,
      height: 80,
    });
    expect(style(rendered.panel()!, 'justify-content')).toBe('flex-end');
    expect(style(rendered.panel()!, 'align-items')).toBe('flex-end');
  });

  it('takes the width it is given', async () => {
    const rendered = await renderPanel();
    rendered.host.width.set(270);
    await waitForUpdate();
    rendered.held.rest = true;
    rendered.host.open.set(true);
    await vi.waitFor(() => expect(rendered.panel()).not.toBeNull());
    expect(style(rendered.content(), 'width')).toBe('270px');
    rendered.release();

    await openPanel(rendered);
    expect(box(rendered.panel()!).width).toBe(270);
  });

  it('keeps the content inside the safe area once it knows its width', async () => {
    const rendered = await renderPanel();
    rendered.held.rest = true;
    rendered.host.open.set(true);
    await vi.waitFor(() => expect(rendered.panel()).not.toBeNull());
    expect(style(rendered.content(), 'max-width')).toBe('');

    fireLynxEvent(rendered.area(), 'layoutchange', {
      detail: { width: 402 },
    });
    await waitForUpdate();
    expect(style(rendered.content(), 'max-width')).toBe('386px');
    rendered.release();
  });

  it('undoes the scale of a web preview drawn smaller than the app', async () => {
    /**
     * The docs draw the app at 0.5: boundingClientRect measures half of
     * everything, and layoutchange reports the app's own width.
     */
    const half = (rect: MenuRect): MenuRect => ({
      left: rect.left / 2,
      top: rect.top / 2,
      width: rect.width / 2,
      height: rect.height / 2,
    });
    const rendered = await renderPanel({
      anchorRect: half({ left: 16, top: 200, width: 80, height: 44 }),
      area: half(AREA),
      page: half(PAGE),
    });
    fireLynxEvent(rendered.area(), 'layoutchange', {
      detail: { width: 402 },
    });
    await openPanel(rendered);

    // The content measured 240 wide at half scale: 480, as wide as the
    // safe area allows.
    expect(box(rendered.panel()!)).toEqual({
      left: 8,
      top: 200,
      width: 386,
      height: 160,
    });
  });

  it('measures nothing where the elements give no box', async () => {
    const rendered = await renderPanel();
    rendered.held.measure = false;
    // A layout event with no size, as a hidden element sends.
    fireLynxEvent(rendered.area(), 'layoutchange', {});
    fireLynxEvent(rendered.area(), 'layoutchange', { detail: {} });
    await openPanel(rendered);

    // Kept its margin from the edges of a safe area of no size.
    expect(box(rendered.panel()!)).toEqual({
      left: 8,
      top: 8,
      width: 0,
      height: 0,
    });
  });

  it('opens beside its anchor, with an arrow, before iOS 26', async () => {
    const rendered = await renderPanel({ platform: IOS_18 });
    const { host, panel } = rendered;

    // It grows from a corner, with no arrow yet.
    await toStartFrame(rendered);
    expect(box(panel()!).width).toBeCloseTo(72);
    expect(rendered.arrow()).toBeNull();

    await openPanel(rendered);
    // Below the anchor, an arrow's height and a little away.
    expect(box(panel()!)).toEqual({
      left: 16,
      top: 244 + ARROW_HEIGHT + 2,
      width: 240,
      height: 80,
    });
    expect(style(panel()!, 'border-radius')).toBe('13px');
    expect(panel()!.getAttribute('blur-effect')).toBe('extra-light');
    expect(host.panel().coversAnchor()).toBe(false);
    // The arrow points up at the anchor's middle.
    const arrow = rendered.arrow()!;
    expect(box(arrow)).toEqual({
      left: 56 - ARROW_WIDTH / 2,
      top: 244 + 2,
      width: ARROW_WIDTH,
      height: ARROW_HEIGHT,
    });
    const square = arrow.querySelector('blur-view')!;
    expect(style(square, 'transform')).toBe('rotate(45deg)');
    expect(parseFloat(style(square, 'top'))).toBeGreaterThan(0);

    // It doesn't shrink with the panel, so it goes as the panel closes.
    host.open.set(false);
    await waitForUpdate();
    expect(rendered.arrow()).toBeNull();
  });

  it('points its arrow down at an anchor below it', async () => {
    const rendered = await renderPanel({
      platform: IOS_18,
      anchorRect: { left: 160, top: 780, width: 80, height: 44 },
    });
    await openPanel(rendered);

    const arrow = rendered.arrow()!;
    expect(box(arrow).top).toBe(780 - ARROW_HEIGHT - 2);
    expect(box(arrow).left).toBe(200 - ARROW_WIDTH / 2);
    const square = arrow.querySelector('blur-view')!;
    expect(parseFloat(style(square, 'top'))).toBeLessThan(0);
  });

  it('has no arrow when it can only cover its anchor', async () => {
    // As tall as the screen: there's room neither below nor above.
    const rendered = await renderPanel({
      platform: IOS_18,
      anchorRect: { left: 16, top: 92, width: 80, height: 44 },
      area: { ...AREA, height: 100 },
      page: { ...PAGE, height: 162 },
    });
    await openPanel(rendered);

    expect(rendered.arrow()).toBeNull();
  });

  it('unfolds a Material surface from its edge on Android, fading it in', async () => {
    const rendered = await renderPanel({ platform: null });
    const { host, panel } = rendered;

    // A sliver along the edge nearest the anchor, transparent.
    await toStartFrame(rendered);
    expect(box(panel()!).height).toBe(0);
    expect(style(panel()!, 'opacity')).toBe('0');

    await openPanel(rendered);
    expect(box(panel()!)).toEqual({
      left: 16,
      top: 244 + 8,
      width: 240,
      height: 80,
    });
    expect(style(panel()!, 'opacity')).toBe('1');
    expect(style(panel()!, 'border-radius')).toBe('16px');
    expect(panel()!.classList).toContain('bg-secondary');
    expect(rendered.arrow()).toBeNull();
    expect(host.panel().coversAnchor()).toBe(false);
  });

  it('appears in place under Reduce Motion, only fading its content', async () => {
    settings.reduceMotion.set(true);
    const rendered = await renderPanel();
    const { panel } = rendered;

    // Already at its frame, rather than at the anchor.
    await toStartFrame(rendered);
    expect(box(panel()!).width).toBe(240);

    await openPanel(rendered);
    expect(style(panel()!, 'transition')).toMatch(
      /^opacity 350ms cubic-bezier\([^)]*\)$/,
    );
    expect(style(rendered.content(), 'transition')).toContain('opacity');
  });

  describe('closes on a touch outside it', () => {
    it('closes on a touch anywhere else, which still reaches what it touched', async () => {
      const rendered = await renderPanel();
      await openPanel(rendered);

      // Lynx runs the panel's global listener for a touch on any element.
      fireLynxEvent(rendered.panel()!, 'touchstart', {}, 'global-bindEvent');
      expect(rendered.host.dismissed).not.toHaveBeenCalled();
      await nextTimer();
      expect(rendered.host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('closes on a mouse press anywhere else, in the web preview', async () => {
      const rendered = await renderPanel();
      await openPanel(rendered);

      fireLynxEvent(rendered.panel()!, 'mousedown', {}, 'global-bindEvent');
      await nextTimer();
      expect(rendered.host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('stays open for a touch or a mouse press on itself', async () => {
      const rendered = await renderPanel();
      await openPanel(rendered);
      const panel = rendered.panel()!;

      fireLynxEvent(panel, 'touchstart', {}, 'global-bindEvent');
      fireLynxEvent(panel, 'touchstart', {}, 'bindEvent');
      await nextTimer();
      fireLynxEvent(panel, 'mousedown', {}, 'bindEvent');
      fireLynxEvent(panel, 'mousedown', {}, 'global-bindEvent');
      await nextTimer();
      expect(rendered.host.dismissed).not.toHaveBeenCalled();

      // The next touch elsewhere still closes it.
      fireLynxEvent(panel, 'touchstart', {}, 'global-bindEvent');
      await nextTimer();
      expect(rendered.host.dismissed).toHaveBeenCalledTimes(1);
    });

    it('stays open for a touch on its arrow', async () => {
      const rendered = await renderPanel({ platform: IOS_18 });
      await openPanel(rendered);
      const arrow = rendered.arrow()!;

      fireLynxEvent(arrow, 'touchstart', {}, 'bindEvent');
      fireLynxEvent(arrow, 'mousedown', {}, 'bindEvent');
      fireLynxEvent(rendered.panel()!, 'touchstart', {}, 'global-bindEvent');
      await nextTimer();
      expect(rendered.host.dismissed).not.toHaveBeenCalled();
    });

    it('stays open for a touch on its anchor, which toggles it', async () => {
      const rendered = await renderPanel();
      await openPanel(rendered);

      rendered.host.panel().touchedAnchor();
      fireLynxEvent(rendered.panel()!, 'touchstart', {}, 'global-bindEvent');
      await nextTimer();
      expect(rendered.host.dismissed).not.toHaveBeenCalled();
    });

    it("doesn't keep a touch on its anchor from before it opened", async () => {
      const rendered = await renderPanel();
      // The touch that opens it, which no global listener heard.
      rendered.host.panel().touchedAnchor();
      await openPanel(rendered);

      fireLynxEvent(rendered.panel()!, 'touchstart', {}, 'global-bindEvent');
      await nextTimer();
      expect(rendered.host.dismissed).toHaveBeenCalledTimes(1);
    });
  });

  describe('when opened and closed quickly', () => {
    it('closes at once while it is still being measured', async () => {
      const rendered = await renderPanel();
      rendered.held.rest = true;
      rendered.host.open.set(true);
      await vi.waitFor(() => expect(rendered.panel()).not.toBeNull());

      rendered.host.open.set(false);
      await waitForUpdate();
      expect(rendered.panel()).toBeNull();
      expect(rendered.host.closed).toHaveBeenCalledTimes(1);
      // The measurements it was waiting for change nothing.
      rendered.release();
      await settle();
      expect(rendered.host.panel().phase()).toBe('closed');
    });

    it('stops when closed before its anchor is measured', async () => {
      const rendered = await renderPanel();
      rendered.held.anchor = true;
      rendered.host.open.set(true);
      await waitForUpdate();
      rendered.host.open.set(false);
      await waitForUpdate();

      rendered.release();
      await settle();
      expect(rendered.panel()).toBeNull();
      expect(rendered.host.closed).not.toHaveBeenCalled();
    });

    it('stops when closed while it waits to be laid out', async () => {
      const rendered = await renderPanel();
      await toMeasuring(rendered);
      rendered.host.open.set(false);
      rendered.tick();
      // Reopened at once: the first open's wait ends, and gives way.
      rendered.host.open.set(true);
      await openPanel(rendered);
      expect(box(rendered.panel()!).width).toBe(240);
    });

    it('stops when closed while it sits at its start frame', async () => {
      const rendered = await renderPanel();
      await toStartFrame(rendered);

      rendered.host.open.set(false);
      rendered.tick();
      await closePanel(rendered);
      expect(rendered.host.panel().phase()).toBe('closed');
    });

    it('finishes closing at once when reopened while closing', async () => {
      const rendered = await renderPanel();
      await openPanel(rendered);
      rendered.host.open.set(false);
      await waitForUpdate();
      expect(rendered.host.panel().phase()).toBe('closing');

      rendered.host.open.set(true);
      await openPanel(rendered);
      // The interrupted close never reported, and its timer gave way.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(rendered.host.closed).not.toHaveBeenCalled();
      expect(rendered.host.panel().phase()).toBe('open');
    });

    it('stops its timers when destroyed while opening', async () => {
      const rendered = await renderPanel();
      await toMeasuring(rendered);
      rendered.unmount();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(rendered.host.closed).not.toHaveBeenCalled();
    });
  });
});

describe('popoverArrow', () => {
  const placement = (
    overrides: Partial<MenuPlacement> = {},
  ): MenuPlacement => ({
    frame: { left: 100, top: 300, width: 200, height: 100 },
    anchor: { left: 180, top: 250, width: 40, height: 40 },
    vertical: 'top',
    horizontal: 'left',
    ...overrides,
  });

  it("points up at an anchor above, at the anchor's middle", () => {
    expect(popoverArrow(placement(), 13)).toEqual({
      left: 200 - ARROW_WIDTH / 2,
      top: 300 - ARROW_HEIGHT,
      up: true,
    });
  });

  it('points down at an anchor below', () => {
    expect(
      popoverArrow(
        placement({
          anchor: { left: 180, top: 420, width: 40, height: 40 },
          vertical: 'bottom',
        }),
        13,
      ),
    ).toEqual({ left: 200 - ARROW_WIDTH / 2, top: 400, up: false });
  });

  it('keeps clear of the corners', () => {
    const near = (left: number) =>
      popoverArrow(
        placement({ anchor: { left, top: 250, width: 10, height: 40 } }),
        13,
      )?.left;
    expect(near(0)).toBe(113);
    expect(near(400)).toBe(300 - 13 - ARROW_WIDTH);
  });

  it('is null when the popover covers its anchor', () => {
    expect(
      popoverArrow(
        placement({ anchor: { left: 180, top: 320, width: 40, height: 40 } }),
        13,
      ),
    ).toBeNull();
    expect(
      popoverArrow(
        placement({
          anchor: { left: 180, top: 320, width: 40, height: 40 },
          vertical: 'bottom',
        }),
        13,
      ),
    ).toBeNull();
  });
});
