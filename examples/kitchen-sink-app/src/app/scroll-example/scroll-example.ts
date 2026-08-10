import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import type { ScrollEvent } from '@lynx-js/types';
import { UiBadge } from '../../components/ui/badge';
import { UiCard } from '../../components/ui/card';
import { type IconName, UiIcon } from '../../components/ui/icon';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

/** A tile in the horizontal "Featured" carousel. */
type Collection = {
  name: string;
  icon: IconName;
  count: number;
  /** Named Tailwind color for the icon tile — see COLOR NOTE below. */
  tile: string;
};

/** A row in the vertical "Activity" feed. */
type Activity = {
  icon: IconName;
  title: string;
  detail: string;
  /** Named Tailwind color for the icon chip — see COLOR NOTE below. */
  chip: string;
};

// COLOR NOTE: the tiles/chips use *named* Tailwind colors (bg-sky-500, …), not
// the semantic theme tokens. Named colors compile to hex/rgb on Lynx, so they
// render vividly and can vary per item; the theme's semantic tokens are opaque
// rgba() values that can't be safely varied here (see root CLAUDE.md). Icons
// sitting on these tiles are drawn white via [color] because Lynx SVG does not
// inherit the CSS `color` property (see ui-icon).
const COLLECTIONS: readonly Collection[] = [
  { name: 'Photos', icon: 'eye', count: 128, tile: 'bg-sky-500' },
  { name: 'Starred', icon: 'star', count: 42, tile: 'bg-amber-500' },
  { name: 'Favorites', icon: 'heart', count: 18, tile: 'bg-rose-500' },
  { name: 'Alerts', icon: 'bell', count: 24, tile: 'bg-violet-500' },
  { name: 'Explore', icon: 'search', count: 96, tile: 'bg-emerald-500' },
  { name: 'Settings', icon: 'settings', count: 12, tile: 'bg-indigo-500' },
];

const ACTIVITIES: readonly Activity[] = [
  {
    icon: 'heart',
    title: 'Grace liked your photo',
    detail: 'Sunset over the bay · 2m ago',
    chip: 'bg-rose-500',
  },
  {
    icon: 'bell',
    title: 'New comment on “Roadmap”',
    detail: 'Alan: “Looks great!” · 8m ago',
    chip: 'bg-violet-500',
  },
  {
    icon: 'star',
    title: 'Ada starred your project',
    detail: 'angular-lynx · 15m ago',
    chip: 'bg-amber-500',
  },
  {
    icon: 'check',
    title: 'Deploy succeeded',
    detail: 'Production build #482 · 32m ago',
    chip: 'bg-emerald-500',
  },
  {
    icon: 'eye',
    title: 'Katherine viewed your profile',
    detail: 'From Search · 1h ago',
    chip: 'bg-sky-500',
  },
  {
    icon: 'plus',
    title: 'Margaret joined the team',
    detail: 'Flight Software · 2h ago',
    chip: 'bg-indigo-500',
  },
  {
    icon: 'bell',
    title: 'Reminder: standup at 10:00',
    detail: 'Daily sync · 3h ago',
    chip: 'bg-orange-500',
  },
  {
    icon: 'heart',
    title: 'Linus liked your comment',
    detail: '“Ship it 🚀” · 4h ago',
    chip: 'bg-rose-500',
  },
  {
    icon: 'star',
    title: 'Your post reached 1k views',
    detail: 'Rendering Angular on Lynx · 6h ago',
    chip: 'bg-amber-500',
  },
  {
    icon: 'settings',
    title: 'Security settings updated',
    detail: 'Two-factor enabled · 8h ago',
    chip: 'bg-zinc-500',
  },
  {
    icon: 'check',
    title: 'Task completed',
    detail: 'Redesign scroll example · 10h ago',
    chip: 'bg-emerald-500',
  },
  {
    icon: 'info',
    title: 'Weekly digest is ready',
    detail: '12 updates this week · 1d ago',
    chip: 'bg-sky-500',
  },
  {
    icon: 'plus',
    title: 'Barbara mentioned you',
    detail: 'in “Distributed Systems” · 1d ago',
    chip: 'bg-indigo-500',
  },
  {
    icon: 'bell',
    title: 'Subscription renews soon',
    detail: 'Pro plan · in 3 days',
    chip: 'bg-violet-500',
  },
];

/**
 * Scroll View demo — two independent `<scroll-view>`s on one screen:
 *
 *  - A horizontal "Featured" carousel (`scroll-orientation="horizontal"`).
 *  - A vertical "Activity" feed (`scroll-orientation="vertical"`) that reports
 *    its live scroll offset and top/bottom edges via `bindscroll`,
 *    `bindscrolltoupper`, and `bindscrolltolower`.
 *
 * Layout notes (all from investigations/lynx-vs-web-differences.md):
 *  - The root is a plain flex column, NOT a scroll-view: the header and carousel
 *    stay pinned while only the feed scrolls. This also keeps the two
 *    scroll-views as *siblings* — never nested — so each owns its own gesture.
 *  - A `scroll-view` only scrolls with a definite size. `flex-1` on the
 *    scroll-view itself does not bound it (it grows to fit content), so the
 *    feed's `flex-1` lives on a plain wrapping view and the scroll-view fills it
 *    with `h-full w-full`. The carousel gets an explicit height instead.
 */
@Component({
  selector: 'app-scroll-example',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [LYNX_ELEMENTS, UiText, UiBadge, UiCard, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <view class="h-full w-full flex-col bg-background flex">
      <!-- ── Pinned header ── -->
      <view class="flex-col gap-2 p-4 pb-3 flex">
        <ui-text variant="h3">Scroll View</ui-text>
        <ui-badge variant="secondary">Elements</ui-badge>
        <ui-text variant="muted">
          Two scroll-views on one screen. The Featured row scrolls sideways; the
          Activity feed scrolls down and reports its live offset via bindscroll.
        </ui-text>
      </view>

      <!-- ── Horizontal carousel ── -->
      <view class="flex-col gap-2 px-4 flex">
        <view class="flex-row items-center gap-2 flex">
          <ui-text variant="small">Featured</ui-text>
          <ui-badge variant="outline" [animated]="false">horizontal</ui-badge>
        </view>

        <!-- Explicit height: a horizontal scroll-view still needs a definite
             cross-axis size, and its cards match it so nothing clips. -->
        <scroll-view class="h-[168px] w-full" scroll-orientation="horizontal">
          @for (collection of collections; track collection.name) {
            <!-- Plain styled view (not ui-card) as a direct scroll child: Lynx's
                 scroll-view only lays out linear direct children, so a bare view
                 is the most predictable card container here. -->
            <view
              class="mr-3 h-[168px] w-[150px] flex-col rounded-2xl border border-border bg-card p-4 flex justify-between"
            >
              <view [class]="tileClass(collection.tile)">
                <ui-icon [name]="collection.icon" size="md" color="#ffffff" />
              </view>
              <view class="flex-col gap-0.5 flex">
                <ui-text variant="small">{{ collection.name }}</ui-text>
                <ui-text variant="muted">{{ collection.count }} items</ui-text>
              </view>
            </view>
          }
        </scroll-view>
      </view>

      <!-- ── Vertical feed ── -->
      <view class="mt-3 flex-1 flex-col gap-2 px-4 pb-4 flex">
        <view class="flex-row items-center gap-2 flex">
          <ui-text variant="small">Activity</ui-text>
          <view class="flex-1 flex" />
          <!-- Live scroll telemetry, driven by bindscroll below. -->
          <ui-badge variant="outline" [animated]="false">
            {{ scrollY() }} px
          </ui-badge>
          @if (atEdge() === 'top') {
            <ui-badge variant="secondary" [animated]="false">Top</ui-badge>
          } @else if (atEdge() === 'bottom') {
            <ui-badge variant="default" [animated]="false">Bottom</ui-badge>
          }
        </view>

        <!-- flex-1 must sit on this plain view (the real flex child); the
             scroll-view then fills the resulting definite height. -->
        <view class="flex-1 flex-col flex">
          <scroll-view
            class="h-full w-full"
            scroll-orientation="vertical"
            (bindscroll)="onScroll($any($event))"
            (bindscrolltoupper)="onReachTop()"
            (bindscrolltolower)="onReachBottom()"
          >
            @for (activity of activities; track activity.title) {
              <ui-card
                [pressable]="true"
                class="mb-3 flex-row items-center gap-3 p-3 flex"
              >
                <view [class]="chipClass(activity.chip)">
                  <ui-icon [name]="activity.icon" size="sm" color="#ffffff" />
                </view>
                <view class="flex-1 flex-col flex">
                  <text class="text-[15px] font-medium text-foreground">{{
                    activity.title
                  }}</text>
                  <text class="text-[13px] text-muted-foreground">{{
                    activity.detail
                  }}</text>
                </view>
                <ui-icon name="chevron-right" size="sm" color="#a1a1aa" />
              </ui-card>
            }
          </scroll-view>
        </view>
      </view>
    </view>
  `,
})
export class ScrollExample {
  readonly collections = COLLECTIONS;
  readonly activities = ACTIVITIES;

  /** Live vertical scroll offset (px), updated on every bindscroll. */
  readonly scrollY = signal(0);

  /**
   * Which edge the feed currently rests against, so the header can show a
   * "Top"/"Bottom" pill. `null` while scrolling between the two.
   */
  readonly atEdge = signal<'top' | 'bottom' | null>('top');

  /**
   * bindscroll fires continuously as the feed moves. Writing signals here is
   * safe inside a Lynx event callback — we never mutate the element tree, so
   * there's nothing to defer (see App.navigateTo() for the contrasting case).
   */
  onScroll(event: ScrollEvent): void {
    const top = event.detail.scrollTop;
    this.scrollY.set(Math.round(top));
    // The bottom edge is reported by bindscrolltolower; any offset above 0
    // clears the pill. We still resolve the top here because bindscroll can
    // settle at 0 (e.g. after an iOS bounce) without firing bindscrolltoupper.
    this.atEdge.set(top <= 0 ? 'top' : null);
  }

  onReachTop(): void {
    this.atEdge.set('top');
  }

  onReachBottom(): void {
    this.atEdge.set('bottom');
  }

  /**
   * Full class string for a carousel icon tile, with a per-item color.
   */
  tileClass(color: string): string {
    return `h-12 w-12 items-center rounded-xl justify-center flex ${color}`;
  }

  /**
   * Full class string for a feed row's icon chip, with a per-item color.
   */
  chipClass(color: string): string {
    return `h-10 w-10 items-center rounded-full justify-center flex ${color}`;
  }
}
