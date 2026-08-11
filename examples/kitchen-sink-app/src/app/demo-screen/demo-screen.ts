import { Component, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

/**
 * Shared frame that gives every demo route the same look: a scrollable page
 * with a heading, a category badge, and an optional description, followed by
 * the projected demo content.
 *
 * It owns the page scroll-view so individual demos only provide their content.
 * Demos that manage their own scrolling or full-height gestures (list,
 * scroll-view, refresh, gesture demos) must NOT use this wrapper — nesting a
 * scroll-view/list inside this scroll-view breaks Lynx's gesture routing.
 * Those screens compose `UiText` + `UiBadge` inline instead.
 */
@Component({
  selector: 'app-demo-screen',
  imports: [LYNX_ELEMENTS, UiText, UiBadge],
  // ScreenHost makes this frame's host claim its consumer route's full height so
  // the scroll-view below has a definite height to scroll within (see ScreenHost
  // and investigations/lynx-vs-web-differences.md). w-full pairs with the
  // flex-col host to span the full width.
  hostDirectives: [ScreenHost],
  template: `
    <scroll-view
      scroll-orientation="vertical"
      class="h-full w-full bg-background"
    >
      <view class="flex-col gap-4 p-4 flex">
        <view class="flex-col gap-2 flex">
          <ui-text variant="h3">{{ heading() }}</ui-text>
          @if (category()) {
            <ui-badge variant="secondary">{{ category() }}</ui-badge>
          }
          @if (description()) {
            <ui-text variant="muted">{{ description() }}</ui-text>
          }
        </view>
        <ng-content />
      </view>
    </scroll-view>
  `,
})
export class DemoScreen {
  readonly heading = input('');
  readonly category = input('');
  readonly description = input('');
}
