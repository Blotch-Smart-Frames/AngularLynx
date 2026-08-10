import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiAlertDialog,
  UiAlertDialogHeader,
  UiAlertDialogTitle,
  UiAlertDialogDescription,
  UiAlertDialogFooter,
} from '../components/ui/alert-dialog';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiAlertDialog,
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    UiButton,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-4 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Alert Dialog</text>

        <ui-button (pressed)="showDialog.set(true)">Delete Account</ui-button>

        <ui-alert-dialog [(open)]="showDialog">
          <ui-alert-dialog-header>
            <ui-alert-dialog-title>
              Are you absolutely sure?
            </ui-alert-dialog-title>
            <ui-alert-dialog-description>
              This action cannot be undone. This will permanently delete your
              account and remove your data from our servers.
            </ui-alert-dialog-description>
          </ui-alert-dialog-header>
          <ui-alert-dialog-footer>
            <ui-button variant="outline" (pressed)="showDialog.set(false)">
              Cancel
            </ui-button>
            <ui-button variant="destructive" (pressed)="onConfirm()">
              Continue
            </ui-button>
          </ui-alert-dialog-footer>
        </ui-alert-dialog>
      </view>
    </scroll-view>
  `,
})
export class App {
  showDialog = signal(false);

  onConfirm(): void {
    this.showDialog.set(false);
  }
}
