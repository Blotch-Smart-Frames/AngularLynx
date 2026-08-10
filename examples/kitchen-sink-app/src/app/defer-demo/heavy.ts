import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiIcon } from '../../components/ui/icon';
import { UiSeparator } from '../../components/ui/separator';

/**
 * The "expensive" component sitting behind every @defer block on this screen.
 *
 * It lives in its own file for one reason: Angular only code-splits a deferred
 * dependency into a separate chunk when that dependency is referenced
 * *exclusively* inside @defer blocks. DeferDemo imports this component and uses
 * it only in its @defer blocks, so the compiler rewrites the reference to a
 * dynamic `import('./heavy')` and keeps it out of the initial bundle — which is
 * exactly the behavior this demo is meant to make visible. Inlining this markup
 * into DeferDemo instead would defeat the whole point (nothing to split out).
 *
 * Two render modes so the same chunk can headline the interactive card and also
 * appear inline under the compact auto-trigger rows without doubling up chrome:
 *  - full (default) — a self-contained result panel with a stat readout.
 *  - compact        — a single row, for the tight timer/idle sections.
 *
 * `label` names how this instance was triggered ("manually", "on timer", …) so
 * every loaded state reads back the trigger that fetched it. Both inputs are
 * bound on a deferred component on purpose: it proves ordinary input bindings
 * survive Angular's dynamic-import rewrite of the @defer main block.
 */
@Component({
  selector: 'app-heavy',
  imports: [LYNX_ELEMENTS, UiBadge, UiIcon, UiSeparator],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
          <text class="text-sm font-medium text-foreground">Chunk loaded</text>
          <text class="text-xs text-muted-foreground">
            fetched {{ label() }}
          </text>
        </view>
        <ui-badge variant="secondary" [animated]="false">heavy.js</ui-badge>
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
                Chunk loaded
              </text>
              <text class="text-xs text-muted-foreground">
                fetched {{ label() }}
              </text>
            </view>
          </view>
          <ui-badge variant="secondary" [animated]="false">heavy.js</ui-badge>
        </view>

        <text class="text-sm text-muted-foreground">
          Angular fetched this component with a dynamic import() the moment the
          trigger fired — the initial bundle never paid for it.
        </text>

        <ui-separator />

        <view class="flex-col gap-2 flex">
          <view class="flex-row items-center flex justify-between">
            <text class="text-sm text-muted-foreground">Loaded via</text>
            <text class="text-sm font-medium text-foreground">import()</text>
          </view>
          <view class="flex-row items-center flex justify-between">
            <text class="text-sm text-muted-foreground">Initial bundle</text>
            <text class="text-sm font-medium text-foreground">unaffected</text>
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
