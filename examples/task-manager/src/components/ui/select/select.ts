import {
  Component,
  ViewEncapsulation,
  computed,
  contentChildren,
  forwardRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { UiBottomSheet } from '../bottom-sheet/bottom-sheet';
import { cn } from '@blotch/dolan/utils/cn';

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

@Component({
  selector: 'ui-select',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiBottomSheet],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="triggerClass()" (bindtap)="toggle()">
      <text [class]="valueTextClass()">{{ displayText() }}</text>
      <svg [attr.content]="chevronSvg" style="width: 16px; height: 16px;" />
    </view>
    <ui-bottom-sheet [(open)]="sheetOpen">
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
  readonly disabled = input(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly changed = output<string>();

  protected readonly chevronSvg = CHEVRON_SVG;

  // Drives the shared bottom-sheet's `open` model via `[(open)]`. All the
  // overlay/animation/drag behavior lives in ui-bottom-sheet; select only
  // decides when the sheet is open.
  protected readonly sheetOpen = signal(false);

  // `forwardRef` is required because UiSelectItem is defined later in this
  // file — without it, the reference would be `undefined` at class-definition
  // time and contentChildren would silently query nothing.
  readonly itemRefs = contentChildren(forwardRef(() => UiSelectItem));

  protected readonly displayText = computed(() => {
    const val = this.value();
    if (!val) return this.placeholder();
    const item = this.itemRefs().find((i) => i.itemValue() === val);
    return item?.label() ?? val;
  });

  protected readonly triggerClass = computed(() =>
    cn(
      'h-10 flex-row items-center rounded-md border border-input bg-background px-3 py-2 flex justify-between',
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

@Component({
  selector: 'ui-select-item',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()" (bindtap)="onTap()">
      <text [class]="labelClass()">{{ label() }}</text>
      @if (isSelected()) {
        <svg [attr.content]="checkSvg" style="width: 16px; height: 16px;" />
      }
    </view>
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
