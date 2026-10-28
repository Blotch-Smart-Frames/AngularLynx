import {
  ApplicationRef,
  Component,
  type ElementRef,
  type Provider,
  signal,
  viewChild,
} from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { provideIconTheme } from '../icon/icon-theme';
import { type MenuElement, type MenuKind, UiMenuPopup } from './menu-popup';
import { type MenuRect } from './menu-placement';

@Component({
  imports: [LYNX_ELEMENTS, UiMenuPopup],
  template: `
    <view
      #home
      class="home"
      [style.width.px]="popup.placeholder()?.width"
      [style.height.px]="popup.placeholder()?.height"
    >
      <view #anchor class="anchor"><text>Kyoto</text></view>
    </view>
    <ui-menu-popup
      #popup
      [open]="open()"
      [kind]="kind()"
      [anchor]="anchorView().nativeElement"
      [anchorHome]="lifting() ? homeView().nativeElement : null"
      (dismissed)="dismissed()"
      (closed)="closed()"
    >
      <view class="item"><text>Share</text></view>
    </ui-menu-popup>
  `,
})
class PopupHost {
  readonly open = signal(false);
  readonly kind = signal<MenuKind>('pull-down');
  readonly lifting = signal(false);
  readonly anchorView = viewChild.required<ElementRef<MenuElement>>('anchor');
  readonly homeView = viewChild.required<ElementRef<MenuElement>>('home');
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

/** The safe area of a phone, on screen. */
const AREA: MenuRect = { left: 0, top: 62, width: 402, height: 778 };
/** The menu's content, at rest. */
const CONTENT_HEIGHT = 120;

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
 * `boundingClientRect` as on a phone: the anchor at `anchorRect`, the safe
 * area at AREA, and the menu CONTENT_HEIGHT tall. `held` keeps the answers
 * for the elements it picks until `release()`.
 */
const renderPopup = async ({
  platform = IOS_26,
  anchorRect = { left: 16, top: 162, width: 370, height: 96 },
  area = AREA,
  contentHeight = CONTENT_HEIGHT,
  providers = [],
}: {
  area?: MenuRect;
  contentHeight?: number;
  /** `SystemInfo`, or null for none, as in a test, where design is Material. */
  platform?: { platform: string; osVersion: string } | null;
  anchorRect?: MenuRect;
  providers?: Provider[];
} = {}) => {
  vi.stubGlobal('SystemInfo', platform ?? undefined);
  const pending: (() => void)[] = [];
  const held = { anchor: false, menu: false, measure: true };
  const invoke = vi
    .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
    .mockImplementation((element, method, _params, callback) => {
      if (method !== 'boundingClientRect') {
        callback({ code: 0 });
        return;
      }
      const isAnchor = element.classList.contains('anchor');
      const box = !held.measure
        ? undefined
        : isAnchor
          ? anchorRect
          : element.parentElement?.tagName.toLowerCase() === 'scroll-view'
            ? { left: 0, top: 0, width: 250, height: contentHeight }
            : area;
      const answer = () => callback({ code: 0, data: box });
      if (isAnchor ? held.anchor : held.menu) pending.push(answer);
      else answer();
    });
  const result = await render(PopupHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as PopupHost;
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
    overlay: () => query('overlay')!,
    backdrop: () => query('overlay > view')!,
    panel: () => query('overlay blur-view[ui-glass]')!,
    scroller: () => query('overlay scroll-view')!,
    slot: () =>
      query('overlay blur-view[ui-glass]')!
        .previousElementSibling as HTMLElement,
    anchor: () => query('.anchor')!,
    home: () => query('.home')!,
  };
};

type Rendered = Awaited<ReturnType<typeof renderPopup>>;

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
 * Opens the menu and waits until it has grown to its frame.
 */
const openMenu = async (rendered: Rendered) => {
  rendered.host.open.set(true);
  await vi.waitFor(() =>
    expect(rendered.panel().getAttribute('accessibility-exclusive-focus')).toBe(
      'true',
    ),
  );
};

/**
 * Closes the menu and waits for its close animation to finish.
 */
const closeMenu = async (rendered: Rendered) => {
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

// The renderer warns that <ui-menu-popup> isn't a Lynx element.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
});

describe('UiMenuPopup', () => {
  it('is hidden until opened', async () => {
    const { overlay, invoke } = await renderPopup();

    expect(overlay().getAttribute('visible')).toBe('false');
    expect(style(overlay(), 'display')).toBe('none');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('grows a pull-down menu out of its anchor, as one glass shape', async () => {
    const rendered = await renderPopup();
    const { host, overlay, panel, scroller } = rendered;

    rendered.held.menu = true;
    host.open.set(true);
    // Measured off screen at its natural size first.
    await vi.waitFor(() =>
      expect(overlay().getAttribute('visible')).toBe('true'),
    );
    expect(style(panel(), 'left')).toBe('-10000px');
    expect(style(panel(), 'width')).toBe('');
    expect(style(panel(), 'transition')).toBe('none');
    rendered.release();

    // ...and grows to the menu, with a spring, its items fading in.
    await openMenu(rendered);
    expect(box(panel())).toEqual({
      left: 16,
      top: 100,
      width: 250,
      height: 120,
    });
    expect(style(panel(), 'transition')).toContain('width 350ms');
    expect(style(scroller(), 'opacity')).toBe('1');
    expect(style(scroller(), 'height')).toBe('120px');
    expect(style(panel(), 'opacity')).toBe('1');
    expect(style(panel(), 'justify-content')).toBe('flex-start');
    expect(style(panel(), 'align-items')).toBe('flex-start');
    expect(panel().getAttribute('blur-effect')).toBe('glass');
    expect(panel().getAttribute('accessibility-exclusive-focus')).toBe('true');
    // A pull-down menu doesn't dim the screen or move its anchor.
    expect(overlay().querySelector('.bg-glass-dim')).toBeNull();
    expect(rendered.home().contains(rendered.anchor())).toBe(true);

    await closeMenu(rendered);
    expect(overlay().getAttribute('visible')).toBe('false');
    expect(host.closed).toHaveBeenCalledTimes(1);
  });

  it('moves a screen reader into the menu once it opens', async () => {
    const rendered = await renderPopup();

    await openMenu(rendered);

    expect(rendered.invoke).toHaveBeenCalledWith(
      rendered.panel(),
      'requestAccessibilityFocus',
      expect.anything(),
      expect.any(Function),
    );
  });

  it('shrinks back into its anchor as it closes', async () => {
    const rendered = await renderPopup();
    await openMenu(rendered);

    rendered.host.open.set(false);
    await waitForUpdate();

    expect(box(rendered.panel())).toEqual({
      left: 16,
      top: 100,
      width: 370,
      height: 96,
    });
    expect(style(rendered.panel(), 'transition')).toContain('width 250ms');
    expect(style(rendered.scroller(), 'opacity')).toBe('0');
    expect(rendered.host.closed).not.toHaveBeenCalled();
    await closeMenu(rendered);
  });

  it('opens toward the middle of the screen from an anchor in a corner', async () => {
    const rendered = await renderPopup({
      anchorRect: { left: 340, top: 790, width: 44, height: 44 },
    });

    await openMenu(rendered);

    // Lined up with the anchor's right edge, and standing on its bottom edge,
    // inside the margin at the bottom of the safe area.
    expect(box(rendered.panel())).toEqual({
      left: 384 - 250,
      top: 778 - 8 - 120,
      width: 250,
      height: 120,
    });
    expect(style(rendered.panel(), 'justify-content')).toBe('flex-end');
    expect(style(rendered.panel(), 'align-items')).toBe('flex-end');
  });

  it('reports a tap outside the menu, and Android back, as dismissing it', async () => {
    const rendered = await renderPopup();
    await openMenu(rendered);

    fireEvent.tap(rendered.panel(), { eventType: 'catchEvent' });
    expect(rendered.host.dismissed).not.toHaveBeenCalled();

    fireEvent.tap(rendered.backdrop());
    fireLynxEvent(rendered.overlay(), 'requestclose');
    expect(rendered.host.dismissed).toHaveBeenCalledTimes(2);
  });

  it("measures in the app's pixels where the app is drawn scaled", async () => {
    /**
     * A box drawn at half its size, as a docs preview might draw the app:
     * boundingClientRect gives boxes like that, while the safe area's layout
     * gives its real width.
     */
    const half = (box: MenuRect): MenuRect => ({
      left: box.left / 2,
      top: box.top / 2,
      width: box.width / 2,
      height: box.height / 2,
    });
    const rendered = await renderPopup({
      anchorRect: half({ left: 16, top: 162, width: 370, height: 96 }),
      area: half(AREA),
      contentHeight: CONTENT_HEIGHT / 2,
    });
    const area = rendered.panel().parentElement!;
    fireLynxEvent(area, 'layoutchange', { detail: { width: AREA.width } });

    await openMenu(rendered);

    expect(box(rendered.panel())).toEqual({
      left: 16,
      top: 100,
      width: 250,
      height: 120,
    });
  });

  it('takes a layout without a size as unknown', async () => {
    const rendered = await renderPopup();
    fireLynxEvent(rendered.panel().parentElement!, 'layoutchange');

    await openMenu(rendered);

    expect(box(rendered.panel()).width).toBe(250);
  });

  it('opens even where the elements answer without a box', async () => {
    const rendered = await renderPopup();
    rendered.held.measure = false;

    await openMenu(rendered);

    // Nothing to place it by: it opens at the area's top-left corner.
    expect(box(rendered.panel())).toEqual({
      left: 8,
      top: 8,
      width: 0,
      height: 0,
    });
  });

  describe('as a context menu', () => {
    const renderContext = async (
      options: Parameters<typeof renderPopup>[0] = {},
    ) => {
      const rendered = await renderPopup(options);
      rendered.host.kind.set('context');
      rendered.host.lifting.set(true);
      await waitForUpdate();
      return rendered;
    };

    it('lifts the element above a dimming layer and opens beside it', async () => {
      const rendered = await renderContext();
      const { host, overlay, panel, slot } = rendered;

      rendered.held.menu = true;
      host.open.set(true);
      await vi.waitFor(() =>
        expect(overlay().getAttribute('visible')).toBe('true'),
      );
      expect(slot().children).toHaveLength(0);
      rendered.release();
      await settle();
      rendered.tick();
      // The element moves into the overlay where it was, and its home keeps
      // its size; the menu starts small, in the corner nearest it.
      expect(slot().contains(rendered.anchor())).toBe(true);
      expect(box(slot())).toEqual({
        left: 16,
        top: 100,
        width: 370,
        height: NaN,
      });
      expect(style(rendered.home(), 'width')).toBe('370px');
      expect(style(rendered.home(), 'height')).toBe('96px');
      expect(box(panel())).toEqual({
        left: 16,
        top: 204,
        width: 75,
        height: 36,
      });

      await openMenu(rendered);
      expect(box(panel())).toEqual({
        left: 16,
        top: 204,
        width: 250,
        height: 120,
      });
      const dim = overlay().querySelector('.bg-glass-dim')!;
      expect(style(dim, 'opacity')).toBe('1');
      expect(style(dim, 'transition')).toContain('opacity 250ms');
      expect(style(slot(), 'transform')).toBe('scale(1.03)');
      expect(style(slot(), 'transition')).toContain('transform 350ms');
      // iOS 26 dims; it doesn't blur.
      expect(overlay().querySelector('blur-view:not([ui-glass])')).toBeNull();

      await closeMenu(rendered);
      // The element is back where it was, and its home sizes to it again.
      expect(rendered.home().querySelector('.anchor')?.textContent).toBe(
        'Kyoto',
      );
      expect(slot().children).toHaveLength(0);
      expect(style(rendered.home(), 'height')).toBe('');
    });

    it('moves the lifted element up when the menu fits on neither side', async () => {
      const rendered = await renderContext({
        anchorRect: { left: 16, top: 162, width: 370, height: 600 },
      });

      await openMenu(rendered);

      // 778 - 8 - 120 - 8 - 600: the element rises to make room below it.
      expect(style(rendered.slot(), 'top')).toBe('42px');
      expect(box(rendered.panel()).top).toBe(42 + 600 + 8);
    });

    it('blurs the screen behind it before iOS 26, in the app color scheme', async () => {
      const light = await renderContext({ platform: IOS_18 });
      await openMenu(light);

      const blur = light.overlay().querySelector('blur-view:not([ui-glass])')!;
      expect(blur.getAttribute('blur-effect')).toBe('light');
      expect(style(blur, 'opacity')).toBe('1');
      light.unmount();

      const dark = await renderContext({
        platform: IOS_18,
        providers: [provideIconTheme({ colorScheme: 'dark' })],
      });
      expect(
        dark
          .overlay()
          .querySelector('blur-view:not([ui-glass])')!
          .getAttribute('blur-effect'),
      ).toBe('dark');
    });

    it('opens a Material menu beside the element, without lifting or dimming it', async () => {
      const rendered = await renderContext({ platform: null });
      const { host, overlay, panel } = rendered;

      // It unfolds and fades in...
      await openMenu(rendered);
      expect(box(panel())).toEqual({
        left: 16,
        top: 204,
        width: 224,
        height: 120,
      });
      expect(style(panel(), 'opacity')).toBe('1');

      // ...and folds back into a sliver along the edge nearest the element,
      // fading out.
      host.open.set(false);
      await waitForUpdate();
      expect(box(panel())).toEqual({
        left: 16,
        top: 204,
        width: 224,
        height: 0,
      });
      expect(style(panel(), 'opacity')).toBe('0');
      expect(overlay().querySelector('.bg-glass-dim')).toBeNull();
      expect(rendered.home().contains(rendered.anchor())).toBe(true);
      expect(style(rendered.home(), 'height')).toBe('');
    });

    it('follows Reduce Motion: nothing grows, moves or lifts, and only fades play', async () => {
      settings.reduceMotion.set(true);
      const rendered = await renderContext({
        anchorRect: { left: 16, top: 162, width: 370, height: 600 },
      });
      const { host, panel, slot } = rendered;

      host.open.set(true);
      await vi.waitFor(() => expect(style(panel(), 'width')).toBe('250px'));
      // At its frame from the start, and the element already where it goes.
      expect(box(panel()).height).toBe(120);
      expect(style(slot(), 'top')).toBe('42px');

      await openMenu(rendered);
      expect(style(slot(), 'transform')).toBe('scale(1)');
      expect(style(slot(), 'transition')).toBe('none');
      expect(style(panel(), 'transition')).toBe(
        'opacity 350ms cubic-bezier(0.22, 1.2, 0.36, 1)',
      );
    });
  });

  describe('when it closes before it has opened', () => {
    it('stops before the anchor is measured', async () => {
      const rendered = await renderPopup();
      rendered.held.anchor = true;

      rendered.host.open.set(true);
      await waitForUpdate();
      rendered.host.open.set(false);
      await waitForUpdate();
      rendered.release();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(rendered.overlay().getAttribute('visible')).toBe('false');
      expect(rendered.host.closed).not.toHaveBeenCalled();
    });

    it('stops while the overlay lays out, and reports it closed', async () => {
      const rendered = await renderPopup();
      rendered.held.anchor = true;

      rendered.host.open.set(true);
      await waitForUpdate();
      rendered.release();
      await settle();
      // The overlay shows, to lay the menu out; closing now hides it again.
      rendered.tick();
      expect(rendered.overlay().getAttribute('visible')).toBe('true');
      rendered.host.open.set(false);
      rendered.tick();
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(rendered.overlay().getAttribute('visible')).toBe('false');
      expect(rendered.host.closed).toHaveBeenCalledTimes(1);
    });

    it('stops while the menu is measured', async () => {
      const rendered = await renderPopup();
      rendered.held.menu = true;

      rendered.host.open.set(true);
      await vi.waitFor(() =>
        expect(rendered.overlay().getAttribute('visible')).toBe('true'),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      rendered.host.open.set(false);
      rendered.tick();
      rendered.release();
      await settle();
      await waitForUpdate();

      expect(rendered.overlay().getAttribute('visible')).toBe('false');
      expect(style(rendered.panel(), 'left')).toBe('-10000px');
    });

    it('closes from where it started growing', async () => {
      const rendered = await renderPopup();
      rendered.held.menu = true;

      rendered.host.open.set(true);
      await vi.waitFor(() =>
        expect(rendered.overlay().getAttribute('visible')).toBe('true'),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      rendered.release();
      await settle();
      // At its start frame now; closing doesn't let it finish growing.
      rendered.host.open.set(false);
      rendered.tick();

      await vi.waitFor(() => expect(rendered.host.closed).toHaveBeenCalled());
      expect(
        rendered.panel().getAttribute('accessibility-exclusive-focus'),
      ).toBe('false');
    });
  });

  it('opens again at once when reopened while closing', async () => {
    const rendered = await renderPopup();
    await openMenu(rendered);

    rendered.host.open.set(false);
    await waitForUpdate();
    await openMenu(rendered);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The interrupted close never finished, so never reported.
    expect(rendered.host.closed).not.toHaveBeenCalled();
    expect(rendered.overlay().getAttribute('visible')).toBe('true');
  });

  it('stops its timers when destroyed while closing', async () => {
    const rendered = await renderPopup();
    await openMenu(rendered);

    rendered.host.open.set(false);
    await waitForUpdate();
    rendered.unmount();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(rendered.host.closed).not.toHaveBeenCalled();
  });
});
