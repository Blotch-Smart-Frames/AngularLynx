import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { type SheetDetent } from '../components/ui/bottom-sheet';
import { injectGlassDesign } from '../components/ui/glass';
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

        <!-- Glass: each platform's own sheet, at half height and full
             height. On iOS 26 it floats inset over the page, and turns
             opaque as it's dragged up to full height. -->
        <text class="text-lg font-semibold text-foreground">Glass</text>
        <text class="text-xs text-muted-foreground">{{ status() }}</text>
        <ui-button variant="outline" (pressed)="showGlass.set(true)">
          Open Glass Sheet
        </ui-button>
        <view
          class="h-[480px] rounded-[28px]"
          [style.background-image]="landscape"
        ></view>

        <ui-sheet
          variant="glass"
          [detents]="['medium', 'large']"
          [(open)]="showGlass"
          [(detent)]="glassDetent"
        >
          <ui-sheet-header>
            <ui-sheet-title>Trip to Kyoto</ui-sheet-title>
            <ui-sheet-description>
              Drag the handle up, or tap it, for the full sheet.
              {{ glassDetent() === 'large' ? 'Now at full height.' : '' }}
            </ui-sheet-description>
          </ui-sheet-header>
          <view class="flex-1 flex-col gap-3 flex">
            <text class="text-sm text-foreground">Dates: 4 to 11 April</text>
            <text class="text-sm text-foreground">Travelers: 2</text>
            <text class="text-sm text-foreground">Stay: near the old town</text>
          </view>
          <ui-sheet-footer>
            <ui-button (pressed)="showGlass.set(false)">Done</ui-button>
          </ui-sheet-footer>
        </ui-sheet>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly showSheet = signal(false);
  readonly showGlass = signal(false);
  readonly glassDetent = signal<SheetDetent | undefined>(undefined);

  /** A colorful "photo" for the glass to show around it. */
  readonly landscape =
    'linear-gradient(180deg, #38bdf8, #818cf8 40%, #f472b6 70%, #fb923c)';

  /** What the glass sheet draws here, and the setting it follows. */
  readonly status = computed(() => {
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    const motion = this.#settings.reduceMotion() ? 'on' : 'off';
    return `Design: ${this.#design()} on ${os} · Reduce Motion: ${motion}`;
  });
}
