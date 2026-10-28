import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { injectGlassDesign } from '../components/ui/glass';
import { UiIcon } from '../components/ui/icon';
import { UiLabel } from '../components/ui/label';
import {
  UiToggle,
  UiToggleGroup,
  UiToggleGroupItem,
} from '../components/ui/toggle';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiToggle,
    UiToggleGroup,
    UiToggleGroupItem,
    UiLabel,
    UiIcon,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Toggle</text>
        <text class="text-sm text-muted-foreground">
          A two-state button that can be toggled on or off, with support for
          groups.
        </text>

        <!-- Segmented: the platform's segmented control. On iOS 26 the thumb
             lifts into Liquid Glass as it slides, and can be dragged; before
             iOS 26 it's iOS 13's raised thumb, and on Android Material 3
             Expressive's connected button group. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Segmented</text>
          <text class="text-xs text-muted-foreground">{{ status() }}</text>
          <ui-toggle-group variant="segmented" [(value)]="range">
            @for (option of ranges; track option) {
              <ui-toggle-group-item
                [value]="option"
                [accessibility-label]="option"
              >
                <text class="text-[13px] text-foreground">{{ option }}</text>
              </ui-toggle-group-item>
            }
          </ui-toggle-group>
          <text class="text-xs text-muted-foreground">
            Range: {{ range() }}
          </text>

          <ui-label>Segments of different widths</ui-label>
          <ui-toggle-group variant="segmented" [(value)]="mailbox">
            <ui-toggle-group-item value="all" accessibility-label="All">
              <text class="text-[13px] text-foreground">All</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="unread" accessibility-label="Unread">
              <text class="text-[13px] text-foreground">Unread</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item
              value="flagged"
              class="flex-[2]"
              accessibility-label="Flagged and important"
            >
              <text class="text-[13px] text-foreground">
                Flagged and important
              </text>
            </ui-toggle-group-item>
          </ui-toggle-group>

          <ui-label
            >Several at once: each pressed segment has its thumb</ui-label
          >
          <ui-toggle-group
            variant="segmented"
            type="multiple"
            [(value)]="style"
          >
            @for (format of formats; track format.value) {
              <ui-toggle-group-item
                [value]="format.value"
                [accessibility-label]="format.label"
              >
                <ui-icon [name]="format.icon" size="sm" />
              </ui-toggle-group-item>
            }
          </ui-toggle-group>
        </view>

        <!-- Single toggle -->
        <view class="flex-col gap-2 flex">
          <ui-label>Single Toggle</ui-label>
          <view class="flex-row gap-2 flex">
            <ui-toggle [(pressed)]="bold">
              <text class="text-sm font-bold text-foreground">B</text>
            </ui-toggle>
            <ui-toggle [(pressed)]="italic">
              <text class="text-sm italic text-foreground">I</text>
            </ui-toggle>
            <ui-toggle [(pressed)]="underline">
              <text
                class="text-sm text-foreground"
                style="text-decoration: underline;"
              >
                U
              </text>
            </ui-toggle>
          </view>
        </view>

        <!-- Toggle group (single selection) -->
        <view class="flex-col gap-2 flex">
          <ui-label>Alignment (single select)</ui-label>
          <ui-toggle-group type="single" [(value)]="alignment">
            <ui-toggle-group-item value="left">
              <text class="text-sm text-foreground">Left</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="center">
              <text class="text-sm text-foreground">Center</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="right">
              <text class="text-sm text-foreground">Right</text>
            </ui-toggle-group-item>
          </ui-toggle-group>
        </view>

        <!-- Toggle group (multiple selection) -->
        <view class="flex-col gap-2 flex">
          <ui-label>Formatting (multi select)</ui-label>
          <ui-toggle-group type="multiple" [(value)]="formatting">
            <ui-toggle-group-item value="bold">
              <text class="text-sm font-bold text-foreground">B</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="italic">
              <text class="text-sm italic text-foreground">I</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="strike">
              <text
                class="text-sm text-foreground"
                style="text-decoration: line-through;"
              >
                S
              </text>
            </ui-toggle-group-item>
          </ui-toggle-group>
        </view>

        <!-- Outline variant -->
        <view class="flex-col gap-2 flex">
          <ui-label>Outline Variant</ui-label>
          <ui-toggle-group type="single" variant="outline" [(value)]="size">
            <ui-toggle-group-item value="sm">
              <text class="text-sm text-foreground">S</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="md">
              <text class="text-sm text-foreground">M</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="lg">
              <text class="text-sm text-foreground">L</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="xl">
              <text class="text-sm text-foreground">XL</text>
            </ui-toggle-group-item>
          </ui-toggle-group>
        </view>

        <!-- Disabled toggle group -->
        <view class="flex-col gap-2 flex">
          <ui-label [disabled]="true">Disabled Group</ui-label>
          <ui-toggle-group type="single" [disabled]="true" [value]="['left']">
            <ui-toggle-group-item value="left">
              <text class="text-sm text-foreground">Left</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="center">
              <text class="text-sm text-foreground">Center</text>
            </ui-toggle-group-item>
            <ui-toggle-group-item value="right">
              <text class="text-sm text-foreground">Right</text>
            </ui-toggle-group-item>
          </ui-toggle-group>
        </view>

        <!-- Display current state -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">State</text>
          <text class="text-xs text-muted-foreground">
            Bold: {{ bold() }} | Italic: {{ italic() }} | Underline:
            {{ underline() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Alignment: {{ alignment() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Formatting: {{ formatting() }}
          </text>
          <text class="text-xs text-muted-foreground">Size: {{ size() }}</text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly ranges = ['Day', 'Week', 'Month', 'Year'];
  readonly range = signal<string[]>(['Week']);
  readonly mailbox = signal<string[]>(['all']);
  readonly formats = [
    { value: 'bold', label: 'Bold', icon: 'bold' },
    { value: 'quote', label: 'Quote', icon: 'quote' },
    { value: 'list', label: 'List', icon: 'list' },
    { value: 'code', label: 'Code', icon: 'code' },
  ] as const;
  readonly style = signal<string[]>(['bold']);

  /** What the segmented controls draw here, and the settings they follow. */
  readonly status = computed(() => {
    const on = (value: boolean) => (value ? 'on' : 'off');
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${on(this.#settings.reduceMotion())}`,
      `Reduce Transparency: ${on(this.#settings.reduceTransparency())}`,
      `Increase Contrast: ${on(this.#settings.increaseContrast())}`,
    ].join(' · ');
  });

  bold = signal(false);
  italic = signal(false);
  underline = signal(false);
  alignment = signal<string[]>(['left']);
  formatting = signal<string[]>([]);
  size = signal<string[]>(['md']);
}
