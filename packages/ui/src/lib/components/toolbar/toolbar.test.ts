import { Component, type Provider, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { provideGlass } from '../glass/glass-design';
import { type IconName } from '../icon/icons';
import { UiBarState } from './bar-scroll';
import {
  UiToolbar,
  UiToolbarGroup,
  UiToolbarItem,
  UiToolbarSpacer,
} from './toolbar';

@Component({
  imports: [
    LYNX_ELEMENTS,
    UiToolbar,
    UiToolbarGroup,
    UiToolbarItem,
    UiToolbarSpacer,
  ],
  template: `
    <ui-toolbar id="toolbar" [class]="toolbarClass()">
      <ui-toolbar-group id="group" [class]="groupClass()">
        <ui-toolbar-item
          icon="list-checks"
          label="Checklist"
          (pressed)="did('Checklist')"
        />
        <ui-toolbar-item label="Select" prominent (pressed)="did('Select')" />
      </ui-toolbar-group>
      <ui-toolbar-spacer />
      <ui-toolbar-item
        label="Compose"
        [icon]="icon()"
        [prominent]="prominent()"
        [back]="back()"
        [disabled]="disabled()"
        (pressed)="did('Compose')"
      />
    </ui-toolbar>
  `,
})
class ToolbarHost {
  readonly toolbarClass = signal('');
  readonly groupClass = signal('');
  readonly icon = signal<IconName | undefined>('pencil');
  readonly prominent = signal(false);
  readonly back = signal(false);
  readonly disabled = signal(false);
  readonly actions = signal<string[]>([]);

  did(action: string): void {
    this.actions.update((actions) => [...actions, action]);
  }
}

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };
const ANDROID = { platform: 'Android', osVersion: '15' };
const WEB = { platform: 'web', osVersion: '' };

/** The theme's light colors, as icon-theme.ts resolves them for an SVG. */
const PRIMARY = 'rgba(24, 24, 27, 1)';
const PRIMARY_FOREGROUND = 'rgba(250, 250, 250, 1)';
const FOREGROUND = 'rgba(9, 9, 11, 1)';
const MUTED_FOREGROUND = 'rgba(113, 113, 122, 1)';

const renderToolbar = async (
  platform: { platform: string; osVersion: string },
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(ToolbarHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as ToolbarHost;
  const state = result.componentRef.injector.get(UiBarState);
  const { container } = result;
  const toolbar = () => container.querySelector<HTMLElement>('#toolbar')!;
  const group = () => container.querySelector<HTMLElement>('#group')!;
  const item = (name: string) => result.getByRole('button', { name });
  /**
   * The item's button: the content its glass, or the item, holds.
   */
  const button = (name: string) =>
    item(name).querySelector<HTMLElement>('.relative')!;
  const ownGlass = (name: string) =>
    item(name).querySelector<HTMLElement>('[ui-glass]');
  const iconOf = (name: string) =>
    item(name).querySelector('svg')?.getAttribute('content') ?? '';
  const labelOf = (name: string) =>
    item(name).querySelector('text') as HTMLElement | null;
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  const press = async (name: string) => {
    fireEvent.touchstart(item(name));
    await waitForUpdate();
  };
  const release = async (name: string) => {
    fireEvent.touchend(item(name));
    await waitForUpdate();
  };
  return {
    ...result,
    host,
    state,
    toolbar,
    group,
    item,
    button,
    ownGlass,
    iconOf,
    labelOf,
    update,
    press,
    release,
  };
};

/**
 * The highlight under a pressed item's content, if it shows one.
 */
const highlightOf = (button: HTMLElement) =>
  Array.from(button.children).find((child) =>
    child.className.includes('absolute'),
  ) as HTMLElement | undefined;

// The components' selectors aren't Lynx elements, so the renderer falls back
// to a <view> for each and warns.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
});

describe('UiToolbar on iOS 26 and later', () => {
  it('floats its items over the content above the home indicator, with no bar behind them', async () => {
    const { toolbar, state } = await renderToolbar(IOS_26);
    const classes = toolbar().classList;
    expect(classes).toContain('absolute');
    expect(classes).toContain('bottom-0');
    expect(classes).toContain('pb-safe-[8px]');
    expect(classes).not.toContain('bg-secondary');
    expect(toolbar().querySelector('[ui-glass][shape="rounded"]')).toBeNull();
    // It tells the scroll view under it how much room it takes.
    expect(state.bottomBar()?.height()).toBe(52);
  });

  it('puts a group of items on one glass capsule, plain inside it', async () => {
    const { group, item, ownGlass } = await renderToolbar(IOS_26);
    const glass = group().querySelector<HTMLElement>('[ui-glass]')!;
    expect(glass.getAttribute('blur-effect')).toBe('glass');
    expect(glass.getAttribute('glass-interactive')).toBe('true');
    expect(glass.contains(item('Checklist'))).toBe(true);
    expect(ownGlass('Checklist')).toBeNull();
  });

  it('gives an item on its own a glass circle for an icon, and a capsule for a label', async () => {
    const { host, ownGlass, update, iconOf, labelOf, button } =
      await renderToolbar(IOS_26);
    expect(ownGlass('Compose')?.getAttribute('blur-effect')).toBe('glass');
    expect(ownGlass('Compose')?.classList).toContain('rounded-full');
    expect(button('Compose').className).toContain('w-[44px]');
    expect(iconOf('Compose')).toContain(FOREGROUND);
    expect(labelOf('Compose')).toBeNull();

    await update(() => host.icon.set(undefined));
    expect(button('Compose').className).toContain('px-[16px]');
    expect(labelOf('Compose')?.textContent).toBe('Compose');
    expect(labelOf('Compose')?.className).toContain('text-glass-foreground');
  });

  it('tints a prominent item on its own, and leaves one in a group plain', async () => {
    const { host, ownGlass, update, labelOf, iconOf } =
      await renderToolbar(IOS_26);
    await update(() => host.prominent.set(true));
    expect(ownGlass('Compose')?.getAttribute('glass-tint-color')).toBe(PRIMARY);
    expect(iconOf('Compose')).toContain(PRIMARY_FOREGROUND);

    await update(() => host.icon.set(undefined));
    expect(labelOf('Compose')?.className).toContain(
      'text-glass-tint-foreground',
    );
    // In a group, prominent is ignored: a key action stands on its own.
    expect(labelOf('Select')?.className).toContain('text-glass-foreground');
  });

  it('draws a Back item as a glass circle with a chevron, its label for screen readers', async () => {
    const { host, ownGlass, update, labelOf, iconOf, item, button } =
      await renderToolbar(IOS_26);
    await update(() => host.back.set(true));
    expect(ownGlass('Compose')).not.toBeNull();
    expect(button('Compose').className).toContain('w-[44px]');
    expect(iconOf('Compose')).toContain('m15 18-6-6 6-6');
    expect(labelOf('Compose')).toBeNull();
    expect(item('Compose').getAttribute('accessibility-label')).toBe('Compose');
  });

  it('leaves a press to the glass on its own, and highlights a grouped item', async () => {
    const { press, release, button } = await renderToolbar(IOS_26);
    await press('Compose');
    expect(highlightOf(button('Compose'))).toBeUndefined();

    await press('Checklist');
    expect(highlightOf(button('Checklist'))?.className).toContain(
      'bg-glass-foreground',
    );
    await release('Checklist');
    expect(highlightOf(button('Checklist'))).toBeUndefined();
  });

  it('emits pressed on a tap, and dims and ignores a disabled item', async () => {
    const { host, item, update, press, button, ownGlass } =
      await renderToolbar(IOS_26);
    fireEvent.tap(item('Checklist'));
    fireEvent.tap(item('Compose'));
    expect(host.actions()).toEqual(['Checklist', 'Compose']);

    await update(() => host.disabled.set(true));
    expect(item('Compose').getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );
    // The content dims, not the glass, which iOS would wash out.
    expect(button('Compose').className).toContain('opacity-50');
    expect(ownGlass('Compose')?.getAttribute('glass-interactive')).toBeNull();
    await press('Compose');
    expect(highlightOf(button('Compose'))).toBeUndefined();
    fireEvent.tap(item('Compose'));
    expect(host.actions()).toEqual(['Checklist', 'Compose']);

    await update(() => host.disabled.set(false));
    expect(item('Compose').getAttribute('accessibility-traits')).toBe('button');
  });

  it('takes extra classes on the toolbar and the group', async () => {
    const { host, toolbar, group, update } = await renderToolbar(IOS_26);
    await update(() => {
      host.toolbarClass.set('mb-4');
      host.groupClass.set('ml-2');
    });
    expect(toolbar().classList).toContain('mb-4');
    expect(group().classList).toContain('ml-2');
  });
});

describe('UiToolbar before iOS 26', () => {
  it('is the toolbar of that time: edge to edge, on the blur material with a hairline while content continues beneath it', async () => {
    const { toolbar, state, update } = await renderToolbar(IOS_18);
    expect(toolbar().classList).toContain('pb-safe');
    expect(state.bottomBar()?.height()).toBe(44);
    const material = () =>
      toolbar().querySelector<HTMLElement>('[ui-glass][shape="rounded"]');
    expect(material()).toBeNull();

    await update(() => state.scrolledUnderBottom.set(true));
    expect(material()?.getAttribute('blur-effect')).toBe('extra-light');
    expect(toolbar().querySelector('.h-\\[0\\.5px\\]')).not.toBeNull();
  });

  it('draws plain bar buttons in the tint color, which fade while pressed', async () => {
    const { group, iconOf, labelOf, press, release, button, host, update } =
      await renderToolbar(IOS_18);
    expect(group().querySelector('[ui-glass]')).toBeNull();
    expect(iconOf('Compose')).toContain(PRIMARY);
    expect(labelOf('Select')?.className).toContain('text-primary');
    // A prominent label is bold, in the group too: before iOS 26, a group
    // only keeps items together.
    await update(() => {
      host.icon.set(undefined);
      host.prominent.set(true);
    });
    expect(labelOf('Compose')?.className).toContain('font-semibold');

    await press('Compose');
    expect(button('Compose').className).toContain('opacity-30');
    expect(highlightOf(button('Compose'))).toBeUndefined();
    await release('Compose');
    expect(button('Compose').className).not.toContain('opacity-30');
  });

  it('shows a Back item as a chevron and the previous screen’s title', async () => {
    const { host, update, iconOf, labelOf } = await renderToolbar(IOS_18);
    await update(() => host.back.set(true));
    expect(iconOf('Compose')).toContain('m15 18-6-6 6-6');
    expect(labelOf('Compose')?.textContent).toBe('Compose');
  });
});

describe('UiToolbar on Android', () => {
  it('is a Material 3 docked toolbar on the surface container', async () => {
    const { toolbar, state } = await renderToolbar(ANDROID);
    expect(toolbar().classList).toContain('bg-secondary');
    expect(state.bottomBar()?.height()).toBe(64);
    expect(toolbar().querySelector('[ui-glass]')).toBeNull();
  });

  it('draws icon buttons with a round state layer while pressed', async () => {
    const { iconOf, press, release, button } = await renderToolbar(ANDROID);
    expect(iconOf('Compose')).toContain(MUTED_FOREGROUND);
    expect(button('Compose').className).toContain('h-[48px]');

    await press('Compose');
    const layer = highlightOf(button('Compose'))!;
    expect(layer.className).toContain('rounded-full');
    expect(layer.className).toContain('bg-foreground');
    await release('Compose');
    expect(highlightOf(button('Compose'))).toBeUndefined();
  });

  it('draws labels as text buttons, and prominent ones filled', async () => {
    const { host, update, labelOf, button, press, iconOf } =
      await renderToolbar(ANDROID);
    await update(() => host.icon.set(undefined));
    expect(labelOf('Compose')?.className).toContain('text-primary');
    await press('Compose');
    expect(highlightOf(button('Compose'))?.className).toContain('bg-primary');

    await update(() => host.prominent.set(true));
    expect(button('Compose').className).toContain('bg-primary');
    expect(labelOf('Compose')?.className).toContain('text-primary-foreground');
    expect(highlightOf(button('Compose'))?.className).toContain(
      'bg-primary-foreground',
    );

    // A prominent icon is a filled icon button.
    await update(() => host.icon.set('plus'));
    expect(button('Compose').className).toContain('h-[40px]');
    expect(iconOf('Compose')).toContain(PRIMARY_FOREGROUND);
  });

  it('draws a Back item as the navigation icon, an arrow in the surface’s foreground', async () => {
    const { host, update, iconOf } = await renderToolbar(ANDROID);
    await update(() => host.back.set(true));
    expect(iconOf('Compose')).toContain('M19 12H5');
    expect(iconOf('Compose')).toContain(FOREGROUND);
  });
});

describe('UiToolbar without SystemInfo', () => {
  it('draws the Material design, as where there is no platform to read', async () => {
    vi.stubGlobal('SystemInfo', undefined);
    const result = await render(ToolbarHost, {
      providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
    });
    const toolbar = result.container.querySelector('#toolbar')!;
    expect(toolbar.classList).toContain('bg-secondary');
    expect(toolbar.querySelector('[ui-glass]')).toBeNull();
  });
});

describe('UiToolbar with glass on Android and the web', () => {
  it('highlights an item on its own on Android, whose glass doesn’t react to touch', async () => {
    const { ownGlass, press, button } = await renderToolbar(ANDROID, [
      provideGlass({ android: 'glass' }),
    ]);
    expect(ownGlass('Compose')?.getAttribute('blur-effect')).toBe('glass');
    await press('Compose');
    expect(highlightOf(button('Compose'))?.className).toContain(
      'bg-glass-foreground',
    );
  });

  it('stills the web’s glass under Reduce Motion, and highlights the item instead', async () => {
    const { group, ownGlass, press, button, update } = await renderToolbar(WEB);
    const groupGlass = () => group().querySelector('[ui-glass]')!;
    expect(ownGlass('Compose')?.getAttribute('glass-interactive')).toBe('true');
    expect(groupGlass().getAttribute('glass-interactive')).toBe('true');

    await update(() => settings.reduceMotion.set(true));
    expect(ownGlass('Compose')?.getAttribute('glass-interactive')).toBeNull();
    expect(groupGlass().getAttribute('glass-interactive')).toBeNull();
    await press('Compose');
    expect(highlightOf(button('Compose'))).toBeDefined();
  });

  it('releases a press the scroll took, or the mouse left', async () => {
    const { press, item, button } = await renderToolbar(ANDROID);
    await press('Compose');
    fireEvent.touchcancel(item('Compose'));
    await waitForUpdate();
    expect(highlightOf(button('Compose'))).toBeUndefined();

    fireLynxEvent(item('Compose'), 'mousedown');
    await waitForUpdate();
    expect(highlightOf(button('Compose'))).toBeDefined();
    fireLynxEvent(item('Compose'), 'mouseleave');
    await waitForUpdate();
    expect(highlightOf(button('Compose'))).toBeUndefined();
    fireLynxEvent(item('Compose'), 'mousedown');
    fireLynxEvent(item('Compose'), 'mouseup');
    await waitForUpdate();
    expect(highlightOf(button('Compose'))).toBeUndefined();
  });
});
