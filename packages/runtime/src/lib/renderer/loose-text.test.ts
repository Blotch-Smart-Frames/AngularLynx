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
import { resetStyleIndex } from '../lynx-element/text-flow';
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

  it('gives a touch on an anonymous <text> out of the tree no element', () => {
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const wrapperRef = g.__CreateText();
    new LynxElement(wrapperRef as never).markAnonymousText();

    expect(LynxElement.byUniqueId(wrapperRef.id)).toBeUndefined();
  });
});
