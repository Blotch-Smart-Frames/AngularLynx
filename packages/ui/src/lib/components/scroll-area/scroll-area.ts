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
  selector: 'ui-scroll-area',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // The booleans are property bindings to <scroll-view>'s inputs, which hand
  // Lynx a real `false`. They used to be `[attr.x]="x() || undefined"`, which
  // removed the attribute when false, and a missing attribute means Lynx's
  // default: on, for `bounces` and `scroll-bar-enable`. So neither could be
  // turned off. (`[attr.x]` would send the string "false" instead.)
  //
  // The host is the scroll area's box, and the <scroll-view> fills it.
  // Angular gives a component's host every static attribute the app writes
  // on it, so a class on <ui-scroll-area> lands on the host whatever the
  // component does with its `class` input: on the <scroll-view> as well, a
  // margin or padding applied twice. Padding the box insets the scroll view;
  // `contentClass` pads what scrolls. `grow` fills a box with a height of its
  // own (`h-64`, `flex-1`), and a box without one takes the scroll view's,
  // which `height` sets: the scroll view keeps its own height as its flex
  // basis. Not `h-full`: a percentage height doesn't reliably resolve on a
  // flex item in Lynx.
  host: { '[class]': 'hostClass()' },
  template: `
    <scroll-view
      [attr.scroll-orientation]="orientation()"
      [bounces]="bounces()"
      [scroll-bar-enable]="scrollBar()"
      [enable-nested-scroll]="nestedScroll()"
      [attr.upper-threshold]="upperThreshold()"
      [attr.lower-threshold]="lowerThreshold()"
      class="grow"
      [style]="scrollStyle()"
      (bindscrolltoupper)="scrolledToStart.emit()"
      (bindscrolltolower)="scrolledToEnd.emit()"
    >
      <view [class]="contentClass()">
        <ng-content />
      </view>
    </scroll-view>
  `,
})
export class UiScrollArea {
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');
  readonly height = input<string>('');
  readonly bounces = input(true, { transform: booleanAttribute });
  readonly scrollBar = input(true, { transform: booleanAttribute });
  readonly nestedScroll = input(false, { transform: booleanAttribute });
  readonly upperThreshold = input(0);
  readonly lowerThreshold = input(0);
  readonly userClass = input<string>('', { alias: 'class' });
  // Trailing underscore avoids a naming collision with the protected
  // `contentClass` computed property below; the public alias 'contentClass'
  // keeps the template API clean for consumers.
  readonly contentClass_ = input<string>('', { alias: 'contentClass' });

  readonly scrolledToStart = output<void>();
  readonly scrolledToEnd = output<void>();

  protected readonly hostClass = computed(() =>
    cn('w-full flex-col flex', this.userClass()),
  );

  // Explicit height is required for scroll-view to scroll in Lynx
  protected readonly scrollStyle = computed(() => {
    const h = this.height();
    return h ? `height: ${h};` : '';
  });

  protected readonly contentClass = computed(() =>
    cn(
      this.orientation() === 'vertical' ? 'flex-col flex' : 'flex-row flex',
      this.contentClass_(),
    ),
  );
}
