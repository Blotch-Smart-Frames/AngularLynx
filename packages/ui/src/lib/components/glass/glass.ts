import {
  booleanAttribute,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  numberAttribute,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import {
  injectColorScheme,
  injectThemeColors,
  resolveIconColor,
  UI_ICON_COLOR,
} from '../icon/icon-theme';
import { injectGlassDesign, injectSystemDrawsGlass } from './glass-design';

/**
 * `'regular'` glass, the default, frosts what's behind it and suits most
 * controls. `'clear'` glass barely frosts it, for controls over photos and
 * video; put a dimming layer under it when what's behind is bright (see
 * `bg-glass-dim`). Don't mix the two on one screen.
 */
export type GlassVariant = 'regular' | 'clear';

/**
 * A capsule (fully rounded ends, the default for controls), a circle (give
 * it equal width and height) or a rectangle with `radius` corners.
 */
export type GlassShape = 'capsule' | 'circle' | 'rounded';

/**
 * The blur material the frosted design draws on iOS 15 to 25: UIKit's
 * adaptive materials, from the most translucent to the most opaque, and the
 * bars' own. Apple gave each role its own: `'chrome'` for bars (the dock,
 * navigation bar and toolbar), `'regular'` for menus, popovers and alerts,
 * `'thin'` for buttons floating over content.
 */
export type GlassMaterial =
  | 'ultra-thin'
  | 'thin'
  | 'regular'
  | 'thick'
  | 'chrome';

/**
 * What a glass element draws:
 *
 * - `'glass'`: Liquid Glass.
 * - `'frosted'`: a blur material, on iOS 15 to 25.
 * - `'solid'`: an opaque surface. That's Material on Android, unless the app
 *   opted into glass there, and glass under Reduce Transparency on Android
 *   and the web, which can't adapt the glass they draw. iOS adapts its own.
 */
export type GlassSurface = 'glass' | 'frosted' | 'solid';

/**
 * How much the glass blurs where the blur is drawn by the runtime: Android's
 * approximation, and the web before WebGL takes over. iOS's glass ignores it.
 * Clear glass barely blurs.
 */
const GLASS_BLUR: Readonly<Record<GlassVariant, string>> = {
  regular: '16px',
  clear: '6px',
};

/**
 * The blur of the frosted fallback, the `blur-effect` styles from before
 * iOS 13, which hosts without the materials draw (see `#attributes`). The
 * materials have Apple's own.
 */
const FROSTED_BLUR = '20px';

/**
 * A solid surface floats over the content as glass does, so it gets
 * Material's elevation shadow (level 2). An inline style, because Tailwind's
 * shadow classes draw nothing on Lynx.
 */
const SOLID_ELEVATION =
  '0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 6px rgba(0, 0, 0, 0.15)';

/** AngularLynx's wrapper of the native `blur-view` the component sits on. */
type BlurViewElement = { setAttribute(name: string, value: unknown): void };

/**
 * The color an icon projected into the glass draws with when it's given
 * none: the glass's foreground (see UI_ICON_COLOR), the way text there reads
 * `text-glass-foreground`. A named function, not an inline factory: the
 * component's metadata keeps its own copy of an inline one, which nothing
 * calls, so an app's coverage report would show it as uncovered.
 */
const glassIconColor = () => {
  const glass = inject(UiGlass);
  return computed(() => glass.foreground());
};

/**
 * Liquid Glass, for the controls and bars that float above an app's content:
 * a `<blur-view>` that draws the right material on each platform.
 *
 * ```html
 * <blur-view ui-glass class="flex-row items-center gap-2 px-4 py-2">
 *   <text class="text-glass-foreground">Now playing</text>
 * </blur-view>
 * ```
 *
 * It sits on the `<blur-view>` itself rather than wrapping one, so the
 * element you lay out and style is the glass, and what you put in it is
 * inside the glass. That matters on iOS: interactive glass reacts only to
 * touches on itself and what's in it, not on views stacked over it.
 *
 * What it draws follows the platform (see GlassDesign): UIKit's Liquid Glass
 * on iOS 26 and later, a frosted blur material on iOS 15 to 25, an opaque
 * Material surface on Android unless the app opts into glass with
 * `provideGlass({ android: 'glass' })`, and the runtime's WebGL glass in the
 * web preview. It also follows the user's accessibility settings where the
 * platform doesn't: see {@link surface}.
 *
 * Text and icons inside read `text-glass-foreground` (and
 * `text-glass-muted-foreground`), which the glass points at the right color
 * for its variant and the user's contrast setting. Glass belongs to the
 * layer above content, and shouldn't be layered on glass.
 */
@Component({
  selector: 'blur-view[ui-glass]',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Icons projected into the glass inject this through its element injector,
  // which content projection keeps them under.
  providers: [{ provide: UI_ICON_COLOR, useFactory: glassIconColor }],
  host: {
    '[class]': 'surfaceClass()',
    '[style.border-radius.px]': 'cornerRadius()',
    '[style.background-color]': 'solidTint()',
    '[style.box-shadow]': 'elevation()',
  },
  // iOS draws no background on a blur view, so a frosted material takes its
  // tint from a fill under the content, the shape of the glass: the filled
  // button of the design before Liquid Glass.
  template: `
    @if (frostedTint(); as color) {
      <view
        [class]="fillClass()"
        [style.background-color]="color"
        [style.border-radius.px]="cornerRadius()"
      ></view>
    }
    <ng-content />
  `,
})
export class UiGlass {
  /** `'regular'` or `'clear'`; see GlassVariant. */
  readonly variant = input<GlassVariant>('regular');
  /** `'capsule'`, `'circle'` or `'rounded'`; see GlassShape. */
  readonly shape = input<GlassShape>('capsule');
  /**
   * The corner radius of a `'rounded'` shape, in px. For a shape nested in
   * it, see `concentricRadius()`.
   */
  readonly radius = input(20, { transform: numberAttribute });
  /**
   * A color the glass takes on, such as `var(--glass-tint)` for the theme's
   * tint or `#2563eb`: a theme token or any CSS color. Use it sparingly, for
   * the screen's main action. It fills a solid surface or a frosted
   * material, as Material, and iOS before Liquid Glass, fill a button.
   */
  readonly tint = input<string | undefined>(undefined);
  /**
   * The glass reacts to touch, swelling and brightening under the finger as
   * a Liquid Glass control does: on iOS 26 and later, and in the web preview.
   */
  readonly interactive = input(false, { transform: booleanAttribute });
  /**
   * The blur material of the frosted design, on iOS 15 to 25: the one Apple
   * used for the glass's role (see GlassMaterial). Clear glass draws its
   * dark form, in either theme, as Apple's controls over media did. Liquid
   * Glass has one material, and ignores it.
   */
  readonly material = input<GlassMaterial>('regular');
  /**
   * Pairs this shape with another across a change, as SwiftUI's
   * `glassEffectID` does: when a shape with an id goes (removed, or hidden
   * with `visibility`) and one with the same id comes in the same update,
   * the two are one piece of glass changing shape. The new one grows out of
   * the old one's frame and corners, and the old one's content fades out in
   * it. In the same `ui-glass-group`, the group merges the two as they move.
   *
   * On iOS 26 and later, in an app `ng build --platform ios` makes (its
   * blur-view adds this). Elsewhere one shape replaces the other at once.
   */
  readonly glassId = input<string | undefined>(undefined);

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #systemDrawsGlass = injectSystemDrawsGlass();
  readonly #scheme = injectColorScheme();
  readonly #colors = injectThemeColors();
  readonly #host = inject<ElementRef<BlurViewElement>>(ElementRef);

  /**
   * The design on this platform, which components built on the glass follow
   * for their own form (see GlassDesign).
   */
  readonly design = injectGlassDesign();

  /**
   * The id a component pairs this shape under, such as a menu that grows out
   * of it (see pair). It takes the place of `glassId` while it's set.
   */
  readonly #pairedId = signal<string | null>(null);

  /**
   * @internal Pairs the shape under `id` (see glassId), or stops pairing it
   * (null): for a component that grows its own glass out of this shape, such
   * as the menu of a glass button that opens one.
   */
  pair(id: string | null): void {
    this.#pairedId.set(id);
  }

  /**
   * What the glass draws (see GlassSurface): the design's material, or an
   * opaque surface. Where the runtime draws the glass (Android's opt-in and
   * the web), Reduce Transparency turns it opaque, as UIKit turns its own.
   */
  readonly surface = computed<GlassSurface>(() => {
    const design = this.design();
    if (design === 'material') return 'solid';
    if (!this.#systemDrawsGlass && this.#settings.reduceTransparency()) {
      return 'solid';
    }
    return design;
  });

  /** Whether what's behind shows through clear glass. */
  readonly #seeThrough = computed(
    () => this.variant() === 'clear' && this.surface() !== 'solid',
  );

  /**
   * The color of text and icons on this glass, as a `var()`: the clear
   * foreground on see-through clear glass, which sits over photos and video,
   * and the glass foreground otherwise. Projected `<ui-icon>`s get it, and an
   * SVG of your own can resolve it the way icons do (see icon-theme.ts).
   */
  readonly foreground = computed(() =>
    this.#seeThrough()
      ? 'var(--glass-clear-foreground)'
      : 'var(--glass-foreground)',
  );

  /**
   * The tint as a color the native element can parse: an attribute can't
   * read CSS variables, so a theme token is swapped for its value in the
   * active scheme, as icons do.
   */
  readonly #tintColor = computed(() => {
    const tint = this.tint();
    return tint ? resolveIconColor(tint, this.#colors()) : null;
  });

  /**
   * A tinted solid surface is filled with the tint, as Material's filled
   * buttons are, and as iOS draws tinted glass under Reduce Transparency.
   */
  protected readonly solidTint = computed(() =>
    this.surface() === 'solid' ? this.#tintColor() : null,
  );

  protected readonly frostedTint = computed(() =>
    this.surface() === 'frosted' ? this.#tintColor() : null,
  );

  protected readonly fillClass = computed(() =>
    cn(
      'h-full w-full absolute left-0 top-0',
      this.shape() !== 'rounded' && 'rounded-full',
    ),
  );

  protected readonly elevation = computed(() =>
    this.surface() === 'solid' ? SOLID_ELEVATION : null,
  );

  protected readonly cornerRadius = computed(() =>
    this.shape() === 'rounded' ? this.radius() : null,
  );

  protected readonly surfaceClass = computed(() => {
    const increaseContrast = this.#settings.increaseContrast();
    return cn(
      this.shape() !== 'rounded' && 'rounded-full',
      // Material's tonal surface, and the opaque glass of Reduce
      // Transparency, unless a tint fills it (see solidTint). iOS ignores a
      // blur-view's background, but never draws a solid surface.
      this.surface() === 'solid' && !this.tint() && 'bg-secondary',
      // Increase Contrast gives the glass a visible edge, as UIKit gives its
      // own glass one.
      increaseContrast &&
        !this.#systemDrawsGlass &&
        'border border-glass-foreground',
      // The glass points the foreground tokens its content reads at the
      // right color (a variable redefined here reaches the projected text,
      // since variables inherit and `color` doesn't): white on see-through
      // clear glass, and full strength for muted text under Increase
      // Contrast.
      this.#seeThrough()
        ? '[--glass-foreground:var(--glass-clear-foreground)] [--glass-muted-foreground:var(--glass-clear-foreground)]'
        : increaseContrast &&
            '[--glass-muted-foreground:var(--glass-foreground)]',
    );
  });

  /**
   * The blur-view's attributes for the surface. The glass and the materials
   * are forced to the app's color scheme (`ios-user-interface-style`), which
   * iOS would otherwise take from the device: an app in its light theme on a
   * phone in dark mode would get dark glass under dark text. A solid surface
   * turns the blur off, and on Android stops the blur-view redrawing the page
   * behind it on every frame (`enable-auto-blur`), which it does even with no
   * radius.
   *
   * The frosted design draws `blur-material`, which the iOS shell's
   * blur-view adds (packages/native's BlurView.swift): Lynx's own
   * has only the `blur-effect` styles from before iOS 13, a single weight in
   * a single appearance. A host without it, such as Lynx Explorer, ignores
   * the attribute and draws the `blur-effect` instead, picked for the scheme
   * since those styles don't adapt.
   */
  readonly #attributes = computed(() => {
    const surface = this.surface();
    const variant = this.variant();
    // Apple's controls over media used the dark materials in either theme.
    const dark =
      this.#scheme() === 'dark' ||
      (surface === 'frosted' && variant === 'clear');
    let effect = 'light';
    let radius = '0px';
    let material: GlassMaterial | null = null;
    if (surface === 'glass') {
      effect = 'glass';
      radius = GLASS_BLUR[variant];
    } else if (surface === 'frosted') {
      effect = dark ? 'dark' : 'extra-light';
      radius = FROSTED_BLUR;
      material = this.material();
    }
    return {
      'blur-effect': effect,
      'blur-radius': radius,
      'blur-material': material,
      'enable-auto-blur': surface !== 'solid',
      'glass-style': variant,
      'glass-tint-color': this.#tintColor(),
      'glass-interactive': this.interactive() || null,
      'glass-effect-id': this.#pairedId() ?? this.glassId() ?? null,
      'ios-user-interface-style': dark ? 'dark' : 'light',
    };
  });

  // Set on the element as they are, rather than through host attribute
  // bindings, which turn every value into a string: Lynx reads
  // `glass-interactive` and `enable-auto-blur` as booleans. `null` removes an
  // attribute, which restores Lynx's default.
  protected readonly setAttributes = effect(() => {
    const element = this.#host.nativeElement;
    for (const [name, value] of Object.entries(this.#attributes())) {
      element.setAttribute(name, value);
    }
  });
}

/**
 * Merges the glass elements inside it, as iOS 26 draws a group of glass
 * controls: shapes closer than `spacing` flow into each other like droplets,
 * and the group draws them in one pass. Put a `<blur-view ui-glass>` directly
 * inside it for each shape: iOS merges the glass in the group's own content,
 * and a wrapper that draws anything of its own comes between them.
 *
 * ```html
 * <blur-view ui-glass-group [spacing]="16" class="flex-row gap-2">
 *   <blur-view ui-glass shape="circle" class="h-12 w-12">…</blur-view>
 *   <blur-view ui-glass shape="circle" class="h-12 w-12">…</blur-view>
 * </blur-view>
 * ```
 *
 * The group draws nothing itself. Shapes merge on iOS 26 and later and in
 * the web preview. Android's glass doesn't merge, and the frosted and
 * Material designs have no glass to merge.
 *
 * Moving or resizing a shape, with a CSS transition for example, morphs the
 * merged glass with it. On iOS 26, in an app `ng build --platform ios`
 * makes, a shape that's added or removed (or shown and hidden with
 * `visibility`) materializes or dissolves, as UIKit's glass does, and two
 * shapes with the same `glassId` morph into each other (see UiGlass's
 * `glassId`). Elsewhere a shape that's added or removed appears or
 * disappears at once.
 */
@Component({
  selector: 'blur-view[ui-glass-group]',
  encapsulation: ViewEncapsulation.None,
  template: `<ng-content />`,
})
export class UiGlassGroup {
  /** How close two glass shapes come before they merge, in px. */
  readonly spacing = input(0, { transform: numberAttribute });

  readonly #design = injectGlassDesign();
  readonly #host = inject<ElementRef<BlurViewElement>>(ElementRef);

  // As UiGlass sets its own (see there). A container that isn't merging
  // glass is a plain transparent view: `light` with no radius draws nothing,
  // where `glass-container` would log an error before iOS 26. It never blurs,
  // so on Android it never redraws the page behind it either.
  protected readonly material = effect(() => {
    const element = this.#host.nativeElement;
    element.setAttribute(
      'blur-effect',
      this.#design() === 'glass' ? 'glass-container' : 'light',
    );
    element.setAttribute('blur-radius', '0px');
    element.setAttribute('enable-auto-blur', false);
    element.setAttribute('spacing', this.spacing());
  });
}
