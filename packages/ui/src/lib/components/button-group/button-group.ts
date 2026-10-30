import { NgTemplateOutlet } from '@angular/common';
import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  contentChild,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import { cva, type VariantProps } from 'class-variance-authority';

import {
  type AnimationHandle,
  pressDown,
  pressRelease,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import { concentricRadius } from '../glass/concentric-radius';
import { UiGlass } from '../glass/glass';
import {
  injectGlassDesign,
  injectSystemDrawsGlass,
} from '../glass/glass-design';
import { UiIcon } from '../icon/icon';
import { UI_ICON_COLOR } from '../icon/icon-theme';

/**
 * Per-item styling of the solid variants. Corners are intentionally left
 * square here: the group container clips the whole bar with `overflow-hidden`
 * + `rounded-md`, so only the outer edges round off while every internal seam
 * stays crisp. Rounding individual items by position would require
 * `:first-child`/`:last-child` selectors, which Lynx's CSS engine does not
 * support (no component in the library relies on positional selectors — see
 * CLAUDE.md).
 */
export const buttonGroupItemVariants = cva('items-center flex justify-center', {
  variants: {
    variant: {
      // Filled segments — the whole bar reads as a solid control.
      default: 'bg-secondary',
      // Neutral segments against the app background, ringed by the container.
      outline: 'bg-background',
    },
    size: {
      default: 'h-10 px-4',
      sm: 'h-9 px-3',
      lg: 'h-11 px-6',
      icon: 'h-10 w-10',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

/** A variant drawn with solid colors, on every platform. */
export type SolidButtonGroupVariant = NonNullable<
  VariantProps<typeof buttonGroupItemVariants>['variant']
>;

/**
 * The glass variants: the group is one glass shape with plain items in it,
 * the way iOS groups toolbar items on one glass background. `glass-clear` is
 * for a group over photos and video.
 */
export type GlassButtonGroupVariant = 'glass' | 'glass-clear';

export type ButtonGroupVariant =
  | SolidButtonGroupVariant
  | GlassButtonGroupVariant;
export type ButtonGroupSize = NonNullable<
  VariantProps<typeof buttonGroupItemVariants>['size']
>;
export type ButtonGroupOrientation = 'horizontal' | 'vertical';

/**
 * How a group looks on this platform: the solid variants everywhere, and the
 * glass ones as one glass shape (`'glass'`) or, on Android by default, as
 * Material 3 Expressive's connected button group (`'material'`).
 */
export type ButtonGroupLook = 'solid' | 'glass' | 'material';

/** Each size's item height, in px, for the corner radii. */
const ITEM_HEIGHTS: Readonly<Record<ButtonGroupSize, number>> = {
  default: 40,
  sm: 36,
  lg: 44,
  icon: 40,
};

/** How far the items sit inside a glass group's edge, in px (`p-1`). */
const GLASS_INSET = 4;

/**
 * The inner corners of Material's connected button group, in px: the
 * group's ends are fully round, the corners between items small.
 */
const MATERIAL_INNER_RADIUS = 8;

const LABEL_SIZES: Readonly<Record<ButtonGroupSize, string>> = {
  default: 'text-sm',
  sm: 'text-xs',
  lg: 'text-base',
  icon: 'text-sm',
};

const SOLID_LABEL_COLORS: Readonly<Record<SolidButtonGroupVariant, string>> = {
  default: 'text-secondary-foreground',
  outline: 'text-foreground',
};

/** The token of each solid variant's label color, for projected icons. */
const SOLID_FOREGROUNDS: Readonly<Record<SolidButtonGroupVariant, string>> = {
  default: 'var(--secondary-foreground)',
  outline: 'var(--foreground)',
};

/** The size classes of an item in a glass or Material group. */
const ITEM_SIZES: Readonly<Record<ButtonGroupSize, string>> = {
  default: 'h-10 px-4',
  sm: 'h-9 px-3',
  lg: 'h-11 px-6',
  icon: 'h-10 w-10',
};

/**
 * `UiIcon`, for `contentChild()`. A call rather than the class itself: for a
 * class, Angular's test build keeps an arrow function that nothing calls,
 * which an app's coverage report would show as uncovered.
 */
const iconType = () => UiIcon;

/**
 * The color an icon projected into an item draws with when it's given none:
 * the items' label color (see UI_ICON_COLOR). Named, not inline: the
 * component's metadata keeps its own copy of an inline factory, which
 * nothing calls.
 */
const groupIconColor = () => inject(UiButtonGroup).foreground;

/**
 * A row (or column) of connected action buttons — a toolbar of related
 * commands rendered as a single, seamless control.
 *
 * The group owns the shared appearance (`variant`, `size`, `orientation`,
 * `disabled`) and each `<ui-button-group-item>` reads it back via DI, mirroring
 * the `UiToggleGroup`/`UiToggleGroupItem` pattern. Unlike a toggle group this
 * carries no selection state: every item is an independent action that emits
 * `pressed`.
 *
 * With a glass variant the group is one glass shape with plain items in it,
 * as iOS 26 groups toolbar items on one background, rather than a glass
 * shape per item merged in a `ui-glass-group`: merged circles join with
 * pinched waists, not the straight edges of a toolbar's capsule, and glass
 * isn't layered on glass. On Android it's Material's connected button group
 * by default.
 */
@Component({
  selector: 'ui-button-group',
  imports: [LYNX_ELEMENTS, NgTemplateOutlet, UiGlass],
  encapsulation: ViewEncapsulation.None,
  // Icons projected into the items inject this: they're declared inside the
  // group, so the group's element injector is one of theirs.
  providers: [{ provide: UI_ICON_COLOR, useFactory: groupIconColor }],
  template: `
    @if (look() === 'glass') {
      <!-- The frame is the group's box and, under clear glass, its dimming
           layer, in the glass's shape. Before iOS 26 the glass is the thin
           material, as the buttons' is. -->
      <view [class]="frameClass()" [style.border-radius.px]="cornerRadius()">
        <blur-view
          ui-glass
          [shape]="capsule() ? 'capsule' : 'rounded'"
          [radius]="radius()"
          [variant]="variant() === 'glass-clear' ? 'clear' : 'regular'"
          material="thin"
          [interactive]="interactive()"
          [class]="glassClass()"
        >
          <ng-container [ngTemplateOutlet]="items" />
        </blur-view>
      </view>
    } @else {
      <view
        [class]="containerClass()"
        [style.border-radius.px]="materialRadius()"
      >
        <ng-container [ngTemplateOutlet]="items" />
      </view>
    }

    <!-- One copy of the items, for whichever form the group takes: Angular
         projects content once. -->
    <ng-template #items><ng-content /></ng-template>
  `,
})
export class UiButtonGroup {
  readonly orientation = input<ButtonGroupOrientation>('horizontal');
  /**
   * `'default'` or `'outline'`, or `'glass'` / `'glass-clear'` for one glass
   * background (see GlassButtonGroupVariant).
   */
  readonly variant = input<ButtonGroupVariant>('default');
  /** The items' height and padding; `'icon'` makes square icon-only items. */
  readonly size = input<ButtonGroupSize>('default');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #design = injectGlassDesign();
  readonly #systemDrawsGlass = injectSystemDrawsGlass();

  /** The form the group takes on this platform, for its items. */
  readonly look = computed<ButtonGroupLook>(() => {
    const variant = this.variant();
    if (variant !== 'glass' && variant !== 'glass-clear') return 'solid';
    return this.#design() === 'material' ? 'material' : 'glass';
  });

  /**
   * The glass's corner radius, in px: half an item's height plus the inset,
   * the ends a capsule of the items would have. A column of wider items
   * takes it for its corners.
   */
  protected readonly radius = computed(
    () => ITEM_HEIGHTS[this.size()] / 2 + GLASS_INSET,
  );

  /**
   * The corner radius of an item's pressed highlight, in px. In glass it's
   * concentric with the group's corners, so the gap between them stays even
   * all the way round; in Material's connected group it's the small inner
   * corner, and the group's round ends clip the outer ones.
   */
  readonly itemRadius = computed(() =>
    this.look() === 'material'
      ? MATERIAL_INNER_RADIUS
      : concentricRadius(this.radius(), GLASS_INSET),
  );

  /**
   * A row, or a column of square icon items, is a capsule. A column of
   * wider items has round corners instead. A capsule takes `rounded-full`
   * rather than a radius of half its height, which iOS draws with
   * squared-off ends.
   */
  protected readonly capsule = computed(
    () => this.orientation() === 'horizontal' || this.size() === 'icon',
  );

  /** The frame's corners, under glass that isn't a capsule. */
  protected readonly cornerRadius = computed(() =>
    this.capsule() ? null : this.radius(),
  );

  /** A Material column of wider items: its ends are half an item round. */
  protected readonly materialRadius = computed(() =>
    this.look() === 'material' && !this.capsule()
      ? ITEM_HEIGHTS[this.size()] / 2
      : null,
  );

  /**
   * As UiButton's: the glass reacts to touch, unless Reduce Motion is on
   * where the runtime draws it.
   */
  protected readonly interactive = computed(
    () =>
      !this.disabled() &&
      (this.#systemDrawsGlass || !this.#settings.reduceMotion()),
  );

  /**
   * Clear glass that's see-through (not the opaque surface Reduce
   * Transparency makes of the runtime's glass) sits on the dimming layer,
   * and its items turn white.
   */
  readonly #dimmed = computed(
    () =>
      this.variant() === 'glass-clear' &&
      this.look() === 'glass' &&
      (this.#systemDrawsGlass || !this.#settings.reduceTransparency()),
  );

  /** The items' label color, as a `var()`, for projected icons. */
  readonly foreground = computed(() => {
    const variant = this.variant();
    if (variant !== 'glass' && variant !== 'glass-clear') {
      return SOLID_FOREGROUNDS[variant];
    }
    if (this.look() === 'material') return 'var(--secondary-foreground)';
    return this.#dimmed()
      ? 'var(--glass-clear-foreground)'
      : 'var(--glass-foreground)';
  });

  readonly #direction = computed(() =>
    this.orientation() === 'vertical' ? 'flex-col' : 'flex-row',
  );

  protected readonly frameClass = computed(() =>
    cn(
      // `self-start` stops the group stretching to fill a column parent so
      // it hugs its buttons like a real toolbar. Pass `class="w-full"` to
      // override.
      'flex-col self-start flex',
      this.capsule() && 'rounded-full',
      this.#dimmed() && 'bg-glass-dim',
      this.userClass(),
    ),
  );

  protected readonly glassClass = computed(() =>
    cn('p-1 flex', this.#direction()),
  );

  protected readonly containerClass = computed(() =>
    cn(
      this.look() === 'material'
        ? // Material's connected group: the items, 2px apart, show the page
          // between them, and the group's round ends clip the outer corners.
          cn('gap-0.5 flex overflow-hidden', this.capsule() && 'rounded-full')
        : // The dividers between items are the group's own `bg-border`
          // showing through a 1px `gap-px` seam — no per-item borders needed,
          // which keeps items position-agnostic. `overflow-hidden` +
          // `rounded-md` then clip the square item corners so the bar reads
          // as one rounded control.
          'gap-px rounded-md border border-border bg-border flex overflow-hidden',
      'self-start',
      this.#direction(),
      this.userClass(),
    ),
  );
}

/**
 * A single pressable action inside a `<ui-button-group>`. Inherits appearance
 * from the parent group; set `disabled` per-item to disable just this action.
 */
@Component({
  selector: 'ui-button-group-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
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
      @if (highlightClass(); as highlight) {
        <view [class]="highlight" [style.border-radius.px]="radius()"></view>
      }
      <ng-content select="ui-icon" />
      @if (showLabel()) {
        <text
          [attr.accessibility-traits]="accessibilityLabel() ? null : 'button'"
          [class]="labelClass()"
          ><ng-content
        /></text>
      }
    </view>
  `,
})
export class UiButtonGroupItem {
  readonly #group = inject(UiButtonGroup);
  readonly #settings = inject(LynxAccessibilitySettings);

  readonly disabled = input(false, { transform: booleanAttribute });
  /**
   * What a screen reader says for the item. An icon-only item needs one; an
   * item with a label reads its label without it.
   */
  readonly accessibilityLabel = input<string | undefined>(undefined, {
    alias: 'accessibility-label',
  });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly pressed = output<void>();

  readonly containerRef = viewChild<ElementRef>('container');
  /** A `<ui-icon>` projected into the item, which sits before the label. */
  readonly projectedIcon = contentChild(iconType());
  #pressAnim?: AnimationHandle;

  /** A finger (or the mouse) is down on the item. */
  protected readonly pressing = signal(false);

  // Disabled when either the whole group or this specific item is disabled.
  protected readonly isDisabled = computed(
    () => this.#group.disabled() || this.disabled(),
  );

  protected readonly radius = computed(() => this.#group.itemRadius());

  /**
   * Glass and Material items show a highlight while pressed, in place: the
   * glass around them is what reacts on iOS, and Material marks a press with
   * a state layer. Solid items shrink, or dim under Reduce Motion.
   */
  readonly #highlights = computed(() => this.#group.look() !== 'solid');

  protected readonly showLabel = computed(
    () => !(this.projectedIcon() && this.#group.size() === 'icon'),
  );

  readonly #gap = computed(
    () => !!this.projectedIcon() && this.showLabel() && 'gap-2',
  );

  protected readonly containerClass = computed(() => {
    const variant = this.#group.variant();
    const size = this.#group.size();
    const look = this.#group.look();
    const disabled = this.isDisabled() && 'opacity-50';
    if (variant !== 'glass' && variant !== 'glass-clear') {
      return cn(
        buttonGroupItemVariants({ variant, size }),
        this.#gap(),
        this.pressing() && this.#settings.reduceMotion() && 'opacity-70',
        disabled,
        this.userClass(),
      );
    }
    return cn(
      'flex-row items-center flex relative justify-center',
      ITEM_SIZES[size],
      look === 'material' &&
        cn(
          'rounded-[8px] bg-secondary overflow-hidden',
          this.#settings.increaseContrast() && 'border border-foreground',
        ),
      this.#gap(),
      disabled,
      this.userClass(),
    );
  });

  /**
   * The pressed highlight: the label's color at a low opacity, under the
   * content, in the item's concentric corners. It comes and goes with the
   * finger, with no motion.
   */
  protected readonly highlightClass = computed(
    () =>
      this.pressing() &&
      this.#highlights() &&
      cn(
        'h-full w-full absolute left-0 top-0',
        this.#group.look() === 'material'
          ? 'bg-secondary-foreground opacity-10'
          : 'bg-glass-foreground opacity-15',
      ),
  );

  protected readonly labelClass = computed(() => {
    const variant = this.#group.variant();
    let color: string;
    if (variant !== 'glass' && variant !== 'glass-clear') {
      color = SOLID_LABEL_COLORS[variant];
    } else if (this.#group.look() === 'material') {
      color = 'text-secondary-foreground';
    } else {
      // The glass points this at the clear foreground on clear glass.
      color = 'text-glass-foreground';
    }
    return cn('font-medium', LABEL_SIZES[this.#group.size()], color);
  });

  protected onPressStart(): void {
    if (this.isDisabled()) return;
    this.pressing.set(true);
    if (!this.#scales()) return;
    // See UiButton: press feedback is an el.setStyle()-driven CSS transition.
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.containerRef()?.nativeElement);
  }

  protected onPressEnd(): void {
    if (this.isDisabled()) return;
    this.#release();
  }

  protected onPressCancel(): void {
    // Release on cancel too — otherwise a touch stolen by a scroll gesture
    // leaves the item stuck in its pressed-down state.
    this.#release();
  }

  protected onTap(): void {
    if (!this.isDisabled()) {
      this.pressed.emit();
    }
  }

  /**
   * Solid items shrink under the finger, unless Reduce Motion is on.
   */
  #scales(): boolean {
    return !this.#highlights() && !this.#settings.reduceMotion();
  }

  #release(): void {
    this.pressing.set(false);
    if (!this.#scales()) return;
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.containerRef()?.nativeElement);
  }
}
