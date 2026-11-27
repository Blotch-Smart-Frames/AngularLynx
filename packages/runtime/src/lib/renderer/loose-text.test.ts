// @vitest-environment jsdom
//
// Loose text: a raw-text whose parent doesn't draw text, such as `<view>Hi</view>`
// or `<div>Hi <b>there</b></div>`, is drawn in an anonymous <text> with the
// inline tags beside it (see LynxElement's #regroup), which Angular never sees.
// Drives the REAL main-thread renderer against inline-text.test.ts's fake of
// the native tree, so Angular's own create, insert, move and remove sequence
// runs against it.
import '@angular/compiler';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  provideZonelessChangeDetection,
  RendererFactory2,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LynxDocument } from '../lynx-document';
import { setPageElementRef } from '../lynx-document/page-ref';
import {
  ANONYMOUS_TEXT_CLASS,
  INHERITANCE_CLASS,
  LYNX_TEXT_INHERITANCE_CLASS,
  NOT_BLOCK_CONTAINERS,
  INHERITED_TEXT_PROPERTIES,
  resetStyleIndex,
  SMALLER_FLAG,
  VERTICAL_ALIGN_FLAG,
} from '../lynx-element/text-flow';
import {
  LynxElement,
  processPendingFlow,
  processPendingRemovals,
  processPendingTextNormalization,
} from '../lynx-element';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import type { FakeNativeGlobal } from '../testing/fake-native-global';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  text?: string;
  attrs: Map<string, unknown>;
  classes: Set<string>;
  hasPaintingNode: boolean;
};

let nextId = 1;
let pageRoot: FakeEl;
const pendingRemovedSinceFlush = new Set<FakeEl>();

const makeEl = (tag: string, text?: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  text,
  attrs: new Map(),
  classes: new Set(),
  hasPaintingNode: true,
});

const detach = (child: FakeEl): void => {
  const p = child.parent;
  if (!p) return;
  const i = p.children.indexOf(child);
  if (i >= 0) p.children.splice(i, 1);
  child.parent = null;
};

const installNativeFakes = (): void => {
  nextId = 1;
  pageRoot = makeEl('page');
  pendingRemovedSinceFlush.clear();

  const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;

  g.__CreatePage = () => pageRoot;
  g.__CreateView = () => makeEl('view');
  g.__CreateText = () => makeEl('text');
  g.__CreateScrollView = () => makeEl('scroll-view');
  g.__CreateImage = () => makeEl('image');
  g.__CreateRawText = (text: string) => makeEl('raw-text', text);
  g.__CreateElement = (tag: string) => makeEl(tag);
  g.__CreateWrapperElement = () => makeEl('wrapper');
  g.__CreateList = () => makeEl('list');
  g.__UpdateListCallbacks = () => {};

  g.__GetElementUniqueID = (n: FakeEl) => n.id;
  g.__GetTag = (n: FakeEl) => n.tag;

  g.__AppendElement = (parent: FakeEl, child: FakeEl) => {
    detach(child);
    parent.children.push(child);
    child.parent = parent;
    pendingRemovedSinceFlush.delete(child);
    return child;
  };
  g.__InsertElementBefore = (parent: FakeEl, child: FakeEl, ref: FakeEl) => {
    detach(child);
    const i = parent.children.indexOf(ref);
    parent.children.splice(i < 0 ? parent.children.length : i, 0, child);
    child.parent = parent;
    pendingRemovedSinceFlush.delete(child);
    return child;
  };
  g.__RemoveElement = (parent: FakeEl, child: FakeEl) => {
    const i = parent.children.indexOf(child);
    if (i >= 0) parent.children.splice(i, 1);
    child.parent = null;
    pendingRemovedSinceFlush.add(child);
    return child;
  };

  g.__GetParent = (n: FakeEl) => n.parent ?? null;
  g.__GetChildren = (n: FakeEl) => n.children.slice();
  g.__FirstElement = (n: FakeEl) => n.children[0] ?? null;
  g.__LastElement = (n: FakeEl) => n.children[n.children.length - 1] ?? null;
  g.__NextElement = (n: FakeEl) => {
    const p = n.parent;
    if (!p) return null;
    const i = p.children.indexOf(n);
    return p.children[i + 1] ?? null;
  };

  g.__SetClasses = (n: FakeEl, s: string | undefined) => {
    n.classes = new Set((s ?? '').split(/\s+/).filter(Boolean));
  };
  g.__GetClasses = (n: FakeEl) => [...n.classes];
  g.__AddClass = (n: FakeEl, name: string) => n.classes.add(name);
  g.__SetAttribute = (n: FakeEl, name: string, value: unknown) =>
    n.attrs.set(name, value);
  g.__GetAttributeByName = (n: FakeEl, name: string) => n.attrs.get(name);
  g.__SetID = (n: FakeEl, id: string) => n.attrs.set('id', id);
  g.__SetDataset = () => {};
  // Records display, so shape() can leave out Angular's comment anchors,
  // which are views with display: none (see createCommentElement).
  g.__AddInlineStyle = (n: FakeEl, key: string, value: unknown) => {
    if (key === 'display') n.attrs.set('display', value);
  };
  // Records the whole inline style, so a test can see a hidden element.
  g.__SetInlineStyles = (n: FakeEl, value: unknown) => {
    n.attrs.set('style', value);
  };
  g.__AddEvent = () => {};
  g.__FlushElementTree = () => {
    const killSubtree = (n: FakeEl): void => {
      n.hasPaintingNode = false;
      for (const c of n.children) killSubtree(c);
    };
    for (const node of pendingRemovedSinceFlush) killSubtree(node);
    pendingRemovedSinceFlush.clear();
  };
  g.__ElementAnimate = () => {};

  setPageElementRef(pageRoot as unknown as never);
};

/**
 * A raw-text's displayed text: the pass writes trimmed display via
 * __SetAttribute (→ attrs) only when it changes, else the collapsed baked value
 * (→ text) stands — mirroring that both target the same native text property.
 */
const leafText = (el: FakeEl): string =>
  (el.attrs.has('text') ? (el.attrs.get('text') as string) : (el.text ?? '')) ??
  '';

/**
 * Raw-text leaves under `el`, in document order, through LIVE painting nodes
 * only (a dead subtree is invisible on-device).
 */
const rawTextLeaves = (el: FakeEl): FakeEl[] => {
  const out: FakeEl[] = [];
  const walk = (n: FakeEl): void => {
    for (const c of n.children) {
      if (!c.hasPaintingNode) continue;
      if (c.tag === 'raw-text') out.push(c);
      else walk(c);
    }
  };
  walk(el);
  return out;
};

const descendants = (): FakeEl[] => {
  const out: FakeEl[] = [];
  const walk = (n: FakeEl): void => {
    for (const c of n.children) {
      if (!c.hasPaintingNode) continue;
      out.push(c);
      walk(c);
    }
  };
  walk(pageRoot);
  return out;
};

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve));

/** The build's `sub` and `sup` rules, as the style index lists them. */
const BUILD_VERTICAL_ALIGNS = [
  [['_ngtag-sub'], [], [-0.24, 0], 1000, 0, 0],
  [['_ngtag-sup'], [], [0.4, 0], 1000, 0, 1],
];

@Component({
  selector: 'loose-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="box">{{ count() }} items</view>`,
})
class LooseHost {
  readonly count = signal(3);
}

@Component({
  selector: 'blank-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="box">{{ label() }}</view>`,
})
class BlankHost {
  readonly label = signal('');
}

@Component({
  selector: 'mixed-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="row">Hi <view class="dot"></view> there</view>`,
})
class MixedHost {}

@Component({
  selector: 'in-text-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="t">Hello</text>`,
})
class InTextHost {}

@Component({
  selector: 'inline-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="card">Hi <b>there</b>, <a>friend</a>!</div>`,
})
class InlineHost {}

@Component({
  selector: 'spans-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="pair"><span>A</span><span>B</span></div>`,
})
class SpansHost {}

@Component({
  selector: 'lone-span-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="solo"><span class="badge">3</span></div>`,
})
class LoneSpanHost {}

@Component({
  selector: 'paragraph-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="doc">
    Intro
    <p>Para</p>
    outro
  </div>`,
})
class ParagraphHost {}

@Component({
  selector: 'flex-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="box" [class.flex]="row()">Hi <b>there</b></div>`,
})
class FlexHost {
  readonly row = signal(false);
}

@Component({
  selector: 'inline-style-flex-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="box" style="display: flex">Hi <b>there</b></div>`,
})
class InlineStyleFlexHost {}

@Component({
  selector: 'plural-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="box">
    {{ n() }}
    @if (n() !== 1) {
      items
    } @else {
      item
    }
  </div>`,
})
class PluralHost {
  readonly n = signal(3);
}

@Component({
  selector: 'anchors-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="box">
    @if (a()) {
      A
    }
    and
    @if (b()) {
      B
    }
  </div>`,
})
class AnchorsHost {
  readonly a = signal(true);
  readonly b = signal(true);
}

@Component({
  selector: 'text-anchor-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="t"
    >Hi
    @if (loud()) {
      <text>!</text>
    }
  </text>`,
})
class TextAnchorHost {
  readonly loud = signal(true);
}

@Component({
  selector: 'toggle-loose-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="box">
    @if (show()) {
      Shown
    }
    <view class="end"></view
  ></view>`,
})
class ToggleLooseHost {
  readonly show = signal(true);
}

@Component({
  selector: 'for-loose-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="list">
    @for (item of items(); track item) {
      {{ item }}
    }
  </view>`,
})
class ForLooseHost {
  readonly items = signal(['a', 'b', 'c']);
}

@Component({
  selector: 'wrap-view',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="wrap"><ng-content /></view>`,
})
class WrapView {}

@Component({
  selector: 'projected-host',
  imports: [WrapView],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<wrap-view>Projected</wrap-view>`,
})
class ProjectedHost {}

@Component({
  selector: 'inherit-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<div class="box">
    <p class="plain">Plain</p>
    <p class="title">Title</p>
    <text class="lynx">Lynx</text>
  </div>`,
})
class InheritHost {}

@Component({
  selector: 'bold-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="blue">blue <b>bold blue</b> <i>italic</i></text>`,
})
class BoldHost {}

@Component({
  selector: 'inline-style-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="total" style="font-size: 18px; color: red"
      >Total: <b>12</b></text
    >
    <text class="bound" [style.font-size.px]="size()">Total: <b>12</b></text>`,
})
class InlineStyleHost {
  readonly size = signal<number | null>(20);
}

@Component({
  selector: 'decorated-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text
    ><em>italic</em> <s>struck <u>both</u> <b>bold</b></s></text
  >`,
})
class DecoratedHost {}

@Component({
  selector: 'smaller-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="big"
    ><small class="outer" [class.large]="large()"
      >a <b class="in-small">b</b>
      <small class="inner">c <i class="in-inner">i</i></small></small
    >
    x<sup class="sup">n<b class="in-sup">2</b></sup></text
  >`,
})
class SmallerHost {
  readonly large = signal(false);
}

@Component({
  selector: 'inline-smaller-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="big"
    ><small class="outer" [style.font-size.px]="size()"
      >a <b class="in-small">b</b>
      <small class="inner">c <i class="in-inner">i</i></small></small
    ></text
  >`,
})
class InlineSmallerHost {
  readonly size = signal<number | null>(null);
}

@Component({
  selector: 'compact-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view [class.compact]="compact()"
    ><p class="big">
      <span class="label">l <b class="in-label">b</b></span>
    </p></view
  >`,
})
class CompactHost {
  readonly compact = signal(false);
}

@Component({
  selector: 'reset-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view [class.compact]="compact()"
    ><p class="big">
      <small
        ><span class="reset">r <b class="in-reset">b</b></span></small
      >
    </p></view
  >`,
})
class ResetHost {
  readonly compact = signal(false);
}

@Component({
  selector: 'raised-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<p class="big">
    x<sup class="sup" [style.vertical-align]="supAlign()"
      >n<b class="in-sup" [style.font-size]="size()">2</b
      ><small class="small-in-sup">s</small
      ><sup class="sup-in-sup" [class.own]="own()">m</sup></sup
    >
    H<sub
      >2<i
        class="in-sub"
        [style.vertical-align]="subAlign()"
        [style.color]="color()"
        >O</i
      ></sub
    >
  </p>`,
})
class RaisedHost {
  readonly own = signal(false);
  readonly supAlign = signal<string | null>(null);
  readonly size = signal<string | null>(null);
  readonly subAlign = signal<string | null>(null);
  readonly color = signal<string | null>(null);
}

@Component({
  selector: 'own-align-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<p>
    x<span class="exp" [class.sized]="sized()"
      >n<b class="in-exp">2</b><sup class="sup-in-exp">m</sup></span
    >
    y<span class="lift" [style.vertical-align]="lift()"
      ><b class="in-lift">b</b
      ><sup class="sup-in-lift">s<b class="in-sup-in-lift">t</b></sup></span
    >
    <span [class.note]="note()"
      ><sup class="note-sup">a<b class="in-note-sup">b</b></sup></span
    >
  </p>`,
})
class OwnAlignHost {
  readonly sized = signal(false);
  readonly lift = signal<string | null>(null);
  readonly note = signal(false);
}

@Component({
  selector: 'link-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text
    ><a class="link" [attr.href]="href()">docs</a> <a class="plain">plain</a>
    <abbr class="abbr" title="HyperText Markup Language">HTML</abbr>
    <span class="span" title="no style">span</span></text
  >`,
})
class LinkHost {
  readonly href = signal<string | null>('https://lynxjs.org');
}

/**
 * Angular's compiler (`preserveWhitespaces: false`, the default) deletes a
 * text node that is only whitespace, so the space in `</b> <b>` never reaches
 * the renderer, in a browser as on Lynx. This and NgspHost are Angular's two
 * ways to keep it, which the runtime has to draw as a browser would (#644).
 */
@Component({
  selector: 'kept-spaces-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  preserveWhitespaces: true,
  template: `<div class="tags">big <b>bold big</b> <b>b thin</b></div>
    <div class="links"><a>terms</a> <a>privacy</a></div>
    <div class="label"><b>Name:</b> Ada</div>`,
})
class KeptSpacesHost {}

@Component({
  selector: 'ngsp-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<div class="tags">big <b>bold big</b>&ngsp;<b>b thin</b></div>`,
})
class NgspHost {}

@Component({
  selector: 'dropped-space-host',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<div class="tags"><b>Name:</b> <b>Ada</b></div>`,
})
class DroppedSpaceHost {}

/**
 * The live element with `cls`.
 */
const byClass = (cls: string): FakeEl => {
  const found = descendants().filter((n) => n.classes.has(cls));
  if (found.length !== 1) {
    throw new Error(`expected exactly one live .${cls}, got ${found.length}`);
  }
  return found[0]!;
};

/**
 * Whether an element is hidden by its inline style.
 */
const hidden = (el: FakeEl): boolean =>
  el.attrs.get('display') === 'none' ||
  String(el.attrs.get('style') ?? '').startsWith('display: none');

/**
 * What `el`'s visible children draw: an anonymous <text>'s line in quotes,
 * another <text> as its classes and its text, a raw-text as it is, and
 * another element as its tag and classes.
 */
const shape = (el: FakeEl): string[] =>
  el.children
    .filter((c) => c.hasPaintingNode && !hidden(c))
    .map((c) => {
      const classes = [...c.classes].sort().join('.');
      const line = rawTextLeaves(c).map(leafText).join('');
      if (c.tag === 'raw-text') return `raw:${leafText(c)}`;
      if (c.tag === 'text' && c.classes.has('_ngtext')) return `"${line}"`;
      if (c.tag === 'text') return `text.${classes}"${line}"`;
      return `${c.tag}.${classes}`;
    });

describe('loose text', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
    resetStyleIndex();
    markFirstRenderComplete();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LYNX_DOCUMENT, useValue: new LynxDocument() },
        LynxRendererFactory2,
        { provide: RendererFactory2, useExisting: LynxRendererFactory2 },
      ],
    });
  });

  afterEach(() => {
    delete (globalThis as { __angularLynxStyleIndex?: unknown })
      .__angularLynxStyleIndex;
    resetStyleIndex();
  });

  it('draws text in a <view> in a <text> of its own', () => {
    const fixture = TestBed.createComponent(LooseHost);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"3 items"']);

    fixture.componentInstance.count.set(4);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"4 items"']);
  });

  it('hides the <text> while its text is blank, as a browser gives it no box', () => {
    const fixture = TestBed.createComponent(BlankHost);
    fixture.detectChanges();
    expect(byClass('box').children.map(hidden)).toEqual([true]);

    fixture.componentInstance.label.set('Ada');
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"Ada"']);

    // Whitespace alone is blank too; a non-breaking space is text.
    fixture.componentInstance.label.set('  ');
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual([]);
    fixture.componentInstance.label.set(' ');
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['" "']);
  });

  it('regroups loose text only when its text turns blank or back', () => {
    const fixture = TestBed.createComponent(BlankHost);
    fixture.detectChanges();
    // A regroup asks this first, once (see #laysOutLines).
    const regroups = vi.spyOn(NOT_BLOCK_CONTAINERS as Set<string>, 'has');

    fixture.componentInstance.label.set('Ada');
    fixture.detectChanges();
    expect(regroups).toHaveBeenCalledOnce();

    // A counter's tick, say: what a regroup does can't change.
    regroups.mockClear();
    fixture.componentInstance.label.set('Bob');
    fixture.detectChanges();
    expect(regroups).not.toHaveBeenCalled();
    expect(shape(byClass('box'))).toEqual(['"Bob"']);

    regroups.mockClear();
    fixture.componentInstance.label.set(' ');
    fixture.detectChanges();
    expect(regroups).toHaveBeenCalledOnce();
    expect(byClass('box').children.map(hidden)).toEqual([true]);
    regroups.mockRestore();
  });

  it('runs text and inline tags in a block on as one line', () => {
    const fixture = TestBed.createComponent(InlineHost);
    fixture.detectChanges();
    expect(shape(byClass('card'))).toEqual(['"Hi there, friend!"']);
  });

  it('runs inline tags beside each other on as one line', () => {
    const fixture = TestBed.createComponent(SpansHost);
    fixture.detectChanges();
    expect(shape(byClass('pair'))).toEqual(['"AB"']);
  });

  it('drops the space between two inline tags, as Angular does in a browser', () => {
    const fixture = TestBed.createComponent(DroppedSpaceHost);
    fixture.detectChanges();
    expect(shape(byClass('tags'))).toEqual(['"Name:Ada"']);
  });

  it('keeps the space between inline tags with preserveWhitespaces', () => {
    const fixture = TestBed.createComponent(KeptSpacesHost);
    fixture.detectChanges();
    expect(shape(byClass('tags'))).toEqual(['"big bold big b thin"']);
    // The indentation around the line is trimmed, as a browser lays it out.
    expect(shape(byClass('links'))).toEqual(['"terms privacy"']);
    expect(shape(byClass('label'))).toEqual(['"Name: Ada"']);
  });

  it('keeps the space between inline tags written as &ngsp;', () => {
    const fixture = TestBed.createComponent(NgspHost);
    fixture.detectChanges();
    expect(shape(byClass('tags'))).toEqual(['"big bold big b thin"']);
  });

  it('leaves a lone inline tag as it is', () => {
    const fixture = TestBed.createComponent(LoneSpanHost);
    fixture.detectChanges();
    expect(shape(byClass('solo'))).toEqual(['text._ngtag-span.badge"3"']);
  });

  it('starts a new line at a block, as a <p> or a <view>', () => {
    let fixture = TestBed.createComponent(ParagraphHost);
    fixture.detectChanges();
    expect(shape(byClass('doc'))).toEqual([
      '"Intro"',
      'text._ngtag-p"Para"',
      '"outro"',
    ]);

    fixture = TestBed.createComponent(MixedHost);
    fixture.detectChanges();
    expect(shape(byClass('row'))).toEqual(['"Hi"', 'view.dot', '"there"']);
  });

  it('makes each a flex item of its own in a flex container, and regroups when that changes', () => {
    const fixture = TestBed.createComponent(FlexHost);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"Hi there"']);

    fixture.componentInstance.row.set(true);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"Hi"', 'text._ngtag-b"there"']);

    fixture.componentInstance.row.set(false);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"Hi there"']);
  });

  it('reads a flex container from an inline display too', () => {
    const fixture = TestBed.createComponent(InlineStyleFlexHost);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"Hi"', 'text._ngtag-b"there"']);
  });

  it('reads a flex container from the build’s style index', () => {
    // As the build plugin writes it: `.row { display: flex }`.
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = { rules: [[['box'], 1 << 11]] };
    const fixture = TestBed.createComponent(InlineHost);
    fixture.detectChanges();
    expect(shape(byClass('card'))).toEqual(['"Hi there, friend!"']);

    const flex = TestBed.createComponent(FlexHost);
    flex.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"Hi"', 'text._ngtag-b"there"']);
  });

  it('runs @if text on with the text before it', () => {
    const fixture = TestBed.createComponent(PluralHost);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"3 items"']);

    fixture.componentInstance.n.set(1);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"1 item"']);
  });

  it('keeps an @if anchor between text in the line, as an empty raw-text', () => {
    const fixture = TestBed.createComponent(AnchorsHost);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"A and B"']);
    // On iOS a hidden view in a <text> draws a gap: the anchor isn't one.
    const line = byClass('box').children.find((c) => c.tag === 'text')!;
    expect(line.children.map((c) => c.tag)).toEqual([
      'raw-text',
      'raw-text',
      'raw-text',
      'raw-text',
    ]);

    fixture.componentInstance.a.set(false);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"and B"']);
  });

  it('makes an anchor in a Lynx <text> an empty raw-text, which draws no gap', () => {
    const fixture = TestBed.createComponent(TextAnchorHost);
    fixture.detectChanges();
    const tags = (): string[] => byClass('t').children.map((c) => c.tag);
    expect(tags()).toEqual(['raw-text', 'text', 'raw-text']);

    fixture.componentInstance.loud.set(false);
    fixture.detectChanges();
    expect(tags()).toEqual(['raw-text', 'raw-text']);
    fixture.componentInstance.loud.set(true);
    fixture.detectChanges();
    expect(tags()).toEqual(['raw-text', 'text', 'raw-text']);
  });

  it('leaves text in a <text> as it is', () => {
    const fixture = TestBed.createComponent(InTextHost);
    fixture.detectChanges();
    expect(shape(byClass('t'))).toEqual(['raw:Hello']);
  });

  it('draws text projected into a <view>', () => {
    const fixture = TestBed.createComponent(ProjectedHost);
    fixture.detectChanges();
    expect(shape(byClass('wrap'))).toEqual(['"Projected"']);
  });

  it('takes the <text> away with an @if, and brings it back', async () => {
    const fixture = TestBed.createComponent(ToggleLooseHost);
    fixture.detectChanges();
    expect(shape(byClass('box'))).toEqual(['"Shown"', 'view.end']);

    fixture.componentInstance.show.set(false);
    fixture.detectChanges();
    await flush();
    expect(shape(byClass('box'))).toEqual(['view.end']);

    fixture.componentInstance.show.set(true);
    fixture.detectChanges();
    await flush();
    expect(shape(byClass('box'))).toEqual(['"Shown"', 'view.end']);
  });

  it('moves and removes runs with @for, on one line', async () => {
    const fixture = TestBed.createComponent(ForLooseHost);
    fixture.detectChanges();
    expect(shape(byClass('list'))).toEqual(['"a b c"']);

    fixture.componentInstance.items.set(['c', 'a', 'b']);
    fixture.detectChanges();
    await flush();
    expect(shape(byClass('list'))).toEqual(['"c a b"']);

    fixture.componentInstance.items.set(['a', 'd']);
    fixture.detectChanges();
    await flush();
    expect(shape(byClass('list'))).toEqual(['"a d"']);
  });

  it('gives HTML text tags the text styles their own rules don’t set', () => {
    // As the build plugin writes it: `.title { color: … }`, bit 0.
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = { rules: [[['title'], 1]] };
    const fixture = TestBed.createComponent(InheritHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');

    expect(style('plain')).toContain('color: var(--angular-lynx-color)');
    expect(style('plain')).toContain(
      'font-size: var(--angular-lynx-font-size)',
    );
    expect(style('title')).not.toContain('color: var(--angular-lynx-color)');
    expect(style('title')).toContain(
      'font-size: var(--angular-lynx-font-size)',
    );
    // An element written as a Lynx <text> looks as it always has.
    expect(style('lynx')).toBe('');
  });

  // Issue #611: the build gives `<b>` and `<strong>` the browser's bold, in a
  // rule on the tag's class (`._ngtag-b`, the plugin's html-text-tags.css).
  // The weight it inherits would go inline, where it beats any rule, so the
  // index entry for the tag's class must keep it off.
  it("leaves a <b>'s weight to the build's rule for its tag", () => {
    const fontWeight = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-weight');
    const color = 1 << INHERITED_TEXT_PROPERTIES.indexOf('color');
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['blue'], color],
        [['_ngtag-b'], fontWeight],
        [['_ngtag-strong'], fontWeight],
      ],
    };
    const fixture = TestBed.createComponent(BoldHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');

    expect(style('_ngtag-b')).not.toContain('font-weight');
    // It still takes the color of the text around it, as on the web.
    expect(style('_ngtag-b')).toContain('color: var(--angular-lynx-color)');
    // The <i> has no weight of its own: it draws at the <text>'s, which no
    // rule sets, so it reads no variable for it (issue #646).
    expect(style('_ngtag-i')).toContain('color: var(--angular-lynx-color)');
    expect(style('_ngtag-i')).not.toContain('font-weight');
  });

  // Issue #690: an inline style on a Lynx <text> didn't reach the inline
  // tags inside it. The build copies only stylesheet rules to the variables
  // the tags read, and a property set inline counted as the <text>'s
  // default, so `<text style="font-size: 18px">a <b>b</b></text>` drew the
  // <b> at the page's size.
  it("gives an inline tag the inline style of the <text> it's in", () => {
    // As the build writes it for an app whose CSS sets no text styles.
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = { rules: [] };
    const fixture = TestBed.createComponent(InlineStyleHost);
    fixture.detectChanges();
    const style = (el: FakeEl): string => String(el.attrs.get('style') ?? '');
    const total = byClass('total');
    const bold = (text: FakeEl): FakeEl =>
      text.children.find((child) => child.classes.has('_ngtag-b'))!;

    // The <text> passes its inline values down, as its rules' copies do.
    expect(style(total)).toContain('--angular-lynx-font-size: 18px');
    expect(style(total)).toContain('--angular-lynx-color: red');
    expect(style(bold(total))).toContain(
      'font-size: var(--angular-lynx-font-size)',
    );
    expect(style(bold(total))).toContain('color: var(--angular-lynx-color)');

    // A [style.x] binding too, and the <b> goes back to the default with it.
    const bound = byClass('bound');
    expect(style(bound)).toContain('--angular-lynx-font-size: 20px');
    expect(style(bold(bound))).toContain(
      'font-size: var(--angular-lynx-font-size)',
    );
    fixture.componentInstance.size.set(24);
    fixture.detectChanges();
    expect(style(bound)).toContain('--angular-lynx-font-size: 24px');
    fixture.componentInstance.size.set(null);
    fixture.detectChanges();
    expect(style(bound)).not.toContain('--angular-lynx-font-size');
    expect(style(bold(bound))).not.toContain('font-size');
  });

  // Issue #649: a browser styles an `<a>` as a link only with an `href`, and
  // an `<abbr>` only with a `title`. Lynx matches no attribute selector, so
  // the runtime gives the element a class standing for the pair, which the
  // build's rules style, for as long as it has the attribute.
  it('marks an <a> with an href and an <abbr> with a title for the build to style', () => {
    const fixture = TestBed.createComponent(LinkHost);
    fixture.detectChanges();

    expect(byClass('link').classes.has('_ngattr-a-href')).toBe(true);
    // The attribute still reaches the element.
    expect(byClass('link').attrs.get('href')).toBe('https://lynxjs.org');
    expect(byClass('plain').classes.has('_ngattr-a-href')).toBe(false);
    expect(byClass('abbr').classes.has('_ngattr-abbr-title')).toBe(true);
    // Only the tag a browser styles with the attribute gets a class.
    expect(
      [...byClass('span').classes].some((name) => name.startsWith('_ngattr-')),
    ).toBe(false);

    fixture.componentInstance.href.set(null);
    fixture.detectChanges();

    expect(byClass('link').classes.has('_ngattr-a-href')).toBe(false);
  });

  // Issue #663: the build's `<small>`, `<sub>` and `<sup>` rule divides the
  // size around the tag by 1.2, but has no copy to pass that on. The index
  // marks it with SMALLER_FLAG, and the runtime gives the text inside a class
  // of the build's that divides the size again for each level, as a browser
  // draws it.
  it('draws the text inside a <small>, <sub> or <sup> at its smaller size', () => {
    const fontSize = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-size');
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['big'], fontSize],
        [['large'], fontSize],
        [['_ngtag-small'], SMALLER_FLAG],
        [['_ngtag-sup'], SMALLER_FLAG],
        // The build's classes are in the index too, as it lists every rule.
        [['_ngsmaller-1'], SMALLER_FLAG],
        [['_ngsmaller-2'], SMALLER_FLAG],
      ],
    };
    const fixture = TestBed.createComponent(SmallerHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');
    const smaller = (cls: string): string[] =>
      [...byClass(cls).classes].filter((name) =>
        name.startsWith('_ngsmaller-'),
      );

    // The outer tags' own rule makes them smaller.
    expect(smaller('outer')).toEqual([]);
    expect(style('outer')).not.toContain('font-size');
    expect(smaller('sup')).toEqual([]);
    // The text inside one is as small as it is, from the class, which an
    // inherited size inline would beat.
    expect(smaller('in-small')).toEqual(['_ngsmaller-1']);
    expect(style('in-small')).not.toContain('font-size');
    expect(smaller('in-sup')).toEqual(['_ngsmaller-1']);
    // A <small> in a <small> is smaller again, and so is the text in it.
    expect(smaller('inner')).toEqual(['_ngsmaller-2']);
    expect(smaller('in-inner')).toEqual(['_ngsmaller-2']);

    // A class of the app's that sizes the outer <small> passes its size on
    // in its copy, which the text inside reads.
    fixture.componentInstance.large.set(true);
    fixture.detectChanges();
    expect(smaller('in-small')).toEqual([]);
    expect(style('in-small')).toContain(
      'font-size: var(--angular-lynx-font-size)',
    );
    expect(smaller('inner')).toEqual([]);
    expect(smaller('in-inner')).toEqual(['_ngsmaller-1']);

    fixture.componentInstance.large.set(false);
    fixture.detectChanges();
    expect(smaller('in-small')).toEqual(['_ngsmaller-1']);
    expect(smaller('inner')).toEqual(['_ngsmaller-2']);
    expect(smaller('in-inner')).toEqual(['_ngsmaller-2']);
  });

  // Issue #690: an inline size passes on in its copy, as a rule's does, so
  // the levels of <small> start again below it.
  it('starts the levels of <small> again below an inline font size', () => {
    const fontSize = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-size');
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['big'], fontSize],
        [['_ngtag-small'], SMALLER_FLAG],
        [['_ngsmaller-1'], SMALLER_FLAG],
        [['_ngsmaller-2'], SMALLER_FLAG],
      ],
    };
    const fixture = TestBed.createComponent(InlineSmallerHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');
    const smaller = (cls: string): string[] =>
      [...byClass(cls).classes].filter((name) =>
        name.startsWith('_ngsmaller-'),
      );
    expect(smaller('in-small')).toEqual(['_ngsmaller-1']);
    expect(smaller('in-inner')).toEqual(['_ngsmaller-2']);

    fixture.componentInstance.size.set(20);
    fixture.detectChanges();
    expect(style('outer')).toContain('--angular-lynx-font-size: 20px');
    expect(smaller('in-small')).toEqual([]);
    expect(style('in-small')).toContain(
      'font-size: var(--angular-lynx-font-size)',
    );
    expect(smaller('inner')).toEqual([]);
    expect(smaller('in-inner')).toEqual(['_ngsmaller-1']);

    fixture.componentInstance.size.set(null);
    fixture.detectChanges();
    expect(smaller('in-small')).toEqual(['_ngsmaller-1']);
    expect(smaller('in-inner')).toEqual(['_ngsmaller-2']);
  });

  // A rule with the build's smaller size can require an ancestor, as
  // `.compact .label` does: outside `.compact` the label isn't smaller, and
  // nor is the text inside it.
  it('counts a smaller size only where its selector matches the elements above', () => {
    const fontSize = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-size');
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['big'], fontSize],
        [['label'], SMALLER_FLAG, [[' ', ['compact']]]],
      ],
    };
    const fixture = TestBed.createComponent(CompactHost);
    fixture.detectChanges();
    const smaller = (cls: string): string[] =>
      [...byClass(cls).classes].filter((name) =>
        name.startsWith('_ngsmaller-'),
      );

    expect(smaller('in-label')).toEqual([]);

    // The ancestor's class makes the label smaller, and the text inside it.
    fixture.componentInstance.compact.set(true);
    fixture.detectChanges();
    expect(smaller('label')).toEqual([]);
    expect(smaller('in-label')).toEqual(['_ngsmaller-1']);

    fixture.componentInstance.compact.set(false);
    fixture.detectChanges();
    expect(smaller('in-label')).toEqual([]);
  });

  // A rule that sets the size where an ancestor has a class, as `.compact
  // .reset` does, ends the levels of <small> above it there, and only there.
  it('works the levels of <small> out again when an ancestor makes a rule set the size', () => {
    const fontSize = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-size');
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['big'], fontSize],
        [['_ngtag-small'], SMALLER_FLAG],
        [['reset'], fontSize, [[' ', ['compact']]]],
      ],
    };
    const fixture = TestBed.createComponent(ResetHost);
    fixture.detectChanges();
    const smaller = (cls: string): string[] =>
      [...byClass(cls).classes].filter((name) =>
        name.startsWith('_ngsmaller-'),
      );

    expect(smaller('in-reset')).toEqual(['_ngsmaller-1']);

    // The span sets its own size now, which its copy passes to the <b>.
    fixture.componentInstance.compact.set(true);
    fixture.detectChanges();
    expect(smaller('in-reset')).toEqual([]);

    fixture.componentInstance.compact.set(false);
    fixture.detectChanges();
    expect(smaller('in-reset')).toEqual(['_ngsmaller-1']);
  });

  // Issue #682: on iOS, Lynx moves only the text of the <text> that has the
  // vertical-align, so the tags inside a <sup> or <sub> get the distance
  // inline, in their own em, and a <sup> in a <sup> the sum of both.
  it('moves the tags inside a <sup> or <sub> with it', () => {
    const fontSize = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-size');
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['big'], fontSize],
        [['_ngtag-small'], SMALLER_FLAG],
        [['_ngtag-sub'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
        [['_ngtag-sup'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
        [['own'], VERTICAL_ALIGN_FLAG],
      ],
      verticalAligns: [
        ...BUILD_VERTICAL_ALIGNS,
        // A distance the runtime can't copy, such as `super`.
        [['own'], [], null, 1000, 0, 2],
      ],
    };
    const fixture = TestBed.createComponent(RaisedHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');

    // The <sup>'s own rule moves it.
    expect(style('sup')).not.toContain('vertical-align');
    expect(style('in-sup')).toContain('vertical-align: 0.4em');
    expect(style('in-sub')).toContain('vertical-align: -0.24em');
    // A <small> is smaller, so the same distance is more of its em.
    expect(style('small-in-sup')).toContain('vertical-align: 0.48em');
    expect(style('sup-in-sup')).toContain('vertical-align: 0.88em');

    // An app's rule for the inner <sup> beats the build's, with a distance
    // the runtime can't copy, so it leaves the tag to Lynx, where a browser
    // would add the outer <sup>'s distance to it.
    fixture.componentInstance.own.set(true);
    fixture.detectChanges();
    expect(style('sup-in-sup')).not.toContain('vertical-align');

    fixture.componentInstance.own.set(false);
    fixture.detectChanges();
    expect(style('sup-in-sup')).toContain('vertical-align: 0.88em');
  });

  // The index sees neither an inline size nor an inline vertical-align
  // (review of #714): the runtime reads an inline distance as a rule's, and
  // with an inline size the distance can't be worked out.
  it('reads the inline style of the tags around the tags inside a <sup>', () => {
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['_ngtag-small'], SMALLER_FLAG],
        [['_ngtag-sub'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
        [['_ngtag-sup'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
        [['own'], VERTICAL_ALIGN_FLAG],
      ],
      verticalAligns: [
        ...BUILD_VERTICAL_ALIGNS,
        // An app's `.own { vertical-align: -0.24em }`, later in the
        // stylesheet than the build's `sup`, which it beats.
        [['own'], [], [-0.24, 0], 1000, 0, 2],
      ],
    };
    const fixture = TestBed.createComponent(RaisedHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');
    expect(style('in-sup')).toContain('vertical-align: 0.4em');

    // A size of its own: 0.4em of it isn't the <sup>'s distance.
    fixture.componentInstance.size.set('40px');
    fixture.detectChanges();
    expect(style('in-sup')).not.toContain('vertical-align');
    fixture.componentInstance.size.set(null);
    fixture.detectChanges();
    expect(style('in-sup')).toContain('vertical-align: 0.4em');

    // A distance of the <sup>'s own, which wins over its rule.
    fixture.componentInstance.supAlign.set('0.8em');
    fixture.detectChanges();
    expect(style('in-sup')).toContain('vertical-align: 0.8em');
    expect(style('small-in-sup')).toContain('vertical-align: 0.96em');
    // One the runtime can't copy.
    fixture.componentInstance.supAlign.set('super');
    fixture.detectChanges();
    expect(style('in-sup')).not.toContain('vertical-align');
    expect(style('small-in-sup')).not.toContain('vertical-align');
    fixture.componentInstance.supAlign.set(null);
    fixture.detectChanges();
    expect(style('in-sup')).toContain('vertical-align: 0.4em');

    // The inner <sup> is lowered by its own rule, and raised by the outer
    // one's distance, 1.2 times as many of its em.
    fixture.componentInstance.own.set(true);
    fixture.detectChanges();
    expect(style('sup-in-sup')).toContain('vertical-align: 0.24em');
  });

  // A binding's style covers the runtime's own declaration of it while it's
  // there, and removing it natively removed both (review of #714).
  it("keeps the runtime's own declaration of a style when a binding of it goes", () => {
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [[['_ngtag-sub'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG]],
      verticalAligns: BUILD_VERTICAL_ALIGNS,
    };
    const fixture = TestBed.createComponent(RaisedHost);
    fixture.detectChanges();
    const native = globalThis as unknown as {
      __AddInlineStyle: (el: FakeEl, key: string, value: unknown) => void;
    };
    const removed: string[] = [];
    const add = native.__AddInlineStyle;
    native.__AddInlineStyle = (el, key, value) => {
      if (value === null) removed.push(key);
      add(el, key, value);
    };
    const style = (): string => String(byClass('in-sub').attrs.get('style'));
    try {
      // The inherited color comes back, rather than Lynx's default.
      fixture.componentInstance.color.set('red');
      fixture.detectChanges();
      fixture.componentInstance.color.set(null);
      fixture.detectChanges();
      expect(removed).not.toContain('color');
      expect(style()).toContain('color: var(--angular-lynx-color)');

      // And so does the <sub>'s distance, which the app's own left out.
      fixture.componentInstance.subAlign.set('2px');
      fixture.detectChanges();
      expect(style()).not.toContain('vertical-align');
      fixture.componentInstance.subAlign.set(null);
      fixture.detectChanges();
      expect(style()).toContain('vertical-align: -0.24em');
    } finally {
      native.__AddInlineStyle = add;
    }
  });

  // The web preview's browser moves an inline element with its parent
  // already, so an offset of the runtime's would move it twice.
  it('leaves the tags inside a <sup> to the browser in the web preview', () => {
    vi.stubGlobal('__WEB__', true);
    try {
      (
        globalThis as { __angularLynxStyleIndex?: unknown }
      ).__angularLynxStyleIndex = {
        rules: [[['_ngtag-sup'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG]],
        verticalAligns: BUILD_VERTICAL_ALIGNS,
      };
      const fixture = TestBed.createComponent(RaisedHost);
      fixture.detectChanges();
      expect(String(byClass('in-sup').attrs.get('style') ?? '')).not.toContain(
        'vertical-align',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Issue #715: an app's own rule moves the tags inside its tag too, by its
  // distance in em or px, and wins over the build's rule for a <sup> where
  // it's more specific.
  it("moves the tags inside a tag with the app's own vertical-align", () => {
    const fontSize = 1 << INHERITED_TEXT_PROPERTIES.indexOf('font-size');
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['_ngtag-sub'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
        [['_ngtag-sup'], SMALLER_FLAG | VERTICAL_ALIGN_FLAG],
        [['exp'], VERTICAL_ALIGN_FLAG],
        [['sized'], fontSize],
        [['_ngtag-sup'], VERTICAL_ALIGN_FLAG, [[' ', ['note']]]],
      ],
      verticalAligns: [
        ...BUILD_VERTICAL_ALIGNS,
        [['exp'], [], [0.5, 0], 1000, 0, 2],
        [['_ngtag-sup'], [[' ', ['note']]], [0.3, 0], 2000, 0, 3],
      ],
    };
    const fixture = TestBed.createComponent(OwnAlignHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');

    expect(style('exp')).not.toContain('vertical-align');
    expect(style('in-exp')).toContain('vertical-align: 0.5em');
    // A <sup> in it rises by both, its em 1.2 times smaller.
    expect(style('sup-in-exp')).toContain('vertical-align: 1em');

    // A size of the span's own passes to the tags inside, which measure its
    // em by it.
    fixture.componentInstance.sized.set(true);
    fixture.detectChanges();
    expect(style('in-exp')).toContain('vertical-align: 0.5em');
    expect(style('sup-in-exp')).toContain('vertical-align: 1em');

    // An inline distance in pixels moves the tags inside by as much. A
    // <sup> in it would need both its em and the pixels, which Lynx drops
    // as a calc(), so it's left to its own rule.
    expect(style('in-lift')).not.toContain('vertical-align');
    fixture.componentInstance.lift.set('4px');
    fixture.detectChanges();
    expect(style('in-lift')).toContain('vertical-align: 4px');
    expect(style('sup-in-lift')).not.toContain('vertical-align');
    // The tags inside the <sup> still rise with its own text (review of
    // #735).
    expect(style('in-sup-in-lift')).toContain('vertical-align: 0.4em');
    fixture.componentInstance.lift.set(null);
    fixture.detectChanges();
    expect(style('in-lift')).not.toContain('vertical-align');

    // `.note sup` wins over the build's `sup`: the tags inside move by its
    // distance, not the build's.
    expect(style('in-note-sup')).toContain('vertical-align: 0.4em');
    fixture.componentInstance.note.set(true);
    fixture.detectChanges();
    expect(style('in-note-sup')).toContain('vertical-align: 0.3em');
  });

  // Issue #643: the build gives `<em>`, `<u>`, `<s>` and their kin the
  // browser's italic and lines, in rules on their tags' classes. As for
  // `<b>`'s weight, the index entries must keep the inherited value off, and
  // a tag inside one still reads the value from it.
  it("leaves an <em>'s style and an <s>'s line to the build's rules for their tags", () => {
    const bit = (property: string): number =>
      1 << INHERITED_TEXT_PROPERTIES.indexOf(property);
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['_ngtag-em'], bit('font-style')],
        [['_ngtag-s'], bit('text-decoration')],
        [['_ngtag-u'], bit('text-decoration')],
      ],
    };
    const fixture = TestBed.createComponent(DecoratedHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');

    expect(style('_ngtag-em')).not.toContain('font-style');
    expect(style('_ngtag-s')).not.toContain('text-decoration');
    expect(style('_ngtag-u')).not.toContain('text-decoration');
    // A <b> inside the <s> draws its line through, from the <s>'s copy.
    expect(style('_ngtag-b')).toContain(
      'text-decoration: var(--angular-lynx-text-decoration)',
    );
  });

  it('gives an HTML text tag its ancestors’ text styles over a rule for every <text>', () => {
    // As the build writes the theme's `view > text { color: … }` and a
    // `text.title { font-size: … }`: they match a <p> natively, as it's a
    // <text>, but on the web no `text` selector matches a <p>, which takes
    // its parent's color and size (issue #610).
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = {
      rules: [
        [['<text>'], 1],
        [['<text>', 'title'], 4],
      ],
    };
    const fixture = TestBed.createComponent(InheritHost);
    fixture.detectChanges();
    const style = (cls: string): string =>
      String(byClass(cls).attrs.get('style') ?? '');

    expect(style('plain')).toContain('color: var(--angular-lynx-color)');
    expect(style('title')).toContain('color: var(--angular-lynx-color)');
    expect(style('title')).toContain(
      'font-size: var(--angular-lynx-font-size)',
    );
    expect(style('lynx')).toBe('');
  });
});

describe('loose text, element by element', () => {
  let doc: LynxDocument;
  let page: LynxElement;

  /**
   * The fake native element a wrapper drives.
   */
  const native = (el: LynxElement): FakeEl => el.element as unknown as FakeEl;

  /**
   * Commits removals, regrouping and text trims, as the end of a cycle does.
   */
  const commit = (): void => {
    processPendingRemovals();
    processPendingFlow();
    processPendingTextNormalization();
    (globalThis as unknown as FakeNativeGlobal<FakeEl>).__FlushElementTree();
  };

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
    resetStyleIndex();
    doc = new LynxDocument();
    page = doc.createRootElement();
  });

  it('hides the anonymous <text> from parentNode() and nextSibling()', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const before = doc.createElement('view');
    const hello = doc.createText('Hello ');
    const bold = doc.createElement('b');
    const after = doc.createElement('view');
    view.appendChild(before);
    view.appendChild(hello);
    view.appendChild(bold);
    view.appendChild(after);
    commit();

    const wrapper = native(hello).parent!;
    expect(wrapper.tag).toBe('text');
    expect(wrapper.parent).toBe(native(view));
    expect(native(bold).parent).toBe(wrapper);
    expect(hello.parentNode()).toBe(view);
    expect(bold.parentNode()).toBe(view);
    expect(before.nextSibling()).toBe(hello);
    expect(hello.nextSibling()).toBe(bold);
    expect(bold.nextSibling()).toBe(after);
  });

  it('puts an element before loose text, before its <text>', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    commit();
    const first = doc.createElement('image');

    view.insertBefore(first, hello);
    commit();

    expect(native(view).children.map((c) => c.tag)).toEqual(['image', 'text']);
  });

  it('splits a line where an element goes in the middle of it', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const a = doc.createText('a');
    const b = doc.createText('b');
    view.appendChild(a);
    view.appendChild(b);
    commit();
    expect(native(view).children.map((c) => c.tag)).toEqual(['text']);

    const block = doc.createElement('view');
    view.insertBefore(block, b);
    // In the native tree at once, with each half in a <text> of its own.
    expect(native(block).parent).toBe(native(view));
    commit();

    expect(native(view).children.map((c) => c.tag)).toEqual([
      'text',
      'view',
      'text',
    ]);
    expect(a.nextSibling()).toBe(block);
    expect(block.nextSibling()).toBe(b);
  });

  it('joins two lines when the element between them goes', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const a = doc.createText('a ');
    const block = doc.createElement('view');
    const b = doc.createText('b');
    view.appendChild(a);
    view.appendChild(block);
    view.appendChild(b);
    commit();
    expect(native(view).children.map((c) => c.tag)).toEqual([
      'text',
      'view',
      'text',
    ]);

    block.remove();
    commit();

    expect(native(view).children.map((c) => c.tag)).toEqual(['text']);
    expect(rawTextLeaves(native(view)).map(leafText)).toEqual(['a ', 'b']);
  });

  it('takes loose text out of its <text> into a <text>, and back', () => {
    const view = doc.createElement('view');
    const text = doc.createElement('text');
    page.appendChild(view);
    page.appendChild(text);
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    commit();

    text.appendChild(hello);
    commit();
    expect(native(hello).parent).toBe(native(text));
    expect(native(view).children).toEqual([]);

    view.appendChild(hello);
    commit();
    expect(native(view).children.map((c) => c.tag)).toEqual(['text']);
    expect(native(hello).parent).toBe(native(view).children[0]);
    expect(hello.parentNode()).toBe(view);
  });

  it('turns an anchor back into a hidden view when it leaves a <text>', () => {
    const text = doc.createElement('text');
    const view = doc.createElement('view');
    page.appendChild(text);
    page.appendChild(view);
    const anchor = doc.createComment();

    text.appendChild(anchor);
    expect(native(anchor).tag).toBe('raw-text');
    view.appendChild(anchor);
    expect(native(anchor).tag).toBe('view');
    expect(native(anchor).parent).toBe(native(view));
    expect(native(text).children).toEqual([]);
    expect(anchor.parentNode()).toBe(view);
  });

  it('leaves a raw-text in an element that draws no text as it is', () => {
    const input = doc.createElement('input');
    page.appendChild(input);
    const hello = doc.createText('Hello');

    input.appendChild(hello);
    commit();

    expect(native(hello).parent).toBe(native(input));
  });

  it('gives a touch on loose text to its element', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    commit();

    const wrapperId = native(hello).parent!.id;
    expect(LynxElement.byUniqueId(wrapperId)).toBe(view);
    expect(LynxElement.byUniqueId(native(view).id)).toBe(view);

    // Out of the tree, it stands for nothing.
    hello.remove();
    commit();
    expect(LynxElement.byUniqueId(wrapperId)).toBeUndefined();
  });

  it('removes and releases the <text> with the last of its text', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    commit();
    const wrapperId = native(hello).parent!.id;

    hello.remove();
    hello.markDestroyed();
    commit();

    expect(native(view).children).toEqual([]);
    expect(LynxElement.byUniqueId(wrapperId)).toBeUndefined();
  });

  it('keeps loose text that comes back before the removal commits', () => {
    const view = doc.createElement('view');
    const other = doc.createElement('view');
    page.appendChild(view);
    page.appendChild(other);
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    commit();

    // An Angular move: removed, then inserted elsewhere in the same cycle.
    hello.remove();
    other.appendChild(hello);
    commit();

    expect(native(view).children).toEqual([]);
    expect(native(other).children.map((c) => c.tag)).toEqual(['text']);
    expect(rawTextLeaves(native(other)).map(leafText)).toEqual(['Hello']);
  });

  it('regroups a removed element’s loose text when it comes back', async () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    commit();
    // Text goes in, and the view goes out, in the same cycle.
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    view.remove();
    commit();
    expect(native(view).hasPaintingNode).toBe(false);

    page.appendChild(view);
    commit();

    const fresh = native(view);
    expect(fresh.children.map((c) => c.tag)).toEqual(['text']);
    expect(native(hello).parent!.parent).toBe(fresh);
  });

  it('takes the anonymous <text> of a server render as one', () => {
    // A snapshot's tree: the view holds the anonymous <text>, which holds
    // the raw-text (see LynxHydrateDocument).
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const viewRef = g.__CreateView();
    const wrapperRef = g.__CreateText();
    const textRef = g.__CreateRawText('Hello');
    g.__AppendElement(native(page), viewRef);
    g.__AppendElement(viewRef, wrapperRef);
    g.__AppendElement(wrapperRef, textRef);
    const view = new LynxElement(viewRef as never);
    new LynxElement(wrapperRef as never).markAnonymousText();
    const hello = new LynxElement(textRef as never);
    hello.tagName = 'raw-text';

    expect(hello.parentNode()).toBe(view);
    expect(LynxElement.byUniqueId(wrapperRef.id)).toBe(view);
  });

  /**
   * The shapes of `el`'s native children: tag, and the line of a <text>.
   */
  const lines = (el: LynxElement): string[] =>
    native(el)
      .children.filter((c) => !hidden(c))
      .map((c) =>
        c.tag === 'text'
          ? `"${rawTextLeaves(c).map(leafText).join('')}"`
          : c.tag,
      );

  it('keeps each run in a <text> of its own in a scroll-view', () => {
    const scroll = doc.createElement('scroll-view');
    page.appendChild(scroll);
    scroll.appendChild(doc.createText('a '));
    scroll.appendChild(doc.createText('b'));
    commit();

    expect(lines(scroll)).toEqual(['"a"', '"b"']);
  });

  it('reads a row from an inline linear-orientation, and regroups when it goes', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    view.setStyle('linear-orientation', 'horizontal');
    view.appendChild(doc.createText('a '));
    view.appendChild(doc.createText('b'));
    commit();
    expect(lines(view)).toEqual(['"a"', '"b"']);

    view.removeStyle('linear-orientation');
    commit();
    expect(lines(view)).toEqual(['"a b"']);

    view.setInlineStyles('linear-direction: row');
    commit();
    expect(lines(view)).toEqual(['"a"', '"b"']);
  });

  it('reads a flex container by its id from the style index', () => {
    (
      globalThis as { __angularLynxStyleIndex?: unknown }
    ).__angularLynxStyleIndex = { rules: [[['#bar'], 1 << 11]] };
    resetStyleIndex();
    const view = doc.createElement('view');
    page.appendChild(view);
    view.appendChild(doc.createText('a '));
    view.appendChild(doc.createText('b'));
    commit();
    expect(lines(view)).toEqual(['"a b"']);

    view.setAttribute('id', 'bar');
    commit();
    expect(lines(view)).toEqual(['"a"', '"b"']);
    delete (globalThis as { __angularLynxStyleIndex?: unknown })
      .__angularLynxStyleIndex;
    resetStyleIndex();
  });

  it('gives an HTML text tag removed this cycle its inherited styles when it comes back', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    commit();
    const p = doc.createElement('p');
    view.appendChild(p);
    p.remove();
    commit();
    expect(native(p).hasPaintingNode).toBe(false);

    view.appendChild(p);
    commit();

    expect(String(native(p).attrs.get('style'))).toContain(
      'color: var(--angular-lynx-color)',
    );
  });

  it('skips an emptied anonymous <text> in nextSibling()', () => {
    // A server render's anonymous <text> whose text has gone (see
    // LynxHydrateDocument): empty, still in the tree.
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const viewRef = g.__CreateView();
    const beforeRef = g.__CreateView();
    const wrapperRef = g.__CreateText();
    const afterRef = g.__CreateView();
    g.__AppendElement(native(page), viewRef);
    g.__AppendElement(viewRef, beforeRef);
    g.__AppendElement(viewRef, wrapperRef);
    g.__AppendElement(viewRef, afterRef);
    const before = new LynxElement(beforeRef as never);
    new LynxElement(wrapperRef as never).markAnonymousText();
    const after = new LynxElement(afterRef as never);

    expect(before.nextSibling()).toBe(after);
  });

  it('knows a server render’s anchor in a <text> for the raw-text it is', () => {
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const viewRef = g.__CreateView();
    const textRef = g.__CreateText();
    const anchorRef = g.__CreateRawText('');
    g.__AppendElement(native(page), viewRef);
    g.__AppendElement(native(page), textRef);
    g.__AppendElement(textRef, anchorRef);
    const view = new LynxElement(viewRef as never);
    const anchor = new LynxElement(anchorRef as never);
    anchor.tagName = 'comment';
    anchor.hydrateAnchor();

    view.appendChild(anchor);

    expect(native(anchor).tag).toBe('view');
    expect(native(anchor).parent).toBe(viewRef);
  });

  /**
   * Whether an element has the class the build's copies of text styles to
   * variables apply to (see #passTextStyles).
   */
  const passes = (el: LynxElement): boolean =>
    native(el).classes.has(INHERITANCE_CLASS);

  it('gives the elements around loose text the class the copies of text styles need', () => {
    const outer = doc.createElement('view');
    page.appendChild(outer);
    const view = doc.createElement('view');
    outer.appendChild(view);
    const sibling = doc.createElement('view');
    outer.appendChild(sibling);
    view.appendChild(doc.createText('Hello'));
    commit();

    expect(passes(view)).toBe(true);
    expect(passes(outer)).toBe(true);
    expect(passes(page)).toBe(true);
    // Nothing inside it reads them.
    expect(passes(sibling)).toBe(false);
    expect(native(view).children[0]!.classes.has(INHERITANCE_CLASS)).toBe(
      false,
    );
  });

  it('leaves a Lynx <text> with only its text without it', () => {
    // A screen of `<text class="…">{{ i }}</text>` pays for no copies.
    const view = doc.createElement('view');
    page.appendChild(view);
    const text = doc.createElement('text');
    view.appendChild(text);
    text.appendChild(doc.createText('1'));
    commit();

    expect(passes(text)).toBe(false);
    expect(passes(view)).toBe(false);
    expect(passes(page)).toBe(false);
  });

  it('gives it to a Lynx <text> with an HTML inline tag in it', () => {
    const text = doc.createElement('text');
    page.appendChild(text);
    const bold = doc.createElement('b');
    text.appendChild(bold);
    commit();

    expect(passes(text)).toBe(true);
    expect(passes(page)).toBe(true);
    // An HTML text tag with nothing inside reads the copies, needing none.
    expect(passes(bold)).toBe(false);
  });

  it('leaves it off the anonymous <text> an inline tag is in, which passes on its parent’s', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    view.appendChild(doc.createText('Hi '));
    const bold = doc.createElement('b');
    view.appendChild(bold);
    commit();

    const wrapper = native(bold).parent!;
    expect(wrapper.classes.has('_ngtext')).toBe(true);
    // A `view > text` rule matches it, and its copies would hide the view's.
    expect(wrapper.classes.has(INHERITANCE_CLASS)).toBe(false);
    expect(passes(view)).toBe(true);
    expect(passes(page)).toBe(true);
  });

  it('gives it to the HTML text tag an inline tag is in', () => {
    const p = doc.createElement('p');
    page.appendChild(p);
    const bold = doc.createElement('b');
    p.appendChild(bold);
    commit();

    expect(passes(p)).toBe(true);
  });

  it('gives the class for a rule naming <text> to a Lynx <text> only', () => {
    // The build narrows the copies of `view > text { color: … }` to it: a
    // <p> isn't a `text` on the web, so they'd hide its parent's color from
    // the inline tags in it (issue #610).
    const view = doc.createElement('view');
    page.appendChild(view);
    const text = doc.createElement('text');
    view.appendChild(text);
    text.appendChild(doc.createElement('b'));
    const p = doc.createElement('p');
    view.appendChild(p);
    p.appendChild(doc.createElement('b'));
    commit();

    const forText = (el: LynxElement): boolean =>
      native(el).classes.has(LYNX_TEXT_INHERITANCE_CLASS);
    expect(forText(text)).toBe(true);
    expect(passes(text)).toBe(true);
    expect(forText(p)).toBe(false);
    expect(passes(p)).toBe(true);
    // Nothing a `text` rule styles.
    expect(forText(view)).toBe(false);
    expect(forText(page)).toBe(false);
  });

  it('keeps it through a class binding', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    view.appendChild(doc.createElement('p'));
    commit();

    view.setAttribute('class', 'card');

    expect([...native(view).classes]).toEqual(['card', INHERITANCE_CLASS]);
  });

  it('gives it to the new ancestors of an element that moves with text inside', () => {
    const from = doc.createElement('view');
    const to = doc.createElement('view');
    const toParent = doc.createElement('view');
    toParent.appendChild(to);
    const card = doc.createElement('view');
    from.appendChild(card);
    card.appendChild(doc.createElement('span'));
    commit();
    expect(passes(from)).toBe(true);
    expect(passes(to)).toBe(false);

    to.appendChild(card);
    commit();

    expect(passes(to)).toBe(true);
    expect(passes(toParent)).toBe(true);
  });

  it('gives it to the ancestors of an element whose text goes in later', () => {
    // Angular builds an embedded view's elements before it inserts them.
    const view = doc.createElement('view');
    page.appendChild(view);
    const card = doc.createElement('view');
    const label = doc.createElement('label');
    card.appendChild(label);
    view.insertBefore(card, null);
    commit();

    expect(passes(card)).toBe(true);
    expect(passes(view)).toBe(true);
  });

  // Issue #646: a Lynx <text> reads none of the variables, so it draws a
  // property its rules don't set at Lynx's default, whatever its ancestors
  // set. An inline tag in it that read the variable took the ancestors'
  // value instead: under the theme's 16px page, `<text>Lynx text
  // <b>bold</b></text>` drew "bold" larger than the text beside it.
  describe('in a Lynx <text>', () => {
    const bit = (property: string): number =>
      1 << INHERITED_TEXT_PROPERTIES.indexOf(property);
    const style = (el: LynxElement): string =>
      String(native(el).attrs.get('style') ?? '');
    const FONT_SIZE = 'font-size: var(--angular-lynx-font-size)';
    const COLOR = 'color: var(--angular-lynx-color)';

    beforeEach(() => {
      // As the build plugin writes it, for `page { font-size: 16px }`,
      // `.big { font-size: 20px }` and `.red { color: red }`.
      (
        globalThis as { __angularLynxStyleIndex?: unknown }
      ).__angularLynxStyleIndex = {
        rules: [
          [['<page>'], bit('font-size')],
          [['big'], bit('font-size')],
          [['red'], bit('color')],
        ],
      };
      resetStyleIndex();
    });

    afterEach(() => {
      delete (globalThis as { __angularLynxStyleIndex?: unknown })
        .__angularLynxStyleIndex;
      resetStyleIndex();
    });

    it('leaves an inline tag at the default the <text> draws at', () => {
      const view = doc.createElement('view');
      view.setAttribute('class', 'red');
      page.appendChild(view);
      const text = doc.createElement('text');
      view.appendChild(text);
      text.appendChild(doc.createText('Lynx text '));
      const bold = doc.createElement('b');
      text.appendChild(bold);
      bold.appendChild(doc.createText('bold'));
      commit();

      expect(style(bold)).not.toContain(FONT_SIZE);
      expect(style(bold)).not.toContain(COLOR);
    });

    it('gives it what the <text>’s own rules set', () => {
      const text = doc.createElement('text');
      text.setAttribute('class', 'big');
      page.appendChild(text);
      const bold = doc.createElement('b');
      text.appendChild(bold);
      commit();

      expect(style(bold)).toContain(FONT_SIZE);
      expect(style(bold)).not.toContain(COLOR);
    });

    it('gives a tag inside an inline tag what that tag sets', () => {
      const text = doc.createElement('text');
      page.appendChild(text);
      const bold = doc.createElement('b');
      bold.setAttribute('class', 'big');
      text.appendChild(bold);
      const italic = doc.createElement('i');
      bold.appendChild(italic);
      commit();

      expect(style(italic)).toContain(FONT_SIZE);
      expect(style(italic)).not.toContain(COLOR);
    });

    it('inherits again when the <text>’s classes change', () => {
      const text = doc.createElement('text');
      page.appendChild(text);
      const bold = doc.createElement('b');
      text.appendChild(bold);
      const italic = doc.createElement('i');
      bold.appendChild(italic);
      commit();
      expect(style(italic)).not.toContain(FONT_SIZE);

      text.setAttribute('class', 'big');
      commit();
      expect(style(bold)).toContain(FONT_SIZE);
      expect(style(italic)).toContain(FONT_SIZE);

      text.setAttribute('class', '');
      commit();
      expect(style(bold)).not.toContain(FONT_SIZE);
    });

    it('inherits from the ancestors again when the tag moves out of it', () => {
      const text = doc.createElement('text');
      page.appendChild(text);
      const view = doc.createElement('view');
      page.appendChild(view);
      const bold = doc.createElement('b');
      text.appendChild(bold);
      commit();
      expect(style(bold)).not.toContain(FONT_SIZE);

      view.appendChild(bold);
      commit();
      expect(style(bold)).toContain(FONT_SIZE);
      expect(style(bold)).toContain(COLOR);
    });

    it('gives it what the <text>’s inline style sets (issue #690)', () => {
      // Set before the tag goes in, as Angular sets a static style.
      const text = doc.createElement('text');
      text.setAttribute('style', 'font-size: 18px; color: red !important');
      page.appendChild(text);
      const bold = doc.createElement('b');
      text.appendChild(bold);
      commit();

      expect(style(text)).toContain('--angular-lynx-font-size: 18px');
      // A variable can't be !important.
      expect(style(text)).toContain('--angular-lynx-color: red');
      expect(style(text)).not.toContain('--angular-lynx-color: red !');
      expect(style(bold)).toContain(FONT_SIZE);
      expect(style(bold)).toContain(COLOR);

      text.setAttribute('style', 'color: blue');
      commit();
      expect(style(text)).not.toContain('--angular-lynx-font-size');
      expect(style(text)).toContain('--angular-lynx-color: blue');
      expect(style(bold)).not.toContain(FONT_SIZE);
      expect(style(bold)).toContain(COLOR);
    });

    it('gives it a [style.x] the <text> gets after the tag', () => {
      const text = doc.createElement('text');
      page.appendChild(text);
      const bold = doc.createElement('b');
      text.appendChild(bold);
      commit();
      expect(style(bold)).not.toContain(FONT_SIZE);

      text.setStyle('font-size', '18px');
      commit();
      expect(style(text)).toContain('--angular-lynx-font-size: 18px');
      expect(style(bold)).toContain(FONT_SIZE);

      text.removeStyle('font-size');
      commit();
      expect(style(text)).not.toContain('--angular-lynx-font-size');
      expect(style(bold)).not.toContain(FONT_SIZE);
    });

    it('keeps a [style.x] text style and its copy when the whole style changes', () => {
      const text = doc.createElement('text');
      page.appendChild(text);
      const bold = doc.createElement('b');
      text.appendChild(bold);
      text.setStyle('font-size', '20px');
      commit();

      text.setAttribute('style', 'color: red');
      commit();
      // The declaration itself, not only its copy.
      expect(style(text)).toMatch(/(^|; )font-size: 20px/);
      expect(style(text)).toContain('--angular-lynx-font-size: 20px');
      expect(style(text)).toContain('--angular-lynx-color: red');
      expect(style(bold)).toContain(FONT_SIZE);
      expect(style(bold)).toContain(COLOR);
    });

    it('takes a removed style out of the style string of an element that sets copies', () => {
      const view = doc.createElement('view');
      view.setAttribute('style', 'color: red; height: 100px');
      page.appendChild(view);
      view.appendChild(doc.createElement('p'));
      commit();
      expect(style(view)).toContain('height: 100px');

      view.removeStyle('height');
      commit();
      expect(style(view)).not.toContain('height');
      expect(style(view)).toContain('--angular-lynx-color: red');

      // A text style goes with its copy.
      view.removeStyle('color');
      commit();
      expect(style(view)).not.toContain('color');
      // A property's name matches in any case, as the copy reads it.
      view.setAttribute('style', 'Color: green; height: 10px');
      commit();
      expect(style(view)).toContain('--angular-lynx-color: green');
      view.removeStyle('color');
      commit();
      expect(style(view)).not.toContain('green');
      expect(style(view)).toContain('height: 10px');
      // A ; inside a quoted value stays in its declaration.
      view.setAttribute(
        'style',
        '--label: "alpha;height: 10px;omega"; color: red; height: 20px',
      );
      commit();
      view.removeStyle('height');
      commit();
      expect(style(view)).toContain('--label: "alpha;height: 10px;omega"');
      expect(style(view)).not.toContain('height: 20px');
      // One the string doesn't declare leaves it as it is.
      view.setAttribute('style', 'color: blue');
      view.removeStyle('width');
      commit();
      expect(style(view)).toContain('--angular-lynx-color: blue');
    });

    it('lets an inheritance variable the app sets itself win over the copy', () => {
      const view = doc.createElement('view');
      view.setAttribute('style', 'color: red; --angular-lynx-color: blue');
      page.appendChild(view);
      view.appendChild(doc.createElement('p'));
      commit();

      const written = style(view);
      expect(written.lastIndexOf('--angular-lynx-color: blue')).toBeGreaterThan(
        written.indexOf('--angular-lynx-color: red'),
      );
    });

    it('leaves a <text> that never had a text style as it is when one goes', () => {
      const text = doc.createElement('text');
      page.appendChild(text);
      const bold = doc.createElement('b');
      text.appendChild(bold);
      commit();

      text.removeStyle('color');
      commit();
      expect(style(text)).toBe('');
      expect(style(bold)).not.toContain(COLOR);
    });

    it('passes the inline style of an element around an HTML text tag down', () => {
      // `<div style="color: red"><p>red</p></div>`, as on the web.
      const view = doc.createElement('view');
      view.setAttribute('style', 'color: red');
      page.appendChild(view);
      const p = doc.createElement('p');
      view.appendChild(p);
      const span = doc.createElement('span');
      span.setAttribute('style', 'font-size: 20px');
      p.appendChild(span);
      const bold = doc.createElement('b');
      span.appendChild(bold);
      commit();

      expect(style(view)).toContain('--angular-lynx-color: red');
      expect(style(p)).toContain(COLOR);
      expect(style(span)).toContain('--angular-lynx-font-size: 20px');
      // Its own inline value wins: it reads no variable for it.
      expect(style(span)).not.toContain(FONT_SIZE);
      expect(style(bold)).toContain(FONT_SIZE);
    });

    it('keeps a value that reads its own variable out of the copy', () => {
      // As the build makes no copy of `font-size:
      // calc(var(--angular-lynx-font-size) * 2)`: a variable that refers to
      // itself is invalid.
      const view = doc.createElement('view');
      view.setAttribute(
        'style',
        'font-size: calc(var(--angular-lynx-font-size) * 2)',
      );
      page.appendChild(view);
      view.appendChild(doc.createElement('p'));
      commit();

      expect(style(view)).not.toContain('--angular-lynx-font-size:');
    });

    it('leaves the inline style of an element with no HTML text inside as it is', () => {
      const text = doc.createElement('text');
      text.setAttribute('style', 'font-size: 18px');
      page.appendChild(text);
      text.appendChild(doc.createText('18px'));
      commit();

      expect(style(text)).toBe('font-size: 18px');
    });

    // Issue #652: the style index kept only the last part of a selector, so
    // `.card .total` counted for a <text class="total"> outside .card too,
    // and the tag there took its ancestors' size.
    describe('with a rule that requires an ancestor', () => {
      beforeEach(() => {
        // As the build plugin writes it, for `page { font-size: 16px }`,
        // `.card .total`, `.row > .price` and `.pressed:active`, each
        // setting `font-size`.
        (
          globalThis as { __angularLynxStyleIndex?: unknown }
        ).__angularLynxStyleIndex = {
          rules: [
            [['<page>'], bit('font-size')],
            [['total'], bit('font-size'), [[' ', ['card']]]],
            [['price'], bit('font-size'), [['>', ['row']]]],
            [['pressed'], bit('font-size'), [], 1],
          ],
        };
        resetStyleIndex();
      });

      /**
       * A `<text>` with these classes, holding a `<b>`, in `parent`.
       */
      const total = (
        parent: LynxElement,
        classes: string,
      ): { text: LynxElement; bold: LynxElement } => {
        const text = doc.createElement('text');
        text.setAttribute('class', classes);
        parent.appendChild(text);
        text.appendChild(doc.createText('Total: '));
        const bold = doc.createElement('b');
        text.appendChild(bold);
        bold.appendChild(doc.createText('12'));
        return { text, bold };
      };

      it('leaves the tag at the default outside the ancestor', () => {
        const { bold } = total(page, 'total');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);
      });

      it('gives it the <text>’s size inside the ancestor', () => {
        const card = doc.createElement('view');
        card.setAttribute('class', 'card');
        page.appendChild(card);
        const row = doc.createElement('view');
        card.appendChild(row);
        const { bold } = total(row, 'total');
        commit();
        expect(style(bold)).toContain(FONT_SIZE);
      });

      it('requires a child’s parent to be the next one up', () => {
        const row = doc.createElement('view');
        row.setAttribute('class', 'row');
        page.appendChild(row);
        const inRow = total(row, 'price');
        const cell = doc.createElement('view');
        row.appendChild(cell);
        const inCell = total(cell, 'price');
        commit();
        expect(style(inRow.bold)).toContain(FONT_SIZE);
        expect(style(inCell.bold)).not.toContain(FONT_SIZE);
      });

      it('leaves it at the default for a rule only a state applies', () => {
        const { bold } = total(page, 'pressed');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);
      });

      it('inherits again when an ancestor’s classes change', () => {
        const outer = doc.createElement('view');
        page.appendChild(outer);
        const inner = doc.createElement('view');
        outer.appendChild(inner);
        const { bold } = total(inner, 'total');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);

        outer.setAttribute('class', 'card');
        commit();
        expect(style(bold)).toContain(FONT_SIZE);

        outer.removeClass('card');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);

        outer.addClass('card');
        commit();
        expect(style(bold)).toContain(FONT_SIZE);
      });

      it('inherits again below an HTML <p> when an ancestor’s classes change', () => {
        // <p> is a <text> too, but its tags aren't a Lynx <text>'s: the
        // walk goes on through it to the <text class="total"> inside.
        const outer = doc.createElement('view');
        page.appendChild(outer);
        const p = doc.createElement('p');
        outer.appendChild(p);
        const { bold } = total(p, 'total');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);

        outer.setAttribute('class', 'card');
        commit();
        expect(style(bold)).toContain(FONT_SIZE);
      });

      it('inherits again below an HTML <p> that moves', () => {
        const card = doc.createElement('view');
        card.setAttribute('class', 'card');
        page.appendChild(card);
        const p = doc.createElement('p');
        page.appendChild(p);
        const { bold } = total(p, 'total');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);

        card.appendChild(p);
        commit();
        expect(style(bold)).toContain(FONT_SIZE);
      });

      it('inherits again in a list’s items when an ancestor’s classes change', () => {
        const outer = doc.createElement('view');
        page.appendChild(outer);
        const list = doc.createElement('list');
        outer.appendChild(list);
        const item = doc.createElement('list-item');
        list.appendChild(item);
        const { bold } = total(item, 'total');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);

        outer.setAttribute('class', 'card');
        commit();
        expect(style(bold)).toContain(FONT_SIZE);
      });

      it('matches an ancestor whose classes only native knows', () => {
        // As LynxHydrateDocument wraps a server render's element: its
        // classes are in the snapshot, which only native read.
        const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
        const ref = g.__CreateView();
        ref.classes.add('card');
        const card = new LynxElement(ref as never);
        card.tagName = 'view';
        page.appendChild(card);
        const { bold } = total(card, 'total');
        commit();
        expect(style(bold)).toContain(FONT_SIZE);
      });

      it('inherits again when the element around the <text> moves', () => {
        const card = doc.createElement('view');
        card.setAttribute('class', 'card');
        page.appendChild(card);
        const holder = doc.createElement('view');
        page.appendChild(holder);
        const { bold } = total(holder, 'total');
        commit();
        expect(style(bold)).not.toContain(FONT_SIZE);

        card.appendChild(holder);
        commit();
        expect(style(bold)).toContain(FONT_SIZE);
      });
    });
  });

  // Issue #667: an HTML text tag's own rules came from the last part of each
  // selector alone, so `.card b { font-size: 24px }` counted for a <b>
  // outside .card too. The <b> then didn't read the variable, and drew at
  // Lynx's default size, not that of the text around it.
  describe('an HTML text tag with a rule that requires an ancestor', () => {
    const bit = (property: string): number =>
      1 << INHERITED_TEXT_PROPERTIES.indexOf(property);
    const style = (el: LynxElement): string =>
      String(native(el).attrs.get('style') ?? '');
    const FONT_SIZE = 'font-size: var(--angular-lynx-font-size)';
    const COLOR = 'color: var(--angular-lynx-color)';

    beforeEach(() => {
      // As the build plugin writes it, for `.big { font-size: 20px }`,
      // `.card b { font-size: 24px }`, `.row > i { font-size: 24px }` and
      // `.pressed b:active { color: red }` and `#totals b { font-size: 24px
      // }`. A <b> is a <text>, so the build
      // writes `b` as the class the renderer gives it (see tagClassOf).
      (
        globalThis as { __angularLynxStyleIndex?: unknown }
      ).__angularLynxStyleIndex = {
        rules: [
          [['big'], bit('font-size')],
          [['_ngtag-b'], bit('font-size'), [[' ', ['card']]]],
          [['_ngtag-i'], bit('font-size'), [['>', ['row']]]],
          [['_ngtag-b'], bit('color'), [[' ', ['pressed']]], 1],
          [['_ngtag-b'], bit('font-size'), [[' ', ['#totals']]]],
          // `.line > u { color: red }`, with the selector the build adds for
          // a <u> in an anonymous <text> (issue #692).
          [['_ngtag-u'], bit('color'), [['>', ['line']]]],
          [
            ['_ngtag-u'],
            bit('color'),
            [
              ['>', ['_ngtext']],
              ['>', ['line']],
            ],
          ],
        ],
      };
      resetStyleIndex();
    });

    afterEach(() => {
      delete (globalThis as { __angularLynxStyleIndex?: unknown })
        .__angularLynxStyleIndex;
      resetStyleIndex();
    });

    /**
     * A `<b>` (or another tag) holding "12" after "Total: " in `parent`,
     * with its tag's class, as the renderer creates it.
     */
    const bold = (parent: LynxElement, tag = 'b'): LynxElement => {
      parent.appendChild(doc.createText('Total: '));
      const el = doc.createElement(tag);
      el.addScopeClass(`_ngtag-${tag}`);
      parent.appendChild(el);
      el.appendChild(doc.createText('12'));
      return el;
    };

    it('inherits outside the ancestor the rule requires', () => {
      const view = doc.createElement('view');
      view.setAttribute('class', 'big');
      page.appendChild(view);
      const b = bold(view);
      commit();
      expect(style(b)).toContain(FONT_SIZE);
    });

    it('keeps the rule’s size inside the ancestor', () => {
      const card = doc.createElement('view');
      card.setAttribute('class', 'card big');
      page.appendChild(card);
      const view = doc.createElement('view');
      card.appendChild(view);
      const b = bold(view);
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);
      expect(style(b)).toContain(COLOR);
    });

    it('requires a child’s parent to be the next one up', () => {
      const row = doc.createElement('view');
      row.setAttribute('class', 'row');
      page.appendChild(row);
      const p = doc.createElement('p');
      row.appendChild(p);
      const inP = bold(p, 'i');
      commit();
      expect(style(inP)).toContain(FONT_SIZE);
    });

    it('counts a rule that applies only in a state as its own', () => {
      // The runtime can't see the state, and an inherited color would win
      // over the rule's while it applies.
      const view = doc.createElement('view');
      view.setAttribute('class', 'pressed');
      page.appendChild(view);
      const b = bold(view);
      commit();
      expect(style(b)).not.toContain(COLOR);
      expect(style(b)).toContain(FONT_SIZE);
    });

    // Issue #692: the build matches `.line > u` through the anonymous
    // <text> a <u> beside loose text is in, and the runtime finds it there.
    describe('a child combinator', () => {
      it('counts the rule for a tag in the anonymous <text>', () => {
        const line = doc.createElement('view');
        line.setAttribute('class', 'line');
        page.appendChild(line);
        const u = bold(line, 'u');
        commit();
        expect(native(u).parent?.classes.has(ANONYMOUS_TEXT_CLASS)).toBe(true);
        expect(style(u)).not.toContain(COLOR);
      });

      it('counts the rule for a lone tag in a row, with no anonymous <text>', () => {
        const line = doc.createElement('view');
        line.setAttribute('class', 'line');
        line.setStyle('display', 'flex');
        page.appendChild(line);
        const u = doc.createElement('u');
        u.addScopeClass('_ngtag-u');
        line.appendChild(u);
        u.appendChild(doc.createText('12'));
        commit();
        expect(native(u).parent).toBe(native(line));
        expect(style(u)).not.toContain(COLOR);
      });

      it('inherits under an element the rule doesn’t require', () => {
        const view = doc.createElement('view');
        page.appendChild(view);
        const u = bold(view, 'u');
        commit();
        expect(style(u)).toContain(COLOR);
      });

      it('inherits in an anonymous <text> below the element the rule requires', () => {
        // `<div class="line"><div>Total: <u>12</u></div></div>`: the <u>'s
        // parent on the web is the inner <div>.
        const line = doc.createElement('view');
        line.setAttribute('class', 'line');
        page.appendChild(line);
        const view = doc.createElement('view');
        line.appendChild(view);
        const u = bold(view, 'u');
        commit();
        expect(style(u)).toContain(COLOR);
      });
    });

    it('inherits again when an ancestor’s classes change', () => {
      const outer = doc.createElement('view');
      page.appendChild(outer);
      const view = doc.createElement('view');
      view.setAttribute('class', 'big');
      outer.appendChild(view);
      const b = bold(view);
      commit();
      expect(style(b)).toContain(FONT_SIZE);

      outer.setAttribute('class', 'card');
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);

      outer.removeClass('card');
      commit();
      expect(style(b)).toContain(FONT_SIZE);

      outer.addClass('card');
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);
    });

    it('inherits again when an ancestor’s id changes', () => {
      const outer = doc.createElement('view');
      page.appendChild(outer);
      const b = bold(outer);
      commit();
      expect(style(b)).toContain(FONT_SIZE);

      outer.setAttribute('id', 'totals');
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);

      outer.setAttribute('id', null);
      commit();
      expect(style(b)).toContain(FONT_SIZE);
    });

    it('inherits again when an ancestor whose classes only native knows changes them', () => {
      // As LynxHydrateDocument wraps a server render's element: its
      // classes are in the snapshot, so which changed isn't known.
      const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
      const ref = g.__CreateView();
      ref.classes.add('card');
      const card = new LynxElement(ref as never);
      card.tagName = 'view';
      page.appendChild(card);
      const b = bold(card);
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);

      card.setAttribute('class', 'other');
      commit();
      expect(style(b)).toContain(FONT_SIZE);
    });

    it('inherits again inside an HTML tag when an ancestor’s classes change', () => {
      const outer = doc.createElement('view');
      page.appendChild(outer);
      const p = doc.createElement('p');
      outer.appendChild(p);
      const span = doc.createElement('span');
      p.appendChild(span);
      const b = bold(span);
      commit();
      expect(style(b)).toContain(FONT_SIZE);

      outer.setAttribute('class', 'card');
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);
    });

    it('inherits again when it moves under the ancestor', () => {
      const card = doc.createElement('view');
      card.setAttribute('class', 'card');
      page.appendChild(card);
      const view = doc.createElement('view');
      page.appendChild(view);
      const b = bold(view);
      commit();
      expect(style(b)).toContain(FONT_SIZE);

      card.appendChild(view);
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);
    });

    it('inherits again in a list’s items when an ancestor’s classes change', () => {
      const outer = doc.createElement('view');
      page.appendChild(outer);
      const list = doc.createElement('list');
      outer.appendChild(list);
      const item = doc.createElement('list-item');
      list.appendChild(item);
      const b = bold(item);
      commit();
      expect(style(b)).toContain(FONT_SIZE);

      outer.setAttribute('class', 'card');
      commit();
      expect(style(b)).not.toContain(FONT_SIZE);
    });
  });

  it('gives a touch on an anonymous <text> out of the tree no element', () => {
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const wrapperRef = g.__CreateText();
    new LynxElement(wrapperRef as never).markAnonymousText();

    expect(LynxElement.byUniqueId(wrapperRef.id)).toBeUndefined();
  });
});

// A <q>'s quotation marks are raw-texts of its own, at the start and end of
// its native children, which Angular never sees (see LynxElement.markQuote).
describe('<q>, element by element', () => {
  let doc: LynxDocument;
  let page: LynxElement;

  const native = (el: LynxElement): FakeEl => el.element as unknown as FakeEl;

  const commit = (): void => {
    processPendingRemovals();
    processPendingFlow();
    processPendingTextNormalization();
    (globalThis as unknown as FakeNativeGlobal<FakeEl>).__FlushElementTree();
  };

  /**
   * What `el` draws: its raw-text leaves' text, in order.
   */
  const drawn = (el: LynxElement): string[] =>
    rawTextLeaves(native(el)).map(leafText);

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
    resetStyleIndex();
    doc = new LynxDocument();
    page = doc.createRootElement();
  });

  it('puts its children between its marks, and hides the marks', () => {
    const p = doc.createElement('p');
    page.appendChild(p);
    const q = doc.createElement('q');
    p.appendChild(q);
    const hello = doc.createText('hello');
    const bold = doc.createElement('b');
    q.appendChild(hello);
    q.appendChild(bold);
    bold.appendChild(doc.createText('!'));
    commit();

    expect(drawn(q)).toEqual(['“', 'hello', '!', '”']);
    // Angular's last child has nothing after it, and its first is first.
    expect(bold.nextSibling()).toBeNull();
    expect(hello.nextSibling()).toBe(bold);

    // An insert before the first child goes after the opening mark.
    const first = doc.createText('so ');
    q.insertBefore(first, hello);
    commit();
    expect(drawn(q)).toEqual(['“', 'so ', 'hello', '!', '”']);
  });

  it('draws single marks inside another <q>, however deep', () => {
    // Built out of the tree, then put in it, as a component's view is.
    const outer = doc.createElement('q');
    const span = doc.createElement('span');
    outer.appendChild(span);
    const inner = doc.createElement('q');
    span.appendChild(inner);
    const innermost = doc.createElement('q');
    inner.appendChild(innermost);
    innermost.appendChild(doc.createText('x'));
    page.appendChild(outer);
    commit();

    expect(drawn(outer)).toEqual(['“', '‘', '‘', 'x', '’', '’', '”']);

    // Moved out of the others, it's outermost again, with what's inside it.
    page.appendChild(inner);
    commit();
    expect(drawn(inner)).toEqual(['“', '‘', 'x', '’', '”']);
  });

  it('draws single marks in a <q> put in an element before that goes in another <q>', () => {
    const outer = doc.createElement('q');
    page.appendChild(outer);
    // The inner <q> goes into its <span> first, then the <span> into the
    // outer <q>, as an element built apart is put in the tree whole.
    const span = doc.createElement('span');
    const inner = doc.createElement('q');
    span.appendChild(inner);
    inner.appendChild(doc.createText('x'));
    expect(drawn(inner)).toEqual(['“', 'x', '”']);
    outer.appendChild(span);
    commit();

    expect(drawn(outer)).toEqual(['“', '‘', 'x', '’', '”']);

    // And outermost again when the <span> moves out.
    page.appendChild(span);
    commit();
    expect(drawn(inner)).toEqual(['“', 'x', '”']);
  });

  it('keeps the spaces inside it, which sit beside a mark', () => {
    const p = doc.createElement('p');
    page.appendChild(p);
    const q = doc.createElement('q');
    p.appendChild(q);
    q.appendChild(doc.createText(' hi '));
    commit();

    expect(drawn(p)).toEqual(['“', ' hi ', '”']);
  });

  it('gives a touch on a mark to the <q>', () => {
    const q = doc.createElement('q');
    page.appendChild(q);
    commit();
    const [open, close] = native(q).children;

    expect(LynxElement.byUniqueId(open!.id)).toBe(q);
    expect(LynxElement.byUniqueId(close!.id)).toBe(q);
    expect(LynxElement.isQuoteMark(open as never)).toBe(true);
    expect(LynxElement.isQuoteMark(native(q) as never)).toBe(false);
  });

  it('draws its marks again when it comes back', () => {
    const q = doc.createElement('q');
    page.appendChild(q);
    q.appendChild(doc.createText('back'));
    commit();
    q.remove();
    commit();
    expect(native(q).hasPaintingNode).toBe(false);

    page.appendChild(q);
    commit();

    expect(native(q).hasPaintingNode).toBe(true);
    expect(drawn(q)).toEqual(['“', 'back', '”']);
    expect(LynxElement.byUniqueId(native(q).children[0]!.id)).toBe(q);
  });

  it('lets go of its marks when it is released', () => {
    const q = doc.createElement('q');
    page.appendChild(q);
    commit();
    const [open, close] = native(q).children;

    q.remove();
    q.markDestroyed();
    commit();

    expect(LynxElement.byUniqueId(open!.id)).toBeUndefined();
    expect(LynxElement.byUniqueId(close!.id)).toBeUndefined();
  });

  it("takes a server render's marks, nested as they were", () => {
    // A snapshot's tree (see LynxHydrateDocument): the <q> holds its marks.
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const qRef = g.__CreateText();
    const openRef = g.__CreateRawText('');
    const textRef = g.__CreateRawText('hi');
    const closeRef = g.__CreateRawText('');
    g.__SetAttribute(openRef, 'text', '“');
    g.__SetAttribute(closeRef, 'text', '”');
    g.__AppendElement(native(page), qRef);
    g.__AppendElement(qRef, openRef);
    g.__AppendElement(qRef, textRef);
    g.__AppendElement(qRef, closeRef);
    const q = new LynxElement(qRef as never);
    q.tagName = 'text';
    q.markQuote([openRef as never, closeRef as never]);
    // A <q> inside it, which hydrates after it.
    const innerRef = g.__CreateText();
    const innerOpenRef = g.__CreateRawText('');
    const innerCloseRef = g.__CreateRawText('');
    g.__AppendElement(qRef, innerRef);
    g.__AppendElement(innerRef, innerOpenRef);
    g.__AppendElement(innerRef, innerCloseRef);
    const inner = new LynxElement(innerRef as never);
    inner.tagName = 'text';
    inner.markQuote([innerOpenRef as never, innerCloseRef as never]);

    expect(qRef.children[0]).toBe(openRef);
    expect(LynxElement.isQuoteMark(openRef as never)).toBe(true);
    expect(LynxElement.byUniqueId(closeRef.id)).toBe(q);
    expect(leafText(openRef)).toBe('“');
    expect(leafText(innerOpenRef)).toBe('‘');
    expect(leafText(innerCloseRef)).toBe('’');
  });
});
