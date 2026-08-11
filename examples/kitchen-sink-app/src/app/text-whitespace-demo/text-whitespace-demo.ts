import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * --- Text whitespace / inline composition ---
 *
 * Lynx's native `<text>` renders raw text verbatim — it has no CSS white-space
 * model, so it does NOT collapse runs or trim the leading/trailing space that
 * Angular's template compiler leaves behind. The renderer fixes this in two
 * layers: it collapses whitespace at create/update time, then trims POSITIONALLY
 * at flush over each text's inline-formatting context — stripping the leading
 * space of the first run and the trailing space of the last, while preserving the
 * spaces BETWEEN adjacent runs.
 *
 * This screen makes that behavior visible. Every template below is written
 * NATURALLY (indented, multi-line) — the whole point is that authors no longer
 * need the `<text\n  >hug</text\n>` workaround to avoid a stray leading indent.
 */
@Component({
  selector: 'app-text-whitespace-demo',
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiIcon,
  ],
  template: `
    <app-demo-screen
      heading="Text Whitespace"
      category="Validation"
      description="Inline text composition on Lynx — adjacent runs keep the spaces between them, and template indentation is trimmed, matching how a browser lays out white-space: normal text."
    >
      <!-- Adjacent styled runs coalesce into one line, spaces intact. -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="ellipsis" size="sm" />
            <ui-card-title class="text-lg">Adjacent runs</ui-card-title>
          </view>
          <ui-card-description>
            Three separately-styled runs on one line read as a single sentence.
            The spaces between them survive — without inline-context trimming
            this would render "Onetwothree".
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <view class="rounded-lg border border-border bg-muted px-4 py-3">
            <text class="text-base text-foreground">
              <text class="text-primary">One </text>
              <text class="font-bold text-foreground">two</text>
              <text class="text-primary"> three</text>
            </text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- Real-world shape: an inline-emphasized value inside running text. -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-card-title class="text-lg">Inline emphasis</ui-card-title>
          </view>
          <ui-card-description>
            A bold amount nested mid-sentence keeps exactly one space on each
            side, no matter that the runs are separate elements.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <view class="rounded-lg border border-border bg-muted px-4 py-3">
            <text class="text-base text-foreground">
              <text>Total: </text>
              <text class="font-bold text-primary">$1,240.00</text>
              <text> due today</text>
            </text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- Edges trimmed; a deliberate &nbsp; is the escape hatch. -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-right" size="sm" />
            <ui-card-title class="text-lg">Edges trimmed</ui-card-title>
          </view>
          <ui-card-description>
            Prose written across indented lines renders flush against the border
            (top). Only ASCII whitespace is trimmed, so a deliberate &nbsp;
            stays as a literal indent (bottom).
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <view
            class="flex-col gap-2 rounded-lg border-l-2 border-primary bg-muted py-2"
          >
            <text class="text-sm text-foreground">
              This sentence spans several indented template lines, yet it
              renders flush with no leading indent.
            </text>
            <text class="text-sm text-muted-foreground">
              &nbsp;&nbsp;&nbsp;&nbsp;A non-breaking space keeps this line
              indented.
            </text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- Runtime values: setValue normalizes on every change. -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">Runtime values</ui-card-title>
          </view>
          <ui-card-description>
            Interpolated values are normalized too. This binding pads and
            double-spaces its text on purpose; tap to update it and it still
            renders clean.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <view
            class="flex-col gap-2 rounded-lg border border-border bg-muted px-4 py-3 flex"
            (bindtap)="bump()"
          >
            <text class="text-base text-foreground">{{ noisy() }}</text>
            <text class="text-xs text-muted-foreground">Tap to update</text>
          </view>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class TextWhitespaceDemo {
  readonly #taps = signal(0);

  // The bound value is deliberately padded and double-spaced. The renderer
  // collapses the interior runs and trims the edges on every update, so the
  // <text> always reads "Tapped N time(s)".
  readonly noisy = computed(() => {
    const n = this.#taps();
    return `   Tapped    ${n}    time${n === 1 ? '' : 's'}   `;
  });

  bump(): void {
    // Defer the signal write out of the native bindtap worklet callback —
    // mutating state that drives the element tree inside the worklet crashes
    // Lynx's main-thread pipeline (see App.navigateTo in app.ts).
    setTimeout(() => this.#taps.update((n) => n + 1), 0);
  }
}
