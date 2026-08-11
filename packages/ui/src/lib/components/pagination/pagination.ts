import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  model,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';

const CHEVRON_LEFT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const CHEVRON_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

@Component({
  selector: 'ui-pagination',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <view [class]="navButtonClass(page() <= 1)" (bindtap)="prev()">
        <svg
          [attr.content]="chevronLeftSvg"
          style="width: 16px; height: 16px;"
        />
      </view>

      @for (item of visiblePages(); track item.key) {
        @if (item.type === 'page') {
          <view
            [class]="pageButtonClass(item.value === page())"
            (bindtap)="goTo(item.value)"
          >
            <text [class]="pageTextClass(item.value === page())">{{
              item.value
            }}</text>
          </view>
        } @else {
          <view class="h-8 w-8 items-center flex justify-center">
            <text class="text-xs text-muted-foreground">...</text>
          </view>
        }
      }

      <view [class]="navButtonClass(page() >= totalPages())" (bindtap)="next()">
        <svg
          [attr.content]="chevronRightSvg"
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
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly chevronLeftSvg = CHEVRON_LEFT;
  protected readonly chevronRightSvg = CHEVRON_RIGHT;

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
