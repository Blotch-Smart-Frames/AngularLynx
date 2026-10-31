import { Component, type Provider, signal, viewChild } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import {
  type SearchFieldContainer,
  UI_SEARCH_FIELD_CONTAINER,
  UiSearchField,
} from './search-field';

@Component({
  imports: [LYNX_ELEMENTS, UiSearchField],
  template: `
    <ui-search-field
      class="mx-4"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [cancelable]="cancelable()"
      [value]="query()"
      (valueChange)="query.set($event)"
      (submitted)="submitted.push($event)"
      (canceled)="events.push('canceled')"
      (focused)="events.push('focused')"
      (blurred)="events.push('blurred')"
    />
  `,
})
class FieldHost {
  readonly placeholder = signal('Songs and artists');
  readonly disabled = signal(false);
  readonly cancelable = signal(false);
  readonly query = signal('');
  readonly submitted: string[] = [];
  readonly events: string[] = [];
  readonly field = viewChild.required(UiSearchField);
}

@Component({
  imports: [UiSearchField],
  template: `<ui-search-field placeholder="Songs and artists" class="mx-4" />`,
})
class StaticAttributesHost {}

/** A bar that holds the field in a shape of its own, as the dock does. */
const container = {
  searching: signal(false),
  searchCanceled: vi.fn<() => void>(),
} satisfies SearchFieldContainer;

@Component({
  imports: [LYNX_ELEMENTS, UiSearchField],
  providers: [{ provide: UI_SEARCH_FIELD_CONTAINER, useValue: container }],
  template: `<ui-search-field cancelable />`,
})
class ContainedHost {
  readonly field = viewChild.required(UiSearchField);
}

/**
 * The Lynx function that runs an element's UI methods: focusing an input,
 * or measuring an element (`boundingClientRect`).
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

/** A phone's screen, as SystemInfo reports it: 402×874pt at 3x. */
const IOS_26 = {
  platform: 'iOS',
  osVersion: '26.0',
  pixelWidth: 1206,
  pixelHeight: 2622,
  pixelRatio: 3,
};
const IOS_18 = { ...IOS_26, osVersion: '18.5' };
const ANDROID = {
  platform: 'Android',
  osVersion: '15',
  pixelWidth: 1080,
  pixelHeight: 2400,
  pixelRatio: 2.5,
};

/**
 * The theme's light colors, as the field resolves them for an SVG.
 */
const color = (token: string) => ICON_LIGHT_COLORS[token]!;

/**
 * Where elements are on screen, as `boundingClientRect` reports them: the
 * page fills a 874pt screen, and the field's host sits `fieldBottom` down.
 */
const screen = { fieldBottom: 820, pageBottom: 874, fails: false };

const renderOn = async (
  platform: Record<string, unknown> | undefined,
  hostType: typeof FieldHost | typeof ContainedHost = FieldHost,
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const invoke = vi
    .spyOn(globalThis as unknown as InvokeUIMethod, '__InvokeUIMethod')
    .mockImplementation((element, method, _params, callback) => {
      if (method !== 'boundingClientRect') {
        callback({ code: 0 });
        return;
      }
      if (screen.fails) {
        callback({ code: 1 });
        return;
      }
      const page = element.tagName.toLowerCase() === 'page';
      const bottom = page ? screen.pageBottom : screen.fieldBottom;
      callback({ code: 0, data: { left: 0, top: bottom - 48, bottom } });
    });
  const result = await render(hostType, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const { container: root } = result;
  const host = result.componentRef.instance as FieldHost;
  /**
   * The field itself, for what it says about its state.
   */
  const component = () => host.field();
  const field = () => root.querySelector<HTMLElement>('input')!;
  /**
   * The field's host, the outermost view of the component.
   */
  const fieldHost = () =>
    root.querySelector<HTMLElement>('.flex-row.items-center')!;
  /**
   * The view inside the host that rises above the keyboard. Not the host's
   * first element: Angular's anchors are invisible views on Lynx.
   */
  const frame = () =>
    fieldHost().querySelector<HTMLElement>(':scope > .flex-1.flex-row')!;
  const glass = () => root.querySelector<HTMLElement>('[ui-glass]');
  const icons = () =>
    Array.from(root.querySelectorAll('svg')).map(
      (svg) => svg.getAttribute('content') ?? '',
    );
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  const type = async (text: string) => {
    fireEvent.input(field(), { detail: { value: text } });
    await waitForUpdate();
  };
  const keyboard = async (height: number) => {
    fireLynxEvent(field(), 'keyboardheightchange', { detail: { height } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    await waitForUpdate();
  };
  return {
    ...result,
    host,
    component,
    invoke,
    field,
    fieldHost,
    frame,
    glass,
    icons,
    update,
    type,
    keyboard,
  };
};

const style = (element: HTMLElement, name: string) =>
  element.style.getPropertyValue(name);

/**
 * The UI methods the field called on its input, by name.
 */
const methodsCalled = (rendered: {
  invoke: { mock: { calls: unknown[][] } };
}) => rendered.invoke.mock.calls.map(([, method]) => method);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
  settings.increaseContrast.set(false);
  container.searching.set(false);
  container.searchCanceled.mockClear();
  Object.assign(screen, { fieldBottom: 820, pageBottom: 874, fails: false });
});

describe('UiSearchField’s static attributes', () => {
  // Angular gives a component's host every static attribute written on it
  // (issue #181): the placeholder made a second match for
  // getByPlaceholderText.
  it('puts its class on one element, and its placeholder only on its input', async () => {
    vi.stubGlobal('SystemInfo', IOS_26);
    const { container, getAllByPlaceholderText } = await render(
      StaticAttributesHost,
      {
        providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
      },
    );
    expect(container.querySelectorAll('.mx-4')).toHaveLength(1);
    expect(getAllByPlaceholderText('Songs and artists')).toEqual([
      container.querySelector('input'),
    ]);
  });
});

describe('UiSearchField on iOS 26 and later', () => {
  it('is a glass capsule with a magnifier and a search box that searches on return', async () => {
    const { getByRole, field, fieldHost, glass, icons } =
      await renderOn(IOS_26);

    expect(fieldHost().classList).toContain('mx-4');
    expect(glass()?.parentElement?.hasAttribute('ui-glass-group')).toBe(true);
    expect(glass()?.getAttribute('blur-effect')).toBe('glass');
    expect(glass()?.getAttribute('glass-interactive')).toBe('true');
    expect(glass()?.classList).toContain('rounded-full');
    expect(style(glass()!, 'height')).toBe('48px');
    expect(style(glass()!, 'column-gap')).toBe('8px');

    expect(getByRole('searchbox', { name: 'Songs and artists' })).toBe(field());
    expect(field().getAttribute('confirm-type')).toBe('search');
    expect(field().getAttribute('placeholder')).toBe('Songs and artists');
    expect(field().classList).toContain('text-glass-foreground');
    expect(style(field(), 'font-size')).toBe('17px');
    // The placeholder and the magnifier take the glass's muted foreground,
    // resolved, as an attribute and an SVG can't read a CSS variable.
    expect(field().getAttribute('placeholder-color')).toBe(
      color('glass-muted-foreground'),
    );
    expect(icons()).toEqual([
      expect.stringContaining(color('glass-muted-foreground')),
    ]);
  });

  it('follows typing, drops the placeholder while there is text, and clears it', async () => {
    const { host, getByRole, queryByRole, field, type, icons } =
      await renderOn(IOS_26);
    expect(queryByRole('button', { name: 'Clear text' })).toBeNull();

    await type('night');
    expect(host.query()).toBe('night');
    expect(field().getAttribute('placeholder')).toBeNull();
    // UIKit's clear button: an x cut out of a gray circle.
    const clear = getByRole('button', { name: 'Clear text' });
    expect(clear.querySelector('.rounded-full')?.classList).toContain(
      'bg-glass-muted-foreground',
    );
    expect(icons()[1]).toContain(color('background'));

    fireEvent.tap(clear);
    await waitForUpdate();
    expect(host.query()).toBe('');
    expect(field().getAttribute('placeholder')).toBe('Songs and artists');
    expect(queryByRole('button', { name: 'Clear text' })).toBeNull();
  });

  it('shows text the app sets', async () => {
    const { host, update, field } = await renderOn(IOS_26);
    await update(() => host.query.set('jazz'));
    expect(field().getAttribute('placeholder')).toBeNull();
  });

  it('emits the text when the keyboard’s Search key is pressed', async () => {
    const { host, field } = await renderOn(IOS_26);
    fireLynxEvent(field(), 'confirm', { detail: { value: 'night swim' } });
    expect(host.submitted).toEqual(['night swim']);
  });

  it('says when it has the keyboard’s focus', async () => {
    const { host, field, component } = await renderOn(IOS_26);

    fireEvent.focus(field());
    expect(component().hasFocus()).toBe(true);
    fireEvent.blur(field());
    expect(component().hasFocus()).toBe(false);
    expect(host.events).toEqual(['focused', 'blurred']);
  });

  it('grows a glass cancel button out of its end while it’s in use, which clears it and closes the keyboard', async () => {
    const rendered = await renderOn(IOS_26);
    const { host, update, getByRole, queryByRole, field } = rendered;
    await update(() => host.cancelable.set(true));
    const cancel = () => getByRole('button', { name: 'Cancel', hidden: true });

    // At rest, it's a circle with no width, folded into the field's end.
    expect(cancel().getAttribute('blur-effect')).toBe('glass');
    expect(cancel().parentElement?.hasAttribute('ui-glass-group')).toBe(true);
    expect(style(cancel(), 'width')).toBe('0px');
    expect(style(cancel(), 'margin-left')).toBe('0px');
    expect(style(cancel(), 'transition')).toContain('width');
    expect(queryByRole('button', { name: 'Cancel' })).toBeNull();

    fireEvent.focus(field());
    await waitForUpdate();
    expect(style(cancel(), 'width')).toBe('48px');
    expect(style(cancel(), 'margin-left')).toBe('10px');
    expect(
      style(cancel().querySelector('svg') as unknown as HTMLElement, 'opacity'),
    ).toBe('1');

    await rendered.type('moons');
    fireEvent.tap(cancel());
    await waitForUpdate();
    expect(host.query()).toBe('');
    expect(host.events).toEqual(['focused', 'canceled']);
    expect(methodsCalled(rendered)).toContain('blur');
  });

  it('shows Cancel while it holds text, focused or not', async () => {
    const { host, update, getByRole } = await renderOn(IOS_26);
    await update(() => {
      host.cancelable.set(true);
      host.query.set('ada');
    });
    expect(style(getByRole('button', { name: 'Cancel' }), 'width')).toBe(
      '48px',
    );
  });

  it('dims and ignores typing while it’s disabled, with no clear button', async () => {
    const { host, update, queryByRole, field, type } = await renderOn(IOS_26);
    await update(() => {
      host.query.set('ada');
      host.disabled.set(true);
    });
    expect(field().classList).toContain('opacity-50');
    expect(queryByRole('button', { name: 'Clear text' })).toBeNull();

    await type('blocked');
    expect(host.query()).toBe('ada');
  });

  it('turns its muted icons full strength under Increase Contrast', async () => {
    const { icons } = await renderOn(IOS_26);
    settings.increaseContrast.set(true);
    await waitForUpdate();
    expect(icons()[0]).toContain(color('glass-foreground'));
  });

  it('grows and fades nothing under Reduce Motion', async () => {
    settings.reduceMotion.set(true);
    const { host, update, getByRole, frame } = await renderOn(IOS_26);
    await update(() => host.cancelable.set(true));
    const cancel = getByRole('button', { name: 'Cancel', hidden: true });
    expect(style(cancel, 'transition')).toBe('none');
    expect(
      style(
        cancel.querySelector('svg') as unknown as HTMLElement,
        'transition',
      ),
    ).toBe('none');
    expect(style(frame(), 'transition')).toBe('none');
  });

  it('gives its input the keyboard’s focus, and takes it back', async () => {
    const rendered = await renderOn(IOS_26);

    rendered.component().focus();
    rendered.component().blur();
    expect(methodsCalled(rendered)).toEqual(
      expect.arrayContaining(['focus', 'blur']),
    );
  });
});

describe('UiSearchField and the keyboard', () => {
  it('rises on iOS to clear a keyboard that would cover it, and settles as it closes', async () => {
    // The keyboard is 336pt, so its top is at 874 - 336 = 538. The field's
    // bottom is at 820, so it rises 820 + 8 - 538 = 290.
    const { frame, keyboard } = await renderOn(IOS_26);
    expect(style(frame(), 'transition')).toContain('transform');

    await keyboard(336);
    expect(style(frame(), 'transform')).toBe('translateY(-290px)');

    fireLynxEvent(frame().querySelector('input')!, 'keyboardheightchange', {
      detail: { height: 0 },
    });
    await waitForUpdate();
    expect(style(frame(), 'transform')).toBe('');
  });

  it('stays where it is when the keyboard doesn’t reach it', async () => {
    screen.fieldBottom = 200;
    const { frame, keyboard } = await renderOn(IOS_26);
    await keyboard(336);
    expect(style(frame(), 'transform')).toBe('');
  });

  it('counts Android’s keyboard in physical pixels from the bottom of the Lynx view', async () => {
    // 800 physical pixels at 2.5x is 320dp, measured up from the page's
    // bottom at 860: its top is at 540, and the field rises 820 + 8 - 540.
    screen.pageBottom = 860;
    const { frame, keyboard } = await renderOn(ANDROID);
    await keyboard(800);
    expect(style(frame(), 'transform')).toBe('translateY(-288px)');
  });

  it('settles when it loses focus, past a measure still to answer', async () => {
    const { frame, field, invoke } = await renderOn(IOS_26);
    let answer: (() => void) | undefined;
    invoke.mockImplementation((_element, _method, _params, callback) => {
      answer = () => callback({ code: 0, data: { bottom: 820 } });
    });

    fireLynxEvent(field(), 'keyboardheightchange', { detail: { height: 336 } });
    fireEvent.blur(field());
    answer?.();
    await waitForUpdate();
    expect(style(frame(), 'transform')).toBe('');
  });

  it('stays put where its box can’t be measured', async () => {
    screen.fails = true;
    const { frame, keyboard } = await renderOn(IOS_26);
    await keyboard(336);
    expect(style(frame(), 'transform')).toBe('');
  });

  it('ignores the keyboard where there’s no SystemInfo to place it', async () => {
    const rendered = await renderOn(undefined);
    const { frame, field } = rendered;
    fireLynxEvent(field(), 'keyboardheightchange', { detail: { height: 336 } });
    await waitForUpdate();
    expect(methodsCalled(rendered)).not.toContain('boundingClientRect');
    expect(style(frame(), 'transform')).toBe('');
  });
});

describe('UiSearchField before iOS 26', () => {
  it('is UISearchBar’s field: a rounded rectangle on a gray fill', async () => {
    const { glass, fieldHost, field, icons } = await renderOn(IOS_18);
    expect(glass()).toBeNull();
    const fill = fieldHost().querySelector<HTMLElement>('.bg-muted')!;
    expect(style(fill, 'border-radius')).toBe('10px');
    expect(style(fill, 'height')).toBe('36px');
    expect(field().classList).toContain('text-foreground');
    expect(field().getAttribute('placeholder-color')).toBe(
      color('muted-foreground'),
    );
    expect(icons()[0]).toContain(color('muted-foreground'));
  });

  it('slides a Cancel button in beside the field while it’s in use', async () => {
    const { host, update, getByRole, getByText, field } =
      await renderOn(IOS_18);
    await update(() => host.cancelable.set(true));
    const cancel = () => getByRole('button', { name: 'Cancel', hidden: true });
    expect(getByText('Cancel').classList).toContain('text-primary');
    expect(style(cancel(), 'max-width')).toBe('0px');

    fireEvent.focus(field());
    await waitForUpdate();
    expect(style(cancel(), 'max-width')).toBe('120px');
    expect(style(cancel(), 'margin-left')).toBe('8px');

    fireEvent.tap(cancel());
    await waitForUpdate();
    expect(host.events).toEqual(['focused', 'canceled']);
  });

  it('clears with a gray circle, and slides Cancel in at once under Reduce Motion', async () => {
    settings.reduceMotion.set(true);
    const { host, update, getByRole } = await renderOn(IOS_18);
    await update(() => {
      host.cancelable.set(true);
      host.query.set('ada');
    });
    const clear = getByRole('button', { name: 'Clear text' });
    expect(clear.querySelector('.rounded-full')?.classList).toContain(
      'bg-muted-foreground',
    );
    expect(style(getByRole('button', { name: 'Cancel' }), 'transition')).toBe(
      'none',
    );
  });
});

describe('UiSearchField on Android', () => {
  it('is Material 3’s search bar: a 56dp capsule on a tonal surface', async () => {
    const { host, update, getByRole, glass, fieldHost, field, icons } =
      await renderOn(ANDROID);
    expect(glass()).toBeNull();
    const bar = fieldHost().querySelector<HTMLElement>('.bg-secondary')!;
    expect(bar.classList).toContain('rounded-full');
    expect(style(bar, 'height')).toBe('56px');
    expect(style(bar, 'column-gap')).toBe('16px');
    expect(style(field(), 'font-size')).toBe('16px');

    // Its clear button is a plain x.
    await update(() => host.query.set('ada'));
    const clear = getByRole('button', { name: 'Clear text' });
    expect(clear.querySelector('.rounded-full')).toBeNull();
    expect(icons()[1]).toContain(color('muted-foreground'));
  });

  it('turns its search icon into a back arrow that cancels while it’s in use', async () => {
    const { host, update, getByRole, queryByRole, field } =
      await renderOn(ANDROID);
    await update(() => host.cancelable.set(true));
    expect(queryByRole('button', { name: 'Cancel' })).toBeNull();

    fireEvent.focus(field());
    await waitForUpdate();
    fireEvent.tap(getByRole('button', { name: 'Cancel' }));
    // Cancel takes the focus, which Lynx reports with a blur.
    fireEvent.blur(field());
    await waitForUpdate();
    expect(host.events).toEqual(['focused', 'canceled', 'blurred']);
    expect(queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('UiSearchField in a bar that holds it', () => {
  it('draws only its content on glass, padded as a field of its own', async () => {
    const { glass, frame, keyboard, component } = await renderOn(
      IOS_26,
      ContainedHost,
    );
    expect(glass()).toBeNull();
    expect(style(frame(), 'padding-left')).toBe('14px');
    expect(style(frame(), 'column-gap')).toBe('8px');

    // The bar moves itself above the keyboard, by the height the field
    // reports.
    await keyboard(336);
    expect(style(frame(), 'transform')).toBe('');
    expect(component().keyboardHeight()).toBe(336);
  });

  it('keeps its own fill before iOS 26, which had no glass to hold it', async () => {
    const { fieldHost } = await renderOn(IOS_18, ContainedHost);
    expect(fieldHost().classList).toContain('flex-1');
    expect(fieldHost().querySelector('.bg-muted')).toBeTruthy();
  });

  it('shows Material’s back arrow while the bar searches, and tells the bar when it’s pressed', async () => {
    const { getByRole, queryByRole, fieldHost } = await renderOn(
      ANDROID,
      ContainedHost,
    );
    expect(fieldHost().querySelector('.bg-secondary')).toBeNull();
    expect(queryByRole('button', { name: 'Cancel' })).toBeNull();

    container.searching.set(true);
    await waitForUpdate();
    fireEvent.tap(getByRole('button', { name: 'Cancel' }));
    expect(container.searchCanceled).toHaveBeenCalledOnce();
  });
});
