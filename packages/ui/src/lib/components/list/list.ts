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
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // The booleans are property bindings to <list>'s inputs, which hand Lynx a
  // real `false`. They used to be `[attr.x]="x() || undefined"`, which removed
  // the attribute when false, and a missing attribute means Lynx's default: on,
  // for `bounces` and `scroll-bar-enable`. So neither could be turned off.
  // (`[attr.x]` would send the string "false" instead.)
  template: `
    <list
      [attr.list-type]="listType()"
      [attr.span-count]="spanCount()"
      [attr.scroll-orientation]="orientation()"
      [bounces]="bounces()"
      [scroll-bar-enable]="scrollBar()"
      [enable-nested-scroll]="nestedScroll()"
      [sticky]="sticky()"
      [attr.sticky-offset]="stickyOffset()"
      [attr.preload-buffer-count]="preloadBufferCount()"
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

  // Explicit height is required for list to scroll in Lynx. The gaps go here
  // too: they're CSS properties that Lynx's list reads from its style, and as
  // attributes they did nothing.
  protected readonly listStyle = computed(() =>
    [
      this.height() && `height: ${this.height()};`,
      this.mainAxisGap() && `list-main-axis-gap: ${this.mainAxisGap()};`,
      this.crossAxisGap() && `list-cross-axis-gap: ${this.crossAxisGap()};`,
    ]
      .filter(Boolean)
      .join(' '),
  );
}
