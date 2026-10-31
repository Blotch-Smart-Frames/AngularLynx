import {
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  contentChildren,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { UiBottomSheet } from '../bottom-sheet/bottom-sheet';
import { cn } from '../../utils/cn';

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/**
 * `UiSelectItem`, for `contentChildren()`. A call rather than the class
 * itself: for a class, Angular's test build keeps an arrow function that
 * nothing calls, which an app's coverage report would show as uncovered.
 */
const selectItem = () => UiSelectItem;

/**
 * The host is the field: its border, fill and height, and the app's class.
 * Angular gives a component's host every static attribute the app writes on
 * it, so a class on <ui-select> lands on the host whatever the component
 * does: passed on to a field inside it as well, a margin applied twice. The
 * trigger that takes the tap fills the field, beside the sheet rather than
 * around it, so a tap in the sheet doesn't bubble to the trigger. The
 * placeholder is shown in a text, so the host drops its copy: an element with
 * the attribute is a match for getByPlaceholderText.
 */
@Component({
  selector: 'ui-select',
  imports: [LYNX_ELEMENTS, UiBottomSheet],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClass()',
    '[attr.placeholder]': 'null',
  },
  // `sheetOpen` is bound both ways by hand rather than with `[(open)]`: for a
  // two-way binding Angular also compiles a fallback that assigns the field,
  // which never runs for a signal and so shows as an uncovered branch in an
  // app's coverage report.
  template: `
    <!-- The trigger fills the field: the row stretches it to its height. -->
    <view
      class="flex-1 flex-row items-center px-3 py-2 flex justify-between"
      (bindtap)="toggle()"
    >
      <text [class]="valueTextClass()">{{ displayText() }}</text>
      <svg [attr.content]="chevronSvg" style="width: 16px; height: 16px;" />
    </view>
    <ui-bottom-sheet [open]="sheetOpen()" (openChange)="sheetOpen.set($event)">
      <scroll-view scroll-orientation="vertical" style="max-height: 300px;">
        <view class="flex-col pb-4 flex">
          <ng-content />
        </view>
      </scroll-view>
    </ui-bottom-sheet>
  `,
})
export class UiSelect {
  readonly value = model<string>('');
  readonly placeholder = input('Select...');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<string>();

  protected readonly chevronSvg = CHEVRON_SVG;

  // Drives the shared bottom-sheet's `open` model. All the overlay/animation/
  // drag behavior lives in ui-bottom-sheet; select only decides when the sheet
  // is open.
  protected readonly sheetOpen = signal(false);

  // The projected items, so the trigger can show the chosen one's label.
  readonly itemRefs = contentChildren(selectItem());

  protected readonly displayText = computed(() => {
    const val = this.value();
    if (!val) return this.placeholder();
    const item = this.itemRefs().find((i) => i.itemValue() === val);
    return item?.label() ?? val;
  });

  protected readonly hostClass = computed(() =>
    cn(
      'h-10 flex-row rounded-md border border-input bg-background flex',
      this.disabled() && 'opacity-50',
      this.userClass(),
    ),
  );

  protected readonly valueTextClass = computed(() => {
    const val = this.value();
    return cn(
      'flex-1 text-sm',
      val ? 'text-foreground' : 'text-muted-foreground',
    );
  });

  select(value: string): void {
    this.value.set(value);
    this.changed.emit(value);
    this.close();
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
 * Each item is its host, styled through `host` (see UiSelect).
 */
@Component({
  selector: 'ui-select-item',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'containerClass()',
    '(bindtap)': 'onTap()',
  },
  template: `
    <text [class]="labelClass()">{{ label() }}</text>
    @if (isSelected()) {
      <svg [attr.content]="checkSvg" style="width: 16px; height: 16px;" />
    }
  `,
})
export class UiSelectItem {
  readonly #select = inject(UiSelect);

  readonly itemValue = input.required<string>({ alias: 'value' });
  readonly label = input.required<string>();
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly checkSvg = CHECK_SVG;

  protected readonly isSelected = computed(
    () => this.#select.value() === this.itemValue(),
  );

  protected readonly containerClass = computed(() =>
    cn(
      'flex-row items-center px-4 py-3 flex justify-between',
      this.isSelected() && 'bg-accent',
      this.userClass(),
    ),
  );

  protected readonly labelClass = computed(() => cn('text-sm text-foreground'));

  protected onTap(): void {
    this.#select.select(this.itemValue());
  }
}
