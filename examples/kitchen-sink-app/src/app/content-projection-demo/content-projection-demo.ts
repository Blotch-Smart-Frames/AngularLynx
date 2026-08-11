import {
  Component,
  computed,
  contentChild,
  contentChildren,
  ElementRef,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
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
 * --- Reusable wrapper components: the actual subjects of this demo ---
 *
 * Each wrapper is a component that projects caller-supplied content through
 * `<ng-content>`. They are the demonstration itself — the outer `ui-card`s in
 * the page only frame them. They are styled with the shared theme tokens
 * (bg-muted, border-border, bg-card, …) so they look native and follow dark
 * mode, rather than the hard-coded hex colors the first version used.
 */

/**
 * Single default slot. Whatever the caller nests inside lands in the dashed
 * frame — the simplest form of content projection.
 */
@Component({
  selector: 'app-slot-frame',
  imports: [LYNX_ELEMENTS],
  template: `
    <view
      class="flex-col gap-1 rounded-lg border border-dashed border-border bg-muted p-4 flex"
    >
      <ng-content />
    </view>
  `,
})
export class SlotFrame {}

/**
 * Named-slot panel. `select="[slot=header]"` routes content marked with
 * `slot="header"` into the colored header bar; everything else falls through
 * to the default `<ng-content>` in the body.
 */
@Component({
  selector: 'app-labeled-panel',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="flex-col rounded-lg border border-border flex overflow-hidden">
      <view class="bg-primary px-4 py-2.5 flex">
        <ng-content select="[slot=header]" />
      </view>
      <view class="flex-col gap-1 bg-card p-4 flex">
        <ng-content />
      </view>
    </view>
  `,
})
export class LabeledPanel {}

/**
 * Conditional projection driven by a plain button toggle. The projected content
 * lives inside an `@if`, so it is only rendered while `open()` is true. A simple
 * button is used deliberately — the header-plus-chevron pattern would look like
 * the dedicated accordion component and blur what this example is really about.
 */
@Component({
  selector: 'app-reveal',
  imports: [LYNX_ELEMENTS, UiButton],
  template: `
    <view class="flex-col gap-3 flex">
      <ui-button variant="outline" size="sm" (pressed)="toggle()">
        {{ open() ? 'Hide details' : 'Show details' }}
      </ui-button>
      @if (open()) {
        <view
          class="flex-col gap-1 rounded-lg border border-dashed border-border bg-muted p-4 flex"
        >
          <ng-content />
        </view>
      }
    </view>
  `,
})
export class Reveal {
  readonly open = signal(false);

  toggle(): void {
    // Defer out of the native `bindtap` callback (UiButton emits `pressed` from
    // inside bindtap). Flipping this signal toggles the `@if` above, which
    // mutates the element tree; doing that synchronously while the native event
    // is still on the call stack flushes the renderer mid-event and breaks
    // Lynx's main-thread frame pipeline.
    setTimeout(() => this.open.update((v) => !v), 0);
  }
}

/**
 * Content queries. `contentChild`/`contentChildren` reach into the projected
 * content and resolve the `#main` and `#item` template-reference variables —
 * a lighter-weight alternative to querying by component type. The counts update
 * reactively as the projected set changes.
 */
@Component({
  selector: 'app-query-probe',
  imports: [LYNX_ELEMENTS, UiBadge],
  template: `
    <view class="flex-col gap-3 flex">
      <view class="flex-row flex-wrap items-center gap-2 flex">
        <ui-badge
          [variant]="hasMain() ? 'default' : 'secondary'"
          [animated]="false"
        >
          {{ hasMain() ? '#main found' : '#main missing' }}
        </ui-badge>
        <ui-badge variant="outline" [animated]="false">
          #item × {{ itemCount() }}
        </ui-badge>
      </view>
      <view
        class="flex-col gap-1 rounded-lg border border-dashed border-border bg-muted p-4 flex"
      >
        <ng-content />
      </view>
    </view>
  `,
})
export class QueryProbe {
  // String selectors match by template-reference variable name (#main, #item),
  // resolved against the projected content rather than by component type.
  readonly mainContent = contentChild('main', { read: ElementRef });
  readonly items = contentChildren('item', { read: ElementRef });
  readonly hasMain = computed(() => this.mainContent() != null);
  readonly itemCount = computed(() => this.items().length);
}

/**
 * --- Main demo screen ---
 *
 * One `ui-card` per projection concept, each framing a live wrapper above.
 */
@Component({
  selector: 'app-content-projection-demo',
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
    SlotFrame,
    LabeledPanel,
    Reveal,
    QueryProbe,
  ],
  template: `
    <app-demo-screen
      heading="Content Projection"
      category="Components"
      description="Passing content into a component with <ng-content>, named slots, conditional projection, and content queries."
    >
      <!-- ── Single slot: the basic <ng-content /> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="circle" size="sm" />
            <ui-card-title class="text-lg">Single slot</ui-card-title>
          </view>
          <ui-card-description>
            A component renders whatever the caller nests inside it via
            &lt;ng-content /&gt;.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-3 p-4 pt-0 flex">
          <app-slot-frame>
            <text class="text-sm text-foreground">
              This text is projected into the frame.
            </text>
          </app-slot-frame>
          <app-slot-frame>
            <text class="text-sm font-semibold text-foreground">
              Rich content works too
            </text>
            <text class="text-xs text-muted-foreground">
              Any elements can be projected — not just a single line.
            </text>
          </app-slot-frame>
        </ui-card-content>
      </ui-card>

      <!-- ── Named slots: <ng-content select="[slot=header]" /> ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="menu" size="sm" />
            <ui-card-title class="text-lg">Named slots</ui-card-title>
          </view>
          <ui-card-description>
            select routes each element to a matching slot; the rest falls
            through to the default one.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-labeled-panel>
            <text
              slot="header"
              class="text-sm font-semibold text-primary-foreground"
            >
              Panel header
            </text>
            <text class="text-sm text-foreground">
              This drops into the default body slot.
            </text>
            <text class="text-xs text-muted-foreground">
              The header text carries slot="header" to land in the bar above.
            </text>
          </app-labeled-panel>
        </ui-card-content>
      </ui-card>

      <!-- ── Conditional projection: <ng-content /> inside an @if ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="eye" size="sm" />
            <ui-card-title class="text-lg">Conditional</ui-card-title>
          </view>
          <ui-card-description>
            Projected content wrapped in an &#64;if — a button toggles whether
            it renders at all.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-reveal>
            <text class="text-sm text-foreground">
              This content only exists while it's shown.
            </text>
            <text class="text-xs text-muted-foreground">
              Hiding it removes the projected nodes from the tree — it isn't
              just visually collapsed.
            </text>
          </app-reveal>
        </ui-card-content>
      </ui-card>

      <!-- ── Nested projection: a wrapper inside a wrapper ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="chevron-right" size="sm" />
            <ui-card-title class="text-lg">Nested wrappers</ui-card-title>
          </view>
          <ui-card-description>
            Projection composes — a frame can wrap a panel, two levels deep.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-slot-frame>
            <app-labeled-panel>
              <text
                slot="header"
                class="text-sm font-semibold text-primary-foreground"
              >
                Nested header
              </text>
              <text class="text-sm text-foreground">
                A frame wraps a panel — content flows through both.
              </text>
            </app-labeled-panel>
          </app-slot-frame>
        </ui-card-content>
      </ui-card>

      <!-- ── Content queries: contentChild / contentChildren ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="search" size="sm" />
            <ui-card-title class="text-lg">Content queries</ui-card-title>
          </view>
          <ui-card-description>
            A component can inspect its own projected content with contentChild
            and contentChildren.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="p-4 pt-0">
          <app-query-probe>
            <text #main class="text-sm font-semibold text-foreground">
              Main content (#main)
            </text>
            <text #item class="text-sm text-muted-foreground">
              Item A (#item)
            </text>
            <text #item class="text-sm text-muted-foreground">
              Item B (#item)
            </text>
            <text #item class="text-sm text-muted-foreground">
              Item C (#item)
            </text>
          </app-query-probe>
        </ui-card-content>
      </ui-card>
    </app-demo-screen>
  `,
})
export class ContentProjectionDemo {}
