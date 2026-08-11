import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../components/ui/badge';
import { UiCard, UiCardContent } from '../components/ui/card';
import { UiToaster, toast } from '../components/ui/toast';
import {
  UiActionSheet,
  UiActionSheetTitle,
  UiActionSheetItem,
  UiActionSheetCancel,
} from '../components/ui/action-sheet';
import { UiEmptyState } from '../components/ui/empty-state';
import { UiButton } from '../components/ui/button';

type Notification = {
  id: number;
  title: string;
  message: string;
  read: boolean;
  time: string;
};

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiBadge,
    UiCard,
    UiCardContent,
    UiToaster,
    UiActionSheet,
    UiActionSheetTitle,
    UiActionSheetItem,
    UiActionSheetCancel,
    UiEmptyState,
    UiButton,
  ],
  template: `
    <view class="h-screen flex-col bg-zinc-50 flex">
      <view
        class="flex-row items-center border-b border-zinc-200 bg-white px-5 py-4 flex justify-between"
      >
        <view class="flex-row items-center gap-2.5 flex">
          <text class="text-[22px] font-bold text-zinc-900">Notifications</text>
          @if (unreadCount() > 0) {
            <ui-badge>{{ unreadCount() }}</ui-badge>
          }
        </view>
        @if (notifications().length > 0) {
          <ui-button variant="ghost" size="sm" (pressed)="clearAll()">
            Clear All
          </ui-button>
        }
      </view>

      <scroll-view scroll-orientation="vertical" class="flex-1">
        @if (notifications().length === 0) {
          <view class="p-6">
            <ui-empty-state
              icon="bell"
              title="All caught up"
              description="No notifications to show."
            />
          </view>
        } @else {
          <view class="flex-col gap-2 p-4 flex">
            @for (n of notifications(); track n.id) {
              <!-- Was (longpress), which silently did nothing on long-press: Lynx
                   event names need a propagation prefix (bind/catch/...), and the
                   renderer drops any event name it doesn't recognize as prefixed
                   with no error or warning — it just never registers a native
                   listener. "bindlongpress" is the actual native event name. -->
              <ui-card
                [class.opacity-[0.55]]="n.read"
                (bindlongpress)="openActionSheet(n)"
              >
                <ui-card-content class="p-3">
                  <view class="flex-row items-start gap-3 flex">
                    @if (!n.read) {
                      <view
                        class="mt-1.5 h-2 w-2 shrink-0 rounded-[50%] bg-indigo-500"
                      />
                    } @else {
                      <view class="mt-1.5 h-2 w-2 shrink-0" />
                    }
                    <view class="flex-1 flex-col gap-0.5 flex">
                      <text class="text-sm font-semibold text-zinc-900">{{
                        n.title
                      }}</text>
                      <text class="text-xs text-zinc-500">{{ n.message }}</text>
                      <text class="mt-1 text-xs text-zinc-400">{{
                        n.time
                      }}</text>
                    </view>
                  </view>
                </ui-card-content>
              </ui-card>
            }
          </view>
        }
      </scroll-view>
    </view>

    @if (selected()) {
      <ui-action-sheet [(open)]="actionSheetOpen">
        <ui-action-sheet-title>{{ selected()!.title }}</ui-action-sheet-title>
        @if (!selected()!.read) {
          <ui-action-sheet-item (pressed)="markRead()">
            Mark as Read
          </ui-action-sheet-item>
        }
        <ui-action-sheet-item
          variant="destructive"
          (pressed)="deleteSelected()"
        >
          Delete
        </ui-action-sheet-item>
        <ui-action-sheet-cancel>Cancel</ui-action-sheet-cancel>
      </ui-action-sheet>
    }

    <ui-toaster />
  `,
})
export class App {
  readonly notifications = signal<Notification[]>([
    {
      id: 1,
      title: 'New message',
      message: 'Jordan sent you a message.',
      read: false,
      time: '2m ago',
    },
    {
      id: 2,
      title: 'Build complete',
      message: 'Your app compiled successfully.',
      read: false,
      time: '15m ago',
    },
    {
      id: 3,
      title: 'Welcome!',
      message: 'Thanks for joining AngularLynx.',
      read: true,
      time: '1h ago',
    },
  ]);
  readonly unreadCount = computed(
    () => this.notifications().filter((n) => !n.read).length,
  );
  readonly actionSheetOpen = signal(false);
  readonly selected = signal<Notification | null>(null);

  openActionSheet(n: Notification): void {
    this.selected.set(n);
    this.actionSheetOpen.set(true);
  }

  markRead(): void {
    const id = this.selected()!.id;
    this.notifications.update((list) =>
      list.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    this.actionSheetOpen.set(false);
    toast({ title: 'Marked as read' });
  }

  deleteSelected(): void {
    const id = this.selected()!.id;
    this.notifications.update((list) => list.filter((n) => n.id !== id));
    this.actionSheetOpen.set(false);
    toast({ title: 'Notification deleted' });
  }

  clearAll(): void {
    this.notifications.set([]);
    toast({ title: 'All notifications cleared' });
  }
}
