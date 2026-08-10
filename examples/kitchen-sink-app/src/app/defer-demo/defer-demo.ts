import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { UiSeparator } from '../../components/ui/separator';
import { UiSpinner } from '../../components/ui/spinner';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';
import { Heavy } from './heavy';

/** The three states a @defer block moves through, in order. */
type Stage = 'placeholder' | 'loading' | 'loaded';

/**
 * How long the manual card sits in its @loading state on the FIRST load.
 *
 * The live stepper can't hook @defer's internal lifecycle (it exposes no output
 * to bind to), so we mirror the timing ourselves. This MUST stay in sync with
 * the `@loading (minimum 900ms)` literal in the template below — the loading
 * block shows for at least that long, so we flip the stepper to "loaded" after
 * the same window. On later loads the chunk is already cached and there is no
 * loading phase, so we skip this wait entirely (see showManual).
 */
const MANUAL_LOADING_MS = 900;

/**
 * Defer demo — showcases Angular's @defer control-flow block on Lynx.
 *
 * The screen tells one story in three cards: explain the lifecycle, let you
 * drive it by hand, then show it firing automatically.
 *
 *  1. Lifecycle — the placeholder → loading → loaded states, and the core idea
 *     (@defer ships the component in its own JS chunk, fetched on demand).
 *  2. Manual (`when`) — the interactive centerpiece. A live stepper tracks the
 *     current state as you Load and Reset. Resetting re-shows the placeholder
 *     but the chunk stays cached, so the second load skips loading entirely.
 *  3. Automatic (`on timer` / `on idle`) — two compact rows that load with no
 *     interaction, sharing the very same heavy.js chunk.
 *
 * Only triggers that actually fire on Lynx are shown. Deliberately omitted:
 * `on interaction` and `on hover`. Angular implements those by registering DOM
 * `click`/`keydown`/`mouseenter` listeners through Renderer2.listen(), but
 * Lynx's element only understands `bind*`/`catch*` prefixed events — any other
 * name is silently dropped, so those triggers would never fire and their
 * placeholders would hang forever. `on idle` works because Angular backs it
 * with requestIdleCallback falling back to setTimeout, and Lynx has setTimeout.
 *
 * `Heavy` is imported normally (not lazily) here on purpose: because it is
 * referenced *only* inside @defer blocks, Angular's compiler is what turns it
 * into a dynamic import() and splits it into its own chunk. See heavy.ts.
 */
@Component({
  selector: 'app-defer-demo',
  hostDirectives: [ScreenHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    Heavy,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiBadge,
    UiButton,
    UiIcon,
    UiSeparator,
    UiSpinner,
  ],
  template: `
    <app-demo-screen
      heading="Defer"
      category="Platform"
      description="@defer keeps a component out of the initial bundle, then lazy-loads it into its own JS chunk when a trigger fires."
    >
      <!-- ── 1. The lifecycle: concept + the three states ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="info" size="sm" />
            <ui-card-title class="text-lg">The lifecycle</ui-card-title>
          </view>
          <ui-card-description>
            A deferred block moves through three states. Angular ships the
            component in its own chunk and fetches it with a dynamic import()
            the moment a trigger fires — the initial bundle never pays for it.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <view class="flex-row items-center gap-3 flex">
            <view
              class="h-8 w-8 items-center rounded-full bg-muted flex justify-center"
            >
              <ui-icon name="circle" size="sm" />
            </view>
            <view class="flex-1 flex-col flex">
              <text class="text-sm font-medium text-foreground"
                >&#64;placeholder
              </text>
              <text class="text-xs text-muted-foreground">
                Shown until the trigger fires
              </text>
            </view>
          </view>
          <view class="flex-row items-center gap-3 flex">
            <view
              class="h-8 w-8 items-center rounded-full bg-muted flex justify-center"
            >
              <ui-icon name="loader" size="sm" />
            </view>
            <view class="flex-1 flex-col flex">
              <text class="text-sm font-medium text-foreground"
                >&#64;loading
              </text>
              <text class="text-xs text-muted-foreground">
                While the chunk is fetched over the network
              </text>
            </view>
          </view>
          <view class="flex-row items-center gap-3 flex">
            <view
              class="h-8 w-8 items-center rounded-full bg-green-500 flex justify-center"
            >
              <ui-icon name="check" size="sm" color="#ffffff" />
            </view>
            <view class="flex-1 flex-col flex">
              <text class="text-sm font-medium text-foreground">loaded</text>
              <text class="text-xs text-muted-foreground">
                The real component, now on screen
              </text>
            </view>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── 2. Manual (when): the interactive centerpiece ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="plus" size="sm" />
              <ui-card-title class="text-lg">Manual trigger</ui-card-title>
            </view>
            <ui-badge variant="outline" [animated]="false">when</ui-badge>
          </view>
          <ui-card-description>
            Loads only after a signal you control flips true. Reset it and the
            placeholder returns — but the chunk stays cached, so the second load
            is instant.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-4 p-4 pt-0 flex">
          <!-- Live stepper: highlights the state the block is currently in. -->
          <view class="flex-row items-center gap-2 flex">
            @for (step of steps; track step.key) {
              <view [class]="chipClass(step.key)">
                <text [class]="chipTextClass(step.key)">{{ step.label }}</text>
              </view>
              @if (!$last) {
                <ui-icon name="chevron-right" size="xs" />
              }
            }
          </view>

          @defer (when deferManual()) {
            <app-heavy label="manually" />
          } @placeholder {
            <view
              class="flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted p-4 flex"
            >
              <view
                class="h-12 w-12 items-center rounded-full bg-background flex justify-center"
              >
                <ui-icon name="plus" size="md" />
              </view>
              <view class="flex-col items-center gap-1 flex">
                <text class="text-sm font-medium text-foreground">
                  Not loaded yet
                </text>
                <text class="text-xs text-muted-foreground">
                  Tap "Load widget" to fetch heavy.js
                </text>
              </view>
            </view>
          } @loading (minimum 900ms) {
            <view
              class="flex-col items-center gap-3 rounded-lg border border-border bg-muted p-4 flex"
            >
              <ui-spinner size="md" />
              <text class="text-sm text-muted-foreground">
                Fetching heavy.js…
              </text>
            </view>
          } @error {
            <view
              class="flex-row items-center gap-2 rounded-lg border border-destructive bg-destructive-subtle p-4 flex"
            >
              <ui-icon name="alert-triangle" size="sm" />
              <text class="text-sm text-destructive">Failed to load chunk</text>
            </view>
          }

          @if (deferManual()) {
            <ui-button
              class="self-start"
              variant="outline"
              size="sm"
              (pressed)="resetManual()"
            >
              Reset
            </ui-button>
          } @else {
            <ui-button class="self-start" size="sm" (pressed)="showManual()">
              Load widget
            </ui-button>
          }
        </ui-card-content>
      </ui-card>

      <!-- ── 3. Automatic (timer / idle): two compact rows, same chunk ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="loader" size="sm" />
            <ui-card-title class="text-lg">Automatic triggers</ui-card-title>
          </view>
          <ui-card-description>
            Some triggers need no interaction — they fire on their own. Both
            share the same heavy.js chunk as the manual demo above.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-4 p-4 pt-0 flex">
          <!-- on timer: auto-loads a fixed delay after the block renders. -->
          <view class="flex-col gap-2 flex">
            <view class="flex-row items-center flex justify-between">
              <view class="flex-row items-center gap-2 flex">
                <ui-icon name="loader" size="sm" />
                <text class="text-sm font-medium text-foreground">Timer</text>
              </view>
              <ui-badge variant="outline" [animated]="false">
                on timer(3s)
              </ui-badge>
            </view>
            @defer (on timer(3000ms)) {
              <app-heavy [compact]="true" label="on timer" />
            } @placeholder {
              <view
                class="flex-row items-center gap-3 rounded-lg border border-dashed border-border bg-muted p-3 flex"
              >
                <ui-icon name="loader" size="sm" />
                <text class="text-sm text-muted-foreground">
                  Auto-loads 3s after render…
                </text>
              </view>
            } @loading {
              <view
                class="flex-row items-center gap-3 rounded-lg border border-border bg-muted p-3 flex"
              >
                <ui-spinner size="sm" />
                <text class="text-sm text-muted-foreground">
                  Fetching heavy.js…
                </text>
              </view>
            }
          </view>

          <ui-separator />

          <!-- on idle: loads on the next idle frame — ideal for below-the-fold. -->
          <view class="flex-col gap-2 flex">
            <view class="flex-row items-center flex justify-between">
              <view class="flex-row items-center gap-2 flex">
                <ui-icon name="ellipsis" size="sm" />
                <text class="text-sm font-medium text-foreground">Idle</text>
              </view>
              <ui-badge variant="outline" [animated]="false">on idle</ui-badge>
            </view>
            @defer (on idle) {
              <app-heavy [compact]="true" label="on idle" />
            } @placeholder {
              <view
                class="flex-row items-center gap-3 rounded-lg border border-dashed border-border bg-muted p-3 flex"
              >
                <ui-icon name="ellipsis" size="sm" />
                <text class="text-sm text-muted-foreground">
                  Waits for an idle frame…
                </text>
              </view>
            } @loading {
              <view
                class="flex-row items-center gap-3 rounded-lg border border-border bg-muted p-3 flex"
              >
                <ui-spinner size="sm" />
                <text class="text-sm text-muted-foreground">
                  Fetching heavy.js…
                </text>
              </view>
            }
          </view>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class DeferDemo {
  /** Drives the `@defer (when …)` block in the manual-trigger card. */
  readonly deferManual = signal(false);

  /** Current lifecycle state, mirrored for the live stepper. */
  readonly stage = signal<Stage>('placeholder');

  /**
   * Whether heavy.js has been fetched at least once this session. After the
   * first load Angular keeps the chunk in memory, so re-showing the block skips
   * the loading phase — we track that to keep the stepper honest.
   */
  #chunkFetched = false;

  /** Ordered steps rendered by the live stepper. */
  protected readonly steps: readonly { key: Stage; label: string }[] = [
    { key: 'placeholder', label: 'Placeholder' },
    { key: 'loading', label: 'Loading' },
    { key: 'loaded', label: 'Loaded' },
  ];

  showManual(): void {
    // Defer the signal writes out of the native `bindtap` callback (UiButton
    // emits `pressed` synchronously inside its tap handler). Flipping the
    // condition here also mounts the deferred subtree; mutating the element
    // tree while a Lynx worklet callback is still on the stack crashes the
    // main-thread frame pipeline. setTimeout(0) lets the native event unwind
    // first. See App.navigateTo() for the same pattern.
    setTimeout(() => {
      this.deferManual.set(true);
      if (this.#chunkFetched) {
        // Chunk already in memory — Angular renders the component immediately
        // with no @loading phase, so the stepper jumps straight to loaded.
        this.stage.set('loaded');
      } else {
        this.stage.set('loading');
        setTimeout(() => {
          this.#chunkFetched = true;
          this.stage.set('loaded');
        }, MANUAL_LOADING_MS);
      }
    }, 0);
  }

  resetManual(): void {
    // Same reasoning as showManual() — this tears the deferred subtree back down.
    setTimeout(() => {
      this.deferManual.set(false);
      this.stage.set('placeholder');
    }, 0);
  }

  /**
   * 'done' (a past state), 'active' (current), or 'todo' (a future state).
   */
  #stepStatus(step: Stage): 'done' | 'active' | 'todo' {
    const order: Stage[] = ['placeholder', 'loading', 'loaded'];
    const current = order.indexOf(this.stage());
    const index = order.indexOf(step);
    return index < current ? 'done' : index === current ? 'active' : 'todo';
  }

  protected chipClass(step: Stage): string {
    const status = this.#stepStatus(step);
    const bg =
      status === 'active'
        ? 'bg-primary'
        : status === 'done'
          ? 'bg-secondary'
          : 'bg-muted';
    return `items-center rounded-full px-3 py-1 flex ${bg}`;
  }

  protected chipTextClass(step: Stage): string {
    const status = this.#stepStatus(step);
    const color =
      status === 'active'
        ? 'text-primary-foreground'
        : status === 'done'
          ? 'text-secondary-foreground'
          : 'text-muted-foreground';
    return `text-xs font-medium ${color}`;
  }
}
