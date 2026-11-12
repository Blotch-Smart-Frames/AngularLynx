import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiSelect, UiSelectItem } from '../components/ui/select';
import { UiLabel } from '../components/ui/label';
import { type IconName, UiIcon } from '../components/ui/icon';

const TIME_ZONES = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Kolkata',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Rome',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

const WEATHER: readonly { value: IconName; label: string }[] = [
  { value: 'sun', label: 'Sunny' },
  { value: 'cloud', label: 'Cloudy' },
  { value: 'cloud-rain', label: 'Rain' },
  { value: 'cloud-snow', label: 'Snow' },
  { value: 'wind', label: 'Windy' },
  { value: 'zap', label: 'Storm' },
];

/** Stands in for a server that suggests airports as the user types. */
const AIRPORTS = [
  { code: 'LHR', name: 'London Heathrow' },
  { code: 'LGW', name: 'London Gatwick' },
  { code: 'CDG', name: 'Paris Charles de Gaulle' },
  { code: 'JFK', name: 'New York JFK' },
  { code: 'HND', name: 'Tokyo Haneda' },
  { code: 'SFO', name: 'San Francisco' },
];

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiSelect, UiSelectItem, UiLabel, UiIcon],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Select</text>
        <text class="text-sm text-muted-foreground">
          A field that opens a sheet of options, with search for long lists.
        </text>

        <!-- Basic select, beside a label of the app's own -->
        <view class="flex-col gap-2 flex">
          <ui-label>Framework</ui-label>
          <ui-select
            accessibility-label="Framework"
            placeholder="Pick a framework"
            [(value)]="framework"
          >
            <ui-select-item value="angular" label="Angular" />
            <ui-select-item value="react" label="React" />
            <ui-select-item value="vue" label="Vue" />
            <ui-select-item value="svelte" label="Svelte" />
          </ui-select>
        </view>

        <!-- Searchable: a long list, filtered as the user types -->
        <ui-select
          label="Time zone"
          placeholder="Choose a time zone"
          searchable
          searchPlaceholder="Search time zones"
          [(value)]="timeZone"
        >
          @for (zone of timeZones; track zone) {
            <ui-select-item [value]="zone" [label]="zone" />
          }
        </ui-select>

        <!-- Icons in the items, and the chosen one's in the field -->
        <ui-select label="Weather" [(value)]="weather">
          <ui-icon leading [name]="weatherIcon()" size="xs" />
          @for (option of weatherOptions; track option.value) {
            <ui-select-item [value]="option.value" [label]="option.label">
              <ui-icon [name]="option.value" size="sm" />
            </ui-select-item>
          }
        </ui-select>

        <!-- The app's own results for the query, as from a server -->
        <ui-select
          label="Airport"
          placeholder="Find an airport"
          searchable
          [filter]="false"
          [emptyText]="airportQuery() ? 'No airports found' : 'Type a city'"
          [(query)]="airportQuery"
          [(value)]="airport"
        >
          @for (result of airportResults(); track result.code) {
            <ui-select-item
              [value]="result.code"
              [label]="result.name + ' (' + result.code + ')'"
            />
          }
        </ui-select>

        <!-- Disabled select -->
        <ui-select label="Role (locked)" value="admin" disabled>
          <ui-select-item value="admin" label="Administrator" />
          <ui-select-item value="viewer" label="Viewer" />
        </ui-select>

        <!-- Display current selections -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">
            Selected Values
          </text>
          <text class="text-xs text-muted-foreground">
            Framework: {{ framework() || 'none' }}
          </text>
          <text class="text-xs text-muted-foreground">
            Time zone: {{ timeZone() || 'none' }}
          </text>
          <text class="text-xs text-muted-foreground">
            Weather: {{ weather() }}
          </text>
          <text class="text-xs text-muted-foreground">
            Airport: {{ airport() || 'none' }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  protected readonly timeZones = TIME_ZONES;
  protected readonly weatherOptions = WEATHER;

  protected readonly framework = signal('');
  protected readonly timeZone = signal('');
  protected readonly weather = signal('sun');
  protected readonly airport = signal('');
  protected readonly airportQuery = signal('');

  /** The chosen weather's icon, for the field. */
  protected readonly weatherIcon = computed(
    () => WEATHER.find((option) => option.value === this.weather())?.value,
  );

  /**
   * The airports a server would suggest for the query. Without one, the
   * chosen airport stays an item, so the field goes on showing its name
   * rather than its code.
   */
  protected readonly airportResults = computed(() => {
    const query = this.airportQuery().trim().toLowerCase();
    if (!query) {
      return AIRPORTS.filter((airport) => airport.code === this.airport());
    }
    return AIRPORTS.filter(
      (airport) =>
        airport.name.toLowerCase().includes(query) ||
        airport.code.toLowerCase().startsWith(query),
    );
  });
}
