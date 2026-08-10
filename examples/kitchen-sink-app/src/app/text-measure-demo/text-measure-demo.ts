import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxTextMeasure } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiInput } from '../../components/ui/input';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

@Component({
  selector: 'app-text-measure-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiBadge,
    UiButton,
    UiCard,
    UiCardContent,
    UiCardDescription,
    UiCardHeader,
    UiCardTitle,
    UiInput,
    UiText,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-demo-screen
      heading="Text Measure"
      category="Platform"
      description="Measure rendered text with lynx.getTextInfo() — pixel width at any font size, plus native line-breaking. Type below and every panel updates live."
    >
      <!-- One input drives all three panels: they all read the same signal. -->
      <ui-input
        label="Text to measure"
        placeholder="Type anything…"
        [value]="text()"
        (changed)="text.set($event)"
      />

      <!-- Panel 1 — live preview at a size the user picks. The rendered glyphs
           and the reported width sit side by side so the number feels tangible. -->
      <ui-card>
        <ui-card-header class="gap-1 p-4 pb-0">
          <ui-card-title class="text-base">Live preview</ui-card-title>
          <ui-card-description>
            Rendered at the selected font size.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-4 p-4 flex">
          <view class="flex-row flex-wrap gap-2 flex">
            @for (size of previewSizes; track size) {
              <ui-button
                size="sm"
                [variant]="previewSize() === size ? 'default' : 'outline'"
                (pressed)="previewSize.set(size)"
              >
                {{ size }}px
              </ui-button>
            }
          </view>

          <view class="rounded-lg bg-muted p-4 flex">
            @if (text()) {
              <text
                class="text-foreground"
                [style]="'font-size: ' + previewSize() + 'px;'"
              >
                {{ text() }}
              </text>
            } @else {
              <ui-text variant="muted">Type something to measure it.</ui-text>
            }
          </view>

          <view class="flex-row gap-3 flex">
            <view
              class="flex-1 flex-col items-center gap-1 rounded-lg bg-muted px-2 py-3 flex"
            >
              <ui-text variant="h3" class="text-primary">{{
                previewWidth()
              }}</ui-text>
              <ui-text variant="muted">pixels wide</ui-text>
            </view>
            <view
              class="flex-1 flex-col items-center gap-1 rounded-lg bg-muted px-2 py-3 flex"
            >
              <ui-text variant="h3">{{ charCount() }}</ui-text>
              <ui-text variant="muted">characters</ui-text>
            </view>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- Panel 2 — the same text at four sizes, drawn as a bar chart. Bars are
           normalized to the widest sample so they always fit and make the
           "bigger font ⇒ wider" relationship obvious at a glance. -->
      <ui-card>
        <ui-card-header class="gap-1 p-4 pb-0">
          <ui-card-title class="text-base">Width by font size</ui-card-title>
          <ui-card-description>
            Bars are relative to the widest row; labels are the real pixel
            widths.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 flex">
          @for (metric of sizeMetrics(); track metric.size) {
            <view class="flex-row items-center gap-3 flex">
              <text class="w-10 text-sm text-muted-foreground">
                {{ metric.size }}px
              </text>
              <view
                class="h-2.5 flex-1 rounded-full bg-muted flex overflow-hidden"
              >
                <view
                  class="h-full rounded-full bg-primary"
                  [style]="barWidth(metric.width)"
                ></view>
              </view>
              <text class="w-14 text-sm text-foreground text-right">
                {{ metric.width }}px
              </text>
            </view>
          }
        </ui-card-content>
      </ui-card>

      <!-- Panel 3 — line breaking. The dashed box is drawn at exactly the chosen
           width, and the lines inside are the "content" array getTextInfo
           returns — so the box shows the engine's real break points (and where
           it truncates at the line cap), not the browser's own wrapping. -->
      <ui-card>
        <ui-card-header class="gap-1 p-4 pb-0">
          <ui-card-title class="text-base">Line breaking</ui-card-title>
          <ui-card-description>
            getTextInfo reports where each line breaks for a given width, capped
            at {{ maxLine }} lines.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-4 p-4 flex">
          <view class="flex-row flex-wrap items-center gap-2 flex">
            <ui-text variant="muted">Container width</ui-text>
            @for (width of wrapWidths; track width) {
              <ui-button
                size="sm"
                [variant]="wrapWidth() === width ? 'default' : 'outline'"
                (pressed)="wrapWidth.set(width)"
              >
                {{ width }}px
              </ui-button>
            }
          </view>

          <view class="items-start flex">
            <view
              class="flex-col gap-0.5 rounded-lg border border-dashed border-border bg-muted p-3 flex"
              [style]="'width: ' + wrapWidth() + 'px;'"
            >
              @if (wrappedLines().length) {
                @for (line of wrappedLines(); track $index) {
                  <text class="text-foreground" style="font-size: 15px;">{{
                    line
                  }}</text>
                }
              } @else {
                <ui-text variant="muted">
                  Type something to see it wrap.
                </ui-text>
              }
            </view>
          </view>

          <view class="flex-row flex-wrap gap-2 flex">
            <ui-badge variant="secondary" [animated]="false">
              {{ wrappedLines().length }} / {{ maxLine }} lines
            </ui-badge>
            <ui-badge variant="outline" [animated]="false">
              {{ wrapWidth() }}px wide
            </ui-badge>
          </view>
        </ui-card-content>
      </ui-card>

      <ui-text variant="muted">
        Measurements use built-in platform fonts. Text set in a custom font-face
        or LynxFont family falls back to the system font, so its numbers won't
        match.
      </ui-text>
    </app-demo-screen>
  `,
})
export class TextMeasureDemo {
  readonly #textMeasure = inject(LynxTextMeasure);

  /** The text every panel measures. Seeded so the demo is informative on load. */
  readonly text = signal('The quick brown fox jumps over the lazy dog');

  /** Character count shown alongside the measured width. */
  readonly charCount = computed(() => this.text().length);

  // --- Panel 1: preview at a user-selected size ------------------------------
  readonly previewSizes = [16, 24, 32, 48] as const;
  readonly previewSize = signal<number>(32);
  readonly previewWidth = computed(() =>
    Math.round(
      this.#textMeasure.measure(this.text(), {
        fontSize: `${this.previewSize()}px`,
      }).width,
    ),
  );

  // --- Panel 2: width across a fixed set of sizes ----------------------------
  readonly #chartSizes = [14, 20, 28, 40] as const;
  readonly sizeMetrics = computed(() =>
    this.#chartSizes.map((size) => ({
      size,
      width: Math.round(
        this.#textMeasure.measure(this.text(), { fontSize: `${size}px` }).width,
      ),
    })),
  );
  /** Widest sample, used to normalize the bar chart (min 1 to avoid /0). */
  readonly #maxSizeWidth = computed(() =>
    Math.max(1, ...this.sizeMetrics().map((metric) => metric.width)),
  );

  // --- Panel 3: line-breaking within a fixed container -----------------------
  readonly wrapWidths = [120, 180, 240] as const;
  readonly wrapWidth = signal<number>(180);
  /** Line cap passed to getTextInfo; also shown in the results. */
  readonly maxLine = 4;
  readonly wrapped = computed(() =>
    this.#textMeasure.measure(this.text(), {
      fontSize: '15px',
      maxWidth: `${this.wrapWidth()}px`,
      maxLine: this.maxLine,
    }),
  );
  readonly wrappedLines = computed(() => this.wrapped().content ?? []);

  /**
   * Bar width as a percentage of the widest sample, for the size chart.
   */
  protected barWidth(width: number): string {
    return `width: ${Math.round((width / this.#maxSizeWidth()) * 100)}%;`;
  }
}
