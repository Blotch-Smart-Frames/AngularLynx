// @vitest-environment jsdom
//
// The class calls Angular's own styling makes reach native once per element
// per change detection (see LynxElement's #pendingClasses). Drives the REAL
// renderer against a fake native tree that keeps classes as iOS and Android
// do, so Angular's own sequence of addClass and removeClass runs against it.
import '@angular/compiler';
import {
  Component,
  computed,
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
import type { FakeNativeGlobal } from '../testing/fake-native-global';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  classes: string[];
};

let nextId = 1;
let pageRoot: FakeEl;
/**
 * The class calls native got: [call, element id, argument].
 */
let calls: unknown[][] = [];

const makeEl = (tag: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  classes: [],
});

const detach = (child: FakeEl): void => {
  const p = child.parent;
  if (!p) return;
  p.children.splice(p.children.indexOf(child), 1);
  child.parent = null;
};

const installNativeFakes = (): void => {
  nextId = 1;
  calls = [];
  pageRoot = makeEl('page');
  const g = globalThis as unknown as FakeNativeGlobal<FakeEl> &
    Record<string, unknown>;
  g.__CreatePage = () => pageRoot;
  g.__CreateView = () => makeEl('view');
  g.__CreateText = () => makeEl('text');
  g.__CreateScrollView = () => makeEl('scroll-view');
  g.__CreateImage = () => makeEl('image');
  g.__CreateRawText = () => makeEl('raw-text');
  g.__CreateElement = (tag: string) => makeEl(tag);
  g.__CreateWrapperElement = () => makeEl('wrapper');
  g.__GetElementUniqueID = (n: FakeEl) => n.id;
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
  g.__RemoveElement = (_parent: FakeEl, child: FakeEl) => {
    detach(child);
    return child;
  };
  g.__GetParent = (n: FakeEl) => n.parent;
  g.__GetChildren = (n: FakeEl) => n.children.slice();
  g.__FirstElement = (n: FakeEl) => n.children[0] ?? null;
  g.__LastElement = (n: FakeEl) => n.children[n.children.length - 1] ?? null;
  g.__NextElement = (n: FakeEl) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null;
  // iOS and Android: a name goes on the end, there or not, and a whole
  // string is split on spaces.
  g.__AddClass = (n: FakeEl, name: string) => {
    calls.push(['add', n.id, name]);
    n.classes.push(name);
  };
  g.__SetClasses = (n: FakeEl, s: string | undefined) => {
    calls.push(['set', n.id, s]);
    n.classes = (s ?? '').split(' ').filter(Boolean);
  };
  g.__GetClasses = (n: FakeEl) => {
    calls.push(['get', n.id]);
    return n.classes.slice();
  };
  g.__SetAttribute = () => {};
  g.__GetAttributeByName = () => undefined;
  g.__SetID = () => {};
  g.__SetDataset = () => {};
  g.__SetConfig = () => {};
  g.__AddInlineStyle = () => {};
  g.__SetInlineStyles = () => {};
  g.__AddEvent = () => {};
  g.__FlushElementTree = () => {};
  g.__ElementAnimate = () => {};
  setPageElementRef(pageRoot as unknown as never);
};

/**
 * The buttons' variant. A module signal rather than an input: Vitest
 * compiles these components just in time, which can't see signal inputs.
 */
const variant = signal<'primary' | 'ghost'>('primary');

/**
 * A [class] binding's value for each variant: 15 utility classes.
 */
const VARIANTS = {
  primary:
    'inline-flex items-center justify-center rounded-lg h-12 px-4 text-base font-medium bg-primary text-primary-foreground border border-primary shadow-sm gap-2 select-none',
  ghost:
    'inline-flex items-center justify-center rounded-lg h-12 px-4 text-base font-medium bg-transparent text-foreground border border-transparent shadow-none gap-2 opacity-90',
} as const;

@Component({
  selector: 'test-button',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="label" [class.muted]="variant() === 'ghost'"
    >Go</text
  >`,
  host: { '[class]': 'classes()' },
})
class TestButton {
  readonly variant = variant;
  readonly classes = computed(() => VARIANTS[variant()]);
}

@Component({
  selector: 'test-screen',
  imports: [TestButton],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="screen">
    @if (shown()) {
      @for (i of buttons; track i) {
        <test-button />
      }
    }
  </view>`,
})
class TestScreen {
  readonly buttons = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly shown = signal(false);
}

@Component({
  selector: 'test-static',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="a b" [class.a]="on()" [class.c]="on()"></view>`,
})
class TestStatic {
  readonly on = signal(true);
}

const count = (kind: string): number =>
  calls.filter((call) => call[0] === kind).length;

/**
 * The class list native has for each test-button host.
 */
const hostClasses = (): string[][] => {
  const out: string[][] = [];
  const walk = (n: FakeEl): void => {
    if (n.classes.includes('test-button') || n.tag === 'view') {
      if (n.classes.includes('inline-flex')) out.push(n.classes);
    }
    n.children.forEach(walk);
  };
  walk(pageRoot);
  return out;
};

describe('class bindings', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    variant.set('primary');
    vi.stubGlobal('__MAIN_THREAD__', true);
    vi.stubGlobal('__PROFILE__', false);
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

  it('reach native once per element when a screen of them is built', () => {
    const fixture = TestBed.createComponent(TestScreen);
    fixture.detectChanges();
    calls = [];

    // An @if's content is built during change detection.
    fixture.componentInstance.shown.set(true);
    fixture.detectChanges();

    // Each button's host gets its scope classes and its 15 bound classes,
    // its <text> its scope class, static class and bound one: one string
    // each, where it was a call for each.
    expect(count('add')).toBe(0);
    expect(count('get')).toBe(0);
    expect(count('set')).toBe(20);
    expect(hostClasses()).toHaveLength(10);
    // Angular adds a [class] binding's classes in key order.
    for (const classes of hostClasses()) {
      expect(classes.slice(-15)).toEqual(VARIANTS.primary.split(' ').sort());
    }
  });

  it('reach native once per element when a host switches variant', () => {
    const fixture = TestBed.createComponent(TestScreen);
    fixture.detectChanges();
    fixture.componentInstance.shown.set(true);
    fixture.detectChanges();
    const before = hostClasses().map((classes) => classes.slice(0, -15));
    calls = [];

    variant.set('ghost');
    fixture.detectChanges();

    // The host's classes and the label's [class.muted].
    expect(count('add')).toBe(0);
    expect(count('get')).toBe(0);
    expect(count('set')).toBe(20);
    // In the order a call for each change left them: the classes both
    // variants have stay where they were, the new ones go on the end.
    const ghost = VARIANTS.ghost.split(' ').sort();
    const kept = VARIANTS.primary
      .split(' ')
      .sort()
      .filter((c) => ghost.includes(c));
    const added = ghost.filter((c) => !kept.includes(c));
    hostClasses().forEach((classes, i) => {
      expect(classes).toEqual([...before[i]!, ...kept, ...added]);
    });
  });

  it('keep a static class a binding adds again as native had it', () => {
    const fixture = TestBed.createComponent(TestStatic);
    fixture.detectChanges();
    // The fixture's host is the page (see selectRootElement).
    const el = pageRoot.children[0]!;

    // iOS and Android keep `a` twice, as when each change was a call.
    expect(el.classes).toEqual(['a', 'b', 'a', 'c']);

    fixture.componentInstance.on.set(false);
    fixture.detectChanges();
    expect(el.classes).toEqual(['b']);

    calls = [];
    fixture.componentInstance.on.set(true);
    fixture.detectChanges();
    expect(el.classes).toEqual(['b', 'a', 'c']);
    // Native's list had each name once again, so the change waited.
    expect(calls).toEqual([['set', el.id, 'b a c']]);
  });
});
