import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { UiGlass } from '../glass/glass';
import {
  type GlassDesign,
  injectGlassDesign,
  injectSystemDrawsGlass,
} from '../glass/glass-design';
import { injectIconColor } from '../icon/icon-theme';
import { type IconName, ICONS } from '../icon/icons';
import { edgeFadeOverlay, platformOf, UiBarState } from './bar-scroll';

/**
 * The toolbar's height above the home indicator, in px, in each design:
 * iOS 26's floating 44pt glass with 8pt under it, the 44pt toolbar of iOS 15
 * to 25, and Material 3 Expressive's 64dp docked toolbar.
 */
const TOOLBAR_HEIGHT: Readonly<Record<GlassDesign, number>> = {
  glass: 52,
  frosted: 44,
  material: 64,
};

/**
 * An icon's markup, drawn in `color`.
 */
const iconSvg = (icon: IconName, color: string): string =>
  // split/join, not replaceAll(), which PrimJS's ES2019 runtime lacks.
  ICONS[icon].split('currentColor').join(color);

/** AngularLynx's element, as far as the item sets its traits. */
type AccessibleElement = {
  setAccessibilityTrait(trait: string, on: boolean): void;
};

/**
 * Items that belong together, sharing one background: on iOS 26 and later,
 * one Liquid Glass capsule with the items in it, as iOS groups a toolbar's
 * related items. Put it in a `<ui-navigation-bar>` or a `<ui-toolbar>`:
 *
 * ```html
 * <ui-toolbar-group>
 *   <ui-toolbar-item icon="share-2" label="Share" (pressed)="share()" />
 *   <ui-toolbar-item icon="heart" label="Favorite" (pressed)="favorite()" />
 * </ui-toolbar-group>
 * ```
 *
 * The group is one glass shape with plain items in it, rather than a shape
 * per item merged in a glass group: merged circles join with pinched waists,
 * where iOS's grouped items sit on a straight-edged capsule, and glass isn't
 * layered on glass. Before iOS 26 the items are plain bar buttons in the
 * tint color, and on Android Material's icon buttons, so the group only
 * keeps them together.
 *
 * Keep items with a label apart from items with an icon, in groups of their
 * own: side by side, they read as one button.
 */
@Component({
  selector: 'ui-toolbar-group',
  imports: [LYNX_ELEMENTS, NgTemplateOutlet, UiGlass],
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'hostClass()' },
  template: `
    @if (design() === 'glass') {
      <blur-view
        ui-glass
        class="h-[44px] flex-row items-center flex"
        [interactive]="interactive()"
      >
        <ng-container [ngTemplateOutlet]="items" />
      </blur-view>
    } @else {
      <ng-container [ngTemplateOutlet]="items" />
    }

    <!-- One copy of the items, for whichever form the group takes: Angular
         projects content once. -->
    <ng-template #items><ng-content /></ng-template>
  `,
})
export class UiToolbarGroup {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #systemDrawsGlass = injectSystemDrawsGlass();

  /** The design on this platform (see GlassDesign), which the items follow. */
  readonly design = injectGlassDesign();

  /**
   * The glass swells under a finger, as a group of bar items does on iOS 26.
   * Where the runtime draws it (the web preview), that's motion Reduce Motion
   * asks to leave out; iOS tones its own glass down under the setting.
   */
  protected readonly interactive = computed(
    () => this.#systemDrawsGlass || !this.#settings.reduceMotion(),
  );

  protected readonly hostClass = computed(() =>
    // It keeps its items' width: a bar shortens its title, not its controls.
    cn('shrink-0 flex-row items-center flex', this.userClass()),
  );
}

/**
 * A button in a navigation bar or a toolbar: an icon, or a short label for an
 * action no symbol shows well, such as Edit.
 *
 * ```html
 * <ui-toolbar-item icon="plus" label="New note" (pressed)="add()" />
 * <ui-toolbar-item label="Done" prominent (pressed)="save()" />
 * ```
 *
 * In a `<ui-toolbar-group>` it's a plain item on the group's glass. On its
 * own it draws its own: a glass circle for an icon and a capsule for a label.
 *
 * - `prominent` is the screen's key action, such as Done: tinted glass on iOS
 *   26 and later, a bold label before, and a filled button on Android. Give
 *   it its own place, at the trailing end, rather than a group.
 * - `back` draws the platform's Back button: a chevron, and before iOS 26
 *   the `label` beside it, the previous screen's title. The navigation bar
 *   shows one by itself (see UiNavigationBar); use this for your own.
 *
 * The `label` is also what a screen reader says, so an icon-only item needs
 * one too.
 */
@Component({
  selector: 'ui-toolbar-item',
  imports: [LYNX_ELEMENTS, NgTemplateOutlet, UiGlass],
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'flex-row items-center flex shrink-0',
    // The host is the button: one accessibility element named by its label,
    // and the tap target, whose touches start on the glass inside it. The
    // label is an attribute binding: a property binding on a component's
    // host is checked against the DOM schema, which has no
    // `accessibility-label`.
    'accessibility-element': 'true',
    'accessibility-traits': 'button',
    '[attr.accessibility-label]': 'label()',
    // Press feedback binds touch and mouse events: native fires only touch,
    // and the web preview, in a browser, only mouse. A canceled touch (a
    // scroll taking over) and a cursor leaving release too.
    '(bindtouchstart)': 'press(true)',
    '(bindmousedown)': 'press(true)',
    '(bindtouchend)': 'press(false)',
    '(bindtouchcancel)': 'press(false)',
    '(bindmouseup)': 'press(false)',
    '(bindmouseleave)': 'press(false)',
    '(bindtap)': 'tap()',
  },
  // On its own on glass, the item is a glass shape, with its content inside
  // the glass, where iOS's interactive glass reacts to touches on it. The
  // content is what dims when disabled: glass under a faded parent turns
  // into a washed-out patch on iOS.
  template: `
    @if (ownGlass()) {
      <blur-view
        ui-glass
        [shape]="iconOnly() ? 'circle' : 'capsule'"
        [tint]="prominent() ? 'var(--glass-tint)' : undefined"
        [interactive]="interactive()"
        class="h-[44px] flex-row items-center flex"
      >
        <view [class]="buttonClass()">
          <ng-container [ngTemplateOutlet]="content" />
        </view>
      </blur-view>
    } @else {
      <view [class]="buttonClass()">
        <ng-container [ngTemplateOutlet]="content" />
      </view>
    }

    <!-- One copy of the content, for whichever form the item takes. -->
    <ng-template #content>
      @if (highlightClass(); as highlight) {
        <view [class]="highlight"></view>
      }
      @if (iconMarkup(); as markup) {
        <svg [attr.content]="markup" [style]="iconStyle()" />
      }
      @if (labelShown()) {
        <text [class]="labelClass()">{{ label() }}</text>
      }
    </ng-template>
  `,
})
export class UiToolbarItem {
  /** What the item does, shown without an icon and read by screen readers. */
  readonly label = input.required<string>();
  /** The [Icon](/dolan/icon) the item shows instead of its label. */
  readonly icon = input<IconName | undefined>(undefined);
  /** The screen's key action, such as Done: tinted, on its own. */
  readonly prominent = input(false, { transform: booleanAttribute });
  /** The platform's Back button, with `label` as the previous screen's title. */
  readonly back = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  /** Emits on a tap, unless the item is disabled. */
  readonly pressed = output<void>();

  readonly #group = inject(UiToolbarGroup, { optional: true });
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #systemDrawsGlass = injectSystemDrawsGlass();
  readonly #platform = platformOf(inject(Injector));
  readonly #resolveColor = injectIconColor();

  readonly #host = inject<ElementRef<AccessibleElement>>(ElementRef);

  /** The design on this platform (see GlassDesign). */
  readonly design = injectGlassDesign();

  /** A finger (or the mouse) is down on the item. */
  protected readonly pressing = signal(false);

  readonly #glass = computed(() => this.design() === 'glass');
  readonly #material = computed(() => this.design() === 'material');

  /** On glass, an item on its own is a glass shape of its own. */
  protected readonly ownGlass = computed(() => this.#glass() && !this.#group);

  /**
   * The icon the item shows: a Back button's chevron (Material's arrow), or
   * the item's own.
   */
  readonly #icon = computed<IconName | undefined>(() => {
    if (!this.back()) return this.icon();
    return this.#material() ? 'arrow-left' : 'chevron-left';
  });

  /**
   * An item shows its icon alone, except a Back button before iOS 26, which
   * shows the previous screen's title beside its chevron.
   */
  protected readonly iconOnly = computed(
    () => !!this.#icon() && !(this.back() && this.design() === 'frosted'),
  );

  protected readonly labelShown = computed(
    () => !this.#icon() || !this.iconOnly(),
  );

  /** A prominent item stands on its own: in a group, it's a plain one. */
  readonly #prominent = computed(() => this.prominent() && !this.#group);

  /**
   * As UiToolbarGroup's: the glass reacts to touch, unless Reduce Motion is
   * on where the runtime draws it.
   */
  protected readonly interactive = computed(
    () =>
      !this.disabled() &&
      (this.#systemDrawsGlass || !this.#settings.reduceMotion()),
  );

  /**
   * The color of the item's icon, as a theme token (labelClass colors the
   * label). Glass items take the glass's foreground, and a prominent one its
   * tint's. Before iOS 26 bar buttons were the app's tint color. Material's
   * top app bar draws its navigation icon in the surface's foreground, and
   * its actions in the quieter variant; a prominent action is filled.
   */
  readonly #iconColor = computed(() => {
    const prominent = this.#prominent();
    switch (this.design()) {
      case 'glass':
        return prominent
          ? 'var(--glass-tint-foreground)'
          : 'var(--glass-foreground)';
      case 'material':
        if (prominent) return 'var(--primary-foreground)';
        return this.back() ? 'var(--foreground)' : 'var(--muted-foreground)';
      default:
        return 'var(--primary)';
    }
  });

  // The icon is drawn here, as the dock draws its own, rather than by a
  // nested <ui-icon>: an SVG can't read a text class, so the token is
  // resolved to its value and written into the markup (see icon-theme.ts).
  protected readonly iconMarkup = computed(() => {
    const icon = this.#icon();
    return icon ? iconSvg(icon, this.#resolveColor(this.#iconColor())) : null;
  });

  protected readonly iconStyle = computed(() => {
    const size = this.design() === 'glass' ? 22 : 24;
    return { width: `${size}px`, height: `${size}px` };
  });

  protected readonly buttonClass = computed(() => {
    const iconOnly = this.iconOnly();
    const prominent = this.#prominent();
    let size: string;
    switch (this.design()) {
      case 'glass':
        size = cn('h-[44px]', iconOnly ? 'w-[44px]' : 'px-[16px]');
        break;
      case 'material':
        // A 48dp target for an icon, filled in a 40dp circle when it's
        // prominent; a labeled action is a 40dp text or filled button.
        if (iconOnly) {
          size = prominent
            ? 'h-[40px] w-[40px] m-[4px] rounded-full bg-primary overflow-hidden'
            : 'h-[48px] w-[48px]';
        } else {
          // 4dp in from its 48dp target, as Material insets its buttons.
          size = cn(
            'mx-[4px] h-[40px] rounded-full px-[12px] overflow-hidden',
            prominent && 'bg-primary px-[16px]',
          );
        }
        break;
      default:
        // A 44pt target. The Back button's chevron sits close to its title.
        size = cn(
          'h-[44px]',
          iconOnly ? 'min-w-[44px] px-[8px]' : 'gap-[4px] pl-[4px] pr-[8px]',
        );
    }
    return cn(
      'flex-row items-center flex relative justify-center',
      size,
      // Before iOS 26 a pressed bar button fades, rather than moving.
      this.pressing() && this.design() === 'frosted' && 'opacity-30',
      this.disabled() && 'opacity-50',
    );
  });

  /**
   * The press's highlight: Material's state layer, and on glass a shade
   * under the finger where the glass doesn't react by itself (Android's
   * glass, or the web's under Reduce Motion). It comes and goes with the
   * finger, with no motion.
   */
  protected readonly highlightClass = computed(() => {
    if (!this.pressing() || this.design() === 'frosted') return null;
    if (this.#material()) {
      // An icon button's layer is a 40dp circle in its 48dp target; a
      // filled or text button's fills it.
      const prominent = this.#prominent();
      return cn(
        'opacity-10 absolute',
        this.iconOnly() && !prominent
          ? 'h-[40px] w-[40px] rounded-full bg-foreground left-[4px] top-[4px]'
          : 'h-full w-full left-0 top-0',
        prominent ? 'bg-primary-foreground' : !this.iconOnly() && 'bg-primary',
      );
    }
    // The glass swells under the finger by itself: an item's own, or the
    // group's capsule around a grouped item, as iOS 26's does. Except on
    // Android, whose glass doesn't react, and where Reduce Motion stills it.
    const glassReacts = this.interactive() && this.#platform !== 'Android';
    return glassReacts
      ? null
      : 'h-full w-full rounded-full bg-glass-foreground opacity-15 absolute left-0 top-0';
  });

  protected readonly labelClass = computed(() => {
    const prominent = this.#prominent();
    switch (this.design()) {
      case 'glass':
        return cn(
          'text-[17px] font-medium leading-[22px]',
          prominent ? 'text-glass-tint-foreground' : 'text-glass-foreground',
        );
      case 'material':
        return cn(
          'text-[14px] font-medium leading-[20px]',
          prominent ? 'text-primary-foreground' : 'text-primary',
        );
      default:
        return cn(
          'text-[17px] leading-[22px] text-primary',
          prominent && 'font-semibold',
        );
    }
  });

  // Screen readers say a disabled item is dimmed. A trait of its own, merged
  // into `button` by the element (see LynxElement.setAccessibilityTrait).
  protected readonly disabledTrait = effect(() => {
    this.#host.nativeElement.setAccessibilityTrait('disabled', this.disabled());
  });

  protected press(down: boolean): void {
    this.pressing.set(down && !this.disabled());
  }

  protected tap(): void {
    if (!this.disabled()) this.pressed.emit();
  }
}

/**
 * Flexible space between a toolbar's items, which pushes what follows it to
 * the end, as SwiftUI's `ToolbarSpacer(.flexible)` does:
 *
 * ```html
 * <ui-toolbar>
 *   <ui-toolbar-item icon="filter" label="Filter" />
 *   <ui-toolbar-spacer />
 *   <ui-toolbar-item icon="pencil" label="Compose" />
 * </ui-toolbar>
 * ```
 */
@Component({
  selector: 'ui-toolbar-spacer',
  encapsulation: ViewEncapsulation.None,
  // The host is the space: a component's host is a plain view on Lynx.
  host: { class: 'flex-1' },
  template: '',
})
export class UiToolbarSpacer {}

/**
 * A bar of actions along the bottom of the screen, over the content, which
 * scrolls beneath it: iOS's toolbar, and Material 3 Expressive's docked
 * toolbar. Put items, groups and spacers in it:
 *
 * ```html
 * <ui-toolbar>
 *   <ui-toolbar-item icon="list-checks" label="Checklist" />
 *   <ui-toolbar-item icon="camera" label="Camera" />
 *   <ui-toolbar-item icon="pencil" label="New note" />
 * </ui-toolbar>
 * ```
 *
 * Items spread across it, or sit at either end around a
 * `<ui-toolbar-spacer>`. Put `ui-bar-scroll` on the screen's scroll view and
 * its content ends above the toolbar.
 *
 * Its form follows the platform (see GlassDesign):
 *
 * - `'glass'`: no bar at all. The items float in glass above the home
 *   indicator, and content fades out as it passes beneath them.
 * - `'frosted'`: the toolbar of iOS 15 to 25, edge to edge, on the bars'
 *   chrome material with a hairline on top while content continues beneath
 *   it, and clear once it's scrolled to the end.
 * - `'material'`: a docked toolbar on the surface container color.
 */
@Component({
  selector: 'ui-toolbar',
  imports: [LYNX_ELEMENTS, UiGlass],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[style.background-image]': 'edgeFade()',
  },
  template: `
    @if (frostedBackground()) {
      <blur-view
        ui-glass
        shape="rounded"
        [radius]="0"
        material="chrome"
        class="absolute bottom-0 left-0 right-0 top-0"
      ></blur-view>
      <view class="h-[0.5px] bg-border absolute left-0 right-0 top-0"></view>
    }
    <view [class]="rowClass()"><ng-content /></view>
  `,
})
export class UiToolbar {
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #state = inject(UiBarState);
  readonly #platform = platformOf(inject(Injector));

  /** The design on this platform (see GlassDesign), which the items follow. */
  readonly design = injectGlassDesign();

  /** The toolbar's height above the home indicator, for the scroll view. */
  readonly height = computed(() => TOOLBAR_HEIGHT[this.design()]);

  protected readonly attachment = this.#state.attach(
    this.#state.bottomBar,
    this,
    inject(DestroyRef),
  );

  /**
   * The frosted toolbar's material shows while content continues beneath
   * it, as iOS 15 to 25 draw it, and goes once it's scrolled to the end.
   */
  protected readonly frostedBackground = computed(
    () => this.design() === 'frosted' && this.#state.scrolledUnderBottom(),
  );

  /**
   * On Android, glass bars fade the content beneath them themselves, since
   * its scroll view takes no mask (see edgeFadeOverlay).
   */
  protected readonly edgeFade = computed(() =>
    this.design() === 'glass' && this.#platform === 'Android'
      ? edgeFadeOverlay('top')
      : null,
  );

  protected readonly hostClass = computed(() => {
    const design = this.design();
    return cn(
      'flex-col flex absolute bottom-0 left-0 right-0',
      design === 'glass' ? 'px-[16px] pb-safe-[8px]' : 'pb-safe',
      design === 'material' && 'bg-secondary',
      this.userClass(),
    );
  });

  protected readonly rowClass = computed(() =>
    cn(
      'flex-row items-center flex relative justify-between',
      this.design() === 'material' ? 'h-[64px] px-[16px]' : 'h-[44px]',
      this.design() === 'frosted' ? 'px-[8px]' : 'gap-[8px]',
    ),
  );
}
