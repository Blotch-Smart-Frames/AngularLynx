import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  InjectionToken,
  Renderer2,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '@blotch/dolan/utils/cn';
import { UiGlass } from '../glass/glass';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import { UiIcon } from '../icon/icon';
import { type IconName, optionalIconMarkup } from '../icon/icons';
import { type MenuElement, UiMenuPopup } from './menu-popup';
import { type MenuRow, MenuPress, MenuRows } from './menu-rows';

/**
 * What a menu's items need from the menu they're in: `ui-menu` or
 * `ui-context-menu`.
 */
export type UiMenuHost = {
  /** Closes the menu, as choosing an item does. */
  close(): void;
  /**
   * The menu's rows, which its items join so a finger can slide onto them,
   * and how the menu draws them while it's open.
   */
  readonly rows: MenuRows;
};

/**
 * The classes of a menu row, an item or a submenu's: Apple's 44pt rows and
 * Material 3's 48dp rows, which grow when their label wraps.
 */
export const menuRowClass = (design: GlassDesign, disabled: boolean) =>
  cn(
    'flex-row items-center gap-3 flex relative',
    design === 'material'
      ? 'min-h-[48px] px-3 py-3'
      : 'min-h-[44px] px-4 py-[11px]',
    disabled && 'opacity-40',
  );

/**
 * iOS 26's menus highlight a pressed row with a capsule inset 10pt from
 * the menu's sides, 8% darker than the glass, measured on iOS 27's Files
 * menu. Before, Apple's menus filled the row edge to edge, and so does
 * Material's state layer, at a tenth. In the glass's own foreground, so it
 * suits light and dark glass.
 */
export const menuHighlightClass = (design: GlassDesign) =>
  cn(
    'bg-glass-foreground absolute bottom-0 top-0',
    design === 'glass'
      ? 'rounded-full left-[10px] right-[10px]'
      : 'left-0 right-0',
  );

/** The pressed highlight's opacity: none unless the row is `lit`. */
export const menuHighlightOpacity = (design: GlassDesign, lit: boolean) => {
  if (!lit) return 0;
  return design === 'glass' ? 0.08 : 0.1;
};

/** A row label's classes, in red for a destructive item. */
export const menuLabelClass = (design: GlassDesign, destructive = false) =>
  cn(
    'flex-1',
    design === 'material' ? 'text-[16px]' : 'text-[17px]',
    destructive ? 'text-destructive' : 'text-glass-foreground',
  );

/**
 * Makes `row` one of `rows`, until `destroyRef` is destroyed: a finger
 * sliding across the menu lights it up and chooses it (see MenuPress).
 */
export const joinRows = (
  rows: MenuRows,
  row: MenuRow,
  destroyRef: DestroyRef,
): (() => void) => destroyRef.onDestroy(rows.add(row));

/**
 * The menu an item is in. `ui-menu` and `ui-context-menu` provide it, so the
 * same items, sections and separators work in both.
 */
export const UI_MENU = new InjectionToken<UiMenuHost>('UI_MENU');

/**
 * `booleanAttribute` for an input that can also be unset: a bare attribute
 * is true, as it is for the other boolean inputs, and `undefined` stays
 * `undefined` rather than becoming false.
 */
const optionalBooleanAttribute = (value: unknown): boolean | undefined =>
  value === undefined ? undefined : booleanAttribute(value);

/**
 * A menu item: a label, with an optional icon, that does something and
 * closes the menu.
 *
 * ```html
 * <ui-menu-item label="Copy" icon="copy" (pressed)="copy()" />
 * <ui-menu-item label="Delete" icon="trash" variant="destructive" (pressed)="remove()" />
 * <ui-menu-item label="Open in Acme" [svg]="acmeMark" (pressed)="open()" />
 * ```
 *
 * Each design lays it out as its platform does: Apple's 44pt rows, with the
 * icon before the label from iOS 26 and after it before, and Material 3's
 * 48dp rows with a leading icon. A screen reader reads it as a button with
 * its label, and a destructive item as "Delete, destructive".
 */
@Component({
  selector: 'ui-menu-item',
  imports: [LYNX_ELEMENTS, UiIcon],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- A checked item is selected to a screen reader, which iOS reads.
         lynxAccessibilityTraits adds the trait to button on iOS, and leaves
         Android, which reads one trait, with button. -->
    <view
      #row
      [class]="rowClass()"
      [accessibility-element]="true"
      accessibility-traits="button"
      [accessibility-label]="spokenLabel()"
      [lynxAccessibilityTraits]="{ selected: checked() === true }"
      (bindtouchstart)="hold(true)"
      (bindtouchend)="hold(false)"
      (bindtouchcancel)="hold(false)"
      (bindmousedown)="hold(true)"
      (bindmouseup)="hold(false)"
      (bindmouseleave)="hold(false)"
      (bindtap)="tap()"
    >
      <!-- The pressed highlight, in the glass's own foreground, so it suits
           light and dark glass (see menuHighlightClass). -->
      <view
        [class]="highlightClass()"
        [style.opacity]="highlightOpacity()"
      ></view>
      @if (checked() !== undefined) {
        <!-- A checkable item keeps the column for the checkmark when it's
             unchecked, so the labels of a group line up. -->
        <view class="h-5 w-5 items-center flex justify-center">
          @if (checked()) {
            <ui-icon name="check" size="sm" [color]="iconColor()" />
          }
        </view>
      }
      @if (leadingIcon(); as markup) {
        <ui-icon [svg]="markup" [size]="iconSize()" [color]="iconColor()" />
      }
      <text [class]="labelClass()">{{ label() }}</text>
      @if (trailingIcon(); as markup) {
        <ui-icon [svg]="markup" [size]="iconSize()" [color]="iconColor()" />
      }
    </view>
  `,
})
export class UiMenuItem {
  readonly #menu = inject(UI_MENU);
  readonly #design = injectGlassDesign();

  /** What the item does, which is also what a screen reader reads. */
  readonly label = input.required<string>();
  /** An icon for a common action, from the icon set. Give this or `svg`. */
  readonly icon = input<IconName | undefined>(undefined);
  /**
   * SVG markup to draw instead of an icon from the set, such as the app's
   * own mark for an action the set has nothing for. `currentColor` in it
   * takes the item's color, as the set's icons do (the destructive color on
   * a destructive item, the glass's foreground otherwise), and it's drawn at
   * the row's icon size; colors written out stay. Give this or `icon`.
   */
  readonly svg = input<string | undefined>(undefined);
  /** `'destructive'` for an action that deletes or can't be undone. */
  readonly variant = input<'default' | 'destructive'>('default');
  /**
   * Whether the item shows a checkmark, for an option that's on, such as the
   * current sort order. Leave it unset for an item that's never checked;
   * set it, true or false, on each item of a group of options, so their
   * labels line up.
   */
  readonly checked = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBooleanAttribute,
  });
  /** Shows the item without letting it be chosen. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /**
   * What a screen reader reads, when the label isn't enough. By default the
   * label, and ", destructive" after it for a destructive item.
   */
  readonly accessibilityLabel = input<string | undefined>(undefined);

  /** The item was chosen. The menu closes. */
  readonly pressed = output<void>();

  /** Whether a finger (or the mouse) is down on the item. */
  protected readonly held = signal(false);

  // Required: always in the template.
  readonly row = viewChild.required<ElementRef<MenuElement>>('row');

  /** The item as a row a finger sliding across the menu can choose. */
  readonly #asRow: MenuRow = {
    element: () => this.row().nativeElement,
    disabled: () => this.disabled(),
    choose: () => this.choose(),
  };
  protected readonly joined = joinRows(
    this.#menu.rows,
    this.#asRow,
    inject(DestroyRef),
  );

  readonly #material = computed(() => this.#design() === 'material');
  readonly #destructive = computed(() => this.variant() === 'destructive');

  /**
   * The icon goes before the label, except before iOS 26, whose menus put it
   * at the end of the row.
   */
  readonly #iconLeads = computed(() => this.#design() !== 'frosted');
  /**
   * The icon's markup, from the set or the app's own, or nothing. The
   * <ui-icon> gets it as its `svg` either way, so the item checks for both
   * itself and names itself in the error rather than the icon.
   */
  readonly #iconMarkup = computed(() =>
    optionalIconMarkup(
      this.icon(),
      this.svg(),
      '<ui-menu-item> takes an icon or an svg, not both.',
    ),
  );
  protected readonly leadingIcon = computed(() =>
    this.#iconLeads() ? this.#iconMarkup() : undefined,
  );
  protected readonly trailingIcon = computed(() =>
    this.#iconLeads() ? undefined : this.#iconMarkup(),
  );

  protected readonly highlightClass = computed(() =>
    menuHighlightClass(this.#design()),
  );
  /** Lit while pressed, or while a finger sliding across the menu is on it. */
  protected readonly highlightOpacity = computed(() =>
    menuHighlightOpacity(
      this.#design(),
      this.held() || this.#menu.rows.highlighted() === this.#asRow,
    ),
  );

  protected readonly rowClass = computed(() =>
    menuRowClass(this.#design(), this.disabled()),
  );

  protected readonly labelClass = computed(() =>
    menuLabelClass(this.#design(), this.#destructive()),
  );
  protected readonly iconSize = computed(() =>
    this.#material() ? 'md' : 'sm',
  );
  protected readonly iconColor = computed(() =>
    this.#destructive() ? 'var(--destructive)' : 'var(--glass-foreground)',
  );
  protected readonly spokenLabel = computed(
    () =>
      this.accessibilityLabel() ??
      (this.#destructive() ? `${this.label()}, destructive` : this.label()),
  );

  protected hold(down: boolean): void {
    this.held.set(down && !this.disabled());
  }

  /**
   * A tap on the item chooses it, unless it ends the press that opened the
   * menu: lifting there without sliding leaves the menu open, as on iOS.
   */
  protected tap(): void {
    if (!this.#menu.rows.ownsTap()) this.choose();
  }

  protected choose(): void {
    if (this.disabled()) return;
    this.pressed.emit();
    this.#menu.close();
  }
}

/**
 * A group of menu items, with an optional title above them.
 *
 * ```html
 * <ui-menu-section title="Sort by">
 *   <ui-menu-item label="Name" />
 *   <ui-menu-item label="Date" />
 * </ui-menu-section>
 * ```
 *
 * Put a `<ui-menu-separator />` between sections.
 */
@Component({
  selector: 'ui-menu-section',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // The title is the section's text. Angular also gives the host every static
  // attribute the app writes on it, and a `title` on the host is a tooltip in
  // the web preview and a second match for getByTitle, so the host drops it.
  host: { '[attr.title]': 'null' },
  // The title stays above the items when the menu lists them from the
  // bottom up (see MenuRows' reversed), as a section's does in UIKit.
  template: `
    <view class="flex-col flex">
      @if (title()) {
        <text [class]="titleClass()" accessibility-traits="header">
          {{ title() }}
        </text>
      }
      <view
        class="flex-col flex"
        [style.flex-direction]="reversed() ? 'column-reverse' : 'column'"
      >
        <ng-content />
      </view>
    </view>
  `,
})
export class UiMenuSection {
  readonly #design = injectGlassDesign();
  readonly #menu = inject(UI_MENU);

  protected readonly reversed = computed(() => this.#menu.rows.reversed());

  /** A title for the section, such as "Sort by". */
  readonly title = input<string | undefined>(undefined);

  protected readonly titleClass = computed(() =>
    cn(
      'pb-1 pt-2 text-[13px] text-glass-muted-foreground',
      this.#design() === 'material' ? 'px-3' : 'px-4',
    ),
  );
}

/**
 * A line between a menu's sections. Before iOS 26, Apple's menus parted
 * sections with a thick band rather than a line.
 */
@Component({
  selector: 'ui-menu-separator',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<view [class]="lineClass()"></view>`,
})
export class UiMenuSeparator {
  readonly #design = injectGlassDesign();

  protected readonly lineClass = computed(() => {
    switch (this.#design()) {
      case 'glass':
        return 'mx-4 my-1.5 h-px bg-glass-foreground opacity-20';
      case 'frosted':
        return 'h-2 bg-glass-foreground opacity-10';
      default:
        return 'my-2 h-px bg-border';
    }
  });
}

/** How many pull-down menus there have been, for their glass ids. */
let menuCount = 0;

/**
 * The `ui-menu` a trigger is in, for `UI_MENU`. A named function rather than
 * an inline factory: the component's metadata keeps its own copy of an
 * inline one, which nothing calls, so an app's coverage report would show it
 * as uncovered.
 */
const pullDownMenu = (): UiMenuHost => inject(UiMenu);

/**
 * A pull-down menu: a glass menu that grows out of the button that opens it.
 *
 * ```html
 * <ui-menu>
 *   <ui-button uiMenuTrigger variant="outline">Sort</ui-button>
 *   <ui-menu-item label="Name" icon="type" (pressed)="sortBy('name')" />
 *   <ui-menu-item label="Date" icon="calendar" (pressed)="sortBy('date')" />
 * </ui-menu>
 * ```
 *
 * Mark the element that opens it with `uiMenuTrigger`; everything else
 * inside it is the menu. A tap on the trigger opens it; a tap outside it,
 * choosing an item, or Android's back button closes it. `[(open)]` opens and
 * closes it from code.
 *
 * On iOS 26 and later it's Liquid Glass, and grows out of its trigger: one
 * glass shape whose frame grows from the trigger's to the menu's, which the
 * glass follows as it goes, with the trigger hidden under it. Before iOS 26
 * it's the frosted material. On Android it's a Material 3 menu that unfolds
 * below its trigger, or Liquid Glass with `provideGlass({ android: 'glass' })`.
 * It stays on screen and inside the safe area, and opens upward near the
 * bottom of the screen.
 */
@Component({
  selector: 'ui-menu',
  imports: [LYNX_ELEMENTS, UiMenuPopup],
  encapsulation: ViewEncapsulation.None,
  providers: [{ provide: UI_MENU, useFactory: pullDownMenu }],
  template: `
    <ng-content />
    <ui-menu-popup
      #popup
      [open]="open()"
      [anchor]="anchor()"
      [glassId]="glassId"
      [rows]="rows"
      (dismissed)="close()"
      (closed)="closed.emit()"
    >
      <ng-content
        select="ui-menu-item, ui-menu-section, ui-menu-separator, ui-menu-submenu"
      />
    </ui-menu-popup>
  `,
})
export class UiMenu implements UiMenuHost {
  /** Whether the menu is open. */
  readonly open = model(false);
  /** The menu has closed and its close animation has finished. */
  readonly closed = output<void>();

  readonly #host = inject<ElementRef<MenuElement>>(ElementRef);
  readonly #trigger = signal<MenuElement | null>(null);

  readonly rows = new MenuRows();

  /**
   * The id the menu's glass and a glass trigger share (see UiGlass's
   * `glassId`), unique to the menu, so the menu takes over the trigger's
   * glass as it grows out of it.
   */
  readonly glassId = `ui-menu-${++menuCount}`;

  // Required: always in the template.
  readonly popup = viewChild.required<UiMenuPopup>('popup');

  /**
   * What the menu grows out of: its trigger, or the menu's own element when
   * nothing is marked `uiMenuTrigger`.
   */
  protected readonly anchor = computed(
    () => this.#trigger() ?? this.#host.nativeElement,
  );

  /**
   * Whether the menu covers its trigger now: a glass or frosted menu grows
   * out of it and shrinks back into it, so the trigger hides meanwhile, as
   * on iOS. A Material menu opens beside it.
   *
   * It hides with `visibility`, in the same update that shows the menu's
   * glass at the trigger's place, and shows again in the one that hides the
   * glass. On iOS 26 and later, the shell pairs a glass trigger with the menu
   * across that change (see UiGlass's `glassId`): the menu takes over the
   * trigger's corners, and the trigger's content fades out in it, and back in
   * as the menu closes.
   */
  readonly coversTrigger = computed(() => {
    const popup = this.popup();
    const phase = popup.phase();
    return (
      popup.design() !== 'material' &&
      phase !== 'closed' &&
      phase !== 'measuring'
    );
  });

  toggle(): void {
    this.open.update((open) => !open);
  }

  /**
   * A finger sliding from the trigger across the menu (see MenuPress).
   */
  readonly #press = new MenuPress(() => this.popup());

  /**
   * @internal A finger touched the trigger down. An Apple menu opens at
   * once, as UIKit's pull-down menus do, so the finger can slide onto an
   * item and lift to choose it; the tap that follows the press then doesn't
   * close it again. A Material menu opens on the tap, as Android's do.
   */
  pressTrigger(event: unknown): void {
    if (this.open() || this.popup().design() === 'material') return;
    this.#press.start(event);
    this.rows.pressStarted();
    this.open.set(true);
  }

  /**
   * @internal The finger moved.
   */
  moveOnTrigger(event: unknown): void {
    if (this.#press.active) this.#press.move(event);
  }

  /**
   * @internal The finger lifted, on a row, or anywhere.
   */
  liftFromTrigger(event: unknown): void {
    this.#press.end(event);
    this.rows.pressEnded();
  }

  /**
   * @internal The system took the touch over, as a scroll does.
   */
  cancelTriggerPress(): void {
    this.#press.cancel();
    this.rows.pressEnded();
  }

  /**
   * @internal A tap on the trigger: opens or closes the menu, unless it
   * ends the press that just opened it (see MenuRows' ownsTap). A tap that
   * comes on its own, as a screen reader's activation does, always toggles.
   */
  tapTrigger(): void {
    if (!this.rows.ownsTap()) this.toggle();
  }

  close(): void {
    this.open.set(false);
  }

  /**
   * @internal Called by the `uiMenuTrigger` directive.
   */
  setTrigger(trigger: MenuElement | null): void {
    this.#trigger.set(trigger);
  }
}

/**
 * Marks the element that opens a `ui-menu`: a tap on it opens or closes the
 * menu, and the menu grows out of it.
 *
 * ```html
 * <ui-menu>
 *   <ui-button uiMenuTrigger>Options</ui-button>
 *   …
 * </ui-menu>
 * ```
 */
@Directive({
  selector: '[uiMenuTrigger]',
  host: {
    '(click)': 'menu.tapTrigger()',
    '(bindtouchstart)': 'menu.pressTrigger($event)',
    '(bindtouchend)': 'menu.liftFromTrigger($event)',
    '(bindtouchcancel)': 'menu.cancelTriggerPress()',
    '[style.visibility]': 'menu.coversTrigger() ? "hidden" : null',
  },
})
export class UiMenuTrigger {
  protected readonly menu = inject(UiMenu);
  readonly #host = inject<ElementRef<MenuElement>>(ElementRef).nativeElement;

  /**
   * Listens for the finger's moves in code rather than in the host
   * metadata: Angular checks a host listener's component and every one
   * around it after each event, and a finger sends one for every frame it
   * moves (see UiTabsTrigger's moveListeners). Lynx keeps sending a touch's
   * moves to the element it started on, so they still come here while the
   * finger slides across the menu.
   */
  protected readonly removeMoveListener = inject(DestroyRef).onDestroy(
    inject(Renderer2).listen(this.#host, 'bindtouchmove', (event: unknown) =>
      this.menu.moveOnTrigger(event),
    ),
  );

  /**
   * Points the menu at this element until the directive is destroyed. A
   * trigger that's glass itself (`<blur-view ui-glass uiMenuTrigger>`)
   * shares the menu's glass id meanwhile, so the menu takes its glass over
   * (see UiMenu's coversTrigger).
   */
  protected readonly unregister = registerTrigger(
    this.menu,
    inject<ElementRef<MenuElement>>(ElementRef).nativeElement,
    inject(UiGlass, { self: true, optional: true }),
    inject(DestroyRef),
  );
}

/**
 * Makes `trigger` the element `menu` grows out of, and pairs its `glass`, if
 * it's glass, with the menu's, until `destroyRef` is destroyed. Returns what
 * takes the registration back early.
 */
const registerTrigger = (
  menu: UiMenu,
  trigger: MenuElement,
  glass: UiGlass | null,
  destroyRef: DestroyRef,
): (() => void) => {
  menu.setTrigger(trigger);
  glass?.pair(menu.glassId);
  return destroyRef.onDestroy(() => {
    menu.setTrigger(null);
    glass?.pair(null);
  });
};
