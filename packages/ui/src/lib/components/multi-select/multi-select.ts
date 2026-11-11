import {
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { type BaseLynxElement, LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { UiBadge } from '../badge/badge';
import { UiButton } from '../button/button';
import { UiCheckbox } from '../checkbox/checkbox';
import { UiSelectSheet, matchesQuery } from '../select/select-sheet';

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

/**
 * `UiMultiSelectItem`, for `contentChildren()`. A call rather than the class
 * itself: for a class, Angular's test build keeps an arrow function that
 * nothing calls, which an app's coverage report would show as uncovered.
 */
const multiSelectItem = () => UiMultiSelectItem;

/**
 * A field that opens a sheet of options with a checkbox each, and shows the
 * chosen ones as chips.
 *
 * Built like `ui-select`: the host is the field's column, its label above
 * the field, and takes the app's class, so a class on <ui-multi-select>
 * lands once, on the host (Angular gives a component's host every static
 * attribute the app writes on it). The placeholder is shown in a text and the
 * accessibility label belongs to the trigger, so the host drops its copies.
 * The sheet, its search and its filtering are `ui-select`'s (see
 * UiSelectSheet), with a header that names the field and closes the sheet.
 */
@Component({
  selector: 'ui-multi-select',
  imports: [LYNX_ELEMENTS, UiBadge, UiButton, UiSelectSheet],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[attr.placeholder]': 'null',
    '[attr.accessibility-label]': 'null',
  },
  // `sheetOpen` and `query` are bound both ways by hand rather than with
  // `[()]`: for a two-way binding Angular also compiles a fallback that
  // assigns the field, which never runs for a signal and so shows as an
  // uncovered branch in an app's coverage report.
  template: `
    <!-- The trigger carries the label as its accessibility-label, so screen
         readers read it with the field. Hidden here, or VoiceOver and
         TalkBack would stop on it a second time. -->
    @if (label()) {
      <text
        class="text-sm font-medium text-foreground"
        accessibility-elements-hidden="true"
        >{{ label() }}</text
      >
    }
    <view [class]="fieldClass()">
      <!-- One accessibility element, a button, as ui-select's trigger is: its
           label names the field, and its value is the chosen items' labels,
           so VoiceOver says "Topics, News, Sport, button". The chips wrap
           onto more lines as they need, and the field grows with them. -->
      <view
        class="flex-1 flex-row items-center gap-2 px-3 py-2 flex"
        accessibility-element="true"
        accessibility-traits="button"
        [accessibility-label]="triggerLabel()"
        [accessibility-value]="triggerValue()"
        [lynxAccessibilityTraits]="{ disabled: disabled() }"
        (bindtap)="toggle()"
      >
        @if (chosenLabels().length > 0) {
          <view class="flex-1 flex-row flex-wrap gap-1.5 flex">
            <!-- By index: a value the app sets may hold an item twice. -->
            @for (chip of chosenLabels(); track $index) {
              <ui-badge variant="secondary" [animated]="false">{{
                chip
              }}</ui-badge>
            }
          </view>
        } @else {
          <text class="flex-1 text-sm text-muted-foreground">{{
            placeholder()
          }}</text>
        }
        <svg [attr.content]="chevronSvg" style="width: 16px; height: 16px;" />
      </view>
      <ui-select-sheet
        [open]="sheetOpen()"
        (openChange)="sheetOpen.set($event)"
        [searchable]="searchable()"
        [query]="query()"
        (queryChange)="query.set($event)"
        [searchPlaceholder]="searchPlaceholder()"
        [emptyText]="emptyText()"
        [empty]="noneShown()"
      >
        <!-- The sheet stays open while items are toggled, so it says what's
             being chosen and has a button to finish. -->
        <view
          ui-select-sheet-header
          class="flex-row items-center gap-3 px-4 pb-3 flex"
        >
          <text
            class="flex-1 text-base font-semibold text-foreground"
            accessibility-traits="header"
            >{{ sheetTitle() }}</text
          >
          <ui-button size="sm" (pressed)="close()">{{ doneLabel() }}</ui-button>
        </view>
        <ng-content />
      </ui-select-sheet>
    </view>
  `,
})
export class UiMultiSelect {
  /** The chosen items' values, in the order they were chosen. */
  readonly value = model<readonly string[]>([]);
  readonly placeholder = input('Select...');
  /**
   * The field's name, shown above it and as the sheet's title, and read by
   * screen readers as the trigger's label.
   */
  readonly label = input<string>('');
  /**
   * What a screen reader calls the field when it's shown without a label,
   * such as beside a label of the app's own. `label` wins when both are set.
   */
  readonly accessibilityLabel = input<string>('', {
    alias: 'accessibility-label',
  });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });
  /**
   * Shows a search field above the items. The sheet then opens at full
   * height, so the field sits clear of the keyboard, and the list fills it.
   */
  readonly searchable = input(false, { transform: booleanAttribute });
  /** The search field's text. Cleared when the sheet closes. */
  readonly query = model<string>('');
  /**
   * Hides the items whose label doesn't contain `query`, ignoring case.
   * Turn it off to show results of the app's own for `query` instead.
   */
  readonly filter = input(true, { transform: booleanAttribute });
  readonly searchPlaceholder = input('Search');
  /** Shown in a searchable sheet while no item is. */
  readonly emptyText = input('No results');
  /** The label of the button in the sheet's header that closes it. */
  readonly doneLabel = input('Done');

  /** Emits the new value every time an item is toggled. */
  readonly changed = output<readonly string[]>();

  protected readonly chevronSvg = CHEVRON_SVG;

  protected readonly sheetOpen = signal(false);

  // The projected items, so the field can show the chosen ones' labels.
  readonly itemRefs = contentChildren(multiSelectItem());

  /**
   * The chosen items' labels, in `value`'s order. A value no item has shows
   * as it is, as `ui-select` shows one.
   */
  protected readonly chosenLabels = computed(() => {
    const items = this.itemRefs();
    return this.value().map(
      (value) => items.find((i) => i.itemValue() === value)?.label() ?? value,
    );
  });

  /** What the field holds, as words: the chosen labels, or the placeholder. */
  readonly #displayText = computed(
    () => this.chosenLabels().join(', ') || this.placeholder(),
  );

  /**
   * The field's name for screen readers: the label, the accessibility label,
   * or, with neither, what the field holds, so the button still says what
   * it holds.
   */
  protected readonly triggerLabel = computed(
    () => this.label() || this.accessibilityLabel() || this.#displayText(),
  );

  /**
   * What the field holds, read after its name. Left out when the name is
   * that text already, or a screen reader would say it twice.
   */
  protected readonly triggerValue = computed(() =>
    this.label() || this.accessibilityLabel() ? this.#displayText() : null,
  );

  protected readonly sheetTitle = computed(
    () => this.label() || this.accessibilityLabel(),
  );

  /** Whether the search hides every item, for the sheet's empty text. */
  protected readonly noneShown = computed(
    () => !this.itemRefs().some((item) => this.shows(item.label())),
  );

  protected readonly hostClass = computed(() =>
    cn('flex-col gap-1.5 flex', this.userClass()),
  );

  /** As tall as `ui-select`'s field with one line of chips, and taller with more. */
  protected readonly fieldClass = computed(() =>
    cn(
      'min-h-10 flex-row rounded-md border border-input bg-background flex',
      this.disabled() && 'opacity-50',
    ),
  );

  /**
   * Whether an item with this label shows for the search text: always while
   * `filter` is off.
   */
  shows(label: string): boolean {
    return !this.filter() || matchesQuery(label, this.query());
  }

  /**
   * Chooses the value if it isn't chosen, adding it to the end of `value`,
   * and otherwise takes it out. The sheet stays open.
   */
  toggleValue(value: string): void {
    const current = this.value();
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.value.set(next);
    this.changed.emit(next);
  }

  toggle(): void {
    if (this.disabled()) return;
    this.sheetOpen.update((v) => !v);
  }

  open(): void {
    if (this.disabled()) return;
    this.sheetOpen.set(true);
  }

  close(): void {
    this.sheetOpen.set(false);
  }
}

/**
 * Each item is its host, a row with a checkbox at its leading edge, then any
 * projected content (an icon), then its label. The host is one accessibility
 * element, a button named by its label, and `selected` while chosen, as
 * UiSelectItem is.
 *
 * The checkbox toggles itself when it's the part tapped, and the tap goes on
 * to the row, which toggles the value: the binding then sets the checkbox to
 * the state it already has. A tap beside it toggles the value alone, and the
 * binding moves the checkbox. Either way it shows its check popping in or out.
 */
@Component({
  selector: 'ui-multi-select-item',
  imports: [LYNX_ELEMENTS, UiCheckbox],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'containerClass()',
    '[attr.accessibility-element]': "'true'",
    '[attr.accessibility-traits]': "'button'",
    '[attr.accessibility-label]': 'label()',
    '(bindtap)': 'onTap()',
  },
  template: `
    <ui-checkbox [checked]="isChosen()" />
    <ng-content />
    <text class="flex-1 py-3 text-sm text-foreground">{{ label() }}</text>
  `,
})
export class UiMultiSelectItem {
  readonly #select = inject(UiMultiSelect);
  readonly #host: BaseLynxElement = inject(ElementRef).nativeElement;

  readonly itemValue = input.required<string>({ alias: 'value' });
  readonly label = input.required<string>();
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly isChosen = computed(() =>
    this.#select.value().includes(this.itemValue()),
  );

  /**
   * A chosen item is `selected` to a screen reader, as its checkbox shows.
   * Added to the host's own `button` trait, as UiSelectItem does.
   */
  protected readonly markingSelected = effect(() => {
    this.#host.setAccessibilityTrait('selected', this.isChosen());
  });

  /**
   * The checkbox's 44pt tap target insets its box, so the row's own inset
   * is smaller: the box lines up with the search field and the header. An
   * item the search hides takes no room.
   */
  protected readonly containerClass = computed(() =>
    cn(
      'flex-row items-center gap-3 pl-1 pr-4 flex',
      !this.#select.shows(this.label()) && 'hidden',
      this.userClass(),
    ),
  );

  protected onTap(): void {
    this.#select.toggleValue(this.itemValue());
  }
}
