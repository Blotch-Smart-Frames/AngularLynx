import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  CompileDiagnostic,
  CompileRequest,
} from '../testing/element-events-compiler.mjs';

// These types do their work in Angular's template type-checker, which Vitest
// doesn't run. So the test compiles components with the compiler `ng build`
// uses, with strictTemplates as `ng new` sets it, and reads its errors. All
// the components are in one fixture file, compiled once with the runtime's
// public API, which also type-checks the runtime's own host listeners.

const here = dirname(fileURLToPath(import.meta.url));
const fixtureFile = join(here, '__fixture__.ts');
const publicApi = join(here, '../../public-api.ts');
const compiler = join(here, '../testing/element-events-compiler.mts');

type Case = {
  readonly name: string;
  readonly template: string;
  /** The component class's body. */
  readonly members: string;
  /** The errors Angular reports for the component, in order. */
  readonly errors: readonly string[];
};

/**
 * A case that passes `$event` to a `never` parameter, so that the error names
 * the type Angular inferred for it.
 */
const probe = (template: string, type: string): Case => ({
  name: `${template} → ${type}`,
  template,
  members: 'protected $p(event: never): void {}',
  errors: [
    `Argument of type '${type}' is not assignable to parameter of type 'never'.`,
  ],
});

const cases: readonly Case[] = [
  // The events every element fires.
  probe('<view (bindtap)="$p($event)"></view>', 'TouchEvent'),
  probe('<view (capture-catchtouchmove)="$p($event)"></view>', 'TouchEvent'),
  probe('<view (global-bindtap)="$p($event)"></view>', 'TouchEvent'),
  probe('<view (bindmousedown)="$p($event)"></view>', 'MouseEvent'),
  probe('<view (global-bindmousedown)="$p($event)"></view>', 'MouseEvent'),
  probe(
    '<view (bindlayoutchange)="$p($event)"></view>',
    'LynxEvent<LayoutChangeDetail>',
  ),
  probe(
    '<image (capture-bindlayoutchange)="$p($event)" />',
    'LynxEvent<LayoutChangeDetail>',
  ),
  probe(
    '<input (bindlayoutchange)="$p($event)" />',
    'LynxEvent<LayoutChangeDetail>',
  ),
  probe(
    '<view (binduidisappear)="$p($event)"></view>',
    'LynxEvent<UIAppearanceDetail>',
  ),
  probe('<view (bindanimationend)="$p($event)"></view>', 'AnimationEvent'),
  probe('<view (bindtransitionstart)="$p($event)"></view>', 'TransitionEvent'),
  probe(
    '<view (bindaccessibilityaction)="$p($event)"></view>',
    'LynxEvent<AccessibilityActionDetail>',
  ),
  // Each element's own events, on a Lynx-only tag…
  probe('<image (bindload)="$p($event)" />', 'LynxEvent<ImageLoadDetail>'),
  probe('<image (binderror)="$p($event)" />', 'LynxEvent<ImageErrorDetail>'),
  probe('<image (bindstartplay)="$p($event)" />', 'LynxEvent'),
  probe('<svg (bindload)="$p($event)"></svg>', 'LynxEvent<ImageLoadDetail>'),
  probe(
    '<text (bindlayout)="$p($event)"></text>',
    'LynxEvent<TextLayoutDetail>',
  ),
  probe(
    '<text (bindselectionchange)="$p($event)"></text>',
    'LynxEvent<TextSelectionChangeDetail>',
  ),
  probe(
    '<scroll-view (bindscroll)="$p($event)"></scroll-view>',
    'LynxEvent<ScrollDetail>',
  ),
  probe(
    '<scroll-view (bindcontentsizechanged)="$p($event)"></scroll-view>',
    'LynxEvent<ScrollDetail>',
  ),
  probe(
    '<list (bindscroll)="$p($event)"></list>',
    'LynxEvent<ListScrollDetail>',
  ),
  probe(
    '<list (bindscrollstatechange)="$p($event)"></list>',
    'LynxEvent<ListScrollStateChangeDetail>',
  ),
  probe(
    '<list (bindlayoutcomplete)="$p($event)"></list>',
    'LynxEvent<ListLayoutCompleteDetail>',
  ),
  probe('<list (bindsnap)="$p($event)"></list>', 'LynxEvent<ListSnapDetail>'),
  probe(
    '<overlay (bindoverlaytouch)="$p($event)"></overlay>',
    'LynxEvent<OverlayTouchDetail>',
  ),
  probe(
    '<overlay (binderror)="$p($event)"></overlay>',
    'LynxEvent<OverlayErrorDetail>',
  ),
  probe(
    '<refresh (bindstartrefresh)="$p($event)"></refresh>',
    'LynxEvent<RefreshStartDetail>',
  ),
  probe(
    '<refresh (bindheaderoffset)="$p($event)"></refresh>',
    'LynxEvent<RefreshHeaderOffsetDetail>',
  ),
  probe(
    '<scroll-coordinator (bindoffset)="$p($event)"></scroll-coordinator>',
    'LynxEvent<ScrollCoordinatorOffsetDetail>',
  ),
  probe(
    '<viewpager (bindwillchange)="$p($event)"></viewpager>',
    'LynxEvent<ViewPagerChangeDetail>',
  ),
  probe(
    '<viewpager (bindoffsetchange)="$p($event)"></viewpager>',
    'LynxEvent<ViewPagerOffsetChangeDetail>',
  ),
  probe('<webview (bindload)="$p($event)" />', 'LynxEvent'),
  probe(
    '<webview (bindmessage)="$p($event)" />',
    'LynxEvent<WebViewMessageDetail>',
  ),
  probe(
    '<webview (bindlocationchange)="$p($event)" />',
    'LynxEvent<WebViewUrlDetail>',
  ),
  // …and on a tag HTML also has.
  probe('<input (bindinput)="$p($event)" />', 'LynxEvent<InputDetail>'),
  probe('<input (bindconfirm)="$p($event)" />', 'LynxEvent<InputValueDetail>'),
  probe(
    '<input (bindkeyboardheightchange)="$p($event)" />',
    'LynxEvent<KeyboardHeightDetail>',
  ),
  probe(
    '<textarea (bindbeforeinput)="$p($event)"></textarea>',
    'LynxEvent<BeforeInputDetail>',
  ),
  probe(
    '<textarea (bindline)="$p($event)"></textarea>',
    'LynxEvent<TextareaLineDetail>',
  ),
  // `line` is <textarea>'s alone.
  probe('<input (bindline)="$p($event)" />', 'Event'),
  probe(
    '<textarea (bindselection)="$p($event)"></textarea>',
    'LynxEvent<InputSelectionDetail>',
  ),
  probe(
    '<video (bindtimeupdate)="$p($event)"></video>',
    'LynxEvent<VideoTimeUpdateDetail>',
  ),
  probe(
    '<video (binderror)="$p($event)"></video>',
    'LynxEvent<VideoErrorDetail>',
  ),
  probe(
    '<frame (bindload)="$p($event)"></frame>',
    'LynxEvent<FrameLoadDetail>',
  ),
  probe(
    '<frame (bindloadmetrics)="$p($event)"></frame>',
    'LynxEvent<FrameLoadMetricsDetail>',
  ),
  // An event the element doesn't fire stays the DOM's Event.
  probe('<view (bindload)="$p($event)"></view>', 'Event'),
  {
    name: 'a handler declared apart from the template',
    template: '<image [src]="url" (bindload)="loaded($event)" />',
    members: `
      protected readonly url = 'https://example.com/a.png';
      protected size?: ImageLoadDetail;
      protected loaded({ detail }: LynxEvent<ImageLoadDetail>): void {
        this.size = detail;
      }`,
    errors: [],
  },
  {
    name: 'a field the detail lacks',
    template: '<image (bindload)="width = $event.detail.size" />',
    members: 'protected width = 0;',
    errors: [`Property 'size' does not exist on type 'ImageLoadDetail'.`],
  },
  {
    name: 'a DOM event field Lynx events lack',
    template: '<input (bindinput)="time = $event.timeStamp" />',
    members: 'protected time = 0;',
    errors: [
      `Property 'timeStamp' does not exist on type 'LynxEvent<InputDetail>'. Did you mean 'timestamp'?`,
    ],
  },
  {
    // What the docs said to write before these types: it no longer compiles.
    name: 'a handler that takes a DOM Event',
    template: '<input (bindinput)="onInput($event)" />',
    members: 'protected onInput(event: Event): void {}',
    errors: [
      `Argument of type 'LynxEvent<InputDetail>' is not assignable to parameter of type 'Event'.`,
    ],
  },
];

const fixtureSource = [
  "import { Component } from '@angular/core';",
  "import { LYNX_ELEMENTS } from '../lynx-elements';",
  "import type { ImageLoadDetail } from './element-events';",
  "import type { LynxEvent } from './lynx-event';",
  ...cases.map(
    ({ template, members }, index) => `
@Component({
  selector: 'app-case-${index}',
  imports: [LYNX_ELEMENTS],
  template: \`${template}\`,
})
export class Case${index} {
  ${members}
}`,
  ),
].join('\n');

/**
 * Which case's component a position in the fixture falls in.
 */
const caseAt = (position: number): number =>
  fixtureSource.slice(0, position).split("selector: 'app-case-").length - 2;

/**
 * Type-checks the fixture with the runtime, as `ng build` does, in a worker
 * thread that coverage doesn't slow (see testing/element-events-compiler.mts).
 */
const compile = (): Promise<readonly CompileDiagnostic[]> =>
  new Promise((resolve, reject) => {
    const request: CompileRequest = { fixtureFile, fixtureSource, publicApi };
    const worker = new Worker(compiler, { workerData: request });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) =>
      reject(new Error(`The compile worker exited with code ${code}`)),
    );
  });

describe('element event types', () => {
  let diagnostics: readonly CompileDiagnostic[];

  // The compile takes a second or two on its own, but CI runs every package's
  // tests at once on a few cores, where it has taken 40 to 60 seconds with
  // coverage (issue #741). The limit is there to catch a hung worker, so it
  // leaves room for a busy runner.
  beforeAll(async () => {
    diagnostics = await compile();
  }, 180_000);

  it('type-checks the runtime’s own templates and host listeners', () => {
    const elsewhere = diagnostics
      .filter(({ fileName }) => fileName !== fixtureFile)
      .map(({ fileName, message }) => `${fileName}: ${message}`);
    expect(elsewhere).toEqual([]);
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))(
    '$name',
    ({ index, errors }) => {
      const reported = diagnostics
        .filter(
          ({ fileName, start }) =>
            fileName === fixtureFile && caseAt(start ?? 0) === index,
        )
        .map(({ message }) => message);
      expect(reported).toEqual(errors);
    },
  );
});
