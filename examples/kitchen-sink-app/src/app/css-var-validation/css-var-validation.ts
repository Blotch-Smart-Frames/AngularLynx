import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiBadge } from '../../components/ui/badge';
import { UiIcon } from '../../components/ui/icon';
import { UiSeparator } from '../../components/ui/separator';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * One CSS color/var() syntax to run through Lynx's native style parser.
 *
 * `style` is applied verbatim to the chip so the swatch renders (or fails to
 * render) exactly as it would in real app code — the whole point of this page
 * is to observe the round-trip through `__AddInlineStyle` on-device. `supported`
 * records the KNOWN outcome so the status pill can call out formats to avoid;
 * `tailwind` swatches use a utility class instead of an inline style to prove
 * the Tailwind → var() pipeline.
 */
type Swatch = {
  /** The CSS value, shown in monospace. */
  readonly code: string;
  /** Short human explanation shown under the code. */
  readonly note?: string;
  /** Whether Lynx's parser renders this value (false = silently dropped). */
  readonly supported: boolean;
  /** Inline style applied to the chip. Omitted for `tailwind` swatches. */
  readonly style?: string;
  /** Render the chip via the `bg-primary` utility instead of an inline style. */
  readonly tailwind?: boolean;
};

type SwatchGroup = {
  readonly title: string;
  readonly description: string;
  readonly swatches: readonly Swatch[];
};

/**
 * Visual test matrix for Lynx CSS engine compatibility. Lynx's native style
 * parser doesn't implement the full CSS color spec — e.g. space-separated
 * `hsl(240 5.9% 10%)` and `rgba()` nested inside `hsl()` fail silently. Run this
 * page on-device whenever changing CSS variable handling in the renderer to
 * verify which formats survive: a filled chip rendered, an empty chip did not.
 */
@Component({
  selector: 'app-css-var-validation',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiBadge,
    UiIcon,
    UiSeparator,
    UiText,
  ],
  template: `
    <app-demo-screen
      heading="CSS Variables"
      category="Validation"
      description="Which CSS color and var() syntaxes survive Lynx's native style parser."
    >
      <!-- How to read the matrix -->
      <ui-card class="p-4">
        <view class="flex-row items-start gap-3 flex">
          <ui-icon name="info" size="sm" color="#8b5cf6" />
          <view class="flex-1 flex-col gap-1 flex">
            <ui-text variant="small">How to read this</ui-text>
            <ui-text variant="muted">
              A filled chip means Lynx rendered the value. An empty chip means
              the native parser silently dropped it — avoid that syntax.
            </ui-text>
          </view>
        </view>
      </ui-card>

      @for (group of groups; track group.title) {
        <ui-card>
          <ui-card-header class="p-4 pb-3">
            <view class="flex-row items-start gap-3 flex justify-between">
              <view class="flex-1 flex-col gap-1 flex">
                <ui-card-title class="text-lg">{{ group.title }}</ui-card-title>
                <ui-card-description>{{
                  group.description
                }}</ui-card-description>
              </view>
              <ui-badge variant="outline">
                {{ supportedCount(group) }}/{{ group.swatches.length }}
              </ui-badge>
            </view>
          </ui-card-header>

          <ui-card-content class="flex-col p-4 pt-0 flex">
            @for (s of group.swatches; track s.code; let last = $last) {
              <view class="flex-row items-center gap-3 py-2.5 flex">
                <!-- The chip renders the value under test. A border keeps a
                     dropped (transparent) swatch visible as an empty box. -->
                <view
                  class="h-11 w-11 shrink-0 rounded-xl border border-border"
                  [attr.style]="s.style"
                  [class.bg-primary]="s.tailwind"
                ></view>

                <view class="flex-1 flex-col gap-0.5 flex">
                  <text class="font-[monospace] text-sm text-foreground">{{
                    s.code
                  }}</text>
                  @if (s.note) {
                    <text class="text-xs text-muted-foreground">{{
                      s.note
                    }}</text>
                  }
                </view>

                <view [class]="pillClass(s.supported)">
                  <ui-icon
                    [name]="s.supported ? 'check' : 'x'"
                    size="xs"
                    [color]="s.supported ? '#16a34a' : '#dc2626'"
                  />
                  <text
                    [class]="
                      s.supported
                        ? 'text-xs font-medium text-green-600'
                        : 'text-xs font-medium text-red-600'
                    "
                  >
                    {{ s.supported ? 'Renders' : 'Blank' }}
                  </text>
                </view>
              </view>

              @if (!last) {
                <ui-separator />
              }
            }
          </ui-card-content>
        </ui-card>
      }
    </app-demo-screen>
  `,
})
export class CssVarValidation {
  protected readonly groups: readonly SwatchGroup[] = [
    {
      title: 'Color Formats',
      description: 'Literal color values in background-color.',
      swatches: [
        {
          code: '#18181b',
          note: 'Hex',
          supported: true,
          style: 'background-color: #18181b;',
        },
        {
          code: 'rgb(24, 24, 27)',
          note: 'RGB, comma-separated',
          supported: true,
          style: 'background-color: rgb(24, 24, 27);',
        },
        {
          code: 'rgb(24 24 27)',
          note: 'RGB, space-separated',
          supported: true,
          style: 'background-color: rgb(24 24 27);',
        },
        {
          code: 'rgba(24, 24, 27, 0.5)',
          note: '50% alpha',
          supported: true,
          style: 'background-color: rgba(24, 24, 27, 0.5);',
        },
        {
          code: 'hsl(240, 5.9%, 10%)',
          note: 'HSL, comma-separated',
          supported: true,
          style: 'background-color: hsl(240, 5.9%, 10%);',
        },
        {
          code: 'hsl(240 5.9% 10%)',
          note: 'HSL space-separated — use commas instead',
          supported: false,
          style: 'background-color: hsl(240 5.9% 10%);',
        },
        {
          code: 'hsla(240, 5.9%, 10%, 0.5)',
          note: '50% alpha',
          supported: true,
          style: 'background-color: hsla(240, 5.9%, 10%, 0.5);',
        },
        {
          code: 'red',
          note: 'Named color',
          supported: true,
          style: 'background-color: red;',
        },
      ],
    },
    {
      title: 'CSS Variables',
      description:
        'var() references resolved from page-level custom properties.',
      swatches: [
        {
          code: 'var(--test-hex)',
          note: 'Resolves to #18181b',
          supported: true,
          style: 'background-color: var(--test-hex);',
        },
        {
          code: 'var(--primary)',
          note: 'Theme token — a complete rgba() value',
          supported: true,
          style: 'background-color: var(--primary);',
        },
        {
          code: 'hsl(var(--primary))',
          note: 'rgba() nested inside hsl() is invalid',
          supported: false,
          style: 'background-color: hsl(var(--primary));',
        },
        {
          code: 'var(--missing, #18181b)',
          note: 'Fallback used when the var is undefined',
          supported: true,
          style: 'background-color: var(--missing, #18181b);',
        },
      ],
    },
    {
      title: 'Composition',
      description: 'Colors assembled from multiple variables.',
      swatches: [
        {
          code: 'rgb(var(--r), var(--g), var(--b))',
          note: 'Per-channel custom properties',
          supported: true,
          style:
            'background-color: rgb(var(--test-rgb-r), var(--test-rgb-g), var(--test-rgb-b));',
        },
        {
          code: 'bg-primary',
          note: 'Tailwind class → var(--primary)',
          supported: true,
          tailwind: true,
        },
      ],
    },
  ];

  protected supportedCount(group: SwatchGroup): number {
    return group.swatches.filter((s) => s.supported).length;
  }

  protected pillClass(supported: boolean): string {
    // Translucent named-color tint (bg-green-500/10) is safe in Lynx — opacity
    // modifiers work on named colors, unlike on the opaque rgba() theme tokens.
    return `flex flex-row items-center gap-1 self-start rounded-full px-2.5 py-1 ${
      supported ? 'bg-green-500/10' : 'bg-red-500/10'
    }`;
  }
}
