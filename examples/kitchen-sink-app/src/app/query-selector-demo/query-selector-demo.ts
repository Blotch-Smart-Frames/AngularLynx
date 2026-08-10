import {
  type AfterViewInit,
  type ElementRef,
  Component,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { type IconName, UiIcon } from '../../components/ui/icon';
import { UiSeparator } from '../../components/ui/separator';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/** Result of a single selector run: pending before ngAfterViewInit, then pass/fail. */
type QueryState = 'pending' | 'pass' | 'fail';

type QueryRow = {
  /** The call as written, shown in monospace. */
  readonly selector: string;
  /** Human label for the kind of selector being exercised. */
  readonly kind: string;
  readonly state: QueryState;
  /** Short outcome shown on the right ("found", "null", "3 matches"). */
  readonly detail: string;
};

// Icon colors are substituted literally into the SVG markup (see UiIcon), so they
// must be concrete values, not theme CSS vars. green-500 / red-500 / zinc-400 read
// well in both light and dark mode.
const PASS_COLOR = '#22c55e';
const FAIL_COLOR = '#ef4444';
const PENDING_COLOR = '#a1a1aa';

// Selector + label for each case, in display order. ngAfterViewInit fills in the
// live outcome by index; keeping the definitions here means the pending rows show
// the real selectors before the query runs.
const QUERY_DEFS: readonly Pick<QueryRow, 'selector' | 'kind'>[] = [
  { selector: "querySelector('.qs-active')", kind: 'Class selector' },
  {
    selector: "querySelectorAll('.qs-item')",
    kind: 'Class selector · all matches',
  },
  { selector: "querySelector('#qs-first')", kind: 'ID selector' },
  { selector: "querySelector('text.qs-label')", kind: 'Tag + class selector' },
  {
    selector: "querySelector('view view')",
    kind: 'Descendant combinator (unsupported)',
  },
];

/**
 * A match is a pass.
 */
const found = (el: unknown): Pick<QueryRow, 'state' | 'detail'> =>
  el ? { state: 'pass', detail: 'found' } : { state: 'fail', detail: 'null' };

/**
 * The right number of matches is a pass.
 */
const counted = (
  n: number,
  expected: number,
): Pick<QueryRow, 'state' | 'detail'> => ({
  state: n === expected ? 'pass' : 'fail',
  detail: `${n} matches`,
});

/** Combinators are intentionally unsupported on the background thread, so here
 *  null is the correct (passing) outcome and a match would be the failure. */
const expectedNull = (el: unknown): Pick<QueryRow, 'state' | 'detail'> =>
  el ? { state: 'fail', detail: 'found' } : { state: 'pass', detail: 'null' };

/**
 * querySelector demo — verifies that CSS selector queries resolve against Lynx's
 * background-thread element tree, where there is no browser DOM. The "Element
 * tree" card renders the subject being queried (its badges spell out which
 * selector each element matches), and the "Query results" card runs each selector
 * in ngAfterViewInit via ElementRef.nativeElement and reports pass/fail.
 */
@Component({
  selector: 'app-query-selector-demo',
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
  ],
  template: `
    <app-demo-screen
      heading="querySelector"
      category="Platform"
      description="Run CSS selector queries against Lynx's background-thread element tree — no browser DOM required."
    >
      <!-- ── How it works ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="search" size="sm" />
            <ui-card-title class="text-lg">
              On the background thread
            </ui-card-title>
          </view>
          <ui-card-description>
            Lynx runs Angular on a background JS thread with only a virtual
            element tree. These queries resolve in ngAfterViewInit via
            ElementRef.nativeElement — the same querySelector / querySelectorAll
            API you'd use on the web.
          </ui-card-description>
        </ui-card-header>
      </ui-card>

      <!-- ── The subject tree being queried ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center gap-2 flex">
            <ui-icon name="menu" size="sm" />
            <ui-card-title class="text-lg">Element tree</ui-card-title>
          </view>
          <ui-card-description>
            The elements below are the subject. Each badge names a selector that
            element matches.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col gap-2 p-4 pt-0 flex">
          <!-- #subject is the root querySelector runs against. The qs-* classes
               and id="qs-first" are the hooks the queries target. -->
          <view #subject class="flex-col gap-2 flex">
            <view
              class="qs-item flex-row items-center gap-2 rounded-lg border border-border bg-muted p-3 flex"
              id="qs-first"
            >
              <text class="flex-1 text-sm font-medium text-foreground">
                Item A
              </text>
              <ui-badge variant="outline" [animated]="false"
                >#qs-first
              </ui-badge>
              <ui-badge variant="secondary" [animated]="false"
                >.qs-item
              </ui-badge>
            </view>

            <!-- Item B carries the extra .qs-active class and stands out. -->
            <view
              class="qs-item qs-active flex-row items-center gap-2 rounded-lg border border-primary bg-muted p-3 flex"
            >
              <text class="flex-1 text-sm font-medium text-foreground">
                Item B (active)
              </text>
              <ui-badge [animated]="false">.qs-active</ui-badge>
              <ui-badge variant="secondary" [animated]="false"
                >.qs-item
              </ui-badge>
            </view>

            <view
              class="qs-item flex-row items-center gap-2 rounded-lg border border-border bg-muted p-3 flex"
            >
              <text class="flex-1 text-sm font-medium text-foreground">
                Item C
              </text>
              <ui-badge variant="secondary" [animated]="false"
                >.qs-item
              </ui-badge>
            </view>

            <!-- A <text> (not a <view>) with .qs-label, for the tag+class case. -->
            <view
              class="flex-row items-center gap-2 rounded-lg border border-dashed border-border p-3 flex"
            >
              <text
                class="qs-label flex-1 text-sm italic text-muted-foreground"
              >
                Label
              </text>
              <ui-badge variant="outline" [animated]="false">
                text.qs-label
              </ui-badge>
            </view>
          </view>
        </ui-card-content>
      </ui-card>

      <!-- ── Query results ── -->
      <ui-card class="w-full">
        <ui-card-header class="gap-1 p-4">
          <view class="flex-row items-center flex justify-between">
            <view class="flex-row items-center gap-2 flex">
              <ui-icon name="check" size="sm" />
              <ui-card-title class="text-lg">Query results</ui-card-title>
            </view>
            <ui-badge variant="secondary" [animated]="false">
              {{ passedCount() }} / {{ queries().length }} passed
            </ui-badge>
          </view>
          <ui-card-description>
            Each selector run against the tree above.
          </ui-card-description>
        </ui-card-header>
        <ui-card-content class="flex-col p-4 pt-0 flex">
          @for (q of queries(); track q.selector; let last = $last) {
            <view class="flex-row items-center gap-3 py-3 flex">
              <ui-icon
                [name]="iconFor(q.state)"
                size="sm"
                [color]="colorFor(q.state)"
              />
              <view class="flex-1 flex-col gap-0.5 flex">
                <text class="font-[monospace] text-[13px] text-foreground">{{
                  q.selector
                }}</text>
                <text class="text-xs text-muted-foreground">{{ q.kind }}</text>
              </view>
              <text
                class="text-sm font-medium"
                [style.color]="colorFor(q.state)"
              >
                {{ q.detail }}
              </text>
            </view>
            @if (!last) {
              <ui-separator />
            }
          }
        </ui-card-content>
      </ui-card>

      <!-- ── Footnote ── -->
      <view class="flex-row items-start gap-2 flex">
        <ui-icon name="info" size="xs" color="#a1a1aa" />
        <text class="flex-1 text-xs text-muted-foreground">
          Descendant combinators like "view view" aren't supported by the
          background thread's querySelector, so null is the correct result
          there.
        </text>
      </view>
    </app-demo-screen>
  `,
})
export class QuerySelectorDemo implements AfterViewInit {
  readonly subject = viewChild.required<ElementRef>('subject');

  // Seeded with the selectors in a pending state so the rows render (with real
  // selector text) before ngAfterViewInit resolves the outcomes.
  readonly queries = signal<QueryRow[]>(
    QUERY_DEFS.map((def) => ({ ...def, state: 'pending', detail: '—' })),
  );

  readonly passedCount = computed(
    () => this.queries().filter((q) => q.state === 'pass').length,
  );

  ngAfterViewInit(): void {
    const el = this.subject().nativeElement;

    // Same order as QUERY_DEFS — merged back into the seed rows by index.
    const outcomes = [
      found(el.querySelector('.qs-active')),
      counted(el.querySelectorAll('.qs-item').length, 3),
      found(el.querySelector('#qs-first')),
      found(el.querySelector('text.qs-label')),
      expectedNull(el.querySelector('view view')),
    ];

    this.queries.update((rows) =>
      rows.map((row, i) => ({ ...row, ...outcomes[i] })),
    );
  }

  protected iconFor(state: QueryState): IconName {
    if (state === 'pending') return 'circle';
    return state === 'pass' ? 'check' : 'x';
  }

  protected colorFor(state: QueryState): string {
    if (state === 'pending') return PENDING_COLOR;
    return state === 'pass' ? PASS_COLOR : FAIL_COLOR;
  }
}
