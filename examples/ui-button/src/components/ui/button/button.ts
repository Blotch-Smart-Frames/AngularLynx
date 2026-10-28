import { NgTemplateOutlet } from '@angular/common';
import {
  type ElementRef,
  Component,
  Injector,
  ViewEncapsulation,
  computed,
  contentChild,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { cva, type VariantProps } from 'class-variance-authority';

import {
  type AnimationHandle,
  pressDown,
  pressRelease,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass } from '../glass/glass';
import {
  injectGlassDesign,
  injectSystemDrawsGlass,
} from '../glass/glass-design';
import { UiIcon } from '../icon/icon';
import { UI_ICON_COLOR } from '../icon/icon-theme';
import { UiSpinner } from '../spinner/spinner';

/**
 * The container classes of the solid variants. The glass variants draw a
 * `<blur-view>`, which classes alone can't, so they aren't here.
 */
export const buttonVariants = cva(
  'items-center rounded-md flex justify-center',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-background',
        secondary: 'bg-secondary',
        ghost: 'bg-transparent',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
        'icon-circle': 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/** A variant drawn with solid colors, on every platform. */
export type SolidButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>['variant']
>;

/**
 * Liquid Glass variants, SwiftUI's button styles: `glass` (`.glass`),
 * `glass-prominent` (`.glassProminent`, tinted for the screen's main action)
 * and `glass-clear` (`.glass(.clear)`, for buttons over photos and video).
 */
export type GlassButtonVariant = 'glass' | 'glass-prominent' | 'glass-clear';

export type ButtonVariant = SolidButtonVariant | GlassButtonVariant;
export type ButtonSize = NonNullable<
  VariantProps<typeof buttonVariants>['size']
>;

const GLASS_VARIANTS: ReadonlySet<ButtonVariant> = new Set<ButtonVariant>([
  'glass',
  'glass-prominent',
  'glass-clear',
]);

/**
 * Whether a variant is drawn with glass, narrowing it for the maps below.
 */
const isGlassVariant = (
  variant: ButtonVariant,
): variant is GlassButtonVariant => GLASS_VARIANTS.has(variant);

/** The sizes for a single icon, which then needs no label. */
const ICON_SIZES: ReadonlySet<ButtonSize> = new Set<ButtonSize>([
  'icon',
  'icon-circle',
]);

const LABEL_SIZES: Readonly<Record<ButtonSize, string>> = {
  default: 'text-sm',
  sm: 'text-xs',
  lg: 'text-base',
  icon: 'text-sm',
  'icon-circle': 'text-sm',
};

const SOLID_LABEL_COLORS: Readonly<Record<SolidButtonVariant, string>> = {
  default: 'text-primary-foreground',
  destructive: 'text-destructive-foreground',
  outline: 'text-foreground',
  secondary: 'text-secondary-foreground',
  ghost: 'text-foreground',
};

/**
 * The token of each solid variant's label color above, for what draws with
 * SVG: the spinner and projected icons can't read the text classes, so they
 * get the token and resolve it themselves (see icon-theme.ts).
 */
const SOLID_FOREGROUNDS: Readonly<Record<SolidButtonVariant, string>> = {
  default: 'var(--primary-foreground)',
  destructive: 'var(--destructive-foreground)',
  outline: 'var(--foreground)',
  secondary: 'var(--secondary-foreground)',
  ghost: 'var(--foreground)',
};

/**
 * A glass button's box, which its glass fills. Glass buttons are capsules,
 * as SwiftUI draws them, so an icon size is a circle.
 */
const glassFrameVariants = cva('flex-col rounded-full flex', {
  variants: {
    size: {
      default: 'h-10',
      sm: 'h-9',
      lg: 'h-11',
      icon: 'h-10 w-10',
      'icon-circle': 'h-10 w-10',
    },
  },
});

const GLASS_PADDING: Readonly<Record<ButtonSize, string>> = {
  default: 'px-4',
  sm: 'px-3',
  lg: 'px-8',
  icon: '',
  'icon-circle': '',
};

/**
 * The glass variants as Material 3 Expressive buttons, Android's default
 * (see GlassDesign): `glass` and `glass-clear` are filled tonal buttons,
 * `glass-prominent` a filled one in the glass tint, and the icon sizes
 * Material's round icon buttons. Material's buttons sit flat on the page,
 * with no shadow, and are fully rounded.
 */
const materialButtonVariants = cva(
  'flex-row items-center rounded-full flex relative justify-center overflow-hidden',
  {
    variants: {
      variant: {
        glass: 'bg-secondary',
        'glass-clear': 'bg-secondary',
        'glass-prominent': 'bg-glass-tint',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
        'icon-circle': 'h-10 w-10',
      },
    },
  },
);

/**
 * How a glass variant looks on this platform: `'glass'` draws it on a
 * `<blur-view ui-glass>` (Liquid Glass, or the frosted material before iOS
 * 26), `'material'` as a Material button. The solid variants are `'solid'`
 * everywhere.
 */
type ButtonLook = 'solid' | 'glass' | 'material';

/**
 * How the button answers a finger: it shrinks (`'scale'`), dims at once
 * (`'dim'`, under Reduce Motion), shows Material's pressed state layer
 * (`'layer'`), or leaves it to interactive glass, which reacts by itself
 * (`'none'`).
 */
type PressFeedback = 'scale' | 'dim' | 'layer' | 'none';

/**
 * `UiIcon`, for `contentChild()`. A call rather than the class itself: for a
 * class, Angular's test build keeps an arrow function that nothing calls,
 * which an app's coverage report would show as uncovered.
 */
const iconType = () => UiIcon;

/**
 * The platform, as SystemInfo names it, or undefined where there's no
 * SystemInfo to read, such as in unit tests, where LynxSystemInfo throws.
 */
const platformOf = (injector: Injector): string | undefined => {
  try {
    return injector.get(LynxSystemInfo).platform;
  } catch {
    return undefined;
  }
};

/**
 * The color an icon projected into the button draws with when it's given
 * none: its label's (see UI_ICON_COLOR). A named function, not an inline
 * factory: the component's metadata keeps its own copy of an inline one,
 * which nothing calls, so an app's coverage report would show it uncovered.
 */
const buttonIconColor = () => inject(UiButton).foreground;

@Component({
  selector: 'ui-button',
  imports: [LYNX_ELEMENTS, NgTemplateOutlet, UiGlass, UiSpinner],
  encapsulation: ViewEncapsulation.None,
  // Icons projected into the button inject this through its host's element
  // injector, which is where Angular looks for projected content: the glass
  // inside the template provides one too, but only for the template's own
  // nodes.
  providers: [{ provide: UI_ICON_COLOR, useFactory: buttonIconColor }],
  template: `
    <!-- Press feedback binds BOTH touch and mouse events on purpose. Native
         (iOS/Android) only ever fires touch; Lynx web runs in the browser, where
         a cursor press fires mousedown/up and NEVER touchstart — so touch-only
         bindings gave zero visual feedback on web while (bindtap) still fired the
         action (a "the button works but doesn't react" split). Binding both makes
         the press-and-hold identical on every platform; mouse events are inert on
         touch devices, so there's no double-fire. The scale animation itself lives
         in pressDown/pressRelease — see their JSDoc for why it's a CSS transition
         (which serializes to the DOM on Lynx web) and not el.animate() (whose Web
         Animation runs on web-core's offscreen node and never reaches the screen).

         An icon-only button has no text for a screen reader to read, so with
         an accessibility-label the whole button becomes one element that says
         it. Without one, the label's own text is read, as a button. -->
    <view
      #container
      [class]="containerClass()"
      [attr.accessibility-element]="accessibilityLabel() ? 'true' : null"
      [attr.accessibility-traits]="accessibilityLabel() ? 'button' : null"
      [attr.accessibility-label]="accessibilityLabel() || null"
      (bindtouchstart)="onPressStart()"
      (bindtouchend)="onPressEnd()"
      (bindtouchcancel)="onPressCancel()"
      (bindmousedown)="onPressStart()"
      (bindmouseup)="onPressEnd()"
      (bindmouseleave)="onPressCancel()"
      (bindtap)="onTap()"
    >
      @if (look() === 'glass') {
        <!-- The container is the button's box, and the glass fills it. Under
             clear glass the container is the dimming layer (see dimmed).
             The content sits in the glass, where iOS's interactive glass
             reacts to touches on it, and is what dims when disabled, as a
             disabled SwiftUI glass button dims its label: glass under a
             faded parent turns into a washed-out patch on iOS. -->
        <blur-view
          ui-glass
          [variant]="variant() === 'glass-clear' ? 'clear' : 'regular'"
          [tint]="
            variant() === 'glass-prominent' ? 'var(--glass-tint)' : undefined
          "
          [interactive]="interactive()"
          [class]="glassClass()"
        >
          <view [class]="glassContentClass()">
            <ng-container [ngTemplateOutlet]="content" />
          </view>
        </blur-view>
      } @else {
        @if (stateLayerClass(); as layer) {
          <view [class]="layer"></view>
        }
        <ng-container [ngTemplateOutlet]="content" />
      }
    </view>

    <!-- One copy of the content, for whichever form the button takes: Angular
         projects content once, so it can't be in both branches above. -->
    <ng-template #content>
      @if (loading()) {
        <ui-spinner [size]="spinnerSize()" [color]="foreground()" />
      } @else {
        <ng-content select="ui-icon" />
        @if (showLabel()) {
          <text
            [attr.accessibility-traits]="accessibilityLabel() ? null : 'button'"
            [class]="labelClass()"
            ><ng-content
          /></text>
        }
      }
    </ng-template>
  `,
})
export class UiButton {
  /**
   * The look: a solid variant, or a glass one (`'glass'`,
   * `'glass-prominent'`, `'glass-clear'`; see GlassButtonVariant). Keep glass
   * for buttons that float over the content.
   */
  readonly variant = input<ButtonVariant>('default');
  /**
   * The height and padding. `'icon'` and `'icon-circle'` fit one projected
   * `<ui-icon>`: a rounded square and a circle (glass buttons are circles in
   * either).
   */
  readonly size = input<ButtonSize>('default');
  readonly disabled = input(false);
  readonly loading = input(false);
  /**
   * What a screen reader says for the button. An icon-only button needs one;
   * a button with a label reads its label without it.
   */
  readonly accessibilityLabel = input<string | undefined>(undefined, {
    alias: 'accessibility-label',
  });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  readonly containerRef = viewChild<ElementRef>('container');
  /** A `<ui-icon>` projected into the button, which sits before the label. */
  readonly projectedIcon = contentChild(iconType());

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #design = injectGlassDesign();
  readonly #systemDrawsGlass = injectSystemDrawsGlass();
  readonly #platform = platformOf(inject(Injector));
  #pressAnim?: AnimationHandle;

  /** A finger (or the mouse) is down on the button. */
  protected readonly pressing = signal(false);

  readonly #inactive = computed(() => this.disabled() || this.loading());

  protected readonly look = computed<ButtonLook>(() => {
    if (!isGlassVariant(this.variant())) return 'solid';
    return this.#design() === 'material' ? 'material' : 'glass';
  });

  /**
   * The glass reacts to touch while the button can be pressed. Where the
   * runtime draws it (the web preview), that's motion Reduce Motion asks to
   * leave out; iOS tones its own glass down under the setting.
   */
  protected readonly interactive = computed(
    () =>
      !this.#inactive() &&
      (this.#systemDrawsGlass || !this.#settings.reduceMotion()),
  );

  /**
   * For the glass look: what's behind shows through the glass, which is
   * drawn as glass or a frosted material, not the opaque surface it turns
   * into under Reduce Transparency where the runtime draws it (as
   * UiGlass.surface decides).
   */
  readonly #seeThrough = computed(
    () => this.#systemDrawsGlass || !this.#settings.reduceTransparency(),
  );

  /**
   * Interactive glass that answers a press itself, swelling under the
   * finger: UIKit's on iOS 26 and later, and the runtime's in the web
   * preview. Android's blur-view has no interactive glass, and the frosted
   * materials before iOS 26 don't react.
   */
  readonly #glassReacts = computed(
    () =>
      this.#design() === 'glass' &&
      this.#seeThrough() &&
      this.interactive() &&
      this.#platform !== 'Android',
  );

  /**
   * See PressFeedback. Shrinking on top of interactive glass would fight its
   * swell, Material's buttons show a state layer, and under Reduce Motion
   * the button dims rather than moving.
   */
  readonly #feedback = computed<PressFeedback>(() => {
    const look = this.look();
    if (look === 'material') return 'layer';
    if (look === 'glass' && this.#glassReacts()) return 'none';
    return this.#settings.reduceMotion() ? 'dim' : 'scale';
  });

  readonly #dimmedByPress = computed(
    () => this.pressing() && this.#feedback() === 'dim',
  );

  /**
   * Clear glass sits on a dark layer at about a third, so its white label
   * stays legible over bright photos and video: Apple's rule for clear
   * glass. The layer is the container, under the glass.
   */
  readonly #dimmed = computed(
    () => this.variant() === 'glass-clear' && this.#seeThrough(),
  );

  protected readonly showLabel = computed(
    () => !(this.projectedIcon() && ICON_SIZES.has(this.size())),
  );

  /** Space between an icon and the label beside it. */
  readonly #gap = computed(
    () => !!this.projectedIcon() && this.showLabel() && 'gap-2',
  );

  /**
   * The color of the label, the spinner and projected icons, as a `var()`.
   * On clear glass it's the clear foreground, which stays white over media.
   */
  readonly foreground = computed(() => {
    const variant = this.variant();
    if (!isGlassVariant(variant)) return SOLID_FOREGROUNDS[variant];
    if (variant === 'glass-prominent') return 'var(--glass-tint-foreground)';
    if (this.look() === 'material') return 'var(--secondary-foreground)';
    return this.#dimmed()
      ? 'var(--glass-clear-foreground)'
      : 'var(--glass-foreground)';
  });

  protected readonly containerClass = computed(() => {
    const variant = this.variant();
    const size = this.size();
    const inactive = this.#inactive();
    if (!isGlassVariant(variant)) {
      return cn(
        buttonVariants({ variant, size }),
        this.#gap(),
        this.#dimmedByPress() && 'opacity-70',
        inactive && 'opacity-50',
        this.userClass(),
      );
    }
    if (this.look() === 'material') {
      return cn(
        materialButtonVariants({ variant, size }),
        this.#gap(),
        // A tonal button's edge barely shows on the page, so Increase
        // Contrast outlines it, as glass gets an edge there.
        variant !== 'glass-prominent' &&
          this.#settings.increaseContrast() &&
          'border border-foreground',
        inactive && 'opacity-50',
        this.userClass(),
      );
    }
    return cn(
      glassFrameVariants({ size }),
      this.#dimmed() && 'bg-glass-dim',
      this.userClass(),
    );
  });

  protected readonly glassClass = computed(() =>
    cn(
      'flex-1 flex-row items-center flex justify-center',
      GLASS_PADDING[this.size()],
    ),
  );

  protected readonly glassContentClass = computed(() =>
    cn(
      'flex-row items-center flex justify-center',
      this.#gap(),
      this.#dimmedByPress() && 'opacity-70',
      this.#inactive() && 'opacity-50',
    ),
  );

  /**
   * Material's pressed state: the label's color over the container at 10%,
   * under the content. It appears with the press and goes with the release,
   * with no motion.
   */
  protected readonly stateLayerClass = computed(
    () =>
      this.pressing() &&
      this.#feedback() === 'layer' &&
      cn(
        'h-full w-full opacity-10 absolute left-0 top-0',
        this.variant() === 'glass-prominent'
          ? 'bg-glass-tint-foreground'
          : 'bg-secondary-foreground',
      ),
  );

  protected readonly labelClass = computed(() => {
    const variant = this.variant();
    let color: string;
    if (!isGlassVariant(variant)) color = SOLID_LABEL_COLORS[variant];
    else if (variant === 'glass-prominent') {
      color = 'text-glass-tint-foreground';
    } else if (this.look() === 'material') color = 'text-secondary-foreground';
    // The glass points this at the clear foreground on clear glass.
    else color = 'text-glass-foreground';
    return cn('font-medium', LABEL_SIZES[this.size()], color);
  });

  protected readonly spinnerSize = computed(() => {
    const s = this.size();
    return s === 'sm' ? ('xs' as const) : ('sm' as const);
  });

  protected onPressStart(): void {
    if (this.#inactive()) return;
    this.pressing.set(true);
    if (this.#feedback() !== 'scale') return;
    // pressDown/pressRelease drive el.setStyle() based CSS transitions on the
    // container ref (see pressDown for why it isn't el.animate()).
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    if (this.#inactive()) return;
    this.#release();
  }

  protected onPressCancel(): void {
    // Also release on cancel — without this, a canceled touch (e.g. scroll
    // gesture taking over) leaves the button stuck in its pressed-down state.
    this.#release();
  }

  protected onTap(): void {
    if (!this.#inactive()) {
      this.pressed.emit();
    }
  }

  #release(): void {
    this.pressing.set(false);
    if (this.#feedback() !== 'scale') return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }
}
