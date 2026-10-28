import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiActionSheet,
  UiActionSheetAnchor,
  UiActionSheetTitle,
  UiActionSheetItem,
  UiActionSheetCancel,
} from '../components/ui/action-sheet';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiActionSheet,
    UiActionSheetAnchor,
    UiActionSheetTitle,
    UiActionSheetItem,
    UiActionSheetCancel,
    UiButton,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <view class="flex-col gap-1 flex">
          <text class="text-2xl font-bold text-foreground">Action Sheet</text>
          <text class="text-sm text-muted-foreground">
            A short list of choices about something you just did.
          </text>
          <text class="text-xs text-muted-foreground">
            Last action: {{ lastAction() }}
          </text>
        </view>

        <view class="flex-col gap-3 flex">
          <text class="text-sm font-semibold text-foreground">
            From the bottom
          </text>
          <ui-button (pressed)="showSheet.set(true)">Share Document</ui-button>

          <ui-action-sheet [(open)]="showSheet">
            <ui-action-sheet-title>Share this document</ui-action-sheet-title>
            <ui-action-sheet-item (pressed)="did('Copied link')">
              Copy Link
            </ui-action-sheet-item>
            <ui-action-sheet-item (pressed)="did('Sent email')">
              Send via Email
            </ui-action-sheet-item>
            <ui-action-sheet-item
              variant="destructive"
              (pressed)="did('Deleted document')"
            >
              Delete Document
            </ui-action-sheet-item>
            <ui-action-sheet-cancel />
          </ui-action-sheet>
        </view>

        <view class="flex-col gap-3 flex">
          <text class="text-sm font-semibold text-foreground">
            From its button
          </text>
          <text class="text-xs text-muted-foreground">
            On iOS 26 it grows out of the button, and on Android it's a menu
            beside it. The rest of the screen stays as it was. Before iOS 26 it
            rises from the bottom, as iPhone action sheets did.
          </text>
          <ui-button
            variant="outline"
            class="self-start"
            [uiActionSheetAnchor]="draftSheet"
            (pressed)="showDraft.set(true)"
          >
            Discard Draft
          </ui-button>

          <ui-action-sheet #draftSheet [(open)]="showDraft">
            <ui-action-sheet-title>Delete this draft?</ui-action-sheet-title>
            <ui-action-sheet-item
              variant="destructive"
              (pressed)="did('Deleted draft')"
            >
              Delete Draft
            </ui-action-sheet-item>
            <ui-action-sheet-item (pressed)="did('Saved draft')">
              Save Draft
            </ui-action-sheet-item>
            <ui-action-sheet-cancel />
          </ui-action-sheet>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly showSheet = signal(false);
  readonly showDraft = signal(false);
  readonly lastAction = signal('none');

  did(action: string): void {
    this.lastAction.set(action);
  }
}
