import { Component, type Provider, signal, viewChild } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiIcon } from '../icon/icon';
import {
  ICON_DARK_COLORS,
  ICON_LIGHT_COLORS,
  provideIconTheme,
} from '../icon/icon-theme';
import {
  UiGlass,
  UiGlassGroup,
  type GlassMaterial,
  type GlassShape,
  type GlassVariant,
} from './glass';
import { provideGlass } from './glass-design';

@Component({
  imports: [LYNX_ELEMENTS, UiGlass, UiGlassGroup, UiIcon],
  template: `
    <blur-view ui-glass-group [spacing]="spacing()" class="flex-row gap-2">
      <blur-view
        ui-glass
        id="glass"
        class="px-4 py-2"
        [variant]="variant()"
        [shape]="shape()"
        [radius]="radius()"
        [tint]="tint()"
        [interactive]="interactive()"
        [material]="material()"
        [glassId]="glassId()"
      >
        <text class="text-glass-foreground">Now playing</text>
        <ui-icon name="play" />
      </blur-view>
    </blur-view>
  `,
})
class GlassHost {
  readonly spacing = signal(12);
  readonly variant = signal<GlassVariant>('regular');
  readonly shape = signal<GlassShape>('capsule');
  readonly radius = signal(20);
  readonly tint = signal<string | undefined>(undefined);
  readonly interactive = signal(false);
  readonly material = signal<GlassMaterial>('regular');
  readonly glassId = signal<string | undefined>(undefined);
  readonly glass = viewChild.required(UiGlass);
}

/** Accessibility settings a test can change, as the host app would. */
const settings = {
  reduceMotion: signal(false),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
};

/**
 * Renders the host on a platform, as `SystemInfo` reports it, or with no
 * SystemInfo at all.
 */
const renderOn = async (
  platform: { platform: string; osVersion: string } | undefined,
  providers: Provider[] = [],
) => {
  vi.stubGlobal('SystemInfo', platform);
  const result = await render(GlassHost, {
    providers: [
      { provide: LynxAccessibilitySettings, useValue: settings },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as GlassHost;
  const glass = result.container.querySelector('#glass')!;
  const group = glass.parentElement!;
  const update = async (change: () => void) => {
    change();
    await waitForUpdate();
  };
  return { ...result, host, glass, group, update };
};

const IOS_26 = { platform: 'iOS', osVersion: '26.0' };
const IOS_18 = { platform: 'iOS', osVersion: '18.5' };
const ANDROID = { platform: 'Android', osVersion: '15' };
const WEB = { platform: 'web', osVersion: '' };

// The icon's selector isn't a Lynx element, so the renderer falls back to a
// <view> for it and warns.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('UiGlass', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    settings.reduceTransparency.set(false);
    settings.increaseContrast.set(false);
  });

  it('draws Liquid Glass on iOS 26, in the app color scheme', async () => {
    const { glass } = await renderOn(IOS_26);

    expect(glass.tagName.toLowerCase()).toBe('blur-view');
    expect(glass.getAttribute('blur-effect')).toBe('glass');
    expect(glass.getAttribute('glass-style')).toBe('regular');
    expect(glass.getAttribute('blur-radius')).toBe('16px');
    expect(glass.getAttribute('enable-auto-blur')).toBe('true');
    expect(glass.getAttribute('ios-user-interface-style')).toBe('light');
    expect(glass.hasAttribute('glass-tint-color')).toBe(false);
    expect(glass.hasAttribute('glass-interactive')).toBe(false);
    // Liquid Glass has no materials.
    expect(glass.hasAttribute('blur-material')).toBe(false);
    // The app's own classes stay on the glass, beside its shape.
    expect(glass.classList).toContain('px-4');
    expect(glass.classList).toContain('rounded-full');
    expect(glass.classList).not.toContain('bg-secondary');
  });

  it('pairs the shape under its glass id, or the one a component pairs it under', async () => {
    const { glass, host, update } = await renderOn(IOS_26);
    expect(glass.hasAttribute('glass-effect-id')).toBe(false);

    await update(() => host.glassId.set('search'));
    expect(glass.getAttribute('glass-effect-id')).toBe('search');

    // A menu that grows out of the shape pairs it under its own id, until
    // it lets go.
    await update(() => host.glass().pair('ui-menu-1'));
    expect(glass.getAttribute('glass-effect-id')).toBe('ui-menu-1');
    await update(() => host.glass().pair(null));
    expect(glass.getAttribute('glass-effect-id')).toBe('search');

    await update(() => host.glassId.set(undefined));
    expect(glass.hasAttribute('glass-effect-id')).toBe(false);
  });

  it('keeps its content inside the glass', async () => {
    const { glass } = await renderOn(IOS_26);

    expect(glass.querySelector('text')?.textContent).toBe('Now playing');
  });

  it('takes the variant, tint and interactivity', async () => {
    const { glass, host, update } = await renderOn(IOS_26);

    await update(() => {
      host.variant.set('clear');
      host.tint.set('#2563eb');
      host.interactive.set(true);
    });

    expect(glass.getAttribute('glass-style')).toBe('clear');
    expect(glass.getAttribute('blur-radius')).toBe('6px');
    expect(glass.getAttribute('glass-tint-color')).toBe('#2563eb');
    expect(glass.getAttribute('glass-interactive')).toBe('true');

    await update(() => host.interactive.set(false));
    expect(glass.hasAttribute('glass-interactive')).toBe(false);
  });

  it("resolves a theme token tint to the scheme's value, and forces the scheme", async () => {
    const scheme = signal<'light' | 'dark'>('light');
    const { glass, host, update } = await renderOn(IOS_26, [
      provideIconTheme({ colorScheme: () => scheme() }),
    ]);

    await update(() => host.tint.set('var(--glass-tint)'));
    expect(glass.getAttribute('glass-tint-color')).toBe(
      ICON_LIGHT_COLORS['glass-tint'],
    );

    await update(() => scheme.set('dark'));
    expect(glass.getAttribute('glass-tint-color')).toBe(
      ICON_DARK_COLORS['glass-tint'],
    );
    expect(glass.getAttribute('ios-user-interface-style')).toBe('dark');
  });

  it('turns the foreground white on clear glass, which sits over media', async () => {
    const { glass, host, update } = await renderOn(IOS_26);
    const icon = () => glass.querySelector('svg')!.getAttribute('content');

    expect(icon()).toContain(ICON_LIGHT_COLORS['glass-foreground']);

    await update(() => host.variant.set('clear'));

    expect(glass.classList).toContain(
      '[--glass-foreground:var(--glass-clear-foreground)]',
    );
    expect(glass.classList).toContain(
      '[--glass-muted-foreground:var(--glass-clear-foreground)]',
    );
    expect(icon()).toContain(ICON_LIGHT_COLORS['glass-clear-foreground']);
  });

  it('gives a rounded shape its radius, and capsules and circles round ends', async () => {
    const { glass, host, update } = await renderOn(IOS_26);
    const radius = () =>
      (glass as HTMLElement).style.getPropertyValue('border-radius');

    expect(radius()).toBe('');

    await update(() => {
      host.shape.set('rounded');
      host.radius.set(24);
    });
    expect(glass.classList).not.toContain('rounded-full');
    expect(radius()).toBe('24px');

    await update(() => host.shape.set('circle'));
    expect(glass.classList).toContain('rounded-full');
    expect(radius()).toBe('');
  });

  it('leaves Reduce Transparency and Increase Contrast to iOS, except for muted text', async () => {
    const { glass, update } = await renderOn(IOS_26);

    await update(() => {
      settings.reduceTransparency.set(true);
      settings.increaseContrast.set(true);
    });

    // UIKit adapts its own glass: no opaque surface or border here.
    expect(glass.getAttribute('blur-effect')).toBe('glass');
    expect(glass.classList).not.toContain('border');
    expect(glass.classList).toContain(
      '[--glass-muted-foreground:var(--glass-foreground)]',
    );
  });

  it('draws a frosted material before iOS 26, which has no glass', async () => {
    const scheme = signal<'light' | 'dark'>('light');
    const { glass, host, update } = await renderOn(IOS_18, [
      provideIconTheme({ colorScheme: () => scheme() }),
    ]);

    // UIKit's material, which the iOS shell's blur-view draws, in the app's
    // scheme. The style before iOS 13 is for hosts without it.
    expect(glass.getAttribute('blur-material')).toBe('regular');
    expect(glass.getAttribute('ios-user-interface-style')).toBe('light');
    expect(glass.getAttribute('blur-effect')).toBe('extra-light');
    expect(glass.getAttribute('blur-radius')).toBe('20px');

    await update(() => host.material.set('chrome'));
    expect(glass.getAttribute('blur-material')).toBe('chrome');

    await update(() => scheme.set('dark'));
    expect(glass.getAttribute('ios-user-interface-style')).toBe('dark');
    expect(glass.getAttribute('blur-effect')).toBe('dark');

    // Clear glass draws the dark material in either scheme.
    await update(() => {
      scheme.set('light');
      host.variant.set('clear');
    });
    expect(glass.getAttribute('blur-material')).toBe('chrome');
    expect(glass.getAttribute('ios-user-interface-style')).toBe('dark');
    expect(glass.getAttribute('blur-effect')).toBe('dark');
  });

  it('fills a frosted material with its tint, under the content', async () => {
    const { glass, host, update } = await renderOn(IOS_18);
    /**
     * The fill: the view that draws a background, before the content.
     */
    const fill = () =>
      Array.from(glass.children).find(
        (child) => (child as HTMLElement).style.backgroundColor,
      ) as HTMLElement;

    expect(fill()).toBeUndefined();

    await update(() => host.tint.set('#2563eb'));
    // Drawn first, so the content sits on it.
    expect(Array.from(glass.children).indexOf(fill())).toBeLessThan(
      Array.from(glass.children).indexOf(glass.querySelector('text')!),
    );
    expect(fill().style.getPropertyValue('background-color')).toBe(
      'rgb(37, 99, 235)',
    );
    expect(fill().classList).toContain('rounded-full');

    await update(() => host.shape.set('rounded'));
    expect(fill().classList).not.toContain('rounded-full');
    expect(fill().style.getPropertyValue('border-radius')).toBe('20px');
  });

  it('draws an opaque Material surface on Android by default', async () => {
    const { glass, group, host, update } = await renderOn(ANDROID);

    expect(glass.getAttribute('blur-effect')).toBe('light');
    expect(glass.getAttribute('blur-radius')).toBe('0px');
    // A blur-view redraws what's behind it on every frame on Android, even
    // without a radius, unless this is off.
    expect(glass.getAttribute('enable-auto-blur')).toBe('false');
    expect(glass.classList).toContain('bg-secondary');
    expect(glass.hasAttribute('blur-material')).toBe(false);
    expect(group.getAttribute('blur-effect')).toBe('light');

    // Clear glass is opaque here too, so its foreground stays dark.
    await update(() => host.variant.set('clear'));
    expect(glass.classList).not.toContain(
      '[--glass-foreground:var(--glass-clear-foreground)]',
    );

    // A tint fills the surface, as Material fills a button.
    await update(() => host.tint.set('#2563eb'));
    expect(glass.classList).not.toContain('bg-secondary');
    expect(
      (glass as HTMLElement).style.getPropertyValue('background-color'),
    ).toBe('rgb(37, 99, 235)');
    expect(
      (glass as HTMLElement).style.getPropertyValue('box-shadow'),
    ).not.toBe('');
  });

  it('draws glass on Android when the app opts in, and follows the settings there', async () => {
    const { glass, update } = await renderOn(ANDROID, [
      provideGlass({ android: 'glass' }),
    ]);

    expect(glass.getAttribute('blur-effect')).toBe('glass');
    expect(glass.classList).not.toContain('bg-secondary');

    await update(() => settings.increaseContrast.set(true));
    expect(glass.classList).toContain('border');
    expect(glass.classList).toContain('border-glass-foreground');

    await update(() => settings.reduceTransparency.set(true));
    expect(glass.getAttribute('blur-effect')).toBe('light');
    expect(glass.classList).toContain('bg-secondary');
  });

  it('draws glass in the web preview', async () => {
    const { glass } = await renderOn(WEB);

    expect(glass.getAttribute('blur-effect')).toBe('glass');
  });

  it('draws a Material surface where there is no SystemInfo to read', async () => {
    const { glass } = await renderOn(undefined);

    expect(glass.classList).toContain('bg-secondary');
  });
});

describe('UiGlassGroup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('merges the glass in it within spacing', async () => {
    const { group, host, update } = await renderOn(IOS_26);

    expect(group.getAttribute('blur-effect')).toBe('glass-container');
    expect(group.getAttribute('spacing')).toBe('12');
    expect(group.getAttribute('enable-auto-blur')).toBe('false');
    expect(group.classList).toContain('flex-row');

    await update(() => host.spacing.set(24));
    expect(group.getAttribute('spacing')).toBe('24');
  });

  it('is a plain container where there is no glass to merge', async () => {
    const { group } = await renderOn(IOS_18);

    expect(group.getAttribute('blur-effect')).toBe('light');
    expect(group.getAttribute('blur-radius')).toBe('0px');
  });
});
