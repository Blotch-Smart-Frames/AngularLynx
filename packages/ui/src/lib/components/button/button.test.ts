import { Component, type Provider, signal } from '@angular/core';
import { LynxAccessibilitySettings } from '@blotch/angular-lynx';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { provideGlass } from '../glass/glass-design';
import { UiIcon } from '../icon/icon';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import {
  type ButtonSize,
  type ButtonVariant,
  UiButton,
  buttonVariants,
} from './button';

@Component({
  imports: [UiButton, UiIcon],
  template: `
    <ui-button
      [variant]="variant()"
      [size]="size()"
      [disabled]="disabled()"
      [loading]="loading()"
      [accessibility-label]="label()"
      class="w-full"
      (pressed)="presses.set(presses() + 1)"
    >
      @if (withIcon()) {
        <ui-icon name="search" />
      }
      Save
    </ui-button>
  `,
})
class ButtonHost {
  readonly variant = signal<ButtonVariant>('default');
  readonly size = signal<ButtonSize>('default');
  readonly disabled = signal(false);
  readonly loading = signal(false);
  readonly label = signal<string | undefined>(undefined);
  readonly withIcon = signal(false);
  readonly presses = signal(0);
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
const renderButton = async (
  platform?: { platform: string; osVersion: string },
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(ButtonHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as ButtonHost;
  return {
    ...result,
    host,
    /**
     * The button's own box, the first child of its host: it takes the
     * presses, and holds the glass on a glass variant.
     */
    button: () => result.container.firstElementChild!.firstElementChild!,
    glass: () => result.container.querySelector('blur-view')!,
    spinner: () => result.container.querySelector('svg'),
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
 * The scale the button's inline style holds, if any.
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

describe('UiButton', () => {
  it('renders its label with the classes for its variant and size', async () => {
    const { button, getByText } = await renderButton();
    expect(button().classList).toContain('bg-primary');
    expect(button().classList).toContain('h-10');
    expect(button().classList).toContain('w-full');
    expect(button().classList).not.toContain('opacity-50');
    expect(getByText('Save').classList).toContain('text-primary-foreground');
    expect(getByText('Save').classList).toContain('text-sm');
  });

  it('restyles the button and its label when the variant or size changes', async () => {
    const { host, button, getByText, update } = await renderButton();
    await update(() => {
      host.variant.set('destructive');
      host.size.set('lg');
    });
    expect(button().classList).toContain('bg-destructive');
    expect(button().classList).toContain('h-11');
    expect(getByText('Save').classList).toContain(
      'text-destructive-foreground',
    );
    expect(getByText('Save').classList).toContain('text-base');
  });

  it('emits `pressed` when tapped', async () => {
    const { host, button } = await renderButton();
    fireEvent.tap(button());
    fireEvent.tap(button());
    expect(host.presses()).toBe(2);
  });

  it("dims and ignores taps while it's disabled", async () => {
    const { host, button, update } = await renderButton();
    await update(() => host.disabled.set(true));
    expect(button().classList).toContain('opacity-50');
    fireEvent.tap(button());
    expect(host.presses()).toBe(0);
  });

  it("shows a spinner in place of the label, dims and ignores taps while it's loading", async () => {
    const { host, button, spinner, queryByText, update } = await renderButton();
    expect(spinner()).toBeNull();

    await update(() => host.loading.set(true));
    expect(spinner()).not.toBeNull();
    expect(queryByText('Save')).toBeNull();
    expect(button().classList).toContain('opacity-50');
    fireEvent.tap(button());
    expect(host.presses()).toBe(0);
  });

  it('shrinks the spinner for a small button', async () => {
    const { host, spinner, update } = await renderButton();
    await update(() => host.loading.set(true));
    /**
     * The spinner's size: its own view carries it, and the svg fills it.
     */
    const spinnerSize = () =>
      (spinner()!.parentElement as HTMLElement).style.getPropertyValue('width');
    expect(spinnerSize()).toBe('20px');

    await update(() => host.size.set('sm'));
    expect(spinnerSize()).toBe('16px');
  });

  it("colors the spinner like each variant's label", async () => {
    const { host, spinner, update } = await renderButton();
    host.loading.set(true);
    // The spinner draws with SVG, which can't read the theme's CSS variables,
    // so its markup carries the light theme's value of the label's color.
    for (const [variant, color] of [
      ['default', 'rgba(250, 250, 250, 1)'], // --primary-foreground
      ['destructive', 'rgba(250, 250, 250, 1)'], // --destructive-foreground
      ['outline', 'rgba(9, 9, 11, 1)'], // --foreground
      ['secondary', 'rgba(24, 24, 27, 1)'], // --secondary-foreground
      ['ghost', 'rgba(9, 9, 11, 1)'], // --foreground
    ] as const) {
      await update(() => host.variant.set(variant));
      expect(spinner()!.getAttribute('content')).toContain(`stroke="${color}"`);
    }
  });

  it('scales down while pressed by touch, and back on release', async () => {
    const { button } = await renderButton();
    fireEvent.touchstart(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.touchend(button());
    expect(scaleOf(button())).toBe('scale(1)');

    // A scroll that takes the touch over cancels it: the button scales back
    // rather than staying pressed.
    fireEvent.touchstart(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.touchcancel(button());
    expect(scaleOf(button())).toBe('scale(1)');
  });

  it('scales down while pressed by mouse, and back on release or leave', async () => {
    // Lynx on the web fires mouse events for a cursor, never touch ones.
    const { button } = await renderButton();
    fireEvent.mousedown(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.mouseup(button());
    expect(scaleOf(button())).toBe('scale(1)');

    fireEvent.mousedown(button());
    fireLynxEvent(button(), 'mouseleave');
    expect(scaleOf(button())).toBe('scale(1)');
  });

  it("doesn't react to presses while it's disabled or loading", async () => {
    const { host, button, update } = await renderButton();
    for (const state of [host.disabled, host.loading]) {
      await update(() => state.set(true));
      fireEvent.touchstart(button());
      fireEvent.mousedown(button());
      expect(scaleOf(button())).toBe('');
      fireEvent.touchend(button());
      fireEvent.mouseup(button());
      expect(scaleOf(button())).toBe('');
      state.set(false);
    }
  });

  it('dims at once instead of shrinking under Reduce Motion', async () => {
    const { button, update } = await renderButton();
    await update(() => settings.reduceMotion.set(true));

    fireEvent.touchstart(button());
    await waitForUpdate();
    expect(button().classList).toContain('opacity-70');
    expect(scaleOf(button())).toBe('');

    fireEvent.touchend(button());
    await waitForUpdate();
    expect(button().classList).not.toContain('opacity-70');
    expect(scaleOf(button())).toBe('');
  });

  it('puts a projected icon before the label, in the label color', async () => {
    const { host, button, getByText, icon, update } = await renderButton();
    await update(() => host.withIcon.set(true));

    expect(button().classList).toContain('gap-2');
    expect(icon().compareDocumentPosition(getByText('Save'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['primary-foreground'],
    );

    await update(() => host.variant.set('outline'));
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['foreground'],
    );
  });

  it('shows only the icon in an icon size, named by its accessibility label', async () => {
    const { host, button, queryByText, getByRole, update } =
      await renderButton();
    await update(() => {
      host.withIcon.set(true);
      host.size.set('icon-circle');
      host.label.set('Search');
    });

    expect(queryByText('Save')).toBeNull();
    expect(button().classList).toContain('rounded-full');
    expect(button().classList).not.toContain('gap-2');
    expect(getByRole('button', { name: 'Search' })).toBe(button());
  });

  it("keeps an icon size's text when nothing else is projected", async () => {
    // `size="icon"` has long held a single character, such as "+".
    const { host, getByText, update } = await renderButton();
    await update(() => host.size.set('icon'));

    expect(getByText('Save').classList).toContain('text-sm');
  });

  it('is read as a button with its label, or with its accessibility label', async () => {
    const { host, button, getByRole, getByText, update } = await renderButton();
    expect(getByRole('button', { name: 'Save' })).toBe(getByText('Save'));
    expect(button().hasAttribute('accessibility-element')).toBe(false);

    await update(() => host.label.set('Save the draft'));
    expect(getByRole('button', { name: 'Save the draft' })).toBe(button());
    expect(button().getAttribute('accessibility-element')).toBe('true');
    expect(getByText('Save').hasAttribute('accessibility-traits')).toBe(false);
  });
});

describe('UiButton glass variants', () => {
  it('draws interactive Liquid Glass on iOS 26, filling the button', async () => {
    const { host, button, glass, getByText, update } =
      await renderButton(IOS_26);
    await update(() => host.variant.set('glass'));

    expect(glass().getAttribute('blur-effect')).toBe('glass');
    expect(glass().getAttribute('glass-style')).toBe('regular');
    expect(glass().getAttribute('glass-interactive')).toBe('true');
    expect(glass().hasAttribute('glass-tint-color')).toBe(false);
    expect(glass().parentElement).toBe(button());
    expect(glass().classList).toContain('flex-1');
    expect(glass().classList).toContain('px-4');
    // The button is a capsule, sized by its size and the app's classes.
    expect(button().classList).toContain('rounded-full');
    expect(button().classList).toContain('h-10');
    expect(button().classList).toContain('w-full');
    expect(button().classList).not.toContain('bg-glass-dim');
    // The label is inside the glass, in the glass's foreground.
    expect(glass().contains(getByText('Save'))).toBe(true);
    expect(getByText('Save').classList).toContain('text-glass-foreground');
  });

  it('leaves the press to the glass on iOS 26, which reacts by itself', async () => {
    const { host, button, glass, getByText, update } =
      await renderButton(IOS_26);
    await update(() => host.variant.set('glass'));

    fireEvent.touchstart(button());
    await waitForUpdate();
    expect(scaleOf(button())).toBe('');
    fireEvent.touchend(button());
    fireEvent.tap(button());
    expect(scaleOf(button())).toBe('');
    expect(host.presses()).toBe(1);

    // iOS tones its own glass down under Reduce Motion, so it stays
    // interactive, and the button adds nothing.
    await update(() => settings.reduceMotion.set(true));
    expect(glass().getAttribute('glass-interactive')).toBe('true');
    fireEvent.touchstart(button());
    await waitForUpdate();
    expect(getByText('Save').parentElement!.classList).not.toContain(
      'opacity-70',
    );
  });

  it('tints the prominent variant for the main action', async () => {
    const { host, glass, getByText, icon, update } = await renderButton(IOS_26);
    await update(() => {
      host.variant.set('glass-prominent');
      host.withIcon.set(true);
    });

    expect(glass().getAttribute('glass-tint-color')).toBe(
      ICON_LIGHT_COLORS['glass-tint'],
    );
    expect(getByText('Save').classList).toContain('text-glass-tint-foreground');
    expect(getByText('Save').parentElement!.classList).toContain('gap-2');
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['glass-tint-foreground'],
    );
  });

  it('puts clear glass on the dimming layer, with a white label and icon', async () => {
    const { host, button, glass, icon, update } = await renderButton(IOS_26);
    await update(() => {
      host.variant.set('glass-clear');
      host.withIcon.set(true);
    });

    expect(glass().getAttribute('glass-style')).toBe('clear');
    expect(button().classList).toContain('bg-glass-dim');
    // The glass points the label's color at the clear foreground.
    expect(glass().classList).toContain(
      '[--glass-foreground:var(--glass-clear-foreground)]',
    );
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['glass-clear-foreground'],
    );
  });

  it("dims its content, not the glass, and stops reacting while it's disabled", async () => {
    const { host, button, glass, getByText, update } =
      await renderButton(IOS_26);
    await update(() => {
      host.variant.set('glass');
      host.disabled.set(true);
    });

    // Faded glass looks washed out, so the label dims and the glass stays.
    expect(getByText('Save').parentElement!.classList).toContain('opacity-50');
    expect(button().classList).not.toContain('opacity-50');
    expect(glass().hasAttribute('glass-interactive')).toBe(false);
    fireEvent.touchstart(button());
    fireEvent.tap(button());
    expect(host.presses()).toBe(0);
  });

  it('colors the spinner like the label on clear glass', async () => {
    const { host, spinner, update } = await renderButton(IOS_26);
    await update(() => {
      host.variant.set('glass-clear');
      host.loading.set(true);
    });

    expect(spinner()!.getAttribute('content')).toContain(
      `stroke="${ICON_LIGHT_COLORS['glass-clear-foreground']}"`,
    );
  });

  it('is a circle of glass around an icon, named by its accessibility label', async () => {
    const { host, button, glass, queryByText, getByRole, update } =
      await renderButton(IOS_26);
    await update(() => {
      host.variant.set('glass');
      host.size.set('icon-circle');
      host.withIcon.set(true);
      host.label.set('Search');
    });

    expect(button().classList).toContain('rounded-full');
    expect(glass().classList).not.toContain('px-4');
    expect(queryByText('Save')).toBeNull();
    expect(getByRole('button', { name: 'Search' })).toBe(button());
  });

  it('draws the frosted material before iOS 26, and shrinks when pressed', async () => {
    const { host, button, glass, update } = await renderButton(IOS_18);
    await update(() => host.variant.set('glass'));

    expect(glass().getAttribute('blur-effect')).toBe('extra-light');
    fireEvent.touchstart(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.touchend(button());
    expect(scaleOf(button())).toBe('scale(1)');
  });

  it("dims at once under Reduce Motion where the glass doesn't react", async () => {
    const { host, button, getByText, update } = await renderButton(IOS_18);
    await update(() => {
      host.variant.set('glass');
      settings.reduceMotion.set(true);
    });
    const content = () => getByText('Save').parentElement!;

    fireEvent.touchstart(button());
    await waitForUpdate();
    expect(content().classList).toContain('opacity-70');
    expect(button().classList).not.toContain('opacity-70');
    expect(scaleOf(button())).toBe('');

    fireEvent.touchcancel(button());
    await waitForUpdate();
    expect(content().classList).not.toContain('opacity-70');
  });

  it('leaves the press to the glass in the web preview, unless Reduce Motion is on', async () => {
    const { host, button, glass, getByText, update } = await renderButton(WEB);
    await update(() => host.variant.set('glass'));

    expect(glass().getAttribute('glass-interactive')).toBe('true');
    fireEvent.mousedown(button());
    expect(scaleOf(button())).toBe('');
    fireEvent.mouseup(button());

    // The runtime's glass swells without regard to the setting, so the
    // button stops it swelling and dims instead.
    await update(() => settings.reduceMotion.set(true));
    expect(glass().hasAttribute('glass-interactive')).toBe(false);
    fireEvent.mousedown(button());
    await waitForUpdate();
    expect(getByText('Save').parentElement!.classList).toContain('opacity-70');
  });

  it('turns clear glass solid under Reduce Transparency in the web preview, with no dimming layer', async () => {
    const { host, button, glass, icon, update } = await renderButton(WEB);
    await update(() => {
      host.variant.set('glass-clear');
      host.withIcon.set(true);
      settings.reduceTransparency.set(true);
    });

    expect(glass().classList).toContain('bg-secondary');
    expect(button().classList).not.toContain('bg-glass-dim');
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['glass-foreground'],
    );
    // The opaque surface doesn't react to touch, so the button shrinks.
    fireEvent.touchstart(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
  });

  it("shrinks when pressed on Android's glass, which doesn't react to touch", async () => {
    const { host, button, glass, update } = await renderButton(ANDROID, [
      provideGlass({ android: 'glass' }),
    ]);
    await update(() => host.variant.set('glass'));

    expect(glass().getAttribute('blur-effect')).toBe('glass');
    fireEvent.touchstart(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.touchend(button());
    expect(scaleOf(button())).toBe('scale(1)');
  });
});

describe('UiButton glass variants in Material (Android)', () => {
  it('draws a filled tonal button for glass and clear glass', async () => {
    const { host, button, glass, getByText, icon, update } =
      await renderButton(ANDROID);
    await update(() => {
      host.variant.set('glass');
      host.withIcon.set(true);
    });

    expect(glass()).toBeNull();
    for (const name of ['bg-secondary', 'rounded-full', 'h-10', 'gap-2']) {
      expect(button().classList).toContain(name);
    }
    expect(getByText('Save').classList).toContain('text-secondary-foreground');
    expect(icon().getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['secondary-foreground'],
    );

    await update(() => host.variant.set('glass-clear'));
    expect(button().classList).toContain('bg-secondary');
    expect(button().classList).not.toContain('bg-glass-dim');
  });

  it('draws a filled button in the glass tint for the prominent variant', async () => {
    const { host, button, getByText, update } = await renderButton(ANDROID);
    await update(() => host.variant.set('glass-prominent'));

    expect(button().classList).toContain('bg-glass-tint');
    expect(getByText('Save').classList).toContain('text-glass-tint-foreground');
  });

  it('shows the pressed state layer while pressed, with no motion', async () => {
    const { host, button, getByText, update } = await renderButton(ANDROID);
    await update(() => host.variant.set('glass'));
    const layer = () => button().querySelector('.opacity-10');

    expect(layer()).toBeNull();
    fireEvent.touchstart(button());
    await waitForUpdate();
    expect(layer()!.classList).toContain('bg-secondary-foreground');
    expect(layer()!.classList).toContain('absolute');
    // Before the label, which draws over it.
    expect(layer()!.compareDocumentPosition(getByText('Save'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(scaleOf(button())).toBe('');

    fireEvent.touchend(button());
    await waitForUpdate();
    expect(layer()).toBeNull();
    expect(scaleOf(button())).toBe('');

    await update(() => host.variant.set('glass-prominent'));
    fireEvent.mousedown(button());
    await waitForUpdate();
    expect(layer()!.classList).toContain('bg-glass-tint-foreground');
  });

  it('outlines a tonal button under Increase Contrast', async () => {
    const { host, button, update } = await renderButton(ANDROID);
    await update(() => {
      host.variant.set('glass');
      settings.increaseContrast.set(true);
    });
    expect(button().classList).toContain('border-foreground');

    // A filled button's edge already stands out.
    await update(() => host.variant.set('glass-prominent'));
    expect(button().classList).not.toContain('border-foreground');
  });

  it("dims and ignores taps while it's disabled", async () => {
    const { host, button, update } = await renderButton(ANDROID);
    await update(() => {
      host.variant.set('glass');
      host.disabled.set(true);
    });

    expect(button().classList).toContain('opacity-50');
    fireEvent.tap(button());
    expect(host.presses()).toBe(0);
  });

  it("is Material where there's no SystemInfo to read", async () => {
    const { host, button, glass, update } = await renderButton();
    await update(() => host.variant.set('glass'));

    expect(glass()).toBeNull();
    expect(button().classList).toContain('bg-secondary');
  });
});

describe('buttonVariants', () => {
  it('returns default variant and size classes', () => {
    const result = buttonVariants();
    expect(result).toContain('bg-primary');
    expect(result).toContain('h-10');
    expect(result).toContain('px-4');
  });

  it('returns destructive variant classes', () => {
    const result = buttonVariants({ variant: 'destructive' });
    expect(result).toContain('bg-destructive');
  });

  it('returns outline variant classes', () => {
    const result = buttonVariants({ variant: 'outline' });
    expect(result).toContain('border');
    expect(result).toContain('bg-background');
  });

  it('returns secondary variant classes', () => {
    const result = buttonVariants({ variant: 'secondary' });
    expect(result).toContain('bg-secondary');
  });

  it('returns ghost variant classes', () => {
    const result = buttonVariants({ variant: 'ghost' });
    expect(result).toContain('bg-transparent');
  });

  it('returns small size classes', () => {
    const result = buttonVariants({ size: 'sm' });
    expect(result).toContain('h-9');
    expect(result).toContain('px-3');
  });

  it('returns large size classes', () => {
    const result = buttonVariants({ size: 'lg' });
    expect(result).toContain('h-11');
    expect(result).toContain('px-8');
  });

  it('returns icon size classes', () => {
    const result = buttonVariants({ size: 'icon' });
    expect(result).toContain('h-10');
    expect(result).toContain('w-10');
  });

  it('returns round icon size classes', () => {
    const result = buttonVariants({ size: 'icon-circle' });
    expect(result).toContain('w-10');
    expect(result).toContain('rounded-full');
  });

  it('always includes base classes', () => {
    const result = buttonVariants({ variant: 'ghost', size: 'sm' });
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('rounded-md');
  });
});
