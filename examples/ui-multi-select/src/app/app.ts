import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiMultiSelect,
  UiMultiSelectItem,
} from '../components/ui/multi-select';
import { type IconName, UiIcon } from '../components/ui/icon';

const TOPICS = [
  'Arts',
  'Business',
  'Climate',
  'Education',
  'Food',
  'Health',
  'Movies',
  'Music',
  'News',
  'Politics',
  'Science',
  'Sport',
  'Technology',
  'Travel',
  'Weather',
];

const WEEKDAYS = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
];

const ALERTS: readonly { value: IconName; label: string }[] = [
  { value: 'cloud-rain', label: 'Rain' },
  { value: 'cloud-snow', label: 'Snow' },
  { value: 'wind', label: 'Wind' },
  { value: 'zap', label: 'Thunder' },
  { value: 'flame', label: 'Heat' },
];

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiMultiSelect, UiMultiSelectItem, UiIcon],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Multi Select</text>
        <text class="text-sm text-muted-foreground">
          A field that opens a sheet of checkboxes and shows the chosen items as
          chips.
        </text>

        <!-- Basic: the sheet stays open while items are toggled -->
        <ui-multi-select
          label="Days"
          placeholder="Choose days"
          [(value)]="days"
          (changed)="lastChange.set($event.length + ' chosen')"
        >
          @for (day of weekdays; track day.value) {
            <ui-multi-select-item [value]="day.value" [label]="day.label" />
          }
        </ui-multi-select>

        <!-- Searchable: a longer list, filtered as the user types, in the
             platform's own sheet (variant="glass") -->
        <ui-multi-select
          label="Topics"
          placeholder="Choose topics"
          searchable
          searchPlaceholder="Search topics"
          variant="glass"
          [(value)]="topics"
        >
          @for (topic of topicOptions; track topic) {
            <ui-multi-select-item [value]="topic" [label]="topic" />
          }
        </ui-multi-select>

        <!-- Icons in the items, in the platform's own sheet and rows -->
        <ui-multi-select
          label="Weather alerts"
          variant="glass"
          [(value)]="alerts"
        >
          @for (alert of alertOptions; track alert.value) {
            <ui-multi-select-item [value]="alert.value" [label]="alert.label">
              <ui-icon [name]="alert.value" size="sm" />
            </ui-multi-select-item>
          }
        </ui-multi-select>

        <!-- Disabled -->
        <ui-multi-select
          label="Plan features (locked)"
          [value]="['sync', 'backup']"
          disabled
        >
          <ui-multi-select-item value="sync" label="Sync" />
          <ui-multi-select-item value="backup" label="Backup" />
        </ui-multi-select>

        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">
            Selected Values
          </text>
          <text class="text-xs text-muted-foreground">
            Days: {{ days().join(', ') || 'none' }} ({{ lastChange() }})
          </text>
          <text class="text-xs text-muted-foreground">
            Topics: {{ topics().join(', ') || 'none' }}
          </text>
          <text class="text-xs text-muted-foreground">
            Alerts: {{ alerts().join(', ') || 'none' }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  protected readonly weekdays = WEEKDAYS;
  protected readonly topicOptions = TOPICS;
  protected readonly alertOptions = ALERTS;

  protected readonly days = signal<readonly string[]>(['sat', 'sun']);
  protected readonly topics = signal<readonly string[]>([]);
  protected readonly alerts = signal<readonly string[]>(['cloud-rain']);
  protected readonly lastChange = signal('no changes yet');
}
