import { Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { Inbox } from './inbox';

/**
 * A routed component's host is a real element in the column above the tab
 * bar, and arrives unstyled. `flex-1` gives it the column's height, so the
 * scroll-view inside has a height to scroll within instead of growing to fit
 * its content.
 */
const SCREEN_HOST = { class: 'flex-1 flex-col flex' };

/**
 * Each screen's frame: a title clear of the status bar over scrolling content.
 */
@Component({
  selector: 'app-screen',
  imports: [LYNX_ELEMENTS],
  host: SCREEN_HOST,
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full w-full">
      <view class="flex-col gap-4 px-6 pb-6 flex pt-safe-6">
        <text class="text-2xl font-bold text-foreground">{{ heading() }}</text>
        <ng-content />
      </view>
    </scroll-view>
  `,
})
export class Screen {
  readonly heading = input.required<string>();
}

@Component({
  selector: 'app-home-screen',
  imports: [LYNX_ELEMENTS, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Home">
      <text class="text-sm text-muted-foreground">
        Tap a tab to switch screens. The tab of the screen you're on is drawn in
        the primary color, and a screen reader hears it as selected.
      </text>
      <text class="text-sm text-muted-foreground">
        The Inbox tab's badge counts the unread messages. Open one, or mark them
        all as read, and it goes down.
      </text>
    </app-screen>
  `,
})
export class HomeScreen {}

@Component({
  selector: 'app-search-screen',
  imports: [LYNX_ELEMENTS, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Search">
      <text class="text-sm text-muted-foreground">Nothing to search yet.</text>
    </app-screen>
  `,
})
export class SearchScreen {}

@Component({
  selector: 'app-inbox-screen',
  imports: [LYNX_ELEMENTS, RouterLink, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Inbox">
      @for (message of inbox.messages(); track message.id) {
        <!-- A message opens at /inbox/:id, under the Inbox tab, which stays
             selected there. -->
        <view
          class="flex-row items-center gap-3 rounded-lg border border-border p-3 flex"
          [routerLink]="['/inbox', message.id]"
          [accessibility-element]="true"
          accessibility-traits="button"
          [accessibility-label]="
            (message.read ? '' : 'Unread, ') +
            message.from +
            ', ' +
            message.subject
          "
        >
          <view
            class="h-2 w-2 rounded-full"
            [class.bg-primary]="!message.read"
          ></view>
          <view class="flex-1 flex-col flex">
            <text class="text-sm font-semibold text-foreground">{{
              message.from
            }}</text>
            <text class="text-sm text-muted-foreground">{{
              message.subject
            }}</text>
          </view>
        </view>
      }
      <view
        class="items-center rounded-md bg-secondary px-4 py-2 flex justify-center"
        [accessibility-element]="true"
        accessibility-traits="button"
        accessibility-label="Mark all as read"
        (bindtap)="inbox.markAllRead()"
      >
        <text class="text-sm font-medium text-secondary-foreground"
          >Mark all as read</text
        >
      </view>
    </app-screen>
  `,
})
export class InboxScreen {
  protected readonly inbox = inject(Inbox);
}

@Component({
  selector: 'app-message-screen',
  imports: [LYNX_ELEMENTS, RouterLink, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen [heading]="message()?.subject ?? 'Message'">
      <text class="text-sm text-muted-foreground"
        >From {{ message()?.from }}</text
      >
      <text class="text-base text-foreground">{{ message()?.body }}</text>
      <view
        class="items-center rounded-md bg-secondary px-4 py-2 flex justify-center"
        routerLink="/inbox"
        [accessibility-element]="true"
        accessibility-traits="button"
        accessibility-label="Back to Inbox"
      >
        <text class="text-sm font-medium text-secondary-foreground"
          >Back to Inbox</text
        >
      </view>
    </app-screen>
  `,
})
export class MessageScreen {
  /** The `:id` of the route, through withComponentInputBinding(). */
  readonly id = input.required<string>();

  readonly #inbox = inject(Inbox);

  protected readonly message = computed(() =>
    this.#inbox.find(Number(this.id())),
  );

  // Opening a message reads it, which takes it off the Inbox tab's badge.
  protected readonly markRead = effect(() =>
    this.#inbox.markRead(Number(this.id())),
  );
}

@Component({
  selector: 'app-profile-screen',
  imports: [LYNX_ELEMENTS, Screen],
  host: SCREEN_HOST,
  template: `
    <app-screen heading="Profile">
      <view class="flex-row items-center gap-4 flex">
        <view
          class="h-14 w-14 items-center rounded-full bg-muted flex justify-center"
        >
          <text class="text-lg font-semibold text-foreground">AL</text>
        </view>
        <view class="flex-col flex">
          <text class="text-base font-semibold text-foreground"
            >Angular Lynx</text
          >
          <text class="text-sm text-muted-foreground">hello@example.com</text>
        </view>
      </view>
    </app-screen>
  `,
})
export class ProfileScreen {}
