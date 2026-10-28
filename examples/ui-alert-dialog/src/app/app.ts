import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import {
  UiAlertDialog,
  UiAlertDialogAction,
  UiAlertDialogHeader,
  UiAlertDialogTitle,
  UiAlertDialogDescription,
  UiAlertDialogFooter,
} from '../components/ui/alert-dialog';
import { UiButton } from '../components/ui/button';
import { injectGlassDesign } from '../components/ui/glass';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiAlertDialog,
    UiAlertDialogAction,
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    UiButton,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Alert Dialog</text>
        <text class="text-sm text-muted-foreground">
          Asks the user to confirm or cancel, and closes only when they choose.
        </text>
        <text class="text-xs text-muted-foreground">
          Last choice: {{ lastChoice() || 'none yet' }}
        </text>

        <!-- Default: the alert dialog's own panel, with your own buttons. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Default</text>
          <ui-button variant="destructive" (pressed)="showDefault.set(true)">
            Delete Account
          </ui-button>
        </view>

        <!-- Glass: each platform's own alert. It floats over the content, so
             a colorful card shows the glass bending what's behind it. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Glass</text>
          <text class="text-xs text-muted-foreground">{{ status() }}</text>
          <view
            class="flex-col gap-3 rounded-[20px] p-4 flex"
            [style.background-image]="sunset"
          >
            <ui-button variant="secondary" (pressed)="showDelete.set(true)">
              Delete photo
            </ui-button>
            <ui-button variant="secondary" (pressed)="showSave.set(true)">
              Save changes
            </ui-button>
            <ui-button variant="secondary" (pressed)="showClose.set(true)">
              Close document
            </ui-button>
            <view class="h-[220px]"></view>
          </view>
        </view>

        <ui-alert-dialog [(open)]="showDefault">
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
            <ui-button variant="outline" (pressed)="choose('Kept account')">
              Cancel
            </ui-button>
            <ui-button
              variant="destructive"
              (pressed)="choose('Deleted account')"
            >
              Continue
            </ui-button>
          </ui-alert-dialog-footer>
        </ui-alert-dialog>

        <!-- Two actions sit side by side, cancel first. -->
        <ui-alert-dialog variant="glass" [(open)]="showDelete">
          <ui-alert-dialog-header>
            <ui-alert-dialog-title>Delete Photo?</ui-alert-dialog-title>
            <ui-alert-dialog-description>
              This photo will be deleted from all your devices.
            </ui-alert-dialog-description>
          </ui-alert-dialog-header>
          <ui-alert-dialog-footer>
            <ui-alert-dialog-action
              variant="cancel"
              (pressed)="lastChoice.set('Kept photo')"
            >
              Cancel
            </ui-alert-dialog-action>
            <ui-alert-dialog-action
              variant="destructive"
              (pressed)="lastChoice.set('Deleted photo')"
            >
              Delete
            </ui-alert-dialog-action>
          </ui-alert-dialog-footer>
        </ui-alert-dialog>

        <!-- The preferred action is the one to take: filled with the tint
             on iOS 26, bold before it. -->
        <ui-alert-dialog variant="glass" [(open)]="showSave">
          <ui-alert-dialog-header>
            <ui-alert-dialog-title>Save Changes?</ui-alert-dialog-title>
            <ui-alert-dialog-description>
              Your edits to this note haven't been saved yet.
            </ui-alert-dialog-description>
          </ui-alert-dialog-header>
          <ui-alert-dialog-footer>
            <ui-alert-dialog-action
              variant="cancel"
              (pressed)="lastChoice.set('Kept editing')"
            >
              Cancel
            </ui-alert-dialog-action>
            <ui-alert-dialog-action
              preferred
              (pressed)="lastChoice.set('Saved')"
            >
              Save
            </ui-alert-dialog-action>
          </ui-alert-dialog-footer>
        </ui-alert-dialog>

        <!-- Three actions stack, with cancel at the bottom wherever it's
             written. -->
        <ui-alert-dialog variant="glass" [(open)]="showClose">
          <ui-alert-dialog-header>
            <ui-alert-dialog-title>Close Document?</ui-alert-dialog-title>
            <ui-alert-dialog-description>
              Do you want to save the changes you made to "Trip Plan"?
            </ui-alert-dialog-description>
          </ui-alert-dialog-header>
          <ui-alert-dialog-footer>
            <ui-alert-dialog-action
              variant="cancel"
              (pressed)="lastChoice.set('Kept open')"
            >
              Cancel
            </ui-alert-dialog-action>
            <ui-alert-dialog-action
              preferred
              (pressed)="lastChoice.set('Saved and closed')"
            >
              Save
            </ui-alert-dialog-action>
            <ui-alert-dialog-action
              variant="destructive"
              (pressed)="lastChoice.set('Closed without saving')"
            >
              Don't Save
            </ui-alert-dialog-action>
          </ui-alert-dialog-footer>
        </ui-alert-dialog>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly sunset =
    'linear-gradient(160deg, #fde68a, #fb923c 35%, #db2777 70%, #6d28d9)';

  readonly showDefault = signal(false);
  readonly showDelete = signal(false);
  readonly showSave = signal(false);
  readonly showClose = signal(false);
  readonly lastChoice = signal('');

  /** What the glass variant draws here, and the settings it follows. */
  readonly status = computed(() => {
    const on = (value: boolean) => (value ? 'on' : 'off');
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${on(this.#settings.reduceMotion())}`,
      `Reduce Transparency: ${on(this.#settings.reduceTransparency())}`,
      `Increase Contrast: ${on(this.#settings.increaseContrast())}`,
    ].join(' · ');
  });

  choose(choice: string): void {
    this.lastChoice.set(choice);
    this.showDefault.set(false);
  }
}
