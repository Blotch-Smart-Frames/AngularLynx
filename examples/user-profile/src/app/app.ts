import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiAvatar } from '../components/ui/avatar';
import { UiBadge } from '../components/ui/badge';
import {
  UiCard,
  UiCardHeader,
  UiCardTitle,
  UiCardContent,
} from '../components/ui/card';
import { UiButton } from '../components/ui/button';
import {
  UiSheet,
  UiSheetHeader,
  UiSheetTitle,
  UiSheetFooter,
} from '../components/ui/sheet';
import { UiInput } from '../components/ui/input';
import { UiTextarea } from '../components/ui/textarea';
import { UiLabel } from '../components/ui/label';
import { UiSeparator } from '../components/ui/separator';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiAvatar,
    UiBadge,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardContent,
    UiButton,
    UiSheet,
    UiSheetHeader,
    UiSheetTitle,
    UiSheetFooter,
    UiInput,
    UiTextarea,
    UiLabel,
    UiSeparator,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-zinc-50">
      <view class="flex-col items-center gap-5 px-6 py-8 flex">
        <view class="flex-col items-center gap-2 flex">
          <ui-avatar size="xl" src="" [fallback]="initials()" />
          <text class="text-[24px] font-bold text-zinc-900">{{ name() }}</text>
          <view class="flex-row items-center gap-2 flex">
            <!-- cspell:disable-next-line -->
            <text class="text-sm text-zinc-500">@alexj</text>
            <ui-badge variant="secondary">Pro</ui-badge>
          </view>
        </view>

        <view
          class="flex-row gap-7 rounded-2xl border border-zinc-200 bg-white px-6 py-5 flex"
        >
          <view class="flex-col items-center gap-0.5 flex">
            <text class="text-[20px] font-bold text-zinc-900">248</text>
            <text class="text-xs text-zinc-400">Posts</text>
          </view>
          <ui-separator orientation="vertical" />
          <view class="flex-col items-center gap-0.5 flex">
            <text class="text-[20px] font-bold text-zinc-900">4.2k</text>
            <text class="text-xs text-zinc-400">Followers</text>
          </view>
          <ui-separator orientation="vertical" />
          <view class="flex-col items-center gap-0.5 flex">
            <text class="text-[20px] font-bold text-zinc-900">312</text>
            <text class="text-xs text-zinc-400">Following</text>
          </view>
        </view>

        <ui-button class="w-full" (pressed)="openEdit()">
          Edit Profile
        </ui-button>

        <ui-card class="w-full">
          <ui-card-header><ui-card-title>About</ui-card-title></ui-card-header>
          <ui-card-content>
            <text class="text-sm leading-5 text-zinc-500">{{ bio() }}</text>
          </ui-card-content>
        </ui-card>
      </view>
    </scroll-view>

    <ui-sheet [(open)]="editOpen">
      <ui-sheet-header
        ><ui-sheet-title>Edit Profile</ui-sheet-title>
      </ui-sheet-header>
      <view class="flex-col gap-4 p-4 flex">
        <view class="flex-col gap-1.5 flex">
          <ui-label>Display Name</ui-label>
          <ui-input
            [value]="editName()"
            (valueChange)="editName.set($event)"
            placeholder="Your name"
          />
        </view>
        <view class="flex-col gap-1.5 flex">
          <ui-label>Bio</ui-label>
          <ui-textarea
            [value]="editBio()"
            (valueChange)="editBio.set($event)"
            placeholder="Tell us about yourself"
          />
        </view>
      </view>
      <ui-sheet-footer>
        <ui-button variant="outline" (pressed)="editOpen.set(false)">
          Cancel
        </ui-button>
        <ui-button (pressed)="saveEdit()">Save</ui-button>
      </ui-sheet-footer>
    </ui-sheet>
  `,
})
export class App {
  readonly editOpen = signal(false);
  readonly name = signal('Alex Johnson');
  readonly bio = signal(
    'Full-stack developer passionate about mobile UX and cross-platform apps. Building cool things with AngularLynx.',
  );
  readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join(''),
  );

  // The sheet edits copies, so Cancel leaves the profile as it was.
  readonly editName = signal(this.name());
  readonly editBio = signal(this.bio());

  openEdit(): void {
    // Start from the saved values, not from an edit that was cancelled.
    this.editName.set(this.name());
    this.editBio.set(this.bio());
    this.editOpen.set(true);
  }

  saveEdit(): void {
    // An empty name would leave the header blank, so keep the old one.
    this.name.set(this.editName().trim() || this.name());
    this.bio.set(this.editBio());
    this.editOpen.set(false);
  }
}
