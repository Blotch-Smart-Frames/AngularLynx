// @vitest-environment jsdom
//
// Loose text: a raw-text whose parent doesn't draw text, such as `<view>Hi</view>`
// or `<div>Hi</div>`, is drawn in an anonymous <text> (see LynxElement's
// #putInTextWrapper), which Angular never sees. Drives the REAL main-thread
// renderer against inline-text.test.ts's fake of the native tree, so Angular's
// own create, insert, move and remove sequence runs against it.
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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxDocument } from '../lynx-document';
import { setPageElementRef } from '../lynx-document/page-ref';
import {
  LynxElement,
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
  selector: 'web-div-host',
  encapsulation: ViewEncapsulation.None,
  template: `<div class="card">Hello from a div</div>`,
})
class WebDivHost {}

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
 * What `el`'s live children draw: a raw-text's text, a <text>'s text in
 * quotes (one anonymous text per run of loose text), or another element's
 * tag and class.
 */
const shape = (el: FakeEl): string[] =>
  el.children
    .filter((c) => c.hasPaintingNode && c.attrs.get('display') !== 'none')
    .map((c) => {
      if (c.tag === 'raw-text') return `raw:${leafText(c)}`;
      if (c.tag === 'text')
        return `"${rawTextLeaves(c).map(leafText).join('')}"`;
      return `${c.tag}.${[...c.classes].join('.')}`;
    });

describe('loose text', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
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
    const style = (): unknown => byClass('box').children[0]!.attrs.get('style');
    expect(style()).toBe('display: none; overflow: hidden');

    fixture.componentInstance.label.set('Ada');
    fixture.detectChanges();
    expect(style()).toBeNull();
    expect(shape(byClass('box'))).toEqual(['"Ada"']);

    // Whitespace alone is blank too; a non-breaking space is text.
    fixture.componentInstance.label.set('  ');
    fixture.detectChanges();
    expect(style()).toBe('display: none; overflow: hidden');
    fixture.componentInstance.label.set('\u00a0');
    fixture.detectChanges();
    expect(style()).toBeNull();
  });

  it('gives each run its own <text>, in order around the elements', () => {
    const fixture = TestBed.createComponent(MixedHost);
    fixture.detectChanges();
    expect(shape(byClass('row'))).toEqual(['"Hi"', 'view.dot', '"there"']);
  });

  it('leaves text in a <text> as it is', () => {
    const fixture = TestBed.createComponent(InTextHost);
    fixture.detectChanges();
    expect(shape(byClass('t'))).toEqual(['raw:Hello']);
  });

  it('draws text in a <div>, which is a <view>', () => {
    const fixture = TestBed.createComponent(WebDivHost);
    fixture.detectChanges();
    expect(shape(byClass('card'))).toEqual(['"Hello from a div"']);
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

  it('moves and removes runs with @for', async () => {
    const fixture = TestBed.createComponent(ForLooseHost);
    fixture.detectChanges();
    expect(shape(byClass('list'))).toEqual(['"a"', '"b"', '"c"']);

    fixture.componentInstance.items.set(['c', 'a', 'b']);
    fixture.detectChanges();
    await flush();
    expect(shape(byClass('list'))).toEqual(['"c"', '"a"', '"b"']);

    fixture.componentInstance.items.set(['a', 'd']);
    fixture.detectChanges();
    await flush();
    expect(shape(byClass('list'))).toEqual(['"a"', '"d"']);
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
   * Commits removals and text trims, as the end of a cycle does.
   */
  const commit = (): void => {
    processPendingRemovals();
    processPendingTextNormalization();
    (globalThis as unknown as FakeNativeGlobal<FakeEl>).__FlushElementTree();
  };

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
    doc = new LynxDocument();
    page = doc.createRootElement();
  });

  it('hides the anonymous <text> from parentNode() and nextSibling()', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const before = doc.createElement('view');
    const hello = doc.createText('Hello');
    const after = doc.createElement('view');
    view.appendChild(before);
    view.appendChild(hello);
    view.appendChild(after);

    const wrapper = native(hello).parent!;
    expect(wrapper.tag).toBe('text');
    expect(wrapper.parent).toBe(native(view));
    expect(hello.parentNode()).toBe(view);
    expect(hello.nextSibling()).toBe(after);
    expect(before.nextSibling()).toBe(hello);
  });

  it('puts an element before a raw-text, before its <text>', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    const first = doc.createElement('image');

    view.insertBefore(first, hello);

    expect(native(view).children.map((c) => c.tag)).toEqual(['image', 'text']);
  });

  it('takes a raw-text out of its <text> into a <text>, and back', () => {
    const view = doc.createElement('view');
    const text = doc.createElement('text');
    page.appendChild(view);
    page.appendChild(text);
    const hello = doc.createText('Hello');
    view.appendChild(hello);

    text.appendChild(hello);
    commit();
    expect(native(hello).parent).toBe(native(text));
    expect(native(view).children).toEqual([]);

    // Back in a view, it's drawn in a <text> again: the same wrapper,
    // rebuilt, since its native element went at the commit.
    view.appendChild(hello);
    commit();
    expect(native(view).children.map((c) => c.tag)).toEqual(['text']);
    expect(native(hello).parent).toBe(native(view).children[0]);
    expect(hello.parentNode()).toBe(view);
  });

  it('leaves a raw-text in an element that draws no text as it is', () => {
    const input = doc.createElement('input');
    page.appendChild(input);
    const hello = doc.createText('Hello');

    input.appendChild(hello);

    expect(native(hello).parent).toBe(native(input));
  });

  it('gives a touch on loose text to its element', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const hello = doc.createText('Hello');
    view.appendChild(hello);

    const wrapperId = native(hello).parent!.id;
    expect(LynxElement.byUniqueId(wrapperId)).toBe(view);
    expect(LynxElement.byUniqueId(native(view).id)).toBe(view);

    // Out of the tree, it stands for nothing.
    hello.remove();
    commit();
    expect(LynxElement.byUniqueId(wrapperId)).toBeUndefined();
  });

  it('removes and releases the <text> with a destroyed raw-text', () => {
    const view = doc.createElement('view');
    page.appendChild(view);
    const hello = doc.createText('Hello');
    view.appendChild(hello);
    const wrapperId = native(hello).parent!.id;

    hello.remove();
    hello.markDestroyed();
    commit();

    expect(native(view).children).toEqual([]);
    expect(LynxElement.byUniqueId(wrapperId)).toBeUndefined();
  });

  it('keeps a raw-text that comes back before the removal commits', () => {
    const view = doc.createElement('view');
    const other = doc.createElement('view');
    page.appendChild(view);
    page.appendChild(other);
    const hello = doc.createText('Hello');
    view.appendChild(hello);

    // An Angular move: removed, then inserted elsewhere in the same cycle.
    hello.remove();
    other.appendChild(hello);
    commit();

    expect(native(view).children).toEqual([]);
    expect(native(other).children.map((c) => c.tag)).toEqual(['text']);
    expect(rawTextLeaves(native(other)).map(leafText)).toEqual(['Hello']);
  });

  it('takes a hydrated raw-text and its <text> as one', () => {
    // A snapshot's tree: the view holds the anonymous <text>, which holds
    // the raw-text, and hydration wraps each as it comes (see
    // LynxHydrateDocument.createText).
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const viewRef = g.__CreateView();
    const wrapperRef = g.__CreateText();
    const textRef = g.__CreateRawText('Hello');
    g.__AppendElement(native(page), viewRef);
    g.__AppendElement(viewRef, wrapperRef);
    g.__AppendElement(wrapperRef, textRef);
    const view = new LynxElement(viewRef as never);
    const hello = new LynxElement(textRef as never);
    hello.tagName = 'raw-text';

    hello.hydrateTextWrapper(new LynxElement(wrapperRef as never));

    expect(hello.parentNode()).toBe(view);
    hello.remove();
    commit();
    expect(viewRef.children).toEqual([]);
  });
});
