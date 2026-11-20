// @vitest-environment jsdom
// cspell:words ɵɵdefineComponent ɵɵelementStart ɵɵelement ɵɵelementEnd
//
// The runtime's half of the build plugin's static blocks (its
// static-blocks.ts): Angular hands the renderer a block as its root's static
// attribute, and the native tree must be the one Angular would have built
// from the elements themselves. The folded component is written the way the
// plugin writes it, with Angular's instructions; the reference is the same
// template compiled by Angular.
import '@angular/compiler';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  provideZonelessChangeDetection,
  RendererFactory2,
  ViewEncapsulation,
  ɵɵdefineComponent,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalEvents } from '../global-events';
import { LynxDocument } from '../lynx-document';
import { getPageId, setPageElementRef } from '../lynx-document/page-ref';
import { LynxElement } from '../lynx-element';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import { LynxRendererFactory2 } from '../renderer/lynx-renderer-factory2';
import { LYNX_DOCUMENT } from '../renderer/token';
import { LynxHydrateDocument } from '../ssr/hydrate-document';
import type { FakeNativeGlobal } from '../testing/fake-native-global';
import { staticBlockOwner } from './owner';
import {
  STATIC_BLOCK_ATTRIBUTE,
  type StaticBlock,
  buildStaticBlock,
  staticBlockSize,
} from './static-block';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  text?: string;
  attrs: Map<string, unknown>;
  classes: string[];
  style: string;
};

let nextId = 1;
let pageRoot: FakeEl;
const byId = new Map<number, FakeEl>();

const makeEl = (tag: string, text?: string): FakeEl => {
  const el: FakeEl = {
    id: nextId++,
    tag,
    parent: null,
    children: [],
    text,
    attrs: new Map(),
    classes: [],
    style: '',
  };
  byId.set(el.id, el);
  return el;
};

const detach = (child: FakeEl): void => {
  const p = child.parent;
  if (!p) return;
  p.children.splice(p.children.indexOf(child), 1);
  child.parent = null;
};

const installNativeFakes = (): void => {
  // Ids keep counting across tests: the element registry is the process's,
  // and a test's id must not name an earlier test's element.
  byId.clear();
  pageRoot = makeEl('page');
  const g = globalThis as unknown as FakeNativeGlobal<FakeEl> & {
    __GetElementByUniqueID: (id: number) => FakeEl | undefined;
  };
  g.__CreatePage = () => pageRoot;
  g.__CreateView = () => makeEl('view');
  g.__CreateText = () => makeEl('text');
  g.__CreateScrollView = () => makeEl('scroll-view');
  g.__CreateImage = () => makeEl('image');
  g.__CreateRawText = (text: string) => makeEl('raw-text', text);
  g.__CreateElement = (tag: string) => makeEl(tag);
  g.__CreateWrapperElement = () => makeEl('wrapper');
  g.__GetElementUniqueID = (n: FakeEl) => n.id;
  g.__GetElementByUniqueID = (id: number) => byId.get(id);
  g.__GetTag = (n: FakeEl) => n.tag;
  g.__AppendElement = (parent: FakeEl, child: FakeEl) => {
    detach(child);
    parent.children.push(child);
    child.parent = parent;
    return child;
  };
  g.__InsertElementBefore = (parent: FakeEl, child: FakeEl, ref: FakeEl) => {
    detach(child);
    const i = parent.children.indexOf(ref);
    parent.children.splice(i < 0 ? parent.children.length : i, 0, child);
    child.parent = parent;
    return child;
  };
  g.__RemoveElement = (parent: FakeEl, child: FakeEl) => {
    detach(child);
    return child;
  };
  g.__GetParent = (n: FakeEl) => n.parent ?? null;
  g.__GetChildren = (n: FakeEl) => n.children.slice();
  g.__FirstElement = (n: FakeEl) => n.children[0] ?? null;
  g.__LastElement = (n: FakeEl) => n.children[n.children.length - 1] ?? null;
  g.__NextElement = (n: FakeEl) => {
    const p = n.parent;
    return p ? (p.children[p.children.indexOf(n) + 1] ?? null) : null;
  };
  g.__SetClasses = (n: FakeEl, s: string | undefined) => {
    n.classes = (s ?? '').split(/\s+/).filter(Boolean);
  };
  g.__GetClasses = (n: FakeEl) => n.classes;
  g.__AddClass = (n: FakeEl, name: string) => {
    n.classes.push(name);
  };
  g.__SetAttribute = (n: FakeEl, name: string, value: unknown) =>
    n.attrs.set(name, value);
  g.__GetAttributeByName = (n: FakeEl, name: string) => n.attrs.get(name);
  g.__SetID = (n: FakeEl, id: string) => n.attrs.set('id', id);
  g.__SetDataset = () => {};
  g.__SetConfig = () => {};
  g.__AddInlineStyle = () => {};
  g.__SetInlineStyles = (n: FakeEl, value: unknown) => {
    n.style = String(value ?? '');
  };
  g.__AddEvent = () => {};
  g.__FlushElementTree = () => {};
  g.__ElementAnimate = () => {};
  setPageElementRef(pageRoot as unknown as never);
};

/**
 * The native tree under `el` as text, with each component's scope ID (which
 * differs between two components) written as `*`.
 */
const tree = (el: FakeEl, depth = 0): string[] => [
  `${'  '.repeat(depth)}${el.tag} [${[...el.classes]
    .map((name) => name.replace(/^(_ng(?:content|host))-.*/, '$1-*'))
    .sort()
    .join(' ')}]${el.style ? ` style="${el.style}"` : ''}${[...el.attrs]
    .filter(([name]) => name !== 'ng-version')
    .map(([name, value]) => ` ${name}=${JSON.stringify(value)}`)
    .join('')}${el.text !== undefined ? ` "${el.text}"` : ''}`,
  ...el.children.flatMap((child) => tree(child, depth + 1)),
];

/**
 * What a raw-text shows: what the runtime last set, or what it was made with.
 */
const shown = (el: FakeEl): FakeEl => {
  if (el.tag === 'raw-text' && el.attrs.has('text')) {
    return { ...el, text: el.attrs.get('text') as string, attrs: new Map() };
  }
  return { ...el, children: el.children.map(shown) };
};

const BLOCK: StaticBlock = [
  [
    'view',
    'dot',
    'height: 8px; width: 2px;',
    ['accessibility-label', 'Dot'],
    [],
  ],
  ['text', 'label', '', ['flatten', 'false'], ['Hello there']],
  ['image', '', '', ['src', 'a.png', 'mode', 'aspectFit'], []],
];

@Component({
  selector: 'compiled-card',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="list"
    ><view class="card"
      ><view
        class="dot"
        style="height: 8px; width: 2px"
        accessibility-label="Dot"
      ></view
      ><text class="label" flatten="false"> Hello there </text
      ><image src="a.png" mode="aspectFit" /></view
  ></view>`,
  styles: '.card { width: 1px; }',
})
class CompiledCard {}

/**
 * CompiledCard as the build plugin folds it.
 */
class FoldedCard {
  static ɵfac = () => new FoldedCard();
  static ɵcmp = ɵɵdefineComponent({
    type: FoldedCard,
    selectors: [['folded-card']],
    decls: 6,
    vars: 0,
    consts: [
      [1, 'list'],
      [STATIC_BLOCK_ATTRIBUTE, BLOCK, 1, 'card'],
    ],
    template: (rf: number) => {
      if (rf & 1) {
        ɵɵelementStart(0, 'view', 0);
        ɵɵelement(1, 'view', 1);
        ɵɵelementEnd();
      }
    },
    styles: ['.card[_ngcontent-%COMP%] { width: 1px; }'],
    encapsulation: ViewEncapsulation.Emulated,
  });
}

@Component({
  selector: 'compiled-plain',
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="card"><text>Hi</text></view>`,
})
class CompiledPlain {}

class FoldedPlain {
  static ɵfac = () => new FoldedPlain();
  static ɵcmp = ɵɵdefineComponent({
    type: FoldedPlain,
    selectors: [['folded-plain']],
    decls: 3,
    vars: 0,
    consts: [
      [STATIC_BLOCK_ATTRIBUTE, [['text', '', '', [], ['Hi']]], 1, 'card'],
    ],
    template: (rf: number) => {
      if (rf & 1) ɵɵelement(0, 'view', 0);
    },
    encapsulation: ViewEncapsulation.None,
  });
}

describe('static blocks', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  const setUp = () => {
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
  };
  beforeEach(setUp);

  /**
   * The page a component renders, on a page of its own.
   */
  const render = (component: new () => unknown): string[] => {
    setUp();
    TestBed.createComponent(component).detectChanges();
    return tree(shown(pageRoot));
  };

  it('builds the tree Angular builds from the elements themselves', () => {
    const compiled = render(CompiledCard);
    const folded = render(FoldedCard);
    expect(folded).toEqual(compiled);
    expect(folded.join('\n')).toContain('raw-text [] "Hello there"');
  });

  it('builds it without scope classes for an unscoped component', () => {
    expect(render(FoldedPlain)).toEqual(render(CompiledPlain));
  });

  it('builds every element once, and counts them', () => {
    const root = makeEl('view');
    buildStaticBlock(root as never, BLOCK, '');
    buildStaticBlock(makeEl('view') as never, BLOCK, 's');
    expect(root.children.map((child) => child.tag)).toEqual([
      'view',
      'text',
      'image',
    ]);
    expect(root.children[1]!.children[0]!.text).toBe('Hello there');
    expect(staticBlockSize(BLOCK)).toBe(4);
  });

  it('builds the block again when its root is recreated', () => {
    const document = new LynxDocument();
    document.createRootElement();
    const parent = document.createElement('view') as LynxElement;
    document.appendChild(parent);
    const root = document.createElement('view') as LynxElement;
    document.buildStaticBlock(root, BLOCK, '_ngcontent-x');
    parent.appendChild(root);
    const before = root.element as unknown as FakeEl;
    expect(before.children).toHaveLength(3);

    // Removed in one flush and put back in a later one: Lynx has destroyed
    // its painting nodes, so the runtime makes a new native element.
    root.remove();
    LynxElement.commitPendingRemovals();
    parent.appendChild(root);
    const after = root.element as unknown as FakeEl;
    expect(after).not.toBe(before);
    expect(tree(after).slice(1)).toEqual(tree(before).slice(1));
  });

  it('takes a server render’s elements while hydrating', () => {
    const page = makeEl('page');
    const root = makeEl('view');
    const dot = makeEl('view');
    const text = makeEl('text');
    const raw = makeEl('raw-text', 'Hello there');
    const image = makeEl('image');
    const next = makeEl('view');
    const document = new LynxHydrateDocument(
      page as never,
      [root, dot, text, raw, image, next] as never,
    );
    document.createRootElement();
    // A block built after hydration names the hydrated page.
    expect(getPageId()).toBe(page.id);
    const first = document.createElement('view') as LynxElement;
    document.buildStaticBlock(first, BLOCK, '');
    expect(first.element).toBe(root);
    // Nothing built: the snapshot's elements are the block's.
    expect(root.children).toHaveLength(0);
    expect((document.createElement('view') as LynxElement).element).toBe(next);
    // Past the snapshot, a block is built.
    const later = document.createElement('view') as LynxElement;
    document.buildStaticBlock(later, BLOCK, '');
    expect((later.element as unknown as FakeEl).children).toHaveLength(3);
  });

  it('gives a touch on a static element to the nearest element with a wrapper', () => {
    const document = new LynxDocument();
    document.createRootElement();
    const root = document.createElement('view') as LynxElement;
    document.appendChild(root);
    document.buildStaticBlock(root, BLOCK, '');
    const raw = (root.element as unknown as FakeEl).children[1]!.children[0]!;
    expect(staticBlockOwner(raw.id)?.element).toBe(root.element);
    // The document's events find it the same way.
    expect((globalEvents().targetFor(raw.id) as LynxElement).element).toBe(
      root.element,
    );
    expect(staticBlockOwner(999_999)).toBeUndefined();
    // A block whose root no wrapper owns, out of the tree.
    const loose = makeEl('view');
    buildStaticBlock(loose as never, BLOCK, '');
    expect(staticBlockOwner(loose.children[0]!.id)).toBeUndefined();
    vi.stubGlobal('__GetElementByUniqueID', undefined);
    expect(staticBlockOwner(raw.id)).toBeUndefined();
  });
});
