import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  model,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { injectIconColor } from '../icon/icon-theme';

const CHEVRON_LEFT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const CHEVRON_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

/**
 * What a screen reader says for a page button, unless `pageLabel` is set.
 */
const defaultPageLabel = (page: number, current: boolean): string =>
  current ? `Page ${page}, current page` : `Page ${page}`;

@Component({
  selector: 'ui-pagination',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // Each button is one accessibility element with a label: without them a
  // screen reader found the arrows unlabeled (they're only an SVG) and read
  // each number as plain text, with nothing saying it's a button or which page
  // is current. The "..." gaps are hidden, since they aren't controls.
  //
  // The chevrons are drawn in the theme's foreground, like the page numbers
  // next to them. An SVG can't read the text color classes, so the color is
  // resolved and written into the markup (see icon-theme.ts).
  template: `
    <view [class]="containerClass()">
      <view
        [class]="navButtonClass(page() <= 1)"
        [accessibility-element]="true"
        accessibility-traits="button"
        [accessibility-label]="previousLabel()"
        (bindtap)="prev()"
      >
        <svg
          [attr.content]="chevronLeftSvg()"
          style="width: 16px; height: 16px;"
        />
      </view>

      @for (item of visiblePages(); track item.key) {
        @if (item.type === 'page') {
          <view
            [class]="pageButtonClass(item.value === page())"
            [accessibility-element]="true"
            accessibility-traits="button"
            [accessibility-label]="
              pageLabel()(item.value, item.value === page())
            "
            (bindtap)="goTo(item.value)"
          >
            <text [class]="pageTextClass(item.value === page())">{{
              item.value
            }}</text>
          </view>
        } @else {
          <view
            class="h-8 w-8 items-center flex justify-center"
            [accessibility-elements-hidden]="true"
          >
            <text class="text-xs text-muted-foreground">...</text>
          </view>
        }
      }

      <view
        [class]="navButtonClass(page() >= totalPages())"
        [accessibility-element]="true"
        accessibility-traits="button"
        [accessibility-label]="nextLabel()"
        (bindtap)="next()"
      >
        <svg
          [attr.content]="chevronRightSvg()"
          style="width: 16px; height: 16px;"
        />
      </view>
    </view>
  `,
})
export class UiPagination {
  readonly page = model(1);
  readonly totalPages = input.required<number>();
  readonly siblingCount = input(1);
  /** Screen reader label for the previous arrow. */
  readonly previousLabel = input('Previous page');
  /** Screen reader label for the next arrow. */
  readonly nextLabel = input('Next page');
  /** Screen reader label for a page button, given its page and whether it's current. */
  readonly pageLabel =
    input<(page: number, current: boolean) => string>(defaultPageLabel);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #resolveColor = injectIconColor();
  // split/join, not replaceAll(): Lynx's main thread (PrimJS, ES2019) lacks it.
  protected readonly chevronLeftSvg = computed(() =>
    CHEVRON_LEFT.split('currentColor').join(this.#resolveColor(undefined)),
  );
  protected readonly chevronRightSvg = computed(() =>
    CHEVRON_RIGHT.split('currentColor').join(this.#resolveColor(undefined)),
  );

  // Sliding-window pagination algorithm:
  // Always shows page 1 and the last page. Around the current page, shows
  // `siblingCount` neighbors on each side. If there's a gap between page 1
  // and the window (or window and last page), an ellipsis is inserted.
  // The threshold `5 + siblings * 2` is the max pages that fit without
  // truncation: first + last + up to (2*siblings+1) window + 2 ellipsis slots.
  protected readonly visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.page();
    const siblings = this.siblingCount();

    if (total <= 5 + siblings * 2) {
      return Array.from({ length: total }, (_, i) => ({
        type: 'page' as const,
        value: i + 1,
        key: `p${i + 1}`,
      }));
    }

    const items: { type: 'page' | 'ellipsis'; value: number; key: string }[] =
      [];

    items.push({ type: 'page', value: 1, key: 'p1' });

    const rangeStart = Math.max(2, current - siblings);
    const rangeEnd = Math.min(total - 1, current + siblings);

    if (rangeStart > 2) {
      items.push({ type: 'ellipsis', value: 0, key: 'el' });
    }

    for (let i = rangeStart; i <= rangeEnd; i++) {
      items.push({ type: 'page', value: i, key: `p${i}` });
    }

    if (rangeEnd < total - 1) {
      items.push({ type: 'ellipsis', value: 0, key: 'er' });
    }

    items.push({ type: 'page', value: total, key: `p${total}` });
    return items;
  });

  protected readonly containerClass = computed(() =>
    cn('flex-row items-center gap-1 flex', this.userClass()),
  );

  protected navButtonClass(disabled: boolean): string {
    return cn(
      'h-10 w-10 items-center rounded-md flex justify-center',
      disabled && 'opacity-50',
    );
  }

  protected pageButtonClass(active: boolean): string {
    return cn(
      'h-10 w-10 items-center rounded-md flex justify-center',
      active ? 'bg-primary' : 'bg-transparent',
    );
  }

  protected pageTextClass(active: boolean): string {
    return cn(
      'text-sm font-medium',
      active ? 'text-primary-foreground' : 'text-foreground',
    );
  }

  protected prev(): void {
    if (this.page() > 1) {
      this.page.update((p) => p - 1);
    }
  }

  protected next(): void {
    if (this.page() < this.totalPages()) {
      this.page.update((p) => p + 1);
    }
  }

  protected goTo(p: number): void {
    this.page.set(p);
  }
}
