import { Component, type Provider, signal } from '@angular/core';
import { LynxAccessibilitySettings } from '@blotch/angular-lynx';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { UiIcon } from '../icon/icon';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import {
  type ButtonGroupOrientation,
  type ButtonGroupSize,
  type ButtonGroupVariant,
  UiButtonGroup,
  UiButtonGroupItem,
  buttonGroupItemVariants,
} from './button-group';

@Component({
  imports: [UiButtonGroup, UiButtonGroupItem, UiIcon],
  template: `
    <ui-button-group
      [orientation]="orientation()"
      [variant]="variant()"
      [size]="size()"
      [disabled]="groupDisabled()"
      class="w-full"
    >
      <ui-button-group-item
        class="flex-1"
        [accessibility-label]="copyLabel()"
        (pressed)="presses.push('Copy')"
      >
        @if (withIcon()) {
          <ui-icon name="copy" />
        }
        Copy
      </ui-button-group-item>
      <ui-button-group-item
        [disabled]="pasteDisabled()"
        (pressed)="presses.push('Paste')"
        >Paste</ui-button-group-item
      >
    </ui-button-group>
  `,
})
class ButtonGroupHost {
  readonly orientation = signal<ButtonGroupOrientation>('horizontal');
  readonly variant = signal<ButtonGroupVariant>('default');
  readonly size = signal<ButtonGroupSize>('default');
  readonly groupDisabled = signal(false);
  readonly pasteDisabled = signal(false);
  readonly withIcon = signal(false);
  readonly copyLabel = signal<string | undefined>(undefined);
  readonly presses: string[] = [];
}

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

/**
 * Renders the host on a platform, as `SystemInfo` reports it, or with no
 * SystemInfo at all, which gives the glass variants Material's design.
 */
const renderGroup = async (
  platform?: { platform: string; osVersion: string },
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(ButtonGroupHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  return {
    ...result,
    host: result.componentRef.instance as ButtonGroupHost,
    /**
     * The group's own box, around the items' hosts: the bar of the solid
     * variants, Material's connected group, or the glass's frame.
     */
    group: (): HTMLElement => {
      const parent =
        result.getByText('Paste').parentElement!.parentElement!.parentElement!;
      return parent.localName === 'blur-view' ? parent.parentElement! : parent;
    },
    glass: () => result.container.querySelector<HTMLElement>('blur-view')!,
    // An item's view (the one that takes presses) holds its label.
    item: (label: string) => result.getByText(label).parentElement!,
    icon: () => result.container.querySelector('svg')!,
    update: async (change: () => void) => {
      change();
      await waitForUpdate();
    },
  };
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };
const ANDROID = { platform: 'Android', osVersion: '15' };
const WEB = { platform: 'web', osVersion: '' };

/**
 * The scale an item's inline style holds, if any.
 */
const scaleOf = (view: Element) =>
  (view as HTMLElement).style.getPropertyValue('transform');

// The icon's selector isn't a Lynx element, so the renderer falls back to a
// <view> for it and warns.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  settings.reduceMotion.set(false);
  settings.reduceTransparency.set(false);
  settings.increaseContrast.set(false);
});

describe('UiButtonGroup', () => {
  it('lays its items out in a row, or in a column when vertical', async () => {
    const { host, group } = await renderGroup();
    expect(group().classList).toContain('flex-row');
    expect(group().classList).toContain('w-full');

    host.orientation.set('vertical');
    await waitForUpdate();
    expect(group().classList).toContain('flex-col');
    expect(group().classList).not.toContain('flex-row');
  });

  it("styles every item and label with the group's variant and size", async () => {
    const { host, item, getByText } = await renderGroup();
    expect(item('Copy').classList).toContain('bg-secondary');
    expect(item('Copy').classList).toContain('h-10');
    expect(item('Copy').classList).toContain('flex-1');
    expect(getByText('Copy').classList).toContain('text-secondary-foreground');
    expect(getByText('Copy').classList).toContain('text-sm');

    host.variant.set('outline');
    host.size.set('sm');
    await waitForUpdate();
    for (const label of ['Copy', 'Paste']) {
      expect(item(label).classList).toContain('bg-background');
      expect(item(label).classList).toContain('h-9');
      expect(getByText(label).classList).toContain('text-foreground');
      expect(getByText(label).classList).toContain('text-xs');
    }

    host.size.set('lg');
    await waitForUpdate();
    expect(item('Paste').classList).toContain('h-11');
    expect(getByText('Paste').classList).toContain('text-base');
  });
});

describe('UiButtonGroupItem', () => {
  it('emits `pressed` when tapped', async () => {
    const { host, item } = await renderGroup();
    fireEvent.tap(item('Copy'));
    fireEvent.tap(item('Paste'));
    expect(host.presses).toEqual(['Copy', 'Paste']);
    expect(item('Copy').classList).not.toContain('opacity-50');
  });

  it('dims and ignores taps when disabled itself, leaving the others working', async () => {
    const { host, item } = await renderGroup();
    host.pasteDisabled.set(true);
    await waitForUpdate();
    expect(item('Paste').classList).toContain('opacity-50');
    expect(item('Copy').classList).not.toContain('opacity-50');

    fireEvent.tap(item('Paste'));
    fireEvent.tap(item('Copy'));
    expect(host.presses).toEqual(['Copy']);
  });

  it('dims and ignores taps on every item when the group is disabled', async () => {
    const { host, item } = await renderGroup();
    host.groupDisabled.set(true);
    await waitForUpdate();
    for (const label of ['Copy', 'Paste']) {
      expect(item(label).classList).toContain('opacity-50');
      fireEvent.tap(item(label));
    }
    expect(host.presses).toEqual([]);
  });

  it('scales down while pressed by touch, and back on release', async () => {
    const { item } = await renderGroup();
    fireEvent.touchstart(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(0.97)');
    fireEvent.touchend(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(1)');

    // A scroll that takes the touch over cancels it: the item scales back
    // rather than staying pressed.
    fireEvent.touchstart(item('Copy'));
    fireEvent.touchcancel(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(1)');
  });

  it('scales down while pressed by mouse, and back on release or leave', async () => {
    // Lynx on the web fires mouse events for a cursor, never touch ones.
    const { item } = await renderGroup();
    fireEvent.mousedown(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(0.97)');
    fireEvent.mouseup(item('Copy'));
    expect(scaleOf(item('Copy'))).toBe('scale(1)');

    fireEvent.mousedown(item('Copy'));
    fireLynxEvent(item('Copy'), 'mouseleave');
    expect(scaleOf(item('Copy'))).toBe('scale(1)');
  });

  it("doesn't react to presses while it or its group is disabled", async () => {
    const { host, item } = await renderGroup();
    host.pasteDisabled.set(true);
    host.groupDisabled.set(true);
    await waitForUpdate();
    for (const label of ['Copy', 'Paste']) {
      fireEvent.touchstart(item(label));
      fireEvent.mousedown(item(label));
      expect(scaleOf(item(label))).toBe('');
      fireEvent.touchend(item(label));
      fireEvent.mouseup(item(label));
      expect(scaleOf(item(label))).toBe('');
    }
  });
});

describe('UiButtonGroupItem icons and accessibility', () => {
  it('puts a projected icon before the label, in the label color', async () => {
    const { host, item, getByText, icon, update } = await renderGroup();
    await update(() => host.withIcon.set(true));

    expect(item('Copy').classList).toContain('gap-2');
    expect(icon().compareDocumentPosition(getByText('Copy'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['secondary-foreground'],
    );

    await update(() => host.variant.set('outline'));
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['foreground'],
    );
  });

  it('shows only the icon in square items, named by its accessibility label', async () => {
    const { host, queryByText, getByRole, update } = await renderGroup();
    await update(() => {
      host.size.set('icon');
      host.withIcon.set(true);
      host.copyLabel.set('Copy the text');
    });

    expect(queryByText('Copy')).toBeNull();
    const copy = getByRole('button', { name: 'Copy the text' });
    expect(copy.classList).toContain('w-10');
    expect(copy.classList).not.toContain('gap-2');
    // An item with a label is read by it, as a button.
    expect(getByRole('button', { name: 'Paste' }).localName).toBe('text');
  });

  it('dims at once instead of shrinking under Reduce Motion', async () => {
    const { item, update } = await renderGroup();
    await update(() => settings.reduceMotion.set(true));

    fireEvent.touchstart(item('Copy'));
    await waitForUpdate();
    expect(item('Copy').classList).toContain('opacity-70');
    expect(scaleOf(item('Copy'))).toBe('');

    fireEvent.touchend(item('Copy'));
    await waitForUpdate();
    expect(item('Copy').classList).not.toContain('opacity-70');
    expect(scaleOf(item('Copy'))).toBe('');
  });
});

describe('UiButtonGroup glass variants', () => {
  it('is one interactive glass shape on iOS 26, with plain items inside', async () => {
    const { host, group, glass, item, getByText, update } =
      await renderGroup(IOS_26);
    await update(() => host.variant.set('glass'));

    expect(glass().parentElement).toBe(group());
    expect(glass().getAttribute('blur-effect')).toBe('glass');
    expect(glass().getAttribute('glass-style')).toBe('regular');
    expect(glass().getAttribute('glass-interactive')).toBe('true');
    expect(glass().classList).toContain('flex-row');
    expect(glass().classList).toContain('p-1');
    // A row is a capsule.
    expect(glass().classList).toContain('rounded-full');
    expect(glass().style.getPropertyValue('border-radius')).toBe('');
    expect(group().classList).toContain('rounded-full');
    expect(group().classList).toContain('self-start');
    expect(group().classList).toContain('w-full');
    expect(group().classList).not.toContain('bg-glass-dim');
    for (const label of ['Copy', 'Paste']) {
      expect(glass().contains(item(label))).toBe(true);
      expect(item(label).classList).toContain('h-10');
      expect(item(label).classList).not.toContain('bg-secondary');
      expect(getByText(label).classList).toContain('text-glass-foreground');
    }

    // A column of wider items has corners of half an item's height plus
    // the 4px inset.
    await update(() => host.orientation.set('vertical'));
    expect(glass().classList).toContain('flex-col');
    expect(glass().classList).not.toContain('rounded-full');
    expect(glass().style.getPropertyValue('border-radius')).toBe('24px');
    expect(group().style.getPropertyValue('border-radius')).toBe('24px');

    // A column of square icons is a capsule again.
    await update(() => host.size.set('icon'));
    expect(glass().classList).toContain('rounded-full');
  });

  it('draws the thin material before iOS 26, as the buttons do', async () => {
    const { host, glass, update } = await renderGroup(IOS_18);
    await update(() => host.variant.set('glass'));

    expect(glass().getAttribute('blur-material')).toBe('thin');
    expect(glass().getAttribute('blur-effect')).toBe('extra-light');
  });

  it('highlights a pressed item in corners concentric with the glass', async () => {
    const { host, item, getByText, update } = await renderGroup(IOS_26);
    await update(() => host.variant.set('glass'));
    const highlight = () => item('Copy').querySelector('.absolute');

    fireEvent.touchstart(item('Copy'));
    await waitForUpdate();
    expect(highlight()!.classList).toContain('bg-glass-foreground');
    // 24px glass corners, 4px out: 20px.
    expect((highlight() as HTMLElement).style.borderRadius).toBe('20px');
    expect(highlight()!.compareDocumentPosition(getByText('Copy'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(scaleOf(item('Copy'))).toBe('');

    fireEvent.touchend(item('Copy'));
    await waitForUpdate();
    expect(highlight()).toBeNull();

    // Smaller items, smaller corners: 22px and 18px.
    await update(() => host.size.set('sm'));
    fireEvent.mousedown(item('Copy'));
    await waitForUpdate();
    expect((highlight() as HTMLElement).style.borderRadius).toBe('18px');
    fireLynxEvent(item('Copy'), 'mouseleave');
    await waitForUpdate();
    expect(highlight()).toBeNull();
  });

  it('sits clear glass on the dimming layer, with white icons', async () => {
    const { host, group, glass, icon, update } = await renderGroup(IOS_26);
    await update(() => {
      host.variant.set('glass-clear');
      host.withIcon.set(true);
    });

    expect(glass().getAttribute('glass-style')).toBe('clear');
    expect(group().classList).toContain('bg-glass-dim');
    expect(group().classList).toContain('rounded-full');
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['glass-clear-foreground'],
    );
  });

  it("stops the glass reacting and dims the items while it's disabled", async () => {
    const { host, glass, item, update } = await renderGroup(IOS_26);
    await update(() => {
      host.variant.set('glass');
      host.groupDisabled.set(true);
    });

    expect(glass().hasAttribute('glass-interactive')).toBe(false);
    expect(item('Copy').classList).toContain('opacity-50');
    fireEvent.touchstart(item('Copy'));
    fireEvent.tap(item('Copy'));
    expect(item('Copy').querySelector('.absolute')).toBeNull();
    expect(host.presses).toEqual([]);
  });

  it('stops the glass swelling under Reduce Motion in the web preview, still highlighting', async () => {
    const { host, glass, item, update } = await renderGroup(WEB);
    await update(() => {
      host.variant.set('glass');
      settings.reduceMotion.set(true);
    });

    expect(glass().hasAttribute('glass-interactive')).toBe(false);
    fireEvent.mousedown(item('Copy'));
    await waitForUpdate();
    expect(item('Copy').querySelector('.absolute')).not.toBeNull();
    expect(scaleOf(item('Copy'))).toBe('');
  });

  it('drops the dimming layer when Reduce Transparency makes the glass solid', async () => {
    const { host, group, icon, update } = await renderGroup(WEB);
    await update(() => {
      host.variant.set('glass-clear');
      host.withIcon.set(true);
      settings.reduceTransparency.set(true);
    });

    expect(group().classList).not.toContain('bg-glass-dim');
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['glass-foreground'],
    );
  });
});

describe('UiButtonGroup glass variants in Material (Android)', () => {
  it("is Material's connected button group", async () => {
    const { host, group, glass, item, getByText, icon, update } =
      await renderGroup(ANDROID);
    await update(() => {
      host.variant.set('glass');
      host.withIcon.set(true);
    });

    expect(glass()).toBeNull();
    for (const name of ['gap-0.5', 'rounded-full', 'overflow-hidden']) {
      expect(group().classList).toContain(name);
    }
    expect(group().classList).not.toContain('bg-border');
    expect(item('Copy').classList).toContain('bg-secondary');
    expect(item('Copy').classList).toContain('rounded-[8px]');
    expect(getByText('Copy').classList).toContain('text-secondary-foreground');
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['secondary-foreground'],
    );

    // Clear glass is the same tonal group here.
    await update(() => host.variant.set('glass-clear'));
    expect(item('Copy').classList).toContain('bg-secondary');

    // A column's ends are half an item round, or a capsule of square icons.
    await update(() => host.orientation.set('vertical'));
    expect(group().classList).not.toContain('rounded-full');
    expect(group().style.borderRadius).toBe('20px');
    await update(() => host.size.set('icon'));
    expect(group().classList).toContain('rounded-full');
    expect(group().style.borderRadius).toBe('');
  });

  it('shows the state layer on a pressed item', async () => {
    const { host, item, update } = await renderGroup(ANDROID);
    await update(() => host.variant.set('glass'));
    const layer = () => item('Copy').querySelector('.absolute');

    fireEvent.touchstart(item('Copy'));
    await waitForUpdate();
    expect(layer()!.classList).toContain('bg-secondary-foreground');
    expect(layer()!.classList).toContain('opacity-10');
    expect(scaleOf(item('Copy'))).toBe('');

    fireEvent.touchcancel(item('Copy'));
    await waitForUpdate();
    expect(layer()).toBeNull();
  });

  it('outlines the items under Increase Contrast', async () => {
    const { host, item, update } = await renderGroup(ANDROID);
    await update(() => {
      host.variant.set('glass');
      settings.increaseContrast.set(true);
    });

    expect(item('Copy').classList).toContain('border-foreground');
  });
});

describe('buttonGroupItemVariants', () => {
  it('returns default variant and size classes', () => {
    const result = buttonGroupItemVariants();
    expect(result).toContain('bg-secondary');
    expect(result).toContain('h-10');
    expect(result).toContain('px-4');
  });

  it('returns outline variant classes', () => {
    const result = buttonGroupItemVariants({ variant: 'outline' });
    expect(result).toContain('bg-background');
  });

  it('returns small size classes', () => {
    const result = buttonGroupItemVariants({ size: 'sm' });
    expect(result).toContain('h-9');
    expect(result).toContain('px-3');
  });

  it('returns large size classes', () => {
    const result = buttonGroupItemVariants({ size: 'lg' });
    expect(result).toContain('h-11');
    expect(result).toContain('px-6');
  });

  it('returns square icon size classes', () => {
    const result = buttonGroupItemVariants({ size: 'icon' });
    expect(result).toContain('h-10');
    expect(result).toContain('w-10');
  });

  it('always includes base layout classes', () => {
    const result = buttonGroupItemVariants({ variant: 'outline', size: 'lg' });
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('justify-center');
  });
});
