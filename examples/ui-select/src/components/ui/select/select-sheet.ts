import {
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  input,
  model,
  type Signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import {
  type BottomSheetVariant,
  type SheetDetent,
  UiBottomSheet,
} from '../bottom-sheet/bottom-sheet';
import { type GlassDesign, injectGlassDesign } from '../glass/glass-design';
import { UiSearchField } from '../search-field/search-field';

/**
 * `UiSearchField`, for `viewChild()`. A call rather than the class itself:
 * for a class, Angular's test build keeps an arrow function that nothing
 * calls, which an app's coverage report would show as uncovered.
 */
const searchFieldType = () => UiSearchField;

/** A list that fits its content, up to the list's cap. */
const FIT: readonly SheetDetent[] = ['fit'];
/**
 * A searchable list opens at full height, so its search field sits at the
 * top of the screen, clear of the keyboard that rises as it's focused.
 */
const LARGE: readonly SheetDetent[] = ['large'];

/**
 * Whether an item's label holds the search text, ignoring case and any
 * space around the text, so a query of spaces alone hides nothing.
 */
export const matchesQuery = (label: string, query: string): boolean =>
  label.toLowerCase().includes(query.trim().toLowerCase());

/**
 * How a select's sheet and rows draw: `'default'`, the sheet's own look on
 * every platform, or, for `variant="glass"`, the design the bottom sheet
 * resolves to on this platform (see GlassDesign).
 */
export type SelectLook = 'default' | GlassDesign;

/**
 * The look for a select's `variant`, from a field initializer. It follows
 * the platform's design as the bottom sheet does, so the rows match the
 * sheet they're in rather than the variant alone: on Android the glass
 * variant draws Material 3, unless the app opted in to glass there.
 */
export const injectSelectLook = (
  variant: () => BottomSheetVariant,
): Signal<SelectLook> => {
  const design = injectGlassDesign();
  return computed(() => (variant() === 'glass' ? design() : 'default'));
};

/**
 * A row's label in each look. Sizes are px, as Lynx's rem is 14px: iOS's
 * 17pt body text, and Material 3's 16sp Body Large.
 */
export const ROW_LABEL: Readonly<Record<SelectLook, string>> = {
  default: 'text-sm text-foreground',
  glass: 'text-[17px] leading-[22px] text-foreground',
  frosted: 'text-[17px] leading-[22px] text-foreground',
  material: 'text-[16px] leading-[24px] text-foreground',
};

/**
 * The sheet a select's options open in, shared by `ui-select` and
 * `ui-multi-select` so their search behaves the same: a bottom sheet holding
 * an optional search field above a scrolling list of the projected items,
 * and a line of text when no item is shown.
 *
 * A searchable sheet opens at full height and its list fills the rest of
 * the sheet; otherwise the sheet fits the list, which scrolls past a cap.
 * The search text is cleared once the sheet has closed, so it opens on the
 * full list again, and the field gives up the keyboard as the sheet starts
 * closing: the keyboard would otherwise outlive the field it belongs to.
 *
 * Content marked `ui-select-sheet-header` sits above the search field. The
 * select decides which items show (see `matchesQuery`) and says through
 * `empty` when none do.
 */
@Component({
  selector: 'ui-select-sheet',
  imports: [LYNX_ELEMENTS, UiBottomSheet, UiSearchField],
  encapsulation: ViewEncapsulation.None,
  // `open` and `query` are bound both ways by hand rather than with `[()]`:
  // for a two-way binding Angular also compiles a fallback that assigns the
  // field, which never runs for a signal and so shows as an uncovered
  // branch in an app's coverage report.
  template: `
    <ui-bottom-sheet
      [open]="open()"
      (openChange)="open.set($event)"
      [variant]="variant()"
      [detents]="detents()"
      (closed)="query.set('')"
    >
      <ng-content select="[ui-select-sheet-header]" />
      @if (searchable()) {
        <view class="px-4 pb-2">
          <ui-search-field
            [value]="query()"
            (valueChange)="query.set($event)"
            [placeholder]="searchPlaceholder()"
          />
        </view>
      }
      <scroll-view
        scroll-orientation="vertical"
        [class]="listClass()"
        [style]="listStyle()"
      >
        <view class="flex-col pb-4 flex">
          <ng-content />
          @if (showsEmpty()) {
            <text class="px-4 py-8 text-sm text-muted-foreground text-center">{{
              emptyText()
            }}</text>
          }
          <!-- Room for the keyboard under the last item, so every item can
               scroll above it while the search field has the focus. -->
          <view [style.height.px]="keyboardInset()"></view>
        </view>
      </scroll-view>
    </ui-bottom-sheet>
  `,
})
export class UiSelectSheet {
  readonly open = model(false);
  /** The bottom sheet's `variant`: `'glass'` draws the platform's sheet. */
  readonly variant = input<BottomSheetVariant>('default');
  /** Shows a search field above the items, and opens at full height. */
  readonly searchable = input(false, { transform: booleanAttribute });
  /** The search field's text. Cleared once the sheet has closed. */
  readonly query = model<string>('');
  readonly searchPlaceholder = input('Search');
  /** Shown in a searchable sheet while no item is. */
  readonly emptyText = input('No results');
  /** Whether no item shows, which the select works out from its items. */
  readonly empty = input(false, { transform: booleanAttribute });

  readonly searchField = viewChild(searchFieldType());

  protected readonly detents = computed(() =>
    this.searchable() ? LARGE : FIT,
  );

  /**
   * At full height the list fills what the sheet has left under the search
   * field; fitting its content, it scrolls once it's taller than the cap.
   */
  protected readonly listClass = computed(() =>
    this.searchable() ? 'flex-1' : '',
  );

  protected readonly listStyle = computed(() =>
    this.searchable() ? null : 'max-height: 300px;',
  );

  protected readonly showsEmpty = computed(
    () => this.searchable() && this.empty(),
  );

  /**
   * The keyboard's height while the search field has the focus. The sheet
   * runs to the bottom of the screen, under the keyboard.
   */
  protected readonly keyboardInset = computed(
    () => this.searchField()?.keyboardHeight() ?? 0,
  );

  #wasOpen = false;

  /**
   * Takes the keyboard from the search field as the sheet starts closing,
   * however it closes: an item chosen, Done, the backdrop, a drag, or code.
   * A hidden field can keep the focus on iOS, and the keyboard with it.
   */
  protected readonly blurOnClose = effect(() => {
    const open = this.open();
    if (this.#wasOpen && !open) {
      untracked(() => this.searchField()?.blur());
    }
    this.#wasOpen = open;
  });
}
