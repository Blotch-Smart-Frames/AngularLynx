// cspell:words ɵɵdefineComponent ɵɵelementStart ɵɵelement ɵɵelementEnd ɵɵdomElementStart ɵɵdomElement ɵɵdomElementEnd ɵɵtext ɵɵadvance ɵɵlistener ɵɵproperty ɵɵtextInterpolate ɵɵrepeaterCreate ɵɵrepeater ɵɵdefineDirective ɵɵdefinePipe
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Dependency,
  STATIC_BLOCK_ATTRIBUTE,
  foldStaticBlocks,
} from './static-blocks.js';

const FILE = '/proj/src/app/card.ts';

/**
 * A module as Angular's compiler writes one component (the shape of its
 * full-compilation output: `ngc` on Angular 22).
 */
const component = ({
  creation,
  update = [],
  consts,
  dependencies,
  before = [],
}: {
  creation: string[];
  update?: string[];
  consts: string;
  dependencies?: string;
  before?: string[];
}): string =>
  [
    "import * as i0 from '@angular/core';",
    "import * as i1 from '@blotch/angular-lynx';",
    ...before,
    'export class Card {',
    `    static ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: Card, selectors: [["app-card"]], decls: 9, vars: 1, consts: ${consts}, template: function Card_Template(rf, ctx) { if (rf & 1) {`,
    ...creation.map((line) => `            ${line}`),
    '        } if (rf & 2) {',
    ...update.map((line) => `            ${line}`),
    `        } }${dependencies ? `, dependencies: ${dependencies}` : ''}, encapsulation: 2 });`,
    '}',
  ].join('\n');

const fold = (
  code: string,
  dependencies: Record<string, Dependency> = {},
): string =>
  foldStaticBlocks(
    code,
    FILE,
    (specifier, name) => dependencies[`${specifier}#${name}`] ?? null,
  );

/**
 * The block descriptions a folded module declares, in order.
 */
const blocks = (code: string): unknown[] =>
  [...code.matchAll(/^const ɵngLynxStatic\d+ = (.*);$/gm)].map(([, json]) =>
    JSON.parse(json!),
  );

/**
 * The statements of the template's creation block.
 */
const creationOf = (code: string): string[] =>
  /if \(rf & 1\) \{\n([\s\S]*?)\n\}/
    .exec(code)![1]!
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const CARD = component({
  creation: [
    'i0.ɵɵdomElementStart(0, "view", 0)(1, "view", 1);',
    'i0.ɵɵdomElement(2, "view", 2);',
    'i0.ɵɵdomElementStart(3, "text", 3);',
    'i0.ɵɵtext(4, " Static\\n   label ");',
    'i0.ɵɵdomElementEnd()();',
    'i0.ɵɵdomElementStart(5, "text", 4);',
    'i0.ɵɵtext(6);',
    'i0.ɵɵdomElementEnd();',
    'i0.ɵɵdomElement(7, "image", 5);',
    'i0.ɵɵdomElementEnd();',
  ],
  update: ['i0.ɵɵadvance(6);', 'i0.ɵɵtextInterpolate(ctx.n());'],
  consts:
    '[[1, "card"], [1, "row", 2, "height", "10px"], [1, "dot"], [1, "label"], [1, "t"], ["src", "a.png", "mode", "aspectFit"]]',
});

describe('foldStaticBlocks', () => {
  it('keeps a static subtree’s root and describes the rest', () => {
    const folded = fold(CARD);
    expect(blocks(folded)).toEqual([
      [
        ['view', 'dot', '', [], []],
        ['text', 'label', '', [], ['Static label']],
      ],
    ]);
    expect(creationOf(folded)).toEqual([
      'i0.ɵɵdomElementStart(0, "view", 0);',
      // The root, with a consts entry of its own that adds the block.
      'i0.ɵɵdomElement(1, "view", 6);',
      'i0.ɵɵdomElementStart(5, "text", 4);',
      'i0.ɵɵtext(6);',
      'i0.ɵɵdomElementEnd();',
      'i0.ɵɵdomElement(7, "image", 5);',
      'i0.ɵɵdomElementEnd();',
    ]);
    expect(folded).toContain(
      `consts: [[1, "card"], [1, "row", 2, "height", "10px"], [1, "dot"], [1, "label"], [1, "t"], ["src", "a.png", "mode", "aspectFit"], ["${STATIC_BLOCK_ATTRIBUTE}", ɵngLynxStatic0, 1, "row", 2, "height", "10px"]]`,
    );
    // Nothing else changes: the update block's indices still hold.
    expect(folded).toContain('i0.ɵɵadvance(6);');
  });

  it('runs, giving Angular the block as the root’s attribute', () => {
    const folded = fold(CARD)
      .replace(/^import .*$/gm, '')
      .replace('export class', 'class');
    const calls: unknown[][] = [];
    const i0 = new Proxy(
      {},
      {
        get: (_target, name) => {
          const instruction = (...args: unknown[]) => {
            calls.push([name, ...args]);
            return instruction;
          };
          if (name === 'ɵɵdefineComponent') {
            return (definition: { consts: unknown[] }) => definition;
          }
          return instruction;
        },
      },
    );
    const Card = new Function('i0', `${folded}\nreturn Card;`)(i0) as {
      ɵcmp: { consts: unknown[][] };
    };
    expect(Card.ɵcmp.consts[6]).toEqual([
      STATIC_BLOCK_ATTRIBUTE,
      [
        ['view', 'dot', '', [], []],
        ['text', 'label', '', [], ['Static label']],
      ],
      1,
      'row',
      2,
      'height',
      '10px',
    ]);
  });

  it('leaves a module without components, or with nothing static', () => {
    const code = 'export const a = 1;';
    expect(fold(code)).toBe(code);
    const single = component({
      creation: ['i0.ɵɵdomElement(0, "view", 0);'],
      consts: '[[1, "box"]]',
    });
    expect(fold(single)).toBe(single);
  });

  it('folds the rows of an @for, whose template shares the consts', () => {
    const code = component({
      before: [
        'function Card_For_1_Template(rf, ctx) { if (rf & 1) {',
        '    i0.ɵɵdomElementStart(0, "view", 1);',
        '    i0.ɵɵdomElement(1, "view", 2);',
        '    i0.ɵɵdomElementStart(2, "text");',
        '    i0.ɵɵtext(3, "Row");',
        '    i0.ɵɵdomElementEnd()();',
        '} }',
      ],
      creation: [
        'i0.ɵɵdomElementStart(0, "view", 0);',
        'i0.ɵɵrepeaterCreate(1, Card_For_1_Template, 4, 0, "view", 1, i0.ɵɵrepeaterTrackByIdentity);',
        'i0.ɵɵdomElementEnd();',
      ],
      update: ['i0.ɵɵadvance();', 'i0.ɵɵrepeater(ctx.items());'],
      consts: '[[1, "list"], [1, "item"], [1, "icon"]]',
    });
    const folded = fold(code);
    expect(blocks(folded)).toEqual([
      [
        ['view', 'icon', '', [], []],
        ['text', '', '', [], ['Row']],
      ],
    ]);
    expect(folded).toContain('i0.ɵɵdomElement(0, "view", 3);');
    expect(folded).toContain(
      `["${STATIC_BLOCK_ATTRIBUTE}", ɵngLynxStatic0, 1, "item"]`,
    );
    // The component's own template has nothing static to fold.
    expect(folded).toContain(
      'i0.ɵɵrepeaterCreate(1, Card_For_1_Template, 4, 0, "view", 1, i0.ɵɵrepeaterTrackByIdentity);',
    );
  });

  const keeps = (
    description: string,
    options: Parameters<typeof component>[0],
    dependencies?: Record<string, Dependency>,
  ) =>
    it(`keeps ${description}`, () => {
      const code = component(options);
      expect(blocks(fold(code, dependencies))).toEqual([]);
    });

  keeps('a child with a listener', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0)(1, "view", 0);',
      'i0.ɵɵdomListener("bindtap", function () { return ctx.tap(); });',
      'i0.ɵɵdomElementEnd()();',
    ],
    consts: '[[1, "a"]]',
  });

  keeps('a child the update block binds', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0);',
      'i0.ɵɵdomElement(1, "view", 0);',
      'i0.ɵɵdomElementEnd();',
    ],
    update: ['i0.ɵɵadvance();', 'i0.ɵɵclassProp("on", ctx.on());'],
    consts: '[[1, "a"]]',
  });

  keeps('a child with a local reference', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0);',
      'i0.ɵɵdomElement(1, "view", 0, 1);',
      'i0.ɵɵdomElementEnd();',
    ],
    consts: '[[1, "a"], ["ref", ""]]',
  });

  keeps('an element that isn’t a view, text or image', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0);',
      'i0.ɵɵdomElement(1, "scroll-view", 0);',
      'i0.ɵɵdomElementEnd();',
    ],
    consts: '[[1, "a"]]',
  });

  keeps('an HTML tag', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0);',
      'i0.ɵɵdomElement(1, "div", 0);',
      'i0.ɵɵdomElementEnd();',
    ],
    consts: '[[1, "a"]]',
  });

  keeps('a <view>’s loose text, which the runtime puts in a <text>', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0);',
      'i0.ɵɵtext(1, "Loose");',
      'i0.ɵɵdomElementEnd();',
    ],
    consts: '[[1, "a"]]',
  });

  keeps('a <text> of two runs, whose spaces are trimmed together', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0)(1, "text");',
      'i0.ɵɵtext(2, "One ");',
      'i0.ɵɵdomElementStart(3, "text");',
      'i0.ɵɵtext(4, " two");',
      'i0.ɵɵdomElementEnd()()();',
    ],
    consts: '[[1, "a"]]',
  });

  keeps('a <text> root that may be inside a <text>', {
    creation: [
      'i0.ɵɵdomElementStart(0, "text", 0);',
      'i0.ɵɵtext(1, "Top level");',
      'i0.ɵɵdomElementEnd();',
    ],
    consts: '[[1, "a"]]',
  });

  keeps('an interpolated text', {
    creation: [
      'i0.ɵɵdomElementStart(0, "view", 0)(1, "text");',
      'i0.ɵɵtext(2);',
      'i0.ɵɵdomElementEnd()();',
    ],
    update: ['i0.ɵɵadvance(2);', 'i0.ɵɵtextInterpolate(ctx.n());'],
    consts: '[[1, "a"]]',
  });

  it.each([
    ['hidden', '["hidden", ""]'],
    ['an id', '["id", "x"]'],
    ['a data- attribute', '["data-x", "1"]'],
    ['an animation', '["@fade", ""]'],
    ['accessibility traits', '["accessibility-traits", "button"]'],
    ['a binding’s name', '[3, "src"]'],
    ['a template', '[4, "ngIf"]'],
    ['display', '[2, "display", "block"]'],
    ['a safe area inset', '[2, "padding-top", "env(safe-area-inset-top)"]'],
    ['a custom property', '[2, "--gap", "4px"]'],
  ])('keeps a child with %s', (_name, attrs) => {
    const code = component({
      creation: [
        'i0.ɵɵdomElementStart(0, "view");',
        'i0.ɵɵdomElement(1, "view", 0);',
        'i0.ɵɵdomElementEnd();',
      ],
      consts: `[${attrs}]`,
    });
    expect(blocks(fold(code))).toEqual([]);
  });

  it('keeps a component whose consts are a function (i18n)', () => {
    const code = component({
      creation: [
        'i0.ɵɵdomElementStart(0, "view");',
        'i0.ɵɵdomElement(1, "view");',
        'i0.ɵɵdomElementEnd();',
      ],
      consts: '() => [[1, "a"]]',
    });
    expect(fold(code)).toBe(code);
  });

  it('keeps a template whose update block advances where it can’t follow', () => {
    const code = component({
      creation: [
        'i0.ɵɵdomElementStart(0, "view");',
        'i0.ɵɵdomElement(1, "view");',
        'i0.ɵɵdomElementEnd();',
      ],
      update: ['ctx.x && i0.ɵɵadvance(1);'],
      consts: '[]',
    });
    expect(fold(code)).toBe(code);
  });

  describe('dependencies', () => {
    const code = (dependencies: string) =>
      component({
        creation: [
          'i0.ɵɵelementStart(0, "view", 0);',
          'i0.ɵɵelement(1, "view", 1);',
          'i0.ɵɵelementEnd();',
        ],
        consts: '[[1, "a"], ["routerLinkActive", "on", 1, "b"]]',
        dependencies,
      });

    it('folds with directives that match none of the elements', () => {
      expect(
        blocks(
          fold(code('[i1.LynxView, i1.LynxScrollView]'), {
            '@blotch/angular-lynx#LynxView': [],
            '@blotch/angular-lynx#LynxScrollView': [['scroll-view']],
          }),
        ),
      ).toEqual([[['view', 'b', '', ['routerLinkActive', 'on'], []]]]);
    });

    it('keeps an element a directive matches', () => {
      expect(
        blocks(
          fold(code('[i1.LynxRouterLinkActive]'), {
            '@blotch/angular-lynx#LynxRouterLinkActive': [
              ['', 'routerLinkActive', ''],
            ],
          }),
        ),
      ).toEqual([]);
    });

    it('keeps an element a class selector matches', () => {
      expect(
        blocks(
          fold(code('[i1.Styled]'), {
            '@blotch/angular-lynx#Styled': [['', 8, 'b']],
          }),
        ),
      ).toEqual([]);
    });

    it('keeps an element a :not() selector could match', () => {
      expect(
        blocks(
          fold(code('[i1.Not]'), {
            '@blotch/angular-lynx#Not': [['', 1, 'y', '']],
          }),
        ),
      ).toEqual([]);
    });

    it('keeps every template of a component with a dependency it can’t find', () => {
      const unknown = code('[i1.Unknown]');
      expect(fold(unknown)).toBe(unknown);
    });

    it('reads a dependency defined in the same module, and pipes', () => {
      const local = code('() => [Local, i1.SomePipe]').replace(
        'export class Card {',
        'class Local {\n  static ɵdir = i0.ɵɵdefineDirective({ type: Local, selectors: [["", "x", ""]] });\n}\nexport class Card {',
      );
      expect(
        blocks(fold(local, { '@blotch/angular-lynx#SomePipe': 'pipe' })),
      ).toHaveLength(1);
    });

    it('follows a named import', () => {
      const named = code('[Button]').replace(
        "import * as i1 from '@blotch/angular-lynx';",
        "import { UiButton as Button } from './button';",
      );
      expect(
        blocks(fold(named, { './button#UiButton': [['ui-button']] })),
      ).toHaveLength(1);
    });
  });

  describe('what Angular’s output can hold', () => {
    const FOLDABLE = [
      'i0.ɵɵdomElementStart(0, "view");',
      'i0.ɵɵdomElement(1, "view");',
      'i0.ɵɵdomElementEnd();',
    ];

    it('adds the first entry to empty consts, and after a trailing comma', () => {
      expect(fold(component({ creation: FOLDABLE, consts: '[]' }))).toContain(
        `consts: [["${STATIC_BLOCK_ATTRIBUTE}", ɵngLynxStatic0]]`,
      );
      expect(
        fold(component({ creation: FOLDABLE, consts: '[[1, "a"],]' })),
      ).toContain(
        `consts: [[1, "a"],["${STATIC_BLOCK_ATTRIBUTE}", ɵngLynxStatic0]]`,
      );
    });

    it('keeps statements it doesn’t know, and an element with one inside', () => {
      const folded = fold(
        component({
          creation: [
            'const _r1 = i0.ɵɵgetCurrentView();',
            ...FOLDABLE,
            'i0.ɵɵdomElementStart(2, "view");',
            'const _r2 = i0.ɵɵgetCurrentView();',
            'i0.ɵɵdomElement(3, "view");',
            'i0.ɵɵdomElementEnd();',
          ],
          consts: '[]',
        }),
      );
      expect(blocks(folded)).toHaveLength(1);
      expect(creationOf(folded)).toEqual([
        'const _r1 = i0.ɵɵgetCurrentView();',
        'i0.ɵɵdomElement(0, "view", 0);',
        'i0.ɵɵdomElementStart(2, "view");',
        'const _r2 = i0.ɵɵgetCurrentView();',
        'i0.ɵɵdomElement(3, "view");',
        'i0.ɵɵdomElementEnd();',
      ]);
    });

    it('folds nested elements, a <text> root in a <view>, and an empty <text>', () => {
      const folded = fold(
        component({
          creation: [
            'i0.ɵɵdomElementStart(0, "scroll-view", 0);',
            'i0.ɵɵlistener("bindscroll", function () { return 0; });',
            'i0.ɵɵdomElementStart(1, "view")(2, "view");',
            'i0.ɵɵdomElement(3, "text");',
            'i0.ɵɵdomElementEnd()();',
            'i0.ɵɵdomElementEnd();',
            'i0.ɵɵdomElementStart(4, "view", 0);',
            'i0.ɵɵlistener("bindtap", function () { return 0; });',
            'i0.ɵɵdomElementStart(5, "text");',
            'i0.ɵɵtext(6, "Label");',
            'i0.ɵɵdomElementEnd()();',
          ],
          consts: '[[1, "a"]]',
        }),
      );
      expect(blocks(folded)).toEqual([
        [['view', '', '', [], [['text', '', '', [], []]]]],
        ['Label'],
      ]);
    });

    it('follows an update block that declares, and advances by one', () => {
      const code = component({
        creation: [...FOLDABLE, 'i0.ɵɵdomElement(2, "view");'],
        update: [
          'let tmp_0_0;',
          'i0.ɵɵadvance();',
          'i0.ɵɵadvance(1);',
          'i0.ɵɵclassProp("a", ctx.a());',
        ],
        consts: '[]',
      });
      expect(blocks(fold(code))).toHaveLength(1);
    });

    it.each([['an advance it can’t count', ['i0.ɵɵadvance(ctx.n);']]])(
      'keeps a template with %s',
      (_name, update) => {
        const code = component({ creation: FOLDABLE, update, consts: '[]' });
        expect(fold(code)).toBe(code);
      },
    );

    it.each([
      ['a consts entry that isn’t an array', 'someEntry', '0'],
      ['a consts index it can’t read', '[]', 'index'],
      ['an attribute without a value', '["mode"]', '0'],
      ['a value it can’t read', '["mode", value]', '0'],
      ['a class it can’t read', '[1, someClass]', '0'],
      ['a style without a value', '[2, "height"]', '0'],
      ['a consts entry past the end', '[]', '3'],
    ])('keeps a child with %s', (_name, entry, index) => {
      const code = component({
        creation: [
          'i0.ɵɵdomElementStart(0, "view");',
          `i0.ɵɵdomElement(1, "view", ${index});`,
          'i0.ɵɵdomElementEnd();',
        ],
        consts: `[${entry}]`,
      });
      expect(blocks(fold(code))).toEqual([]);
    });

    it.each([
      ['an index', 'i0.ɵɵdomElement(i, "view");'],
      ['a tag', 'i0.ɵɵdomElement(1, tag);'],
      ['a text’s index', 'i0.ɵɵtext(i, "x");'],
    ])('keeps a child whose %s isn’t a literal', (_name, child) => {
      const code = component({
        creation: [
          'i0.ɵɵdomElementStart(0, "view");',
          child,
          'i0.ɵɵdomElementEnd();',
        ],
        consts: '[]',
      });
      expect(blocks(fold(code))).toEqual([]);
    });

    it('leaves an embedded template with no creation block', () => {
      const code = component({
        before: ['function Card_ng_template_1_Template(rf, ctx) {}'],
        creation: [
          'i0.ɵɵdomTemplate(0, Card_ng_template_1_Template, 0, 0);',
          ...FOLDABLE.map((line) =>
            line.replace(/\((\d)/, (_m, d) => `(${Number(d) + 1}`),
          ),
        ],
        consts: '[]',
      });
      expect(blocks(fold(code))).toHaveLength(1);
    });
  });

  describe('dependencies the module defines or imports', () => {
    const code = (dependencies: string, before: string[] = []) =>
      component({
        before,
        creation: [
          'i0.ɵɵelementStart(0, "view");',
          'i0.ɵɵelement(1, "view", 0);',
          'i0.ɵɵelementEnd();',
        ],
        consts: '[["mode", "x", 1, "b", 2, "height", "1px"]]',
        dependencies,
      });
    const local = (definition: string) => [
      `class Local { static ɵdir = i0.${definition}; }`,
    ];

    it.each([
      ['a pipe', 'ɵɵdefinePipe({ name: "p", type: Local, pure: true })', 1],
      ['a host directive', 'ɵɵdefineDirective({ type: Local })', 1],
      [
        'an element selector',
        'ɵɵdefineDirective({ type: Local, selectors: [["ui-x"]] })',
        1,
      ],
      [
        'a [class] selector',
        'ɵɵdefineDirective({ type: Local, selectors: [["", "class", ""]] })',
        0,
      ],
      [
        'a [style] selector',
        'ɵɵdefineDirective({ type: Local, selectors: [["", "style", ""]] })',
        0,
      ],
      [
        'selectors it can’t read',
        'ɵɵdefineDirective({ type: Local, selectors: someSelectors })',
        0,
      ],
      [
        'a selector it can’t read',
        'ɵɵdefineDirective({ type: Local, selectors: [someSelector] })',
        0,
      ],
      [
        'a selector part it can’t read',
        'ɵɵdefineDirective({ type: Local, selectors: [[tag]] })',
        0,
      ],
    ])('reads %s', (_name, definition, count) => {
      const before = [
        "import 'side-effect';",
        "import { Other } from './other';",
        'i0.ɵɵdefineInjectable({ token: Other, factory: () => 0 });',
        'i0.ɵɵdefineNgModule({ type: Other });',
        ...local(definition),
      ];
      expect(blocks(fold(code('[Local]', before)))).toHaveLength(count);
    });

    it.each([
      ['a block-bodied function', '() => { return [Local]; }'],
      ['a member of something it didn’t import', '[thing.Local]'],
      ['a spread', '[...list]'],
      ['a class it can’t find', '[Missing]'],
    ])('keeps the template with %s', (_name, dependencies) => {
      const unknown = code(dependencies);
      expect(fold(unknown)).toBe(unknown);
    });
  });

  it('has the runtime’s attribute name', () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        '../../runtime/src/lib/static-blocks/static-block.ts',
      ),
      'utf-8',
    );
    expect(source).toContain(
      `export const STATIC_BLOCK_ATTRIBUTE = '${STATIC_BLOCK_ATTRIBUTE}';`,
    );
  });
});
