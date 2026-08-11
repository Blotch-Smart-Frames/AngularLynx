import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiToggle,
  UiToggleGroup,
  UiToggleGroupItem,
} from '../components/ui/toggle';
import { UiLabel } from '../components/ui/label';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiToggle, UiToggleGroup, UiToggleGroupItem, UiLabel],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Toggle</text>
        <text class="text-sm text-muted-foreground">
          A two-state button that can be toggled on or off, with support for
          groups.
        </text>

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
  bold = signal(false);
  italic = signal(false);
  underline = signal(false);
  alignment = signal<string[]>(['left']);
  formatting = signal<string[]>([]);
  size = signal<string[]>(['md']);
}
