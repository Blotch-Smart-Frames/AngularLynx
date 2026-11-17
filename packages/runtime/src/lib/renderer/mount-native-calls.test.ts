// @vitest-environment jsdom
//
// The native reads a screen of many elements costs (#444). Each `__*` call is a
// call out of JavaScript, and building a screen used to read the native tree
// several times per element: the cycle check before each insert, the check
// for a move Lynx would lose, and Angular asking for the parent of an `@for`'s
// anchor for every row. The wrappers now answer those themselves for elements
// LynxDocument just made, so the reads stay the same however many rows there
// are: each new element reads its unique id once, when it's made, and nothing
// else. Drives the real renderer, as an app does, against a fake native tree.
import '@angular/compiler';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  provideZonelessChangeDetection,
  RendererFactory2,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxDocument } from '../lynx-document';
import { setPageElementRef } from '../lynx-document/page-ref';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
};

let nextId = 1;
let pageRoot: FakeEl;
/** How many times each `__*` function was called. */
const calls = new Map<string, number>();

const makeEl = (tag: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
});

const detach = (child: FakeEl): void => {
  const p = child.parent;
  if (!p) return;
  p.children.splice(p.children.indexOf(child), 1);
  child.parent = null;
};

const installNativeFakes = (): void => {
  nextId = 1;
  pageRoot = makeEl('page');
  const fakes: Record<string, (...args: never[]) => unknown> = {
    __CreatePage: () => pageRoot,
    __CreateView: () => makeEl('view'),
    __CreateText: () => makeEl('text'),
    __CreateScrollView: () => makeEl('scroll-view'),
    __CreateImage: () => makeEl('image'),
    __CreateRawText: () => makeEl('raw-text'),
    __CreateElement: (tag: string) => makeEl(tag),
    __GetElementUniqueID: (n: FakeEl) => n.id,
    __GetTag: (n: FakeEl) => n.tag,
    __AppendElement: (parent: FakeEl, child: FakeEl) => {
      detach(child);
      parent.children.push(child);
      child.parent = parent;
      return child;
    },
    __InsertElementBefore: (parent: FakeEl, child: FakeEl, ref: FakeEl) => {
      detach(child);
      const i = parent.children.indexOf(ref);
      parent.children.splice(i < 0 ? parent.children.length : i, 0, child);
      child.parent = parent;
      return child;
    },
    __RemoveElement: (_parent: FakeEl, child: FakeEl) => {
      detach(child);
      return child;
    },
    __GetParent: (n: FakeEl) => n.parent,
    __GetChildren: (n: FakeEl) => n.children.slice(),
    __FirstElement: (n: FakeEl) => n.children[0] ?? null,
    __LastElement: (n: FakeEl) => n.children.at(-1) ?? null,
    __NextElement: (n: FakeEl) =>
      n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    __AddClass: () => {},
    __SetClasses: () => {},
    __GetClasses: () => [],
    __SetAttribute: () => {},
    __GetAttributeByName: () => undefined,
    __SetID: () => {},
    __SetDataset: () => {},
    __SetConfig: () => {},
    __AddInlineStyle: () => {},
    __SetInlineStyles: () => {},
    __AddEvent: () => {},
    __FlushElementTree: () => {},
    __ElementAnimate: () => {},
  };
  for (const [name, fake] of Object.entries(fakes)) {
    vi.stubGlobal(name, (...args: never[]) => {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      return fake(...args);
    });
  }
  setPageElementRef(pageRoot as never);
};

const kind = signal<'view' | 'text' | 'image'>('view');
const items = signal<number[]>([]);

/**
 * The benchmark's mount screen (benchmarks/apps/angular-lynx).
 */
@Component({
  selector: 'test-mount',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <scroll-view class="screen" scroll-orientation="vertical">
      <view class="container">
        @switch (kind()) {
          @case ('text') {
            @for (i of items(); track i) {
              <text class="text">{{ i }}</text>
            }
          }
          @case ('image') {
            @for (i of items(); track i) {
              <image class="image" mode="aspectFit" [src]="'p/' + i + '.png'" />
            }
          }
          @default {
            @for (i of items(); track i) {
              <view class="box"></view>
            }
          }
        }
      </view>
    </scroll-view>
  `,
  styles: `
    .box {
      width: 10px;
    }
    .text {
      color: red;
    }
    .image {
      width: 24px;
    }
  `,
})
class TestMount {
  readonly kind = kind;
  readonly items = items;
}

/**
 * The tree reads building the screen with `rows` rows took.
 */
const readsFor = (rows: number) => {
  installNativeFakes();
  calls.clear();
  items.set(Array.from({ length: rows }, (_, i) => i));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: LYNX_DOCUMENT, useValue: new LynxDocument() },
      LynxRendererFactory2,
      { provide: RendererFactory2, useExisting: LynxRendererFactory2 },
    ],
  });
  const fixture = TestBed.createComponent(TestMount);
  fixture.detectChanges();
  const read = (name: string) => calls.get(name) ?? 0;
  const result = {
    uniqueId: read('__GetElementUniqueID'),
    parent: read('__GetParent'),
    first: read('__FirstElement'),
    next: read('__NextElement'),
  };
  fixture.destroy();
  return result;
};

describe('building a screen of many elements', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.stubGlobal('__PROFILE__', false);
    markFirstRenderComplete();
  });

  // Each row's elements: a view; a text and its run; an image.
  it.each([
    ['view', 1],
    ['text', 2],
    ['image', 1],
  ] as const)(
    'reads nothing per %s row but its new ids',
    (rowKind, elementsPerRow) => {
      kind.set(rowKind);
      const few = readsFor(100);
      const many = readsFor(200);

      // A hundred more rows: a hundred more of each new element's one id
      // read, and not one read of the tree. It was 10 calls a view and 24 a
      // text, against React Lynx's 3.
      expect(many.uniqueId - few.uniqueId).toBe(100 * elementsPerRow);
      expect(many.parent).toBe(few.parent);
      expect(many.first).toBe(few.first);
      expect(many.next).toBe(few.next);
    },
  );
});
