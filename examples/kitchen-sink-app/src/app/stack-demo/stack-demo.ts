import { Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LYNX_ELEMENTS, LynxStackOutlet } from '@blotch/angular-lynx';
import { UiButton } from '../../components/ui/button';
import { UiIcon } from '../../components/ui/icon';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

type Message = {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
};
type Folder = {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly Message[];
};

const FOLDERS: readonly Folder[] = [
  {
    id: 'inbox',
    title: 'Inbox',
    messages: [
      { id: 'm1', from: 'Ada', subject: 'Lunch on Friday?' },
      { id: 'm2', from: 'Grace', subject: 'The build is green again' },
      { id: 'm3', from: 'Linus', subject: 'Notes from the review' },
    ],
  },
  {
    id: 'drafts',
    title: 'Drafts',
    messages: [{ id: 'm4', from: 'Me', subject: 'Re: travel plans' }],
  },
  {
    id: 'archive',
    title: 'Archive',
    messages: [
      { id: 'm5', from: 'Margaret', subject: 'Launch checklist' },
      { id: 'm6', from: 'Alan', subject: 'A puzzle for you' },
    ],
  },
];

const folderOf = (id: string | null): Folder =>
  FOLDERS.find((folder) => folder.id === id) ?? FOLDERS[0]!;

/** The look of a row that opens a screen. */
const ROW =
  'flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 flex';

/**
 * Stack navigation demo: a `<lynx-stack-outlet>` of its own, under the app
 * bar, whose child routes are a mailbox's folders and messages. Opening one
 * slides it in, as iOS and Android do; the Back button, Android's back button
 * or a drag to the right slides it away. The screens under the top one stay
 * alive.
 */
@Component({
  selector: 'app-stack-demo',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  template: `<lynx-stack-outlet />`,
})
export class StackDemo {}

/**
 * The first screen in the stack: the folders.
 */
@Component({
  selector: 'app-stack-demo-folders',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, RouterLink, UiButton, UiIcon, UiText],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full w-full">
      <view class="flex-col gap-3 p-4 flex">
        <ui-text variant="h3">Mailboxes</ui-text>
        <ui-text variant="muted">
          Open a folder, then a message. Go back with Back, Android's back
          button, or by dragging the screen to the right, from its edge or
          anywhere on it.
        </ui-text>
        @for (folder of folders; track folder.id) {
          <view
            [class]="row"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="folder.title"
            [routerLink]="folder.id"
          >
            <ui-text class="flex-1">{{ folder.title }}</ui-text>
            <ui-text variant="muted">{{ folder.messages.length }}</ui-text>
            <ui-icon name="chevron-right" size="sm" />
          </view>
        }
        <ui-button variant="outline" (pressed)="taps.set(taps() + 1)">
          Tapped {{ taps() }} times
        </ui-button>
        <ui-text variant="muted">
          Tap it, open a folder and come back: the count is still here, because
          the screens under the top one stay alive.
        </ui-text>
      </view>
    </scroll-view>
  `,
})
export class StackDemoFolders {
  protected readonly folders = FOLDERS;
  protected readonly row = ROW;
  protected readonly taps = signal(0);
}

/**
 * A folder's screen: its messages.
 */
@Component({
  selector: 'app-stack-demo-folder',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, RouterLink, UiButton, UiIcon, UiText],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full w-full">
      <view class="flex-col gap-3 p-4 flex">
        <view class="flex-row items-center gap-2 flex">
          <ui-button variant="ghost" size="sm" (pressed)="location.back()">
            <ui-icon name="chevron-left" />
            Mailboxes
          </ui-button>
        </view>
        <ui-text variant="h3">{{ current().title }}</ui-text>
        @for (message of current().messages; track message.id) {
          <view
            [class]="row"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="message.subject"
            [routerLink]="message.id"
          >
            <view class="flex-1 flex-col flex">
              <ui-text variant="small">{{ message.from }}</ui-text>
              <ui-text variant="muted">{{ message.subject }}</ui-text>
            </view>
            <ui-icon name="chevron-right" size="sm" />
          </view>
        }
      </view>
    </scroll-view>
  `,
})
export class StackDemoFolder {
  readonly #params = toSignal(inject(ActivatedRoute).paramMap, {
    requireSync: true,
  });
  protected readonly current = computed(() =>
    folderOf(this.#params().get('folder')),
  );
  protected readonly row = ROW;
  protected readonly location = inject(Location);
}

/**
 * A message, three screens deep.
 */
@Component({
  selector: 'app-stack-demo-message',
  hostDirectives: [ScreenHost],
  imports: [LYNX_ELEMENTS, UiButton, UiIcon, UiText],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full w-full">
      <view class="flex-col gap-3 p-4 flex">
        <view class="flex-row items-center gap-2 flex">
          <ui-button variant="ghost" size="sm" (pressed)="location.back()">
            <ui-icon name="chevron-left" />
            {{ parent().title }}
          </ui-button>
        </view>
        <ui-text variant="h3">{{ current().subject }}</ui-text>
        <ui-text variant="muted">From {{ current().from }}</ui-text>
        <ui-text>
          Three screens deep: the mailboxes and {{ parent().title }} are still
          alive under this one.
        </ui-text>
        <ui-button
          variant="secondary"
          (pressed)="router.navigateByUrl('/stack-demo')"
        >
          Back to Mailboxes
        </ui-button>
        <ui-text variant="muted">
          A link to a screen in the stack pops back to it, sliding this one away
          over both.
        </ui-text>
      </view>
    </scroll-view>
  `,
})
export class StackDemoMessage {
  readonly #params = toSignal(inject(ActivatedRoute).paramMap, {
    requireSync: true,
  });
  protected readonly parent = computed(() =>
    folderOf(this.#params().get('folder')),
  );
  protected readonly current = computed(
    () =>
      this.parent().messages.find(
        (m) => m.id === this.#params().get('message'),
      ) ?? this.parent().messages[0]!,
  );
  protected readonly location = inject(Location);
  protected readonly router = inject(Router);
}
