import {
  Component,
  ViewEncapsulation,
  booleanAttribute,
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
  //
  // The host is the list's box, and the <list> fills it. Angular gives a
  // component's host every static attribute the app writes on it, so a class
  // on <ui-list> lands on the host whatever the component does with its
  // `class` input: on the <list> as well, a margin or padding applied twice.
  // `grow` fills a box with a height of its own (`h-64`, `flex-1`), and a
  // box without one takes the list's, which `height` sets: the list keeps
  // its own height as its flex basis. Not `h-full`: a percentage height
  // doesn't reliably resolve on a flex item in Lynx.
  host: { '[class]': 'hostClass()' },
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
      class="grow"
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
  readonly bounces = input(true, { transform: booleanAttribute });
  readonly scrollBar = input(true, { transform: booleanAttribute });
  readonly nestedScroll = input(false, { transform: booleanAttribute });
  readonly sticky = input(false, { transform: booleanAttribute });
  readonly stickyOffset = input(0);
  readonly preloadBufferCount = input(0);
  readonly mainAxisGap = input('');
  readonly crossAxisGap = input('');
  readonly lowerThresholdItemCount = input(0);
  readonly upperThresholdItemCount = input(0);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly scrolledToStart = output<void>();
  readonly scrolledToEnd = output<void>();

  protected readonly hostClass = computed(() =>
    cn('w-full flex-col flex', this.userClass()),
  );

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
