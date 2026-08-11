import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiSheet,
  UiSheetHeader,
  UiSheetTitle,
  UiSheetDescription,
  UiSheetFooter,
} from '../components/ui/sheet';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiSheet,
    UiSheetHeader,
    UiSheetTitle,
    UiSheetDescription,
    UiSheetFooter,
    UiButton,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-4 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Sheet</text>

        <ui-button (pressed)="showSheet.set(true)">Open Sheet</ui-button>

        <ui-sheet [(open)]="showSheet">
          <ui-sheet-header>
            <ui-sheet-title>Edit Settings</ui-sheet-title>
            <ui-sheet-description>
              Configure your preferences. Drag down or tap the backdrop to
              dismiss.
            </ui-sheet-description>
          </ui-sheet-header>
          <view class="flex-col gap-3 py-4 flex">
            <text class="text-sm text-foreground">
              Notifications: Enabled
            </text>
            <text class="text-sm text-foreground"> Dark mode: Off </text>
            <text class="text-sm text-foreground"> Language: English </text>
          </view>
          <ui-sheet-footer>
            <ui-button (pressed)="showSheet.set(false)">Save changes</ui-button>
            <ui-button variant="outline" (pressed)="showSheet.set(false)">
              Cancel
            </ui-button>
          </ui-sheet-footer>
        </ui-sheet>
      </view>
    </scroll-view>
  `,
})
export class App {
  showSheet = signal(false);
}
