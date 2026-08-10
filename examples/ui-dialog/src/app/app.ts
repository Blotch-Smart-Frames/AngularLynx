import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiDialog,
  UiDialogHeader,
  UiDialogTitle,
  UiDialogDescription,
  UiDialogFooter,
} from '../components/ui/dialog';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiDialog,
    UiDialogHeader,
    UiDialogTitle,
    UiDialogDescription,
    UiDialogFooter,
    UiButton,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full bg-red-500">
      <view class="flex-col gap-4 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Dialog</text>

        <ui-button (pressed)="showDialog.set(true)">Edit Profile</ui-button>

        <ui-dialog [(open)]="showDialog">
          <ui-dialog-header>
            <ui-dialog-title>Edit Profile</ui-dialog-title>
            <ui-dialog-description>
              Make changes to your profile here. Tap outside the dialog to
              dismiss.
            </ui-dialog-description>
          </ui-dialog-header>
          <view class="flex-col gap-3 py-4 flex">
            <text class="text-sm text-foreground"> Name: John Doe </text>
            <text class="text-sm text-foreground">
              Email: john&#64;example.com
            </text>
          </view>
          <ui-dialog-footer>
            <ui-button variant="outline" (pressed)="showDialog.set(false)">
              Cancel
            </ui-button>
            <ui-button (pressed)="onSave()">Save changes</ui-button>
          </ui-dialog-footer>
        </ui-dialog>
      </view>
    </scroll-view>
  `,
})
export class App {
  showDialog = signal(false);

  onSave(): void {
    this.showDialog.set(false);
  }
}
