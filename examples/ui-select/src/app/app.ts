import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiSelect, UiSelectItem } from '../components/ui/select';
import { UiLabel } from '../components/ui/label';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiSelect, UiSelectItem, UiLabel],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Select</text>
        <text class="text-sm text-muted-foreground">
          A dropdown menu for selecting a single value from a list of options.
        </text>

        <!-- Basic select -->
        <view class="flex-col gap-2 flex">
          <ui-label>Framework</ui-label>
          <ui-select placeholder="Pick a framework" [(value)]="framework">
            <ui-select-item value="angular" label="Angular" />
            <ui-select-item value="react" label="React" />
            <ui-select-item value="vue" label="Vue" />
            <ui-select-item value="svelte" label="Svelte" />
          </ui-select>
        </view>

        <!-- Select with default value -->
        <view class="flex-col gap-2 flex">
          <ui-label>Country</ui-label>
          <ui-select [(value)]="country">
            <ui-select-item value="us" label="United States" />
            <ui-select-item value="uk" label="United Kingdom" />
            <ui-select-item value="de" label="Germany" />
            <ui-select-item value="jp" label="Japan" />
          </ui-select>
        </view>

        <!-- Disabled select -->
        <view class="flex-col gap-2 flex">
          <ui-label [disabled]="true">Role (locked)</ui-label>
          <ui-select value="admin" [disabled]="true">
            <ui-select-item value="admin" label="Administrator" />
            <ui-select-item value="editor" label="Editor" />
            <ui-select-item value="viewer" label="Viewer" />
          </ui-select>
        </view>

        <!-- Display current selections -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">
            Selected Values
          </text>
          <text class="text-xs text-muted-foreground">
            Framework: {{ framework() || 'none' }}
          </text>
          <text class="text-xs text-muted-foreground">
            Country: {{ country() }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  framework = signal('');
  country = signal('us');
}
