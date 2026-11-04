import { NgtscProgram } from '@angular/compiler-cli';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

// These types do their work in Angular's template type-checker, which Vitest
// doesn't run. So the test compiles components with the compiler `ng build`
// uses, with strictTemplates as `ng new` sets it, and reads its errors. All
// the components are in one fixture file, compiled once with the runtime's
// public API, which also type-checks the runtime's own host listeners.

const here = dirname(fileURLToPath(import.meta.url));
const fixtureFile = join(here, '__fixture__.ts');
const publicApi = join(here, '../../public-api.ts');

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
    'LynxEvent<VideoErrorDetail | undefined>',
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
 * Type-checks the fixture with the runtime, as `ng build` does.
 */
const compile = async (): Promise<readonly ts.Diagnostic[]> => {
  const options: ts.CompilerOptions & Record<string, unknown> = {
    strict: true,
    strictTemplates: true,
    skipLibCheck: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => file === fixtureFile || fileExists(file);
  host.readFile = (file) =>
    file === fixtureFile ? fixtureSource : readFile(file);
  host.getSourceFile = (file, language, ...rest) =>
    file === fixtureFile
      ? ts.createSourceFile(file, fixtureSource, language, true)
      : getSourceFile(file, language, ...rest);
  const program = new NgtscProgram([fixtureFile, publicApi], options, host);
  await program.loadNgStructureAsync();
  return [
    ...program.getTsSemanticDiagnostics(),
    ...program.getNgSemanticDiagnostics(),
  ];
};

const message = (diagnostic: ts.Diagnostic): string =>
  // The first line: the rest explains it, which these cases don't check.
  ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0];

describe('element event types', () => {
  let diagnostics: readonly ts.Diagnostic[];

  beforeAll(async () => {
    diagnostics = await compile();
  }, 60_000);

  it('type-checks the runtime’s own templates and host listeners', () => {
    const elsewhere = diagnostics
      .filter(({ file }) => file?.fileName !== fixtureFile)
      .map(
        (diagnostic) => `${diagnostic.file?.fileName}: ${message(diagnostic)}`,
      );
    expect(elsewhere).toEqual([]);
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))(
    '$name',
    ({ index, errors }) => {
      const reported = diagnostics
        .filter(
          ({ file, start }) =>
            file?.fileName === fixtureFile && caseAt(start ?? 0) === index,
        )
        .map(message);
      expect(reported).toEqual(errors);
    },
  );
});
