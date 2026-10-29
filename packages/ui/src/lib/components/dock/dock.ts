import {
  Component,
  Directive,
  ElementRef,
  Injector,
  Renderer2,
  ViewEncapsulation,
  computed,
  contentChild,
  contentChildren,
  effect,
  forwardRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxRouterLinkActive,
} from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  fadeIn,
  pressDown,
  pressRelease,
} from '../../utils/animate';
import { cn } from '../../utils/cn';
import { type GlassShape, UiGlass, UiGlassGroup } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import { injectIconColor, UI_ICON_COLOR } from '../icon/icon-theme';
import { type IconName, ICONS } from '../icon/icons';
import {
  KEYBOARD_GAP,
  keyboardLift,
  keyboardScreen,
  measureForKeyboard,
} from '../search-field/keyboard';
import {
  type SearchFieldContainer,
  UI_SEARCH_FIELD_CONTAINER,
  UiSearchField,
} from '../search-field/search-field';
import { UiDockState } from './dock-scroll';

/** The dock's sizes and shapes in one design. Sizes are in px. */
type DockLook = {
  /** The bar's height. */
  readonly bar: number;
  /** The action button's width and height. */
  readonly action: number;
  /** The accessory's height. */
  readonly accessory: number;
  /** Between the bar and the action, and between the accessory and the bar. */
  readonly gap: number;
  /** The bar's padding around its items. */
  readonly inset: number;
  readonly barShape: GlassShape;
  readonly actionShape: GlassShape;
  readonly accessoryShape: GlassShape;
  /** The corner radius of the shapes that are `'rounded'`. */
  readonly radius: number;
};

/**
 * iOS 26's floating tab bar: a 62pt capsule, a search button as tall as it
 * beside it, and a 48pt accessory capsule above.
 */
const GLASS_LOOK: DockLook = {
  bar: 62,
  action: 62,
  accessory: 48,
  gap: 10,
  inset: 4,
  barShape: 'capsule',
  actionShape: 'circle',
  accessoryShape: 'capsule',
  radius: 0,
};

/**
 * Material 3 Expressive's floating toolbar (64dp, fully rounded) with a
 * floating action button beside it (56dp, 16dp corners).
 */
const MATERIAL_LOOK: DockLook = {
  bar: 64,
  action: 56,
  accessory: 56,
  gap: 12,
  inset: 4,
  barShape: 'capsule',
  actionShape: 'rounded',
  accessoryShape: 'rounded',
  radius: 16,
};

/**
 * iOS's tab bar before Liquid Glass: 49pt over the home indicator, edge to
 * edge, with the action as its last button, and the accessory floating above
 * it with rounded corners.
 */
const FROSTED_LOOK: DockLook = {
  bar: 49,
  action: 64,
  accessory: 48,
  gap: 8,
  inset: 0,
  barShape: 'rounded',
  actionShape: 'rounded',
  accessoryShape: 'rounded',
  radius: 0,
};

const LOOKS: Readonly<Record<GlassDesign, DockLook>> = {
  glass: GLASS_LOOK,
  material: MATERIAL_LOOK,
  frosted: FROSTED_LOOK,
};

/** The frosted accessory's corner radius and inset from the screen edges. */
const FROSTED_ACCESSORY_RADIUS = 12;
const FROSTED_ACCESSORY_INSET = 8;

/**
 * The glass bar and action minimized: circles a little smaller than the bar,
 * as iOS shrinks its tab bar to the selected tab's icon.
 */
const MINIMIZED_SIZE = 48;

/**
 * How far Material's toolbar slides down when the dock minimizes, beyond its
 * own height: past the dock's margin and the home indicator.
 */
const MATERIAL_HIDDEN_OFFSET = 64;

/**
 * The search field's heights in the dock, in px: iOS 26's, as tall as the
 * minimized bar beside it; Material 3's search bar; and the bar before
 * iOS 26 that holds UISearchBar's 36pt field, 8pt in from its edges.
 */
const GLASS_SEARCH_SIZE = MINIMIZED_SIZE;
const MATERIAL_SEARCH_HEIGHT = 56;
const FROSTED_SEARCH_HEIGHT = 52;

/**
 * Glass shapes this close merge, in px: just under the gap between them, so
 * the bar and the action stay apart at rest, and reach for each other as the
 * accessory moves between them.
 */
const GLASS_SPACING = 8;

/**
 * How the shapes move as the dock minimizes and expands, on the curve iOS's
 * sheets use: quick, then settling gently.
 */
const FRAME_TRANSITION = [
  'left',
  'right',
  'bottom',
  'width',
  'height',
  'transform',
]
  .map((property) => `${property} ${DURATION.slow + 50}ms ${EASING.sheet}`)
  .join(', ');

/**
 * How the dock follows the keyboard up and back down. The keyboard's height
 * arrives a little after it starts to move, so it's quicker than the frames.
 */
const KEYBOARD_TRANSITION = `padding-bottom ${DURATION.normal}ms ${EASING.sheet}`;

/** The action's icon, fading as the action shrinks into the search field. */
const ICON_OUT_TRANSITION = `opacity ${DURATION.fast}ms ${EASING.accelerate}`;

/** The search field's content, fading in as its glass grows. */
const SEARCH_IN_TRANSITION = `opacity ${DURATION.normal}ms ${EASING.decelerate} ${DURATION.fast}ms`;

/** The selection capsule's slide, with a slight overshoot, and its fade. */
const CAPSULE_TRANSITION = `transform ${DURATION.slow}ms ${EASING.springSubtle}, opacity ${DURATION.normal}ms ${EASING.standard}`;

/**
 * The items fade out quickly as the bar shrinks, and back in once it has
 * mostly grown, so they don't squeeze into the narrow bar.
 */
const ROW_OUT_TRANSITION = `opacity ${DURATION.fast}ms ${EASING.accelerate}`;
const ROW_IN_TRANSITION = `opacity ${DURATION.normal}ms ${EASING.decelerate} ${DURATION.fast}ms`;

/** How strongly the selection capsule shades the glass. */
const CAPSULE_OPACITY = 0.1;

/**
 * The color of icons in the accessory: the glass's foreground, as its text
 * reads `text-glass-foreground`. The accessory's content is the app's, which
 * the dock's glass doesn't provide for, since content injects from where it's
 * written, inside `<ui-dock>`, not from where it's projected.
 */
const ACCESSORY_ICON_COLOR = signal('var(--glass-foreground)').asReadonly();

/** What Lynx's `layoutchange` event carries, as far as the dock reads it. */
type LayoutChangeEvent = Event & { detail: { width: number } };

/**
 * A CSS length in px.
 */
const px = (value: number): string => `${value}px`;

/**
 * `value` px above the home indicator. The frosted bar runs to the screen's
 * bottom edge and pads itself by the inset (`pb-safe`), so what sits above
 * it counts the inset too.
 */
const abovePx = (value: number): string =>
  `calc(${value}px + env(safe-area-inset-bottom))`;

/**
 * An icon's markup, drawn in `color`.
 */
const iconSvg = (icon: IconName, color: string): string =>
  // split/join, not replaceAll(), which PrimJS's ES2019 runtime lacks.
  ICONS[icon].split('currentColor').join(color);

/**
 * `UiDockItem`, `UiDockAction` and `UiDockAccessory`, for the dock's content
 * queries. Calls rather than the classes themselves: for a class, Angular's
 * test build keeps an arrow function that nothing calls, which an app's
 * coverage report would show as uncovered.
 */
const itemType = () => UiDockItem;
const actionType = () => UiDockAction;
const accessoryType = () => UiDockAccessory;
const searchFieldType = () => UiSearchField;
/**
 * UiDock, for its own providers, which run before the class is defined.
 */
const dockType = () => UiDock;

/**
 * Marks the content of the dock's accessory: a bar above the dock for
 * something that stays at hand on every screen, such as what's playing. The
 * dock draws the glass around it.
 *
 * ```html
 * <ui-dock>
 *   <view ui-dock-accessory class="flex-row items-center gap-3 px-4">
 *     <text class="text-glass-foreground">Now playing</text>
 *   </view>
 *   …
 * </ui-dock>
 * ```
 *
 * When the glass dock minimizes, the accessory moves down into the row,
 * between the bar and the action, at the minimized bar's height: read the
 * dock's `minimized()` to show less there.
 */
@Directive({
  selector: '[ui-dock-accessory]',
  // It fills the accessory's glass.
  host: { class: 'flex-1' },
})
export class UiDockAccessory {}

/**
 * The bar of an app's top-level screens, floating over the content at the
 * bottom of the screen: the Liquid Glass form of the tab bar. Put a
 * `<ui-dock-item>` in it for each screen, and optionally a `<ui-dock-action>`
 * (a separate button, such as search or compose) and a `ui-dock-accessory`
 * (such as what's playing).
 *
 * ```html
 * <view class="h-full">
 *   <router-outlet />
 *   <ui-dock>
 *     <ui-dock-item route="/home" icon="home" label="Home" />
 *     <ui-dock-item route="/library" icon="music" label="Library" />
 *     <ui-dock-action route="/search" icon="search" label="Search" />
 *   </ui-dock>
 * </view>
 * ```
 *
 * It places itself at the bottom of its parent, over the content, which
 * scrolls beneath it. Its form follows the platform (see GlassDesign):
 *
 * - `'glass'` (iOS 26 and later, the web, Android with the glass opt-in): a
 *   floating capsule whose selected item is marked by a capsule that slides
 *   between the items. The action is a circle beside it, in the same glass
 *   group, and the accessory a capsule above. It minimizes as content
 *   scrolls down (see UiDockScroll): the bar shrinks to the selected item's
 *   icon, and the accessory moves down between it and the action.
 * - `'frosted'` (iOS 15 to 25): the tab bar of that time, edge to edge on
 *   the bars' chrome material, with the action as its last button. It
 *   doesn't minimize.
 * - `'material'` (Android): a Material 3 Expressive floating toolbar, with an
 *   active indicator behind the selected item's icon, and the action as a
 *   floating action button. Minimizing slides the toolbar away and leaves
 *   the button.
 *
 * With a `<ui-search-field>` in it as well, the action opens a search field
 * at the bottom of the screen, as iOS 26 searches on iPhone:
 *
 * ```html
 * <ui-dock>
 *   <ui-dock-item route="/home" icon="home" label="Home" />
 *   <ui-dock-action route="/search" icon="search" label="Search" />
 *   <ui-search-field [(value)]="query" (submitted)="search($event)" />
 * </ui-dock>
 * ```
 *
 * With a `route`, it's the search tab: the field is open while the route is
 * active. Without one, pressing the action opens it and focuses it, and
 * UiDockState's `searching` says whether it's open. On glass, the action
 * grows into the field across the bottom while the bar shrinks to a button
 * that goes back to the last item. On Material, the action grows into a
 * search bar and the toolbar slides away; the field's back arrow returns.
 * Before iOS 26, the field opens in a bar above the tab bar. The field rises
 * with the dock above the keyboard.
 */
@Component({
  selector: 'ui-dock',
  imports: [LYNX_ELEMENTS, UiGlass, UiGlassGroup],
  encapsulation: ViewEncapsulation.None,
  providers: [
    { provide: UI_ICON_COLOR, useValue: ACCESSORY_ICON_COLOR },
    // The search field in the dock draws only its content, in the dock's
    // glass, and tells the dock when it's canceled.
    { provide: UI_SEARCH_FIELD_CONTAINER, useExisting: forwardRef(dockType) },
  ],
  host: {
    '[class]': 'hostClass()',
    // Above the keyboard while the search field has it.
    '[style.padding-bottom]': 'keyboardPadding()',
    '[style.transition]': 'keyboardTransition()',
  },
  // The shapes are direct children of the glass group, so they merge on iOS
  // and the web. Each one keeps its element as the dock minimizes and
  // expands: its frame moves and resizes with a CSS transition, which iOS's
  // glass follows frame by frame, where a shape added or removed would pop.
  //
  // `tabbar` is UIKit's tab bar trait, the one a native tab bar's container
  // has: it tells VoiceOver that the buttons in it are tabs. Android reads a
  // single trait and has none for tab bars, so there it's a plain row.
  //
  // The dock measures its width with an empty view rather than on the
  // group: Lynx for Web sends no layoutchange for a blur-view.

  template: `
    <view class="h-0 w-full" (bindlayoutchange)="measure($event)"></view>
    <blur-view
      ui-glass-group
      class="relative"
      [spacing]="spacing"
      [style]="stageStyle()"
    >
      @if (accessory()) {
        <blur-view
          ui-glass
          interactive
          material="chrome"
          class="flex-row flex absolute overflow-hidden"
          [shape]="look().accessoryShape"
          [radius]="accessoryRadius()"
          [style]="frames().accessory"
        >
          <ng-content select="[ui-dock-accessory]" />
        </blur-view>
      }
      <blur-view
        ui-glass
        interactive
        material="chrome"
        [class]="barClass()"
        [shape]="look().barShape"
        [radius]="look().radius"
        [style]="frames().bar"
      >
        @if (design() === 'frosted') {
          <view
            class="h-[0.5px] bg-border absolute left-0 right-0 top-0"
          ></view>
        }
        <view
          accessibility-traits="tabbar"
          [class]="rowClass()"
          [style]="rowStyle()"
          [attr.accessibility-elements-hidden]="rowHidden() || null"
        >
          <view
            class="rounded-full bg-glass-foreground absolute bottom-0 left-0 top-0"
            [style]="capsuleStyle()"
          ></view>
          <ng-content />
        </view>
        @if (barCollapsed()) {
          <!-- Minimized, the bar is one button that brings the dock back,
               showing the selected item's icon. While the glass dock
               searches, it's the button that goes back to the last item. -->
          <view
            #restore
            class="items-center flex absolute bottom-0 left-0 right-0 top-0 justify-center"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="expandLabel()"
            [attr.accessibility-value]="restoreItem()?.label()"
            (bindtap)="onRestore()"
          >
            <svg
              [attr.content]="minimizedIcon()"
              style="width: 24px; height: 24px;"
            />
          </view>
        }
      </blur-view>
      @if (action()) {
        <blur-view
          ui-glass
          interactive
          material="chrome"
          [class]="actionClass()"
          [shape]="look().actionShape"
          [radius]="look().radius"
          [tint]="actionTint()"
          [style]="frames().action"
          [attr.accessibility-elements-hidden]="actionHidden() || null"
        >
          @if (design() === 'frosted') {
            <view
              class="h-[0.5px] bg-border absolute left-0 right-0 top-0"
            ></view>
          }
          <ng-content select="ui-dock-action" />
        </blur-view>
        @if (searchField(); as field) {
          <!-- The search field's own shape, after the action so it draws
               over it: it grows out of the action as the search opens, and
               shrinks back into it as it closes. -->
          <blur-view
            ui-glass
            interactive
            material="chrome"
            class="flex-row flex absolute overflow-hidden"
            [shape]="searchShape()"
            [radius]="0"
            [style]="frames().search"
          >
            @if (design() === 'frosted') {
              <view
                class="h-[0.5px] bg-border absolute left-0 right-0 top-0"
              ></view>
            }
            <view
              [class]="searchContentClass()"
              [style]="searchContentStyle()"
              [attr.accessibility-elements-hidden]="!searching() || null"
            >
              <ng-content select="ui-search-field" />
            </view>
          </blur-view>
          @if (design() === 'glass' && field.cancelable()) {
            <!-- iOS 26's cancel beside the field: a glass circle that grows
                 out of the field's end while it's in use. -->
            <blur-view
              ui-glass
              interactive
              shape="circle"
              class="items-center flex absolute justify-center overflow-hidden"
              accessibility-element="true"
              accessibility-traits="button"
              [attr.accessibility-label]="field.cancelLabel()"
              [attr.accessibility-elements-hidden]="!cancelShown() || null"
              [style]="frames().cancel"
              (bindtap)="field.cancel()"
            >
              <svg [attr.content]="cancelIcon()" [style]="cancelIconStyle()" />
            </blur-view>
          }
        }
      }
    </blur-view>
  `,
})
export class UiDock implements SearchFieldContainer {
  /**
   * What a screen reader says for the minimized dock, a button that brings
   * it back. The selected item's label follows it.
   */
  readonly expandLabel = input('Show tab bar');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #state = inject(UiDockState);
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #resolveColor = injectIconColor();
  readonly #injector = inject(Injector);
  readonly #renderer = inject(Renderer2);
  readonly #host = inject(ElementRef);

  /** The design on this platform (see GlassDesign), which the items follow. */
  readonly design = injectGlassDesign();

  protected readonly look = computed(() => LOOKS[this.design()]);
  protected readonly spacing = GLASS_SPACING;

  protected readonly items = contentChildren(itemType());
  protected readonly action = contentChild(actionType());
  protected readonly accessory = contentChild(accessoryType());
  protected readonly searchField = contentChild(searchFieldType());
  protected readonly restoreButton = viewChild<ElementRef>('restore');

  /**
   * The dock's width, from Lynx's layout. The glass bar shrinks from it when
   * the dock minimizes.
   */
  protected readonly width = signal(0);

  /** The item whose route is active, if any. */
  readonly selectedItem = computed(() =>
    this.items().find((item) => item.active()),
  );

  /**
   * The item selected last, which stays while the search's route is active
   * and no item is: the glass bar's button goes back to it. Kept by an
   * effect rather than a linkedSignal, which would only see the items
   * selected while something read it.
   */
  readonly #lastItem = signal<UiDockItem | undefined>(undefined);
  protected readonly rememberItem = effect(() => {
    const item = this.selectedItem();
    if (item) this.#lastItem.set(item);
  });

  /**
   * Whether the search field is open: with a search field and an action in
   * the dock, while the action's route is active, or while UiDockState says
   * so for an action without one.
   */
  readonly searching = computed(() => {
    const action = this.action();
    return (
      !!this.searchField() &&
      !!action &&
      (action.active() || this.#state.searching())
    );
  });

  /**
   * Whether the dock is minimized now: as UiDockState says, in the designs
   * that minimize, once the dock knows the width it shrinks from, and not
   * while it searches.
   */
  readonly minimized = computed(
    () =>
      this.#state.minimized() &&
      this.design() !== 'frosted' &&
      this.width() > 0 &&
      !this.searching(),
  );

  /** The glass dock searching: its bar shrinks to a button beside the field. */
  readonly #glassSearch = computed(
    () => this.searching() && this.design() === 'glass' && this.width() > 0,
  );

  /** Whether the bar is one button: minimized, or beside the glass search. */
  protected readonly barCollapsed = computed(
    () => this.minimized() || this.#glassSearch(),
  );

  /**
   * Whether the bar's items are out of sight: in a collapsed bar, or in
   * Material's toolbar while it's slid away for the search bar.
   */
  protected readonly rowHidden = computed(
    () =>
      this.barCollapsed() || (this.searching() && this.design() === 'material'),
  );

  /**
   * The glass and Material action is the field's while it searches: it
   * shrinks into the field's end, and its icon fades out on the way.
   */
  readonly actionHidden = computed(
    () => this.searching() && this.design() !== 'frosted',
  );

  /** The item the collapsed bar shows, and goes back to while searching. */
  protected readonly restoreItem = computed(() =>
    this.#glassSearch() ? this.#lastItem() : this.selectedItem(),
  );

  /** Whether the field's Cancel shows, beside it on glass. */
  protected readonly cancelShown = computed(
    () => this.searching() && !!this.searchField()?.cancelShown(),
  );

  /** No sliding, shrinking or fading under Reduce Motion. */
  readonly #animate = computed(() => !this.#settings.reduceMotion());

  /**
   * How far up the keyboard reaches into the dock, from its bottom edge, in
   * px: 0 while it's down, or while the search field doesn't have it.
   */
  readonly #keyboardOverlap = signal(0);
  /** Each keyboard change's measuring, so a late answer can't win. */
  #measuring = 0;

  protected readonly hostClass = computed(() =>
    cn(
      'flex-col flex absolute bottom-0 left-0 right-0',
      this.design() !== 'frosted' && 'px-4 pb-safe-2',
      this.userClass(),
    ),
  );

  /**
   * While the search field has the keyboard, the dock floats above it: the
   * glass and Material shapes a little above it, as they float above the home
   * indicator, and the field's bar before iOS 26 on top of it, with the tab
   * bar under the keyboard, as Safari's bar did.
   */
  protected readonly keyboardPadding = computed(() => {
    const overlap = this.searching() ? this.#keyboardOverlap() : 0;
    if (overlap <= 0) return null;
    return this.design() === 'frosted'
      ? `calc(${overlap - this.look().bar}px - env(safe-area-inset-bottom))`
      : px(overlap + KEYBOARD_GAP);
  });

  protected readonly keyboardTransition = computed(() =>
    this.searchField() && this.#animate() ? KEYBOARD_TRANSITION : null,
  );

  protected readonly accessoryRadius = computed(() =>
    this.design() === 'frosted' ? FROSTED_ACCESSORY_RADIUS : this.look().radius,
  );

  /**
   * Each shape's frame in the dock, bottom up, and the dock's height. The
   * shapes are positioned absolutely, so a minimized dock can move each one
   * on its own: the accessory from above the bar into the row beside it.
   *
   * The search field's shape and its Cancel are there only with a search
   * field. Closed, they're points inside the action, which they grow out of
   * as the search opens.
   */
  protected readonly frames = computed(() => {
    const look = this.look();
    const design = this.design();
    const hasAction = !!this.action();
    const minimized = this.minimized();
    const searching = this.searching();
    const width = this.width();
    const transition = this.#animate() ? FRAME_TRANSITION : 'none';
    const actionSpace = hasAction ? look.action + look.gap : 0;
    /**
     * A point, a shape with no size, `right` and `bottom` px in.
     */
    const point = (right: number, bottom: number) => ({
      left: px(Math.max(0, width - right)),
      right: px(right),
      bottom: px(bottom),
      height: '0px',
      transition,
    });

    if (design === 'frosted') {
      const above = look.bar + look.gap;
      const strip = searching ? FROSTED_SEARCH_HEIGHT : 0;
      // Only with a search field, so the dock moves as it did without one.
      const searchTransition = this.searchField() ? transition : undefined;
      return {
        stage: {
          height: abovePx(
            this.accessory()
              ? above + strip + look.accessory
              : look.bar + strip,
          ),
          transition: searchTransition,
        },
        bar: {
          left: '0px',
          right: px(hasAction ? look.action : 0),
          bottom: '0px',
          height: abovePx(look.bar),
        },
        action: {
          right: '0px',
          bottom: '0px',
          width: px(look.action),
          height: abovePx(look.bar),
        },
        accessory: {
          left: px(FROSTED_ACCESSORY_INSET),
          right: px(FROSTED_ACCESSORY_INSET),
          bottom: abovePx(above + strip),
          height: px(look.accessory),
          transition: searchTransition,
        },
        // A bar on the tab bar's material, above it.
        search: {
          left: '0px',
          right: '0px',
          bottom: abovePx(look.bar),
          height: px(strip),
          transition,
        },
        cancel: point(0, 0),
      };
    }

    if (design === 'glass' && (minimized || this.#glassSearch())) {
      const size = MINIMIZED_SIZE;
      const besideAction = hasAction ? size + look.gap : 0;
      const cancel = this.cancelShown();
      const cancelSpace = cancel ? GLASS_SEARCH_SIZE + look.gap : 0;
      const accessoryHeight = this.accessory() ? look.gap + look.accessory : 0;
      return {
        stage: {
          height: px(searching ? size + accessoryHeight : size),
          transition,
        },
        bar: {
          left: '0px',
          right: px(width - size),
          bottom: '0px',
          height: px(size),
          transition,
        },
        // Searching, the action shrinks into the end of the field, which
        // grows out of it.
        action: searching
          ? {
              right: px(cancelSpace + size / 2),
              bottom: px(size / 2),
              width: '0px',
              height: '0px',
              transition,
            }
          : {
              right: '0px',
              bottom: '0px',
              width: px(size),
              height: px(size),
              transition,
            },
        // Minimized, the accessory moves down between the bar and the
        // action; searching, it stays above the field.
        accessory: searching
          ? {
              left: '0px',
              right: '0px',
              bottom: px(size + look.gap),
              height: px(look.accessory),
              transition,
            }
          : {
              left: px(size + look.gap),
              right: px(besideAction),
              bottom: '0px',
              height: px(size),
              transition,
            },
        search: searching
          ? {
              left: px(size + look.gap),
              right: px(cancelSpace),
              bottom: '0px',
              height: px(GLASS_SEARCH_SIZE),
              transition,
            }
          : point(size / 2, size / 2),
        cancel: cancel
          ? {
              left: px(width - GLASS_SEARCH_SIZE),
              right: '0px',
              bottom: '0px',
              height: px(GLASS_SEARCH_SIZE),
              transition,
            }
          : point(searching ? 0 : size / 2, size / 2),
      };
    }

    // Glass or Material, expanded; or Material minimized or searching, which
    // slides the toolbar and the accessory below the screen. Minimized, it
    // keeps the button; searching, the button grows into the search bar.
    const hidden = design === 'material' && (minimized || searching);
    const slide = (by: number) =>
      design === 'material' ? `translateY(${hidden ? by : 0}px)` : null;
    const withAccessory = this.accessory()
      ? look.bar + look.gap + look.accessory
      : look.bar;
    const actionCenter = point(look.action / 2, look.bar / 2);
    // Material's button is shorter than the toolbar, and centered on it.
    const actionBottom = (look.bar - look.action) / 2;
    return {
      stage: { height: px(withAccessory), transition },
      bar: {
        left: '0px',
        right: px(actionSpace),
        bottom: '0px',
        height: px(look.bar),
        transform: slide(look.bar + MATERIAL_HIDDEN_OFFSET),
        transition,
      },
      action:
        design === 'material' && searching
          ? {
              right: px(look.action / 2),
              bottom: px(look.bar / 2),
              width: '0px',
              height: '0px',
              transition,
            }
          : {
              right: '0px',
              bottom: px(actionBottom),
              width: px(look.action),
              height: px(look.action),
              transition,
            },
      accessory: {
        left: '0px',
        right: '0px',
        bottom: px(look.bar + look.gap),
        height: px(look.accessory),
        transform: slide(withAccessory + MATERIAL_HIDDEN_OFFSET),
        transition,
      },
      search:
        design === 'material' && searching
          ? {
              left: '0px',
              right: '0px',
              bottom: px((look.bar - MATERIAL_SEARCH_HEIGHT) / 2),
              height: px(MATERIAL_SEARCH_HEIGHT),
              transition,
            }
          : actionCenter,
      cancel: actionCenter,
    };
  });

  protected readonly stageStyle = computed(() => this.frames().stage);

  protected readonly barClass = computed(() =>
    cn(
      'flex-col flex absolute',
      this.design() === 'frosted' ? 'pb-safe' : 'overflow-hidden',
    ),
  );

  protected readonly actionClass = computed(() =>
    cn(
      'flex-col flex absolute overflow-hidden',
      this.design() === 'frosted' && 'pb-safe',
    ),
  );

  /** Material's floating action button is filled with the primary color. */
  protected readonly actionTint = computed(() =>
    this.design() === 'material' ? 'var(--primary)' : undefined,
  );

  /**
   * A capsule on glass and Material, as iOS 26's field and Material 3's
   * search bar are; before iOS 26, a bar from edge to edge.
   */
  protected readonly searchShape = computed(() =>
    this.design() === 'frosted' ? 'rounded' : 'capsule',
  );

  protected readonly searchContentClass = computed(() =>
    cn(
      'flex-1 flex-row items-center flex',
      this.design() === 'frosted' && 'px-[8px]',
    ),
  );

  /**
   * The field's content fades in once its shape has mostly grown, and out at
   * once as the search closes.
   */
  protected readonly searchContentStyle = computed(() => {
    const searching = this.searching();
    return {
      opacity: searching ? '1' : '0',
      transition: searching && this.#animate() ? SEARCH_IN_TRANSITION : 'none',
    };
  });

  protected readonly cancelIcon = computed(() =>
    iconSvg('x', this.#resolveColor('var(--glass-foreground)')),
  );

  protected readonly cancelIconStyle = computed(() => ({
    width: '20px',
    height: '20px',
    opacity: this.cancelShown() ? '1' : '0',
  }));

  protected readonly rowClass = computed(() =>
    cn(
      'flex-row flex relative',
      this.design() === 'frosted' ? 'h-[49px]' : 'flex-1',
    ),
  );

  /**
   * The row sits inside the bar's padding. Once the dock knows its width,
   * the floating bar's row keeps the expanded width, so the items don't
   * squeeze together as the bar shrinks and grows: the bar clips them
   * instead, and they fade out as it shrinks and back in as it grows.
   */
  protected readonly rowStyle = computed(() => {
    const look = this.look();
    const hidden = this.rowHidden();
    const action = this.action() ? look.action + look.gap : 0;
    const floating = this.design() !== 'frosted' && this.width() > 0;
    return {
      margin: px(look.inset),
      width: floating ? px(this.width() - action - 2 * look.inset) : null,
      opacity: hidden ? '0' : '1',
      transition: this.#animate()
        ? hidden
          ? ROW_OUT_TRANSITION
          : ROW_IN_TRANSITION
        : 'none',
    };
  });

  /**
   * The capsule behind the selected item, on glass: one element that slides
   * from item to item. It's a shade of the glass's foreground rather than
   * glass of its own, which would be glass on glass, and it's how iOS marks
   * the selected tab while nobody is touching the bar.
   *
   * The items share the row equally, so it's one item wide, and
   * `translateX(n * 100%)` moves it n items along, whatever the row's width.
   * It fades out while no item is selected, and in the other designs, which
   * mark the selection their own way.
   */
  protected readonly capsuleStyle = computed(() => {
    const count = Math.max(1, this.items().length);
    const selected = this.selectedItem();
    const index = selected ? this.items().indexOf(selected) : 0;
    const shown = !!selected && this.design() === 'glass';
    return {
      width: `${100 / count}%`,
      transform: `translateX(${index * 100}%)`,
      opacity: String(shown ? CAPSULE_OPACITY : 0),
      transition: this.#animate() ? CAPSULE_TRANSITION : 'none',
    };
  });

  /**
   * The icon of the collapsed bar's item (see restoreItem), or the first
   * item's.
   */
  protected readonly minimizedIcon = computed(() => {
    const item = this.restoreItem() ?? this.items()[0];
    return item
      ? iconSvg(item.icon(), this.#resolveColor('var(--primary)'))
      : '';
  });

  // The collapsed bar's icon fades in as the bar shrinks around it.
  protected readonly restoreEntrance = effect(() => {
    const restore = this.restoreButton();
    if (restore && untracked(this.#animate)) {
      fadeIn(restore.nativeElement, { duration: DURATION.slow });
    }
  });

  /** Whether the dock searched when it last checked, to see it close. */
  #wasSearching = false;

  // A search that closes, by its route or by the app, takes the keyboard
  // with it.
  protected readonly closeKeyboard = effect(() => {
    const searching = this.searching();
    if (this.#wasSearching && !searching) {
      untracked(() => this.searchField()?.blur());
    }
    this.#wasSearching = searching;
  });

  // The search field's keyboard height says the keyboard moved: measure how
  // far it reaches into the dock, which floats above it while it searches.
  protected readonly followKeyboard = effect(() => {
    const height = this.searchField()?.keyboardHeight() ?? 0;
    const measuring = ++this.#measuring;
    const screen = height > 0 ? keyboardScreen(this.#injector) : null;
    if (!screen) {
      this.#keyboardOverlap.set(0);
      return;
    }
    // The dock's host sits at the bottom of the screen whatever its padding,
    // so measuring it gives the same answer however far the dock has risen.
    measureForKeyboard(this.#renderer, this.#host.nativeElement).then(
      (measured) => {
        if (measuring !== this.#measuring || !measured) return;
        this.#keyboardOverlap.set(
          keyboardLift(measured.element, measured.page, height, screen, 0),
        );
      },
    );
  });

  protected measure(event: Event): void {
    this.width.set((event as LayoutChangeEvent).detail.width);
  }

  /**
   * Brings a minimized dock back.
   */
  expand(): void {
    this.#state.minimized.set(false);
  }

  /**
   * Opens the search field and gives it the keyboard, as pressing an action
   * without a route does.
   */
  openSearch(): void {
    const field = this.searchField();
    if (!field) return;
    this.#state.searching.set(true);
    field.focus();
  }

  /**
   * Closes the search field: goes back to the last item while the search's
   * route is active, or else closes the search UiDockState holds open.
   */
  closeSearch(): void {
    if (this.action()?.active()) {
      (this.#lastItem() ?? this.items()[0])?.navigate();
    }
    this.#state.searching.set(false);
  }

  /**
   * Cancel closes the search, except that the search tab of iOS stays open
   * with its suggestions: there, Cancel clears the field and closes the
   * keyboard, and the bar's button goes back. Material's back arrow always
   * goes back.
   */
  searchCanceled(): void {
    if (this.design() === 'material' || !this.action()?.active()) {
      this.closeSearch();
    }
  }

  /**
   * The action was pressed: one without a route opens the search.
   */
  actionPressed(routed: boolean): void {
    if (!routed) this.openSearch();
  }

  protected onRestore(): void {
    if (this.searching()) {
      this.closeSearch();
    } else {
      this.expand();
    }
  }
}

/**
 * One of the dock's screens: an icon over a label that navigates to its
 * `route` on a tap.
 *
 * The host itself is the link. Angular's own `RouterLink` and
 * `RouterLinkActive` sit on it as host directives, so every `RouterLink`
 * option (`queryParams`, `replaceUrl`, `state`, …) and
 * `routerLinkActiveOptions` work as they do on the web, and the item knows
 * whether its route is active without the app wiring `routerLinkActive` up.
 * Host directives don't match selectors, so `LynxRouterLinkActive`, which
 * marks the active item `selected` for screen readers, is listed too.
 */
@Component({
  selector: 'ui-dock-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  hostDirectives: [
    {
      directive: RouterLink,
      // `route`, not `routerLink`: an app that imports RouterLink would
      // otherwise put a second RouterLink on the item (its selector matches
      // `routerLink`), and Angular rejects two of one directive on an element.
      inputs: [
        'routerLink: route',
        'queryParams',
        'queryParamsHandling',
        'fragment',
        'preserveFragment',
        'state',
        'info',
        'relativeTo',
        'replaceUrl',
        'skipLocationChange',
      ],
    },
    { directive: RouterLinkActive, inputs: ['routerLinkActiveOptions'] },
    LynxRouterLinkActive,
  ],
  host: {
    // The host is the tap target and takes an equal share of the bar's row,
    // which the selection capsule's width counts on.
    class: 'flex-1 flex-col flex',
    // One accessibility element per item, named by its label, so a screen
    // reader reads "Inbox, 3, button" instead of an unlabeled SVG and a word.
    // LynxRouterLinkActive adds `selected` to `button` while the route is
    // active. The label is an attribute binding: a property binding on a
    // component's host is checked against the DOM schema, which has no
    // `accessibility-label`.
    'accessibility-element': 'true',
    'accessibility-traits': 'button',
    '[attr.accessibility-label]': 'accessibilityLabel()',
    // Press feedback binds touch and mouse events: native fires only touch,
    // and the web preview, in a browser, fires only mouse. See pressDown().
    '(bindtouchstart)': 'onPressStart()',
    '(bindmousedown)': 'onPressStart()',
    // A canceled touch (a scroll taking over) and a cursor leaving mid-press
    // release too, or the item would stay shrunk.
    '(bindtouchend)': 'onPressEnd()',
    '(bindtouchcancel)': 'onPressEnd()',
    '(bindmouseup)': 'onPressEnd()',
    '(bindmouseleave)': 'onPressEnd()',
    // RouterLink navigates on the same tap through its own listener.
    '(bindtap)': 'pressed.emit()',
  },
  template: `
    <view [class]="contentClass()">
      <view [class]="iconFrameClass()">
        @if (design() === 'material') {
          <!-- Material's active indicator: a pill behind the icon that
               widens from its center as the item is selected. -->
          <view
            class="h-8 w-14 rounded-full bg-primary absolute left-0 top-0"
            [style]="indicatorStyle()"
          ></view>
        }
        <view class="relative">
          <svg [attr.content]="iconSvg()" style="width: 24px; height: 24px;" />
          @if (badgeText()) {
            <!-- Hangs off the icon's top-right corner, as on a native tab
                 bar. min-w-4 keeps a one-digit badge round; longer ones
                 grow into a pill. -->
            <view
              class="h-4 min-w-4 items-center rounded-full bg-destructive px-1 flex absolute -right-2.5 -top-1 justify-center"
            >
              <text
                class="text-[10px] font-semibold leading-4 text-destructive-foreground"
                >{{ badgeText() }}</text
              >
            </view>
          }
        </view>
      </view>
      <text [class]="labelClass()">{{ label() }}</text>
    </view>
  `,
})
export class UiDockItem {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  /**
   * A count or short text over the icon's corner, such as unread messages.
   * Nothing shows for `0`, an empty string, `null` or `undefined`, so a count
   * can be bound as it is.
   */
  readonly badge = input<string | number | null | undefined>(undefined);
  readonly userClass = input<string>('', { alias: 'class' });

  /** Emits on every tap, including a tap on the item that's already active. */
  readonly pressed = output<void>();

  readonly #dock = inject(UiDock);
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #resolveColor = injectIconColor();
  // The host, not an inner view, shrinks on a press: it's the whole tap
  // target, and injecting it needs no view query.
  readonly #host = inject(ElementRef);
  readonly #link = inject(RouterLink);
  #pressAnim?: AnimationHandle;

  protected readonly design = this.#dock.design;

  /**
   * Whether the item's route is active, from the RouterLinkActive on the
   * host. RouterLinkActive reports only changes, and starts from not active.
   */
  readonly active = toSignal(inject(RouterLinkActive).isActiveChange, {
    initialValue: false,
  });

  protected readonly badgeText = computed(() => {
    const text = String(this.badge() ?? '');
    return text === '0' ? '' : text;
  });

  protected readonly accessibilityLabel = computed(() =>
    this.badgeText() ? `${this.label()}, ${this.badgeText()}` : this.label(),
  );

  /**
   * The colors of the selected item and the others, as theme tokens. On
   * glass, the selected item takes the primary color over the capsule and
   * the others the glass's foreground. Before iOS 26, the others were gray.
   * On Material, the selected icon sits on the primary indicator.
   */
  readonly #colors = computed(() => {
    const active = this.active();
    switch (this.design()) {
      case 'glass':
        return active
          ? { icon: 'var(--primary)', label: 'text-primary' }
          : { icon: 'var(--glass-foreground)', label: 'text-glass-foreground' };
      case 'material':
        return active
          ? {
              icon: 'var(--primary-foreground)',
              label: 'font-semibold text-foreground',
            }
          : { icon: 'var(--muted-foreground)', label: 'text-muted-foreground' };
      default:
        return active
          ? { icon: 'var(--primary)', label: 'text-primary' }
          : { icon: 'var(--muted-foreground)', label: 'text-muted-foreground' };
    }
  });

  // The icon is drawn here, as the tab bar draws its own, rather than by a
  // nested <ui-icon>: an SVG can't read the label's text class (Lynx doesn't
  // pass `color` down, and the markup is parsed apart from the page's CSS),
  // so the token is resolved to its value and written into the markup (see
  // icon-theme.ts).
  protected readonly iconSvg = computed(() =>
    iconSvg(this.icon(), this.#resolveColor(this.#colors().icon)),
  );

  protected readonly labelClass = computed(() =>
    cn(
      this.design() === 'material'
        ? 'text-xs font-medium'
        : 'text-[10px] font-medium',
      this.#colors().label,
    ),
  );

  protected readonly iconFrameClass = computed(() =>
    this.design() === 'material'
      ? 'h-8 w-14 items-center flex relative justify-center'
      : 'relative',
  );

  /**
   * Material's indicator shows at once on the selected item, so its icon is
   * never light on the toolbar, and widens from the center there. It leaves
   * the item it moves from at once too.
   */
  protected readonly indicatorStyle = computed(() => {
    const active = this.active();
    return {
      opacity: active ? '1' : '0',
      transform: active ? 'scaleX(1)' : 'scaleX(0.5)',
      transition:
        active && !this.#settings.reduceMotion()
          ? `transform ${DURATION.normal}ms ${EASING.decelerate}`
          : 'none',
    };
  });

  protected readonly contentClass = computed(() =>
    cn(
      'flex-1 flex-col items-center flex justify-center',
      this.design() === 'material' ? 'gap-1' : 'gap-0.5',
      this.userClass(),
    ),
  );

  /**
   * Navigates to the item's route, with its RouterLink options, as a tap
   * does: the glass dock's collapsed bar goes back to it from the search.
   */
  navigate(): void {
    this.#link.onClick(0, false, false, false, false);
  }

  protected onPressStart(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.#host.nativeElement);
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.#host.nativeElement);
  }
}

/**
 * The dock's separate button, for the action people reach for from every
 * screen, such as search or compose. It sits beside the bar: on glass, a
 * circle in the dock's glass group, which merges with the bar's glass as the
 * two come close; on Material, a floating action button; before iOS 26, the
 * bar's last button.
 *
 * It navigates to its `route` like an item, and is selected while the route
 * is active, or emits `pressed` for an action of your own without one:
 *
 * ```html
 * <ui-dock-action route="/search" icon="search" label="Search" />
 * <ui-dock-action icon="plus" label="New message" (pressed)="compose()" />
 * ```
 *
 * With a `<ui-search-field>` in the dock, it opens the search (see UiDock).
 */
@Component({
  selector: 'ui-dock-action',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  hostDirectives: [
    {
      directive: RouterLink,
      inputs: [
        'routerLink: route',
        'queryParams',
        'queryParamsHandling',
        'fragment',
        'preserveFragment',
        'state',
        'info',
        'relativeTo',
        'replaceUrl',
        'skipLocationChange',
      ],
    },
    { directive: RouterLinkActive, inputs: ['routerLinkActiveOptions'] },
    LynxRouterLinkActive,
  ],
  host: {
    // It fills the action's glass, which is the button's shape.
    class: 'flex-1 items-center flex justify-center',
    'accessibility-element': 'true',
    'accessibility-traits': 'button',
    '[attr.accessibility-label]': 'label()',
    '(bindtouchstart)': 'onPressStart()',
    '(bindmousedown)': 'onPressStart()',
    '(bindtouchend)': 'onPressEnd()',
    '(bindtouchcancel)': 'onPressEnd()',
    '(bindmouseup)': 'onPressEnd()',
    '(bindmouseleave)': 'onPressEnd()',
    '(bindtap)': 'onTap()',
    // Its icon fades while the button shrinks into the search field, so it
    // doesn't show through the field's glass. The content, not the glass.
    '[style.opacity]': 'fade().opacity',
    '[style.transition]': 'fade().transition',
  },
  template: `<svg
    [attr.content]="iconSvg()"
    style="width: 24px; height: 24px;"
  />`,
})
export class UiDockAction {
  readonly icon = input.required<IconName>();
  /** What the button does, for screen readers: it shows only its icon. */
  readonly label = input.required<string>();

  /** Emits on every tap. */
  readonly pressed = output<void>();

  readonly #dock = inject(UiDock);
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #resolveColor = injectIconColor();
  readonly #host = inject(ElementRef);
  readonly #link = inject(RouterLink);
  #pressAnim?: AnimationHandle;

  /** Whether the button's route is active, as for UiDockItem.active. */
  readonly active = toSignal(inject(RouterLinkActive).isActiveChange, {
    initialValue: false,
  });

  /**
   * On glass, the icon takes the glass's foreground, and the primary color
   * while its route is active, as a selected item does. Material's button is
   * filled with the primary color; before iOS 26, a bar button was tinted.
   */
  protected readonly iconSvg = computed(() => {
    const design = this.#dock.design();
    const color =
      design === 'material'
        ? 'var(--primary-foreground)'
        : design === 'glass' && !this.active()
          ? 'var(--glass-foreground)'
          : 'var(--primary)';
    return iconSvg(this.icon(), this.#resolveColor(color));
  });

  protected readonly fade = computed(() => {
    const hidden = this.#dock.actionHidden();
    return {
      opacity: hidden ? '0' : null,
      transition:
        hidden && !this.#settings.reduceMotion() ? ICON_OUT_TRANSITION : null,
    };
  });

  /**
   * RouterLink navigates on the same tap through its own listener, when the
   * button has a route: one without a route opens the dock's search, if it
   * has one.
   */
  protected onTap(): void {
    this.pressed.emit();
    this.#dock.actionPressed(this.#link.urlTree !== null);
  }

  protected onPressStart(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressDown(this.#host.nativeElement);
  }

  protected onPressEnd(): void {
    this.#pressAnim?.cancel();
    this.#pressAnim = pressRelease(this.#host.nativeElement);
  }
}
