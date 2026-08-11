import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
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
import { type IconName, UiIcon } from '../../components/ui/icon';
import { UiInput } from '../../components/ui/input';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

type IconSize = 'xs' | 'sm' | 'md' | 'lg';

type IconCategory = {
  readonly title: string;
  readonly icons: readonly IconName[];
};

/**
 * Mirrors the category grouping in packages/ui/src/lib/components/icon/icons.ts.
 * There's no runtime metadata linking an icon to its category, so this list is
 * kept in sync by hand — see that file's category comments when adding icons.
 */
const ICON_CATEGORIES: readonly IconCategory[] = [
  {
    title: 'Common',
    icons: [
      'check',
      'x',
      'plus',
      'minus',
      'chevron-down',
      'chevron-up',
      'chevron-left',
      'chevron-right',
      'arrow-left',
      'arrow-right',
      'search',
      'menu',
      'info',
      'alert-triangle',
      'loader',
      'circle',
      'ellipsis',
      'eye',
      'eye-off',
      'settings',
      'trash',
      'heart',
      'star',
      'bell',
    ],
  },
  {
    title: 'Navigation & Arrows',
    icons: [
      'arrow-up',
      'arrow-down',
      'arrow-up-right',
      'arrow-up-left',
      'arrow-down-right',
      'arrow-down-left',
      'chevrons-up',
      'chevrons-down',
      'chevrons-left',
      'chevrons-right',
      'move',
      'maximize',
      'minimize',
      'external-link',
      'refresh-cw',
      'rotate-cw',
      'undo-2',
      'redo-2',
    ],
  },
  {
    title: 'Actions & Editing',
    icons: [
      'edit',
      'pencil',
      'copy',
      'clipboard',
      'save',
      'download',
      'upload',
      'share-2',
      'sliders-horizontal',
      'zoom-in',
      'zoom-out',
      'scissors',
      'trash-2',
      'pin',
      'link',
      'filter',
    ],
  },
  {
    title: 'Media & Playback',
    icons: [
      'play',
      'pause',
      'square',
      'circle-stop',
      'skip-forward',
      'skip-back',
      'rewind',
      'fast-forward',
      'volume-2',
      'volume-x',
      'mic',
      'mic-off',
      'camera',
      'video',
      'music',
      'headphones',
    ],
  },
  {
    title: 'Communication',
    icons: [
      'mail',
      'message-circle',
      'message-square',
      'send',
      'phone',
      'phone-call',
      'at-sign',
      'inbox',
      'megaphone',
      'rss',
      'reply',
      'globe',
    ],
  },
  {
    title: 'Files & Folders',
    icons: [
      'file',
      'file-text',
      'file-plus',
      'folder',
      'folder-open',
      'book',
      'book-open',
      'archive',
      'paperclip',
      'newspaper',
      'database',
      'hard-drive',
    ],
  },
  {
    title: 'Status & Alerts',
    icons: [
      'check-circle',
      'x-circle',
      'alert-circle',
      'plus-circle',
      'minus-circle',
      'shield',
      'shield-check',
      'lock',
      'lock-open',
      'key',
      'ban',
      'help-circle',
    ],
  },
  {
    title: 'People & Social',
    icons: [
      'user',
      'users',
      'user-circle',
      'user-plus',
      'user-check',
      'user-x',
      'thumbs-up',
      'thumbs-down',
      'smile',
      'frown',
      'hand',
      'handshake',
    ],
  },
  {
    title: 'Commerce',
    icons: [
      'shopping-cart',
      'shopping-bag',
      'credit-card',
      'dollar-sign',
      'tag',
      'tags',
      'gift',
      'package',
      'truck',
      'wallet',
      'receipt',
      'store',
    ],
  },
  {
    title: 'Weather & Nature',
    icons: [
      'sun',
      'moon',
      'cloud',
      'cloud-rain',
      'cloud-snow',
      'wind',
      'droplet',
      'zap',
      'snowflake',
      'flame',
      'sunrise',
      'sparkles',
    ],
  },
  {
    title: 'Devices & Tech',
    icons: [
      'home',
      'calendar',
      'clock',
      'map-pin',
      'map',
      'compass',
      'wifi',
      'bluetooth',
      'battery',
      'smartphone',
      'monitor',
      'laptop',
      'server',
      'cpu',
      'keyboard',
      'power',
    ],
  },
  {
    title: 'Layout & Text',
    icons: [
      'layout-grid',
      'layout-dashboard',
      'table',
      'columns-3',
      'rows-3',
      'list',
      'list-checks',
      'list-ordered',
      'bold',
      'quote',
      'align-left',
      'align-center',
      'align-right',
      'type',
    ],
  },
  {
    title: 'Charts & Data',
    icons: [
      'chart-bar',
      'chart-line',
      'chart-pie',
      'chart-column',
      'activity',
      'trending-up',
      'trending-down',
      'target',
    ],
  },
  {
    title: 'Objects & Fun',
    icons: [
      'award',
      'trophy',
      'crown',
      'rocket',
      'lightbulb',
      'coffee',
      'terminal',
      'code',
      'command',
      'git-branch',
      'bug',
    ],
  },
];

const TOTAL_ICON_COUNT = ICON_CATEGORIES.reduce(
  (sum, category) => sum + category.icons.length,
  0,
);

/**
 * A catalog of every icon in the `ui-icon` component: a live search,
 * a size toggle, and a tap-to-preview panel showing the exact template snippet
 * to copy. Exists because the icon set grew large enough (195 icons) that
 * scanning the docs table alone no longer answers "which one looks right?".
 */
@Component({
  selector: 'app-icon-showcase',
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiBadge,
    UiButton,
    UiCard,
    UiCardContent,
    UiCardDescription,
    UiCardHeader,
    UiCardTitle,
    UiIcon,
    UiInput,
    UiText,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-demo-screen
      heading="Icons"
      category="Components"
      [description]="descriptionText"
    >
      <ui-input
        label="Search"
        placeholder="e.g. arrow, chart, moon…"
        [value]="query()"
        (changed)="query.set($event)"
      />

      <!-- Selected-icon preview: seeded with the first match so the panel is
           never empty, and re-seeds itself if a search filters the current
           selection out of view. -->
      <ui-card>
        <ui-card-header class="flex-row items-center p-4 pb-0 justify-between">
          <view class="flex-col gap-1 flex">
            <ui-card-title class="text-base">Preview</ui-card-title>
            <ui-card-description>Tap any icon below.</ui-card-description>
          </view>
          <view class="flex-row gap-1.5 flex">
            @for (size of sizes; track size) {
              <ui-button
                size="sm"
                [variant]="previewSize() === size ? 'default' : 'outline'"
                (pressed)="previewSize.set(size)"
              >
                {{ size }}
              </ui-button>
            }
          </view>
        </ui-card-header>
        <ui-card-content
          class="flex-col items-center gap-3 p-4 flex justify-center"
        >
          <view
            class="h-16 w-16 items-center rounded-lg bg-muted flex justify-center"
          >
            <ui-icon [name]="selected()" [size]="previewSize()" />
          </view>
          <ui-text variant="large">{{ selected() }}</ui-text>
          <ui-badge variant="secondary" [animated]="false">{{
            snippet()
          }}</ui-badge>
        </ui-card-content>
      </ui-card>

      @if (filteredCategories().length) {
        @for (category of filteredCategories(); track category.title) {
          <view class="flex-col gap-3 flex">
            <view class="flex-row items-center gap-2 flex">
              <ui-text variant="small" class="text-muted-foreground">
                {{ category.title }}
              </ui-text>
              <ui-badge variant="outline" [animated]="false">
                {{ category.icons.length }}
              </ui-badge>
            </view>
            <view class="flex-row flex-wrap gap-2.5 flex">
              @for (icon of category.icons; track icon) {
                <view [class]="tileClass(icon)" (bindtap)="selected.set(icon)">
                  <ui-icon [name]="icon" [size]="previewSize()" />
                  <text class="w-20 text-xs text-muted-foreground text-center">
                    {{ icon }}
                  </text>
                </view>
              }
            </view>
          </view>
        }
      } @else {
        <view class="items-center gap-2 py-8 flex justify-center">
          <ui-icon name="search" size="lg" color="#a1a1aa" />
          <ui-text variant="muted">No icons match "{{ query() }}".</ui-text>
        </view>
      }
    </app-demo-screen>
  `,
})
export class IconShowcase {
  readonly query = signal('');
  readonly previewSize = signal<IconSize>('md');
  readonly selected = signal<IconName>('sparkles');

  protected readonly sizes: readonly IconSize[] = ['xs', 'sm', 'md', 'lg'];
  protected readonly totalIcons = TOTAL_ICON_COUNT;
  protected readonly descriptionText = `${TOTAL_ICON_COUNT} icons from the Lucide icon set. Search by name, pick a size, and tap one to see its snippet.`;

  protected readonly snippet = computed(
    () => `<ui-icon name="${this.selected()}" size="${this.previewSize()}" />`,
  );

  protected readonly filteredCategories = computed<IconCategory[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return ICON_CATEGORIES as IconCategory[];
    return ICON_CATEGORIES.map((category) => ({
      title: category.title,
      icons: category.icons.filter((icon) => icon.includes(q)),
    })).filter((category) => category.icons.length > 0);
  });

  protected tileClass(icon: IconName): string {
    const base =
      'flex-col items-center gap-1.5 rounded-lg border p-3 flex justify-center';
    return this.selected() === icon
      ? `${base} border-primary bg-accent`
      : `${base} border-border bg-card`;
  }
}
