import { Component, inject, signal } from '@angular/core';
import {
  type ClipboardError,
  LYNX_ELEMENTS,
  LynxClipboard,
} from '@blotch/angular-lynx';
import { UiButton } from '../components/ui/button';
import { UiCopyButton } from '../components/ui/copy-button';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiButton, UiCopyButton],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Copy Button</text>
        <text class="text-sm text-muted-foreground">
          A button that copies text to the clipboard, then says it did.
        </text>

        <!-- The use it was made for: a code to share. -->
        <view class="flex-col gap-3 rounded-lg border border-border p-4 flex">
          <text class="text-sm text-muted-foreground">Your invite code</text>
          <text class="text-2xl font-semibold text-foreground">{{ code }}</text>
          <ui-copy-button
            [value]="code"
            class="w-full"
            (copied)="lastCopied.set($event)"
            (copyFailed)="onFailed($event)"
          >
            Copy invite code
          </ui-copy-button>
        </view>

        <!-- Variants and sizes, as ui-button has. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Variants</text>
          <view class="flex-row flex-wrap items-center gap-3 flex">
            <ui-copy-button
              value="https://angularlynx.js.org"
              variant="outline"
              (copied)="lastCopied.set($event)"
              (copyFailed)="onFailed($event)"
            >
              Copy link
            </ui-copy-button>
            <ui-copy-button
              value="npx @blotch/dolan add copy-button"
              variant="secondary"
              size="sm"
              (copied)="lastCopied.set($event)"
              (copyFailed)="onFailed($event)"
            >
              Copy command
            </ui-copy-button>
            <ui-copy-button
              [value]="code"
              variant="ghost"
              size="icon"
              accessibility-label="Copy invite code"
              (copied)="lastCopied.set($event)"
              (copyFailed)="onFailed($event)"
            />
          </view>
        </view>

        <!-- Reads the clipboard back with LynxClipboard. iOS asks first when
             another app copied the text. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Clipboard</text>
          <text class="text-sm text-muted-foreground">
            Last copied: {{ lastCopied() || 'nothing yet' }}
          </text>
          <view class="flex-row items-center gap-3 flex">
            <ui-button variant="outline" size="sm" (pressed)="paste()">
              Paste
            </ui-button>
            <text class="flex-1 text-sm text-foreground">{{ pasted() }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #clipboard = inject(LynxClipboard);
  protected readonly code = 'LYNX-2026';
  protected readonly lastCopied = signal('');
  protected readonly pasted = signal('');

  protected onFailed(error: ClipboardError): void {
    this.lastCopied.set(`couldn't copy (${error.code})`);
  }

  protected paste(): void {
    this.#clipboard.getString().then(
      (text) => this.pasted.set(text ? `"${text}"` : 'The clipboard is empty.'),
      (error: ClipboardError) => this.pasted.set(error.message),
    );
  }
}
