// @vitest-environment jsdom
//
// A detectChanges() called during a tick, through the real renderer
// (LynxRendererFactory2, LynxDocument, LynxElement) against a fake native
// tree: Angular runs it as a begin()/end() pair inside the tick's, and the
// tick's end() commits and flushes what both changed, once.
import '@angular/compiler';
import {
  type AfterViewInit,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
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
import {
  isInsideChangeDetection,
  markFirstRenderComplete,
} from '../lynx-render-lifecycle';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

type FakeEl = { id: number; parent: FakeEl | null; children: FakeEl[] };

/**
 * What native was asked, in order: each element made, and each flush.
 */
const calls: string[] = [];

const installNativeFakes = (): void => {
  let nextId = 1;
  calls.length = 0;
  const make = (): FakeEl => {
    calls.push('create');
    return { id: nextId++, parent: null, children: [] };
  };
  const g = globalThis as any;
  const page = make();
  g.__CreatePage = () => page;
  g.__CreateView = make;
  g.__CreateText = make;
  g.__CreateRawText = make;
  g.__CreateElement = make;
  g.__GetElementUniqueID = (n: FakeEl) => n.id;
  const insert = (parent: FakeEl, child: FakeEl, index: number) => {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    parent.children.splice(index, 0, child);
    child.parent = parent;
  };
  g.__AppendElement = (p: FakeEl, c: FakeEl) => insert(p, c, p.children.length);
  g.__InsertElementBefore = (p: FakeEl, c: FakeEl, ref: FakeEl) =>
    insert(p, c, p.children.indexOf(ref));
  g.__RemoveElement = (p: FakeEl, c: FakeEl) => {
    p.children.splice(p.children.indexOf(c), 1);
    c.parent = null;
  };
  g.__GetParent = (n: FakeEl) => n.parent;
  g.__GetChildren = (n: FakeEl) => n.children.slice();
  g.__FirstElement = (n: FakeEl) => n.children[0] ?? null;
  g.__NextElement = (n: FakeEl) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null;
  for (const name of [
    '__SetClasses',
    '__AddClass',
    '__SetAttribute',
    '__SetID',
    '__SetDataset',
    '__AddInlineStyle',
    '__SetInlineStyles',
    '__InvokeUIMethod',
    '__AddEvent',
  ]) {
    g[name] = () => {};
  }
  g.__FlushElementTree = vi.fn(() => {
    // Whether change detection was still running when native was asked to
    // commit: an inner cycle's flush would be.
    calls.push(isInsideChangeDetection() ? 'flush inside' : 'flush');
  });
};

/**
 * Shows more in `ngAfterViewInit()` and checks itself at once, as Angular
 * apps do to avoid ExpressionChangedAfterItHasBeenChecked.
 */
@Component({
  selector: 'nested-check',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view>
      @if (more()) {
        <view><text>More</text></view>
      }
    </view>
  `,
})
class NestedCheck implements AfterViewInit {
  readonly more = signal(false);
  readonly #changeDetector = inject(ChangeDetectorRef);

  ngAfterViewInit(): void {
    this.more.set(true);
    this.#changeDetector.detectChanges();
  }
}

/**
 * Lets the settle flushes queued during the tick run.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('a detectChanges() during a tick', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
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

  it('commits with the tick, in one flush at its end', async () => {
    const fixture = TestBed.createComponent(NestedCheck);
    await settle();
    calls.length = 0;

    fixture.detectChanges();
    await settle();

    // The `@if` content the inner check made, then one flush, once change
    // detection is over: none in the middle of the tick, and no settle flush
    // after it for what the tick did once the inner check had ended.
    expect(calls.filter((call) => call !== 'create')).toEqual(['flush']);
    expect(calls.at(-1)).toBe('flush');
    expect(calls).toContain('create');
    expect(isInsideChangeDetection()).toBe(false);
  });
});
