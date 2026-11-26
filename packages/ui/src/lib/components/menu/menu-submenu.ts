import {
  Component,
  DestroyRef,
  type ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { injectGlassDesign } from '../glass/glass-design';
import { UiIcon } from '../icon/icon';
import { type IconName } from '../icon/icons';
import {
  UI_MENU,
  type UiMenuHost,
  UiMenuSeparator,
  joinRows,
  menuHighlightClass,
  menuHighlightOpacity,
  menuLabelClass,
  menuRowClass,
} from './menu';
import { type MenuElement, UiMenuPopup } from './menu-popup';
import { type MenuRow, MenuRows } from './menu-rows';

/**
 * The submenu its items are in, for `UI_MENU`. A named function rather than
 * an inline factory: the component's metadata keeps its own copy of an
 * inline one, which nothing calls, so an app's coverage report would show it
 * as uncovered.
 */
const submenu = (): UiMenuHost => inject(UiMenuSubmenu);

/**
 * A row of a menu that opens a nested menu, such as "Sort By".
 *
 * ```html
 * <ui-menu>
 *   <ui-button uiMenuTrigger variant="outline">View</ui-button>
 *   <ui-menu-submenu label="Sort By" icon="arrow-down">
 *     <ui-menu-item label="Name" [checked]="sort() === 'name'" (pressed)="sort.set('name')" />
 *     <ui-menu-item label="Date" [checked]="sort() === 'date'" (pressed)="sort.set('date')" />
 *   </ui-menu-submenu>
 *   <ui-menu-item label="Select" icon="check" (pressed)="select()" />
 * </ui-menu>
 * ```
 *
 * It takes the items, sections, separators and submenus a menu does, in a
 * `ui-menu` or a `ui-context-menu`. A tap on its row opens it, growing out
 * of the row over the menu it's in, with a header that closes it again, as
 * iOS's submenus do; the menu behind it fades. Choosing one of its items
 * closes every menu, and a tap outside it, or Android's back button, closes
 * only the submenu. On Android's Material menus it takes the menu's place,
 * as a Material submenu does.
 */
@Component({
  selector: 'ui-menu-submenu',
  imports: [LYNX_ELEMENTS, UiIcon, UiMenuPopup, UiMenuSeparator],
  encapsulation: ViewEncapsulation.None,
  providers: [{ provide: UI_MENU, useFactory: submenu }],
  template: `
    <!-- The row in the menu it's in. It hides while the submenu covers it,
         as the trigger of a pull-down menu does. -->
    <view
      #row
      [class]="rowClass()"
      [style.visibility]="coversRow() ? 'hidden' : null"
      [accessibility-element]="true"
      accessibility-traits="button"
      [accessibility-label]="label()"
      (bindtouchstart)="hold(true)"
      (bindtouchend)="hold(false)"
      (bindtouchcancel)="hold(false)"
      (bindmousedown)="hold(true)"
      (bindmouseup)="hold(false)"
      (bindmouseleave)="hold(false)"
      (bindtap)="tap()"
    >
      <view
        [class]="highlightClass()"
        [style.opacity]="highlightOpacity()"
      ></view>
      @if (leadingIcon(); as name) {
        <ui-icon
          [name]="name"
          [size]="iconSize()"
          color="var(--glass-foreground)"
        />
      }
      <text [class]="labelClass()">{{ label() }}</text>
      @if (trailingIcon(); as name) {
        <ui-icon
          [name]="name"
          [size]="iconSize()"
          color="var(--glass-foreground)"
        />
      }
      <ui-icon
        name="chevron-right"
        size="sm"
        color="var(--glass-muted-foreground)"
      />
    </view>
    <ui-menu-popup
      #popup
      kind="submenu"
      [open]="isOpen()"
      [anchor]="rowView().nativeElement"
      [rows]="rows"
      (dismissed)="collapse()"
    >
      <!-- The header, where the row was: a tap on it goes back to the menu
           the submenu opened from. -->
      <view
        [class]="headerClass()"
        [accessibility-element]="true"
        accessibility-traits="button"
        [accessibility-label]="label()"
        (bindtap)="collapse()"
      >
        @if (material()) {
          <ui-icon
            name="chevron-left"
            size="md"
            color="var(--glass-foreground)"
          />
        }
        <text [class]="headerLabelClass()">{{ label() }}</text>
        @if (!material()) {
          <ui-icon
            name="chevron-down"
            size="sm"
            color="var(--glass-foreground)"
          />
        }
      </view>
      <ui-menu-separator />
      <ng-content
        select="ui-menu-item, ui-menu-section, ui-menu-separator, ui-menu-submenu"
      />
    </ui-menu-popup>
  `,
})
export class UiMenuSubmenu implements UiMenuHost {
  readonly #parent = inject(UI_MENU, { skipSelf: true });
  readonly #design = injectGlassDesign();

  /** The row's text, which is also the submenu's header. */
  readonly label = input.required<string>();
  /** An icon for the row, from the icon set. */
  readonly icon = input<IconName | undefined>(undefined);
  /** Shows the row without letting it open the submenu. */
  readonly disabled = input(false, { transform: booleanAttribute });

  /** The submenu's own rows, which its items join. */
  readonly rows = new MenuRows();

  /** Whether the submenu was opened, and hasn't been closed since. */
  readonly expanded = signal(false);

  // Required: both are always in the template.
  readonly rowView = viewChild.required<ElementRef<MenuElement>>('row');
  readonly popup = viewChild.required<UiMenuPopup>('popup');

  /** Whether a finger (or the mouse) is down on the row. */
  protected readonly held = signal(false);

  /** The row as one a finger sliding across the menu can choose. */
  readonly #asRow: MenuRow = {
    element: () => this.rowView().nativeElement,
    disabled: () => this.disabled(),
    choose: () => this.expand(),
  };
  protected readonly joined = joinRows(
    this.#parent.rows,
    this.#asRow,
    inject(DestroyRef),
  );

  /** Open while the menu it's in is: it closes with that menu. */
  protected readonly isOpen = computed(
    () => this.expanded() && this.#parent.rows.shown(),
  );

  /**
   * Forgets that the submenu was open once the menu it's in closes, so that
   * menu opens on its own items next time, as on iOS. A field rather than a
   * constructor (see UiMenuPopup's openOrClose).
   */
  protected readonly collapsing = effect(() => {
    if (!this.#parent.rows.shown()) untracked(() => this.collapse());
  });

  protected readonly material = computed(() => this.#design() === 'material');

  /** The icon goes before the label, except before iOS 26 (see UiMenuItem). */
  readonly #iconLeads = computed(() => this.#design() !== 'frosted');
  protected readonly leadingIcon = computed(() =>
    this.#iconLeads() ? this.icon() : undefined,
  );
  protected readonly trailingIcon = computed(() =>
    this.#iconLeads() ? undefined : this.icon(),
  );
  protected readonly iconSize = computed(() => (this.material() ? 'md' : 'sm'));

  protected readonly rowClass = computed(() =>
    menuRowClass(this.#design(), this.disabled()),
  );
  protected readonly highlightClass = computed(() =>
    menuHighlightClass(this.#design()),
  );
  protected readonly highlightOpacity = computed(() =>
    menuHighlightOpacity(
      this.#design(),
      this.held() || this.#parent.rows.highlighted() === this.#asRow,
    ),
  );
  protected readonly labelClass = computed(() =>
    menuLabelClass(this.#design()),
  );
  protected readonly headerClass = computed(() =>
    menuRowClass(this.#design(), false),
  );
  protected readonly headerLabelClass = computed(() =>
    cn(menuLabelClass(this.#design()), 'font-semibold'),
  );

  /** Whether the submenu covers its row now (see UiMenu's coversTrigger). */
  protected readonly coversRow = computed(() => {
    const phase = this.popup().phase();
    return phase !== 'closed' && phase !== 'measuring';
  });

  protected hold(down: boolean): void {
    this.held.set(down && !this.disabled());
  }

  /**
   * A tap on the row opens the submenu, unless it ends the press that
   * opened the menu (see MenuRows' ownsTap).
   */
  protected tap(): void {
    if (!this.#parent.rows.ownsTap()) this.expand();
  }

  /**
   * Opens the submenu over the menu it's in, which fades behind it.
   */
  expand(): void {
    if (this.disabled()) return;
    this.expanded.set(true);
    this.#parent.rows.covered.set(true);
  }

  /**
   * Closes the submenu, back to the menu it's in.
   */
  collapse(): void {
    this.expanded.set(false);
    this.#parent.rows.covered.set(false);
  }

  /**
   * Closes the submenu and every menu it's in, as choosing an item does.
   */
  close(): void {
    this.collapse();
    this.#parent.close();
  }
}
