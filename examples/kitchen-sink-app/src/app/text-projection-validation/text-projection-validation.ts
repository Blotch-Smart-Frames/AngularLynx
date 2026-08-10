import { Component, signal } from '@angular/core';
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
 * --- The subjects of this demo: wrappers that project into a Lynx <text> ---
 *
 * The whole point of this screen is a Lynx-specific question: does Angular's
 * `<ng-content>` work when the projection target is a native `<text>` element
 * rather than a `<view>`? On the web any element can host projected nodes; on
 * Lynx `<text>` is a leaf-ish inline container with its own layout rules, so
 * this is worth validating.
 *
 * Each wrapper below places `<ng-content>` *inside* a `<text>` and frames it
 * with shared theme tokens (bg-muted / border-border / text-foreground) so the
 * result looks native and follows dark mode — unlike the first version, which
 * hard-coded bg-green-100 / bg-orange-50 / text-zinc-900 and ignored the theme.
 */

/**
 * Single default slot inside a `<text>`. Whatever the caller nests — a raw
 * string or a styled `<text>` — flows into inline text layout, not box layout.
 */
@Component({
  selector: 'app-text-wrapper',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="rounded-lg border border-border bg-muted px-4 py-3">
      <text class="text-sm text-foreground"><ng-content /></text>
    </view>
  `,
})
export class TextWrapper {}

/**
 * Named-slot projection within a single `<text>`. `select="[prefix]"` routes the
 * marked run to the front; everything else falls through to the default slot,
 * and both share one continuous line of text.
 */
@Component({
  selector: 'app-multi-slot-text',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="rounded-lg border border-border bg-muted px-4 py-3">
      <text class="text-sm text-foreground">
        <ng-content select="[prefix]" />
        <ng-content />
      </text>
    </view>
  `,
})
export class MultiSlotText {}

/**
 * Conditional projection inside a `<text>`. The projected content lives in an
 * `@if`, so tapping the box adds or removes it from the text tree at runtime —
 * proving projection into `<text>` survives dynamic re-rendering, not just the
 * initial paint.
 */
@Component({
  selector: 'app-conditional-text',
  imports: [LYNX_ELEMENTS],
  template: `
    <view
      class="flex-col gap-2 rounded-lg border border-border bg-muted px-4 py-3 flex"
      (bindtap)="toggle()"
    >
      <text class="text-sm text-foreground">
        @if (show()) {
          <ng-content />
        } @else {
          <text class="text-muted-foreground">
            Tap to reveal the projected text
          </text>
        }
      </text>
    </view>
  `,
})
export class ConditionalText {
  readonly show = signal(true);

  toggle(): void {
    // Defer the signal write out of the native `bindtap` callback. Flipping this
    // signal toggles the `@if`, which mutates the element tree; doing that
    // synchronously while the native tap is still on the call stack flushes the
    // renderer mid-event and breaks Lynx's main-thread frame pipeline.
    setTimeout(() => this.show.update((v) => !v), 0);
  }
}

/**
 * The real-world pattern this whole screen validates: a `@blotch/ui`-style
 * component that takes its label through `<ng-content>` inside a styled `<text>`
 * — no `input()` string prop required. Mirrors how `UiCardTitle` works.
 */
@Component({
  selector: 'app-card-title-mock',
  imports: [LYNX_ELEMENTS],
  template: `<text class="text-lg font-semibold text-foreground"
    ><ng-content
  /></text>`,
})
export class CardTitleMock {}

/**
 * --- Main validation screen ---
 *
 * One `ui-card` per projection concept, each framing a live wrapper above, so
 * the page reads like the sibling Content Projection demo rather than a raw
 * test dump.
 */
@Component({
  selector: 'app-text-projection-validation',
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
    TextWrapper,
    MultiSlotText,
    ConditionalText,
    CardTitleMock,
  ],
  template: `
    <app-demo-screen
      heading="Text Projection"
      category="Validation"
      description="Angular <ng-content> projecting into Lynx <text> elements — plain strings, nested text, named slots, and conditional content all flowing through inline text layout."
    >
      <!-- ── Plain string projected into <text> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="circle" size="sm" />
            <ui-card-title class="text-lg">Plain text</ui-card-title>
          </view>
          <ui-card-description>
            A raw string passed between a component's tags lands inside a native
            &lt;text&gt; element.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-text-wrapper>Hello from Angular</app-text-wrapper>
        </ui-card-content>
      </ui-card>

      <!-- ── A styled <text> projected into a parent <text> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-right" size="sm" />
            <ui-card-title class="text-lg">Nested text</ui-card-title>
          </view>
          <ui-card-description>
            A styled &lt;text&gt; projected into a parent &lt;text&gt; keeps its
            own styling while flowing inline.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-text-wrapper>
            <text class="font-bold text-primary">Bold and themed</text>
          </app-text-wrapper>
        </ui-card-content>
      </ui-card>

      <!-- ── Multiple projected runs coalescing into one line ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="ellipsis" size="sm" />
            <ui-card-title class="text-lg">Multiple children</ui-card-title>
          </view>
          <ui-card-description>
            Several projected text runs coalesce into one continuous line, each
            keeping its own weight and color.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-text-wrapper>
            <text class="text-muted-foreground">One </text>
            <text class="font-bold text-foreground">two</text>
            <text class="text-muted-foreground"> three</text>
          </app-text-wrapper>
        </ui-card-content>
      </ui-card>

      <!-- ── Named slot: select="[prefix]" inside a <text> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="menu" size="sm" />
            <ui-card-title class="text-lg">Named slots</ui-card-title>
          </view>
          <ui-card-description>
            select routes a marked run to the front; the rest falls through to
            the default slot — all within a single &lt;text&gt;.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-multi-slot-text>
            <text prefix class="font-semibold text-primary">→ </text>
            <text>Routed after the prefix</text>
          </app-multi-slot-text>
        </ui-card-content>
      </ui-card>

      <!-- ── Conditional projection inside a <text> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">Conditional</ui-card-title>
          </view>
          <ui-card-description>
            Projected text wrapped in an &#64;if — tap the box to add or remove
            it from the text at runtime.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-conditional-text>
            <text>Now you see it</text>
          </app-conditional-text>
        </ui-card-content>
      </ui-card>

      <!-- ── Real-world pattern: the UiCardTitle projection shape ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="star" size="sm" />
            <ui-card-title class="text-lg">Real-world pattern</ui-card-title>
          </view>
          <ui-card-description>
            How &#64;blotch/ui components take their label: &lt;ng-content&gt;
            inside a styled &lt;text&gt;, no input() prop needed.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <view
            class="flex-col gap-1 rounded-lg border border-border bg-muted p-4 flex"
          >
            <app-card-title-mock>Grocery list</app-card-title-mock>
            <text class="text-xs text-muted-foreground">
              4 items · updated just now
            </text>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Takeaway ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="info" size="sm" />
            <ui-card-title class="text-lg">Why this matters</ui-card-title>
          </view>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <text class="text-sm text-muted-foreground">
            Every box above renders its projected text, so &lt;ng-content&gt;
            works inside Lynx &lt;text&gt; elements. That's why &#64;blotch/ui
            components can accept their content through projection instead of
            string input() props.
          </text>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class TextProjectionValidation {}
