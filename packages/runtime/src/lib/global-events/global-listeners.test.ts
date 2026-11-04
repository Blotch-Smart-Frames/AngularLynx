// @vitest-environment jsdom
//
// Angular's `document:`, `window:` and `body:` host listeners on Lynx
// elements, through the real renderer (LynxRendererFactory2, LynxDocument,
// LynxElement), against a fake native tree that sends events the way Lynx
// does: a touch runs the page's global-bind handlers first, then each
// element's bind handlers from the touched one up to the page, stopping at a
// catch handler (TouchEventHandler::HandleEventInternal).
import '@angular/compiler';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  provideZonelessChangeDetection,
  RendererFactory2,
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
import { LynxElement } from '../lynx-element';
import { LynxDocument } from '../lynx-document';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import { LynxRendererFactory2 } from '../renderer/lynx-renderer-factory2';
import { LYNX_DOCUMENT } from '../renderer/token';
import { globalEvents, installGlobalWindow } from './index';

type FakeEl = { id: number; parent: FakeEl | null; children: FakeEl[] };

let nextId = 1;
/** Each element's handlers, by `<id>|<type>|<name>`. */
const handlers = new Map<string, (event: object) => unknown>();

const installNativeFakes = () => {
  nextId = 1;
  handlers.clear();
  const make = (): FakeEl => ({ id: nextId++, parent: null, children: [] });
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
    '__FlushElementTree',
    '__InvokeUIMethod',
  ]) {
    g[name] = () => {};
  }
  g.__AddEvent = (
    el: FakeEl,
    type: string,
    name: string,
    handler?: { value: (event: object) => unknown },
  ) => {
    const key = `${el.id}|${type}|${name}`;
    if (handler) handlers.set(key, handler.value);
    else handlers.delete(key);
  };
  return page;
};

let page: FakeEl;

/**
 * Lynx sends `name` to the element `el`: the global handlers first, then the
 * bubbling ones from `el` up, until a catch handler.
 */
const send = (el: FakeEl, name: string, event: Record<string, unknown>) => {
  const lynxEvent = { type: name, target: { uid: el.id }, ...event };
  for (const [key, handler] of handlers) {
    if (key.endsWith(`|global-bindEvent|${name}`)) handler({ ...lynxEvent });
  }
  for (let node: FakeEl | null = el; node; node = node.parent) {
    const caught = handlers.get(`${node.id}|catchEvent|${name}`);
    if (caught) {
      caught({ ...lynxEvent });
      return;
    }
    handlers.get(`${node.id}|bindEvent|${name}`)?.({ ...lynxEvent });
  }
};

/**
 * The template's two views, in the fake tree: the host is the page (the
 * root component's host is the root element), and its first child the card.
 * Signal queries need the compiler's transform, which JIT tests don't have.
 */
const card = () => page.children[0];
const caught = () => card().children[0];

@Component({
  selector: 'global-listener-host',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view (click)="log.push('card')">
      <view (catchtap)="log.push('caught')"></view>
    </view>
  `,
  host: {
    '(click)': 'log.push("host")',
    '(body:click)': 'log.push("body")',
    '(document:click)': 'log.push("document")',
    '(window:click)': 'log.push("window")',
    '(document:pointermove)': 'moved.push($event)',
    '(window:resize)': 'log.push("resize")',
  },
})
class GlobalListenerHost {
  readonly log: string[] = [];
  readonly moved: any[] = [];
}

describe('document:, window: and body: listeners', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
    // As the polyfills do on the main thread.
    installGlobalWindow(globalThis, globalEvents());
  });

  beforeEach(() => {
    vi.useFakeTimers();
    page = installNativeFakes();
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
    vi.useRealTimers();
  });

  const render = () => {
    const fixture = TestBed.createComponent(GlobalListenerHost);
    fixture.detectChanges();
    return fixture;
  };

  it('are added without throwing, to the document every element is in', () => {
    render();
    const document = globalEvents().document;

    expect(LynxElement.byUniqueId(card().id)!.ownerDocument).toBe(document);
    expect(document.defaultView).toBe(globalThis);
  });

  it('hear a tap anywhere, after the elements it went through and the body', () => {
    const fixture = render();
    const { log } = fixture.componentInstance;

    send(card(), 'tap', { detail: { x: 1, y: 2 } });

    expect(log).toEqual(['card', 'host', 'body', 'document', 'window']);
  });

  it('hear a tap an element caught, which the body never sees', () => {
    const fixture = render();
    const { log } = fixture.componentInstance;

    send(caught(), 'tap', {});
    expect(log).toEqual(['caught']);
    vi.runAllTimers();

    expect(log).toEqual(['caught', 'document', 'window']);
  });

  it('hear a touch anywhere as pointer events, targeted at the element touched', () => {
    const fixture = render();
    const { moved } = fixture.componentInstance;
    const touch = { identifier: 1, x: 5, y: 6, pageX: 15, pageY: 16 };

    send(card(), 'touchstart', { changedTouches: [touch] });
    send(card(), 'touchmove', {
      changedTouches: [{ ...touch, pageX: 25 }],
    });

    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      type: 'pointermove',
      clientX: 25,
      offsetX: 5,
      target: LynxElement.byUniqueId(card().id),
    });
  });

  it("hear the window's resize", () => {
    const fixture = render();
    const { log } = fixture.componentInstance;

    send(page, 'resize', { detail: ['onWindowResize', [402, 874]] });

    expect(log).toEqual(['resize']);
    expect(globalEvents().viewport).toEqual({ width: 402, height: 874 });
  });

  it('stop listening when the component is destroyed', () => {
    const fixture = render();
    const tapKey = `${page.id}|global-bindEvent|tap`;
    expect(handlers.has(tapKey)).toBe(true);

    fixture.destroy();

    expect(handlers.has(tapKey)).toBe(false);
    expect(handlers.has(`${page.id}|global-bindEvent|touchmove`)).toBe(false);
    expect(globalEvents().hasListeners('resize')).toBe(false);
  });
});
