import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';

@Component({
  selector: 'ui-list',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // `|| undefined` on boolean attributes removes the attribute entirely when
  // false. Passing the string "false" is treated as truthy by Lynx's native
  // attribute parser, so absence is the only way to truly turn these off.
  template: `
    <list
      [attr.list-type]="listType()"
      [attr.span-count]="spanCount()"
      [attr.scroll-orientation]="orientation()"
      [attr.bounces]="bounces() || undefined"
      [attr.scroll-bar-enable]="scrollBar() || undefined"
      [attr.enable-nested-scroll]="nestedScroll() || undefined"
      [attr.sticky]="sticky() || undefined"
      [attr.sticky-offset]="stickyOffset()"
      [attr.preload-buffer-count]="preloadBufferCount()"
      [attr.list-main-axis-gap]="mainAxisGap()"
      [attr.list-cross-axis-gap]="crossAxisGap()"
      [attr.lower-threshold-item-count]="lowerThresholdItemCount()"
      [attr.upper-threshold-item-count]="upperThresholdItemCount()"
      [class]="listClass()"
      [style]="listStyle()"
      (bindscrolltoupper)="scrolledToStart.emit()"
      (bindscrolltolower)="scrolledToEnd.emit()"
    >
      <ng-content />
    </list>
  `,
})
export class UiList {
  readonly listType = input<'single' | 'flow' | 'waterfall'>('single');
  readonly spanCount = input(1);
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');
  readonly height = input<string>('');
  readonly bounces = input(true);
  readonly scrollBar = input(true);
  readonly nestedScroll = input(false);
  readonly sticky = input(false);
  readonly stickyOffset = input(0);
  readonly preloadBufferCount = input(0);
  readonly mainAxisGap = input('');
  readonly crossAxisGap = input('');
  readonly lowerThresholdItemCount = input(0);
  readonly upperThresholdItemCount = input(0);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly scrolledToStart = output<void>();
  readonly scrolledToEnd = output<void>();

  protected readonly listClass = computed(() => cn('w-full', this.userClass()));

  // Explicit height is required for list to scroll in Lynx
  protected readonly listStyle = computed(() => {
    const h = this.height();
    return h ? `height: ${h};` : '';
  });
}
