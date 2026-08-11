// Computing pioneers used as sample data — surnames the shared dictionary
// doesn't carry. Scoped here rather than added to the global cspell config.
// cspell:ignore Ada Lovelace Turing Torvalds Liskov Ritchie Knuth Berners Radia Perlman Guido Rossum Anita Borg Vint Cerf Linus

import { Component, computed, signal } from '@angular/core';

import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

type Member = {
  id: string;
  name: string;
  role: string;
  online: boolean;
};

/**
 * Palette of named Tailwind colors for avatar backgrounds. Named colors
 * (bg-rose-500, bg-sky-500, …) compile to hex/rgb on Lynx, unlike the theme's
 * semantic tokens whose opaque rgba() values can't be safely varied per row.
 * Each member gets a stable color derived from its numeric id (see avatarClass).
 */
const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-pink-500',
  'bg-indigo-500',
];

const SEED_MEMBERS: readonly Member[] = [
  { id: '1', name: 'Ada Lovelace', role: 'Engineering Lead', online: true },
  { id: '2', name: 'Alan Turing', role: 'Principal Engineer', online: true },
  { id: '3', name: 'Grace Hopper', role: 'Compiler Architect', online: false },
  { id: '4', name: 'Katherine Johnson', role: 'Systems Analyst', online: true },
  { id: '5', name: 'Linus Torvalds', role: 'Kernel Maintainer', online: false },
  { id: '6', name: 'Margaret Hamilton', role: 'Flight Software', online: true },
  { id: '7', name: 'Dennis Ritchie', role: 'Language Designer', online: false },
  {
    id: '8',
    name: 'Barbara Liskov',
    role: 'Distributed Systems',
    online: true,
  },
  { id: '9', name: 'Tim Berners-Lee', role: 'Web Platform', online: false },
  { id: '10', name: 'Donald Knuth', role: 'Algorithms', online: true },
];

/** Extra teammates cycled in by "Add member" for flavor before falling back to a generic name. */
const EXTRA_MEMBERS: readonly Omit<Member, 'id' | 'online'>[] = [
  { name: 'Radia Perlman', role: 'Network Protocols' },
  { name: 'Guido van Rossum', role: 'Runtime Engineer' },
  { name: 'Anita Borg', role: 'Systems Research' },
  { name: 'Vint Cerf', role: 'Internet Architecture' },
];

/**
 * List demo — a virtualized native <list> rendered as a beautiful team-members
 * roster built entirely from @blotch/dolan UI components and semantic theme
 * colors (no more raw red/blue backgrounds). Tap a row to flip a member's
 * status, tap ✕ to remove one, and use the buttons to add/reset — every change
 * drives the native list's recycling engine to reconcile.
 */
@Component({
  selector: 'app-list-example',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [LYNX_ELEMENTS, UiText, UiBadge, UiButton],
  template: `
    <!-- Root is a plain flex column, NOT a scroll-view: the <list> below is the
         only scroll surface, so the header/controls stay pinned while the list
         scrolls. This also avoids nesting a list inside a scroll-view, which
         would fight Lynx's gesture routing. -->
    <view class="h-full w-full flex-col bg-background flex">
      <!-- Header -->
      <view class="flex-col gap-2 p-4 flex">
        <ui-text variant="h3">List</ui-text>
        <ui-badge variant="secondary">Elements</ui-badge>
        <ui-text variant="muted">
          A virtualized native list. Tap a member to toggle their status, ✕ to
          remove, or add teammates and watch the list reconcile.
        </ui-text>
      </view>

      <!-- Controls -->
      <view class="flex-row items-center gap-3 px-4 pb-3 flex">
        <ui-button size="sm" (pressed)="addMember()">Add member</ui-button>
        <ui-button size="sm" variant="outline" (pressed)="reset()">
          Reset
        </ui-button>
        <view class="flex-1 flex" />
        <ui-badge variant="outline" [animated]="false">
          {{ onlineCount() }} / {{ members().length }} online
        </ui-badge>
      </view>

      <!-- The list fills the remaining height. Per Lynx's sizing rule, flex-1
           must live on a plain view; the <list> then fills it with h-full. -->
      <view class="flex-1 flex-col px-4 pb-4 flex">
        <list
          class="h-full w-full rounded-xl border border-border bg-card overflow-hidden"
          list-type="single"
          scroll-orientation="vertical"
        >
          @for (member of members(); track member.id) {
            <list-item [attr.item-key]="member.id">
              <view
                class="flex-row items-center gap-3 border-b border-border px-4 py-3 flex"
                (bindtap)="toggleOnline(member.id)"
              >
                <!-- Avatar: colored initials + a status dot bordered to blend
                     into the card so it reads as a floating indicator. -->
                <view class="relative">
                  <view [class]="avatarClass(member.id)">
                    <text class="text-sm font-semibold text-white">{{
                      initials(member.name)
                    }}</text>
                  </view>
                  <view
                    class="h-3 w-3 rounded-full border-2 border-card absolute bottom-0 right-0"
                    [class.bg-emerald-500]="member.online"
                    [class.bg-zinc-400]="!member.online"
                  />
                </view>

                <!-- Name + role -->
                <view class="flex-1 flex-col flex">
                  <text class="text-[15px] font-medium text-foreground">{{
                    member.name
                  }}</text>
                  <text class="text-[13px] text-muted-foreground">{{
                    member.role
                  }}</text>
                </view>

                <!-- Status pill -->
                <ui-badge
                  [variant]="member.online ? 'default' : 'secondary'"
                  [animated]="false"
                >
                  {{ member.online ? 'Online' : 'Away' }}
                </ui-badge>

                <!-- Remove. catchtap (not bindtap) stops the tap here so it
                     removes only this row and never bubbles to the row's own
                     toggle handler. -->
                <view
                  class="ml-1 h-8 w-8 items-center rounded-full flex justify-center"
                  (catchtap)="remove(member.id)"
                >
                  <text class="text-base text-muted-foreground">✕</text>
                </view>
              </view>
            </list-item>
          }
        </list>
      </view>
    </view>
  `,
})
export class ListExample {
  readonly members = signal<Member[]>([...SEED_MEMBERS]);

  readonly onlineCount = computed(
    () => this.members().filter((m) => m.online).length,
  );

  // Monotonic id counter, seeded past the initial members so a freshly added
  // member never reuses an existing id/item-key — the native list diffs on
  // item-key, so a collision would misidentify recycled cells.
  #nextId = SEED_MEMBERS.length + 1;

  addMember(): void {
    const id = `${this.#nextId++}`;
    // Cycle through the flavor pool first, then fall back to a generic name so
    // the button keeps working no matter how many times it's tapped.
    const poolIndex = this.members().length - SEED_MEMBERS.length;
    const extra = EXTRA_MEMBERS[poolIndex];
    const member: Member = extra
      ? { id, name: extra.name, role: extra.role, online: true }
      : { id, name: `Teammate ${id}`, role: 'Just joined', online: true };
    this.members.update((list) => [...list, member]);
  }

  remove(id: string): void {
    this.members.update((list) => list.filter((m) => m.id !== id));
  }

  toggleOnline(id: string): void {
    this.members.update((list) =>
      list.map((m) => (m.id === id ? { ...m, online: !m.online } : m)),
    );
  }

  reset(): void {
    this.members.set([...SEED_MEMBERS]);
    this.#nextId = SEED_MEMBERS.length + 1;
  }

  /**
   * First letters of the first two words in uppercase — e.g. "Ada Lovelace" → "AL".
   */
  initials(name: string): string {
    return name
      .split(' ')
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('');
  }

  /**
   * Full class string for an avatar circle, with a stable per-member color.
   */
  avatarClass(id: string): string {
    const color = AVATAR_COLORS[Number(id) % AVATAR_COLORS.length];
    return `h-11 w-11 items-center rounded-full justify-center flex ${color}`;
  }
}
