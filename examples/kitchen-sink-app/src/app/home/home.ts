import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import type { TouchEvent } from '@lynx-js/types';
import angularLogo from '../../assets/angular-logo.png';
import lynxLogo from '../../assets/lynx-logo.png';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import {
  UiDialog,
  UiDialogDescription,
  UiDialogFooter,
  UiDialogHeader,
  UiDialogTitle,
} from '../../components/ui/dialog';
import { UiInput } from '../../components/ui/input';
import { UiTextarea } from '../../components/ui/textarea';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

@Component({
  selector: 'app-home',
  // `home` gives the host a positioned containing block so the fixed emerald
  // backdrop (`.home__bg`) can fill it precisely. See home.css for why the
  // backdrop is a sibling *before* the scroll-view rather than a child.
  host: { class: 'home' },
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    UiButton,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiDialog,
    UiDialogHeader,
    UiDialogTitle,
    UiDialogDescription,
    UiDialogFooter,
    UiInput,
    UiTextarea,
    UiText,
  ],
  template: `
    <!-- Fixed emerald backdrop. Declared as a sibling BEFORE the scroll-view
         (never inside it): an absolute layer within a scroll-view sits above it
         in z-order and swallows the scroll gesture. As a first sibling it paints
         underneath and, living outside the scrolling container, stays put while
         the content scrolls over it. -->
    <view class="home__bg" />

    <scroll-view scroll-orientation="vertical" class="h-full w-full">
      <view class="flex-col items-center gap-4 p-4 flex">
        <view class="logo" (bindtap)="onTap($event)">
          @if (alterLogo()) {
            <image [src]="angularLogo" class="logo--angular" />
          } @else {
            <image [src]="lynxLogo" class="logo--lynx" />
          }
        </view>

        <view class="flex-col items-center gap-1 flex">
          <ui-text variant="h1" class="text-zinc-900">Angular</ui-text>
          <ui-text variant="lead" class="text-zinc-600">on Lynx</ui-text>
        </view>
        <ui-text variant="muted" class="text-zinc-600">
          Tap the logo and have fun!
        </ui-text>

        <ui-card class="w-full">
          <ui-card-header class="p-4">
            <ui-card-title>Native inputs</ui-card-title>
            <ui-card-description>
              Dolan form controls wrapping Lynx native input fields.
            </ui-card-description>
          </ui-card-header>
          <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
            <ui-input label="Name" placeholder="Enter text" [(value)]="name" />
            <ui-textarea
              label="Message"
              placeholder="Enter multi-line text"
              [(value)]="message"
            />
          </ui-card-content>
        </ui-card>

        <ui-card class="w-full">
          <ui-card-header class="p-4">
            <ui-card-title>Overlay dialog</ui-card-title>
            <ui-card-description>
              A modal rendered outside the document flow via the native overlay
              element.
            </ui-card-description>
          </ui-card-header>
          <ui-card-content class="p-4 pt-0">
            <ui-button (pressed)="showDialog.set(true)">Open Dialog</ui-button>
          </ui-card-content>
        </ui-card>

        <ui-text variant="muted" class="text-zinc-600">
          Edit src/app/home/home.ts
        </ui-text>
      </view>

      <ui-dialog [(open)]="showDialog">
        <ui-dialog-header>
          <ui-dialog-title>Overlay Demo</ui-dialog-title>
          <ui-dialog-description>
            This modal is rendered outside the Lynx document flow using the
            native overlay element.
          </ui-dialog-description>
        </ui-dialog-header>
        <ui-dialog-footer>
          <ui-button variant="outline" (pressed)="showDialog.set(false)">
            Close
          </ui-button>
        </ui-dialog-footer>
      </ui-dialog>
    </scroll-view>
  `,
  styleUrl: './home.css',
})
export class Home {
  readonly alterLogo = signal(false);
  readonly showDialog = signal(false);
  readonly name = signal('');
  readonly message = signal('');

  readonly angularLogo = angularLogo;
  readonly lynxLogo = lynxLogo;

  onTap(_event: TouchEvent): void {
    // Signal write from a native tap is safe: zoneless change detection runs
    // asynchronously, so the element tree is not mutated inside the worklet.
    this.alterLogo.update((value) => !value);
  }
}
