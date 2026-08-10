import { Component, computed, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxTransition,
  LynxTransitionGroup,
} from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiCard } from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

type Item = { id: number; title: string };

/** A named `@keyframes` preset. `name` maps to `.{name}-enter`/`.{name}-leave`. */
type Preset = { name: string; label: string; blurb: string };

/**
 * The single-element panel plays for 360ms; must match the CSS animation length
 * because the background thread has no `animationend` bridge (see LynxTransition).
 */
const PANEL_DURATION = 360;
const LIST_DURATION = 300;

@Component({
  selector: 'app-transition-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    LynxTransition,
    LynxTransitionGroup,
    DemoScreen,
    UiCard,
    UiText,
    UiBadge,
    UiButton,
    UiIcon,
  ],
  styleUrl: './transition-demo.css',
  template: `
    <app-demo-screen
      heading="Transitions"
      category="Motion"
      description="Enter & leave animations for single elements and lists, driven by CSS @keyframes."
    >
      <!-- ── Single element ─────────────────────────────────────────────────
           lynx-transition mounts with an enter animation and stays mounted
           through its leave animation before unmounting. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <ui-text variant="large">Single element</ui-text>
          <ui-badge variant="outline">lynx-transition</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Pick a style, then toggle. The panel animates in on mount and animates
          out before it unmounts.
        </ui-text>

        <!-- Style picker: each chip selects the @keyframes preset by name. -->
        <view class="mb-4 flex-row flex-wrap gap-2 flex">
          @for (preset of presets; track preset.name) {
            <view
              class="rounded-full border px-3 py-1.5 {{
                preset.name === selected()
                  ? 'border-primary bg-primary'
                  : 'border-border bg-transparent'
              }}"
              (bindtap)="selectPreset(preset.name)"
            >
              <text
                class="text-xs font-medium {{
                  preset.name === selected()
                    ? 'text-primary-foreground'
                    : 'text-foreground'
                }}"
              >
                {{ preset.label }}
              </text>
            </view>
          }
        </view>

        <!-- Preview stage. A fixed min-height keeps the layout steady whether the
             panel is mounted or not, so toggling doesn't shift the card. -->
        <view
          class="mb-3 min-h-[92px] rounded-lg border border-dashed border-border bg-muted p-3 flex justify-center"
        >
          <lynx-transition
            [show]="showPanel()"
            [name]="selected()"
            [duration]="panelDuration"
            (afterLeave)="onPanelHidden()"
          >
            <view
              class="flex-row items-center gap-3 rounded-lg border border-border bg-card p-4 flex"
            >
              <view
                class="h-10 w-10 items-center rounded-full bg-secondary flex justify-center"
              >
                <ui-icon name="star" size="sm" />
              </view>
              <view class="flex-1 flex-col flex">
                <text class="text-sm font-semibold text-foreground">
                  Hello from Lynx
                </text>
                <text class="text-xs text-muted-foreground">
                  Entered with the “{{ selectedLabel() }}” transition
                </text>
              </view>
            </view>
          </lynx-transition>

          @if (!panelMounted()) {
            <view class="items-center flex">
              <ui-text variant="muted">Hidden — tap Show panel</ui-text>
            </view>
          }
        </view>

        <ui-button (pressed)="togglePanel()">
          {{ showPanel() ? 'Hide panel' : 'Show panel' }}
        </ui-button>
      </ui-card>

      <!-- ── Lists ──────────────────────────────────────────────────────────
           lynx-transition-group diffs the list by trackBy and animates each
           added or removed row independently. -->
      <ui-card class="p-4">
        <view class="mb-1 flex-row items-center flex justify-between">
          <ui-text variant="large">Lists</ui-text>
          <ui-badge variant="outline">lynx-transition-group</ui-badge>
        </view>
        <ui-text variant="muted" class="mb-4">
          Rows slide in when added and slide out when removed. Clearing all at
          once plays every leave animation together.
        </ui-text>

        <view class="mb-4 flex-row gap-2 flex">
          <ui-button class="flex-1" (pressed)="addItem()">Add item</ui-button>
          <ui-button
            class="flex-1"
            variant="outline"
            [disabled]="items().length === 0"
            (pressed)="clearAll()"
          >
            Clear all
          </ui-button>
        </view>

        <lynx-transition-group
          [each]="items()"
          [trackBy]="trackById"
          name="list"
          [duration]="listDuration"
        >
          <ng-template let-item>
            <view
              class="mb-2 flex-row items-center gap-3 rounded-lg border border-border bg-card p-3 flex"
            >
              <view
                class="h-8 w-8 items-center rounded-full bg-secondary flex justify-center"
              >
                <text class="text-xs font-semibold text-secondary-foreground">
                  {{ item.id }}
                </text>
              </view>
              <view class="flex-1 flex-col flex">
                <text class="text-sm font-medium text-foreground">
                  {{ item.title }}
                </text>
                <text class="text-xs text-muted-foreground">
                  tracked by id · {{ item.id }}
                </text>
              </view>
              <view
                class="h-8 w-8 items-center rounded-md bg-muted flex justify-center"
                (bindtap)="removeItem(item)"
              >
                <ui-icon name="x" size="sm" />
              </view>
            </view>
          </ng-template>
        </lynx-transition-group>

        @if (items().length === 0) {
          <view
            class="items-center rounded-lg border border-dashed border-border py-8 flex justify-center"
          >
            <ui-text variant="muted">No items — tap Add item</ui-text>
          </view>
        }
      </ui-card>

      <!-- ── How it works ───────────────────────────────────────────────────
           A short mental model so the demo is informative, not just pretty. -->
      <ui-card class="p-4">
        <view class="mb-2 flex-row items-center gap-2 flex">
          <ui-icon name="info" size="sm" />
          <ui-text variant="large">How it works</ui-text>
        </view>
        <ui-text variant="muted" class="mb-4">
          Angular runs on Lynx's background thread, which has no reliable frame
          boundary — so a two-phase CSS transition never gets its paint gap.
          Instead each phase applies a single @keyframes class the native engine
          plays from 0%.
        </ui-text>
        <view class="flex-col gap-2 flex">
          <view class="flex-row items-center gap-2 flex">
            <ui-badge>enter</ui-badge>
            <ui-text variant="muted">&lt;name&gt;-enter plays on mount</ui-text>
          </view>
          <view class="flex-row items-center gap-2 flex">
            <ui-badge variant="secondary">leave</ui-badge>
            <ui-text variant="muted"
              >&lt;name&gt;-leave plays, then it unmounts
            </ui-text>
          </view>
        </view>
      </ui-card>
    </app-demo-screen>
  `,
})
export class TransitionDemo {
  protected readonly panelDuration = PANEL_DURATION;
  protected readonly listDuration = LIST_DURATION;

  /** Selectable single-element presets; each has matching CSS in the stylesheet. */
  protected readonly presets: readonly Preset[] = [
    { name: 'fade', label: 'Fade', blurb: 'opacity + drift' },
    { name: 'scale', label: 'Scale', blurb: 'pop in/out' },
    { name: 'slide', label: 'Slide', blurb: 'horizontal' },
    { name: 'rise', label: 'Rise', blurb: 'from below' },
  ];

  readonly selected = signal(this.presets[0].name);
  readonly showPanel = signal(false);
  /** Tracks whether the panel is on screen (stays true through its leave animation). */
  readonly panelMounted = signal(false);

  protected readonly selectedLabel = computed(
    () => this.presets.find((p) => p.name === this.selected())?.label ?? '',
  );

  readonly items = signal<Item[]>([
    { id: 1, title: 'New message' },
    { id: 2, title: 'Photo uploaded' },
    { id: 3, title: 'Payment received' },
  ]);
  #nextId = 4;

  /** Sample labels cycled through as items are added, so the list reads like real data. */
  readonly #titlePool = [
    'Friend request',
    'Comment added',
    'Task completed',
    'Meeting reminder',
    'File shared',
    'New follower',
  ];

  readonly trackById = (item: Item) => item.id;

  /**
   * Every handler defers its signal update via setTimeout so the write doesn't
   * happen synchronously inside a Lynx native event handler (bindtap / the
   * UiButton `pressed` output, which emits inside bindtap). Updating directly
   * inside the handler can flush the renderer while the native event is still on
   * the call stack, which breaks Lynx's main-thread frame pipeline.
   */
  selectPreset(name: string): void {
    setTimeout(() => this.selected.set(name), 0);
  }

  togglePanel(): void {
    setTimeout(() => {
      const next = !this.showPanel();
      this.showPanel.set(next);
      // Reveal the panel immediately on show; on hide it stays mounted until the
      // leave animation completes (see onPanelHidden).
      if (next) this.panelMounted.set(true);
    }, 0);
  }

  onPanelHidden(): void {
    // Fires from LynxTransition's leave timer (not a native event handler), so a
    // direct signal write is safe here.
    this.panelMounted.set(false);
  }

  addItem(): void {
    setTimeout(() => {
      const id = this.#nextId++;
      const title = this.#titlePool[(id - 1) % this.#titlePool.length];
      this.items.update((items) => [...items, { id, title }]);
    }, 0);
  }

  removeItem(item: Item): void {
    setTimeout(() => {
      this.items.update((items) => items.filter((i) => i.id !== item.id));
    }, 0);
  }

  clearAll(): void {
    setTimeout(() => this.items.set([]), 0);
  }
}
