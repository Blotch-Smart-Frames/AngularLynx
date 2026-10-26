import { Component, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiIcon } from '../../components/ui/icon';
import { UiSeparator } from '../../components/ui/separator';

/**
 * The "expensive" component sitting behind every @defer block on this screen.
 *
 * It lives in its own file for one reason: Angular only defers loading a
 * dependency when that dependency is referenced *exclusively* inside @defer
 * blocks. DeferDemo imports this component and uses it only in its @defer
 * blocks, so the compiler rewrites the reference to a dynamic
 * `import('./heavy')`. On the web that becomes a separate chunk. Lynx's default
 * build keeps it in the bundle, so here the import resolves at once and @defer
 * only delays creating the views.
 *
 * Two render modes so the same component can headline the interactive card and also
 * appear inline under the compact auto-trigger rows without doubling up chrome:
 *  - full (default) — a self-contained result panel with a stat readout.
 *  - compact        — a single row, for the tight timer/idle sections.
 *
 * `label` names how this instance was triggered ("manually", "on timer", …) so
 * every loaded state reads back the trigger that rendered it. Both inputs are
 * bound on a deferred component on purpose: it proves ordinary input bindings
 * survive Angular's dynamic-import rewrite of the @defer main block.
 */
@Component({
  selector: 'app-heavy',
  imports: [LYNX_ELEMENTS, UiBadge, UiIcon, UiSeparator],
  template: `
    @if (compact()) {
      <view
        class="flex-row items-center gap-3 rounded-lg border border-border bg-muted p-3 flex"
      >
        <view
          class="h-7 w-7 items-center rounded-full bg-green-500 flex justify-center"
        >
          <ui-icon name="check" size="xs" color="#ffffff" />
        </view>
        <view class="flex-1 flex-col flex">
          <text class="text-sm font-medium text-foreground">Loaded</text>
          <text class="text-xs text-muted-foreground">
            rendered {{ label() }}
          </text>
        </view>
        <ui-badge variant="secondary" [animated]="false">heavy.ts</ui-badge>
      </view>
    } @else {
      <view
        class="flex-col gap-3 rounded-lg border border-border bg-muted p-4 flex"
      >
        <view class="flex-row items-center flex justify-between">
          <view class="flex-row items-center gap-2 flex">
            <view
              class="h-8 w-8 items-center rounded-full bg-green-500 flex justify-center"
            >
              <ui-icon name="check" size="sm" color="#ffffff" />
            </view>
            <view class="flex-col flex">
              <text class="text-base font-semibold text-foreground">
                Loaded
              </text>
              <text class="text-xs text-muted-foreground">
                rendered {{ label() }}
              </text>
            </view>
          </view>
          <ui-badge variant="secondary" [animated]="false">heavy.ts</ui-badge>
        </view>

        <text class="text-sm text-muted-foreground">
          Angular created this component the moment the trigger fired. Its code
          was already in the bundle; only creating its views waited.
        </text>

        <ui-separator />

        <view class="flex-col gap-2 flex">
          <view class="flex-row items-center flex justify-between">
            <text class="text-sm text-muted-foreground">Code</text>
            <text class="text-sm font-medium text-foreground"
              >in the bundle</text
            >
          </view>
          <view class="flex-row items-center flex justify-between">
            <text class="text-sm text-muted-foreground">Views created</text>
            <text class="text-sm font-medium text-foreground">on trigger</text>
          </view>
          <view class="flex-row items-center flex justify-between">
            <text class="text-sm text-muted-foreground">Trigger</text>
            <text class="text-sm font-medium text-foreground">{{
              label()
            }}</text>
          </view>
        </view>
      </view>
    }
  `,
})
export class Heavy {
  /** How this instance was triggered — surfaced in the loaded state. */
  readonly label = input('on demand');
  /** Render as a single row (for the tight auto-trigger sections). */
  readonly compact = input(false);
}
