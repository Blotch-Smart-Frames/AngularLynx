// @vitest-environment jsdom
// cspell:words reproj bkinner rawtext regs relinks tappy
//
// Integration harness that drives the REAL main-thread renderer path
// (LynxDocument + LynxElement) against an in-memory fake of the native element
// tree that models BOTH Lynx layers — the fiber tree AND the painting layer
// (see the FakeEl model note below). This lets Angular's actual view-teardown
// sequence exercise LynxElement.remove()/appendChild() so we can regression-test:
//
//   1. Destroying an @if block that contains a native <overlay> fully removes
//      that subtree from the native tree (no orphaned overlay window, no leak).
//   2. A bare <ng-content> inside an @if re-RENDERS its content on re-show: the
//      projected root's painting node died while hidden, so LynxElement rebuilds
//      it (and its nested children) from cache (the LynxTransition shape).
//   3. A component whose @if wraps its OWN element around <ng-content>
//      (`@if{ <view><ng-content/></view> }`, the tabs/accordion shape) ALSO
//      re-renders on re-show — including across repeated collapse/expand cycles.
//      This is the "empty wrapper on the 2nd expand" device bug: the consumer's
//      projected content is recycled with the removed wrapper, its painting node
//      is destroyed at flush, and re-attaching the stale ref renders nothing.
//      recreate-on-remount (LynxElement.#recreateSubtree) fixes it.
//   4. Reordering an @for list MOVES item views (Angular detach-then-reinsert)
//      without gutting them — a move must be reparented intact, never torn down
//      or recreated (see #pendingRemovals in lynx-element.ts). This is the
//      regression that broke examples/transitions.
//
// remove() queues native teardown so it can distinguish a move (remove-then-
// reinsert in the same cycle) from a destroy; genuine removals are committed by
// processPendingRemovals() from the renderer factory's end(), then
// __FlushElementTree() runs (which is where a non-move removal's painting node
// dies). detectChanges() drives that end(), so the native tree reflects removals
// right after it — every test still awaits a macrotask (flush()) for good measure
// before asserting. `findRenderedByClass()` (not `findByClass()`) is used for the
// re-show assertions: it prunes dead-painting-node subtrees, so a bug that
// re-attaches a stale ref shows up as MISSING content, matching device.
import '@angular/compiler';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Directive,
  inject,
  provideZonelessChangeDetection,
  RendererFactory2,
  signal,
  ViewContainerRef,
  ViewEncapsulation,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { processPendingRemovals } from '../lynx-element';
import { LynxDocument } from '../lynx-document';
import { setPageElementRef } from '../lynx-document/page-ref';
import { markFirstRenderComplete } from '../lynx-render-lifecycle';
import type { FakeNativeGlobal } from '../testing/fake-native-global';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

// --- Fake native element tree -------------------------------------------------
// Each node is a plain object standing in for a Lynx ElementRef. The __* PAPI
// globals below mutate these objects to mimic how the native engine maintains
// the element tree.
type FakeEl = {
  id: number;
  tag: string;
  parent: FakeEl | null;
  children: FakeEl[];
  text?: string;
  attrs: Map<string, unknown>;
  classes: Set<string>;
  styles: Map<string, unknown>;
  // Whether this node still has a live native painting node (a rendered UI
  // view). Cleared by __FlushElementTree for a node removed and not reinserted
  // in the same flush — see the two-layer model below.
  hasPaintingNode: boolean;
};

// This fake models BOTH Lynx element layers, because the accordion/collapsible
// bug lives in the split between them:
//
//  - FIBER layer: __RemoveElement is a pure DETACH — it unlinks the node from its
//    parent and clears the parent pointer, nothing more (confirmed in the core:
//    FiberElement::RemoveNodeInternal just erases from scoped_children_ and calls
//    set_parent(nullptr)). The node and its whole subtree stay valid JS objects.
//
//  - PAINTING layer: at flush, a node removed and NOT reinserted in that SAME
//    flush has is_move=false, and its native painting node (the rendered view) is
//    destroyed. There is NO API to re-create a painting node on a later re-insert,
//    so re-attaching such a node in a later flush renders EMPTY. (ElementContainer
//    ::RemoveSelf / PaintingContext::RemovePaintingNode in the core.)
//
// We model the painting layer with `hasPaintingNode` + `pendingRemovedSinceFlush`:
// __RemoveElement enqueues the node, a same-flush re-insert dequeues it (a MOVE,
// is_move=true → painting preserved), and __FlushElementTree kills the painting
// node of anything still enqueued. `findRenderedByClass()` then ignores dead
// subtrees, so a bug where a remounted element re-attaches its old (dead) ref
// shows up as missing content — exactly the on-device symptom. The fix
// (recreate-on-remount in LynxElement) swaps in a fresh ref whose painting node
// is alive, so the content renders again.
let nextId = 1;
let pageRoot: FakeEl;
// Nodes __RemoveElement'd since the last __FlushElementTree. Anything still here
// at flush time was not reinserted → its painting node dies (is_move=false).
const pendingRemovedSinceFlush = new Set<FakeEl>();
// Every __AddEvent registration, so a test can prove a rebuilt element re-binds
// its template handlers (native events don't survive a painting-node teardown).
const addEventCalls: { id: number; type: string; name: string }[] = [];

const makeEl = (tag: string, text?: string): FakeEl => ({
  id: nextId++,
  tag,
  parent: null,
  children: [],
  text,
  attrs: new Map(),
  classes: new Set(),
  styles: new Map(),
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
  addEventCalls.length = 0;

  const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;

  g.__CreatePage = () => pageRoot;
  g.__CreateView = () => makeEl('view');
  g.__CreateText = () => makeEl('text');
  g.__CreateScrollView = () => makeEl('scroll-view');
  g.__CreateImage = () => makeEl('image');
  g.__CreateRawText = (text: string) => makeEl('raw-text', text);
  g.__CreateElement = (tag: string) => makeEl(tag);
  // Real <block> creation calls __CreateWrapperElement, whose native tag is
  // "wrapper" — LynxElement.tagName is separately tracked as 'block' by
  // LynxDocument (see lynx-document.ts), which is what remove() keys off.
  g.__CreateWrapperElement = () => makeEl('wrapper');

  g.__GetElementUniqueID = (n: FakeEl) => n.id;
  g.__GetTag = (n: FakeEl) => n.tag;

  g.__AppendElement = (parent: FakeEl, child: FakeEl) => {
    detach(child);
    parent.children.push(child);
    child.parent = parent;
    // Reinserted before the next flush → this was a MOVE (is_move=true), so the
    // painting node is preserved.
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
    // Fiber layer: pure detach — `child` keeps its own children and stays a valid
    // JS object. Painting layer: enqueue it; if it is not reinserted before the
    // next __FlushElementTree, its painting node dies there (is_move=false).
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
  // Image elements are created via createImageElement, which seeds native config
  // (mode/fadeIn/loadingPlaceholder). Inert here — we only assert tree/painting.
  g.__SetConfig = () => {};
  g.__AddInlineStyle = (n: FakeEl, key: string, value: unknown) => {
    if (value == null) n.styles.delete(key);
    else n.styles.set(key, value);
  };
  g.__SetInlineStyles = (n: FakeEl, value: unknown) =>
    n.styles.set('__inline', value);
  g.__AddEvent = (el: FakeEl, type: string, name: string) => {
    addEventCalls.push({ id: el.id, type, name });
  };
  g.__FlushElementTree = () => {
    const killSubtree = (n: FakeEl): void => {
      n.hasPaintingNode = false;
      for (const c of n.children) killSubtree(c);
    };
    // Anything removed and not reinserted since the last flush was not a move —
    // destroy its painting node and its whole subtree's (native cascade).
    for (const node of pendingRemovedSinceFlush) killSubtree(node);
    pendingRemovedSinceFlush.clear();
  };
  g.__ElementAnimate = () => {};

  setPageElementRef(pageRoot as unknown as never);
};

/**
 * Every node reachable from the page root (excluding the root itself).
 */
const descendants = (): FakeEl[] => {
  const out: FakeEl[] = [];
  const walk = (n: FakeEl): void => {
    for (const c of n.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(pageRoot);
  return out;
};

const tagsUnderRoot = (): string[] => descendants().map((n) => n.tag);
const findByClass = (cls: string): FakeEl[] =>
  descendants().filter((n) => n.classes.has(cls));

/**
 * Every node reachable from the page root through a chain of LIVE painting
 * nodes — i.e. what the user would actually see. A subtree rooted at a node
 * whose painting node was destroyed (re-attached stale ref) is pruned, matching
 * the on-device "empty wrapper" symptom.
 */
const renderedDescendants = (): FakeEl[] => {
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
const findRenderedByClass = (cls: string): FakeEl[] =>
  renderedDescendants().filter((n) => n.classes.has(cls));

/**
 * Does `ancestor` sit somewhere above `node` in the tree?
 */
const isAncestorOf = (ancestor: FakeEl, node: FakeEl | null): boolean => {
  for (let cur = node?.parent ?? null; cur; cur = cur.parent) {
    if (cur === ancestor) return true;
  }
  return false;
};

/**
 * LynxElement.remove() only QUEUES a removal (so it can tell an Angular move from
 * a destroy); genuine removals are committed by processPendingRemovals() from the
 * renderer factory's end(), which detectChanges() drives. Awaiting a macrotask
 * afterwards lets any remaining scheduled work settle before we assert.
 */
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve));

// --- Test components ----------------------------------------------------------

/**
 * Mirrors ui-select → ui-bottom-sheet: a child component whose template renders a
 * native <overlay> wrapping projected <ng-content>, placed inside an @if in the
 * parent so toggling the flag destroys the whole subtree (overlay included).
 */
@Component({
  selector: 'sheet-like',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<overlay
    ><view class="backdrop"><ng-content /></view
  ></overlay>`,
})
class SheetLike {}

@Component({
  selector: 'overlay-host',
  standalone: true,
  imports: [SheetLike],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (show()) {
      <view class="wrapper">
        <sheet-like><text>projected</text></sheet-like>
      </view>
    }
  `,
})
class OverlayHost {
  readonly show = signal(true);
}

/**
 * Component-wrapped projection: an @if wrapping the component's OWN <view slot>
 * around <ng-content>. Toggling `open` destroys and re-creates the slot. The
 * consumer's projected content is detached along with the removed wrapper, then
 * re-attached (alive) to the fresh wrapper on re-show — `__RemoveElement` is a
 * pure detach, so it survives without parking (the tabs/accordion shape).
 */
// Captured on construction so the test can toggle the child's own signal without
// relying on debugElement/viewChild, neither of which resolves in this
// jsdom + Lynx-renderer TestBed setup.
let lastSlot: ReprojSlot;

@Component({
  selector: 'reproj-slot',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `@if (open()) {
    <view class="slot"><ng-content /></view>
  }`,
})
class ReprojSlot {
  readonly open = signal(true);
  constructor() {
    // Deliberately capture the instance so the test can toggle its own signal.
    // eslint-disable-next-line no-this-alias, @typescript-eslint/no-this-alias
    lastSlot = this;
  }
}

@Component({
  selector: 'reproj-host',
  standalone: true,
  imports: [ReprojSlot],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reproj-slot><text class="projected">hi</text></reproj-slot>`,
})
class ReprojHost {}

/**
 * Nested-projection scenario, mirroring LynxTransition exactly: a bare
 * `<ng-content>` directly inside an @if (no component-owned wrapper), and the
 * projected content is a `<view>` that OWNS a nested `<text>` child. Toggling
 * `open` removes the projected `<view>`; on re-show Angular re-inserts that same
 * `<view>` ROOT, which brings its inner `<text>` back with it — the child was
 * never separated from its parent, so no parking is needed to keep it alive.
 */
let lastNestedSlot: ReprojNestedSlot;

@Component({
  selector: 'reproj-nested-slot',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `@if (open()) {
    <ng-content />
  }`,
})
class ReprojNestedSlot {
  readonly open = signal(true);
  constructor() {
    // eslint-disable-next-line no-this-alias, @typescript-eslint/no-this-alias
    lastNestedSlot = this;
  }
}

@Component({
  selector: 'reproj-nested-host',
  standalone: true,
  imports: [ReprojNestedSlot],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reproj-nested-slot
    ><view class="outer"
      ><text class="inner">deep</text></view
    ></reproj-nested-slot
  >`,
})
class ReprojNestedHost {}

/**
 * The accordion scenario precisely: component-wrapped projection that starts
 * COLLAPSED (open=false), so the content is never projected into a slot until the
 * first expand — then it's toggled repeatedly. On device the FIRST expand worked
 * but the SECOND showed an empty wrapper, so this drives several full cycles and
 * asserts the projected content is re-attached after EVERY expand.
 */
let lastCycleSlot: ReprojCycleSlot;

@Component({
  selector: 'reproj-cycle-slot',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `@if (open()) {
    <view class="cyc-slot"><ng-content /></view>
  }`,
})
class ReprojCycleSlot {
  readonly open = signal(false);
  constructor() {
    // eslint-disable-next-line no-this-alias, @typescript-eslint/no-this-alias
    lastCycleSlot = this;
  }
}

@Component({
  selector: 'reproj-cycle-host',
  standalone: true,
  imports: [ReprojCycleSlot],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reproj-cycle-slot
    ><text class="cyc-content">body</text></reproj-cycle-slot
  >`,
})
class ReprojCycleHost {}

/**
 * <block> is a layout-only flattening container (backed by
 * __CreateWrapperElement) whose children have no native UI subtree of their
 * own. Destroying it removes the whole subtree in one shot — the same as every
 * other element under the no-parking model.
 */
@Component({
  selector: 'block-host',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (show()) {
      <block>
        <text class="a">one</text>
        <text class="b">two</text>
      </block>
    }
  `,
})
class BlockHost {
  readonly show = signal(true);
}

/**
 * Reorderable @for list: each item is a <view> owning a <text> child. Reordering
 * the source array makes Angular MOVE the item views (detach-then-reinsert). The
 * move must carry each item's <text> child along — the deferred remove/reinsert
 * split (see #pendingRemovals) recognizes the move and reparents it intact
 * (this is exactly what broke examples/transitions when deleting a non-last item).
 */
@Component({
  selector: 'reorder-host',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `@for (item of items(); track item.id) {
    <view class="item" [id]="item.id">
      <text class="label">{{ item.label }}</text>
    </view>
  }`,
})
class ReorderHost {
  readonly items = signal([
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
    { id: 3, label: 'three' },
  ]);
}

/**
 * Projected content carrying a template `(bindtap)` handler, inside a wrapping
 * @if. On remount the handler must be re-registered on the rebuilt native ref —
 * native events don't survive a painting-node teardown and can't be read back,
 * so #recreateSubtree replays the cached listener.
 */
@Component({
  selector: 'reproj-event-host',
  standalone: true,
  imports: [ReprojSlot],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reproj-slot
    ><view class="tappy" (bindtap)="onTap()"
      ><text class="lbl">x</text></view
    ></reproj-slot
  >`,
})
class ReprojEventHost {
  taps = 0;
  onTap(): void {
    this.taps++;
  }
}

/**
 * Projected content with a static class, a plain attribute and a per-key inline
 * style, inside a wrapping @if. On remount all three must be replayed onto the
 * fresh native ref from the recreation caches.
 */
@Component({
  selector: 'reproj-attr-host',
  standalone: true,
  imports: [ReprojSlot],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reproj-slot
    ><view class="styled" aria-label="hi" [style.color]="'rgb(1, 2, 3)'"></view
  ></reproj-slot>`,
})
class ReprojAttrHost {}

/**
 * Projected content whose ROOT is a layout-only <block> (backed by
 * __CreateWrapperElement), inside a bare-<ng-content> @if. On remount the block
 * wrapper itself must be rebuilt and its child relinked — the child has the
 * painting node, the block just needs a valid fiber node to parent it.
 */
@Component({
  selector: 'reproj-block-host',
  standalone: true,
  imports: [ReprojNestedSlot],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reproj-nested-slot
    ><block><text class="bkinner">deep</text></block></reproj-nested-slot
  >`,
})
class ReprojBlockHost {}

/**
 * Projected content whose text is an INTERPOLATION (`{{ label() }}`), inside a
 * wrapping @if. On remount the raw-text must be rebuilt via __CreateRawText with
 * the current text (proves the #text seed + setAttribute('text') sync path).
 */
@Component({
  selector: 'reproj-rawtext-host',
  standalone: true,
  imports: [ReprojSlot],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reproj-slot
    ><text class="rt">{{ label() }}</text></reproj-slot
  >`,
})
class ReprojRawTextHost {
  readonly label = signal('dynamic');
}

/**
 * Route re-entry scenario (LynxRouteReuseStrategy). The strategy DETACHES a route
 * view on navigate-away and re-INSERTS the same view on return — it never
 * re-evaluates the route's `@if`/`@for`, whose conditions are unchanged. Angular
 * re-attaches a detached view by re-inserting only its TOP-LEVEL native node
 * (applyNodes doesn't walk children of plain elements); the nested embedded
 * content rides that node's native subtree. On Lynx that subtree's painting nodes
 * were destroyed on detach, so recreate-on-remount must rebuild the WHOLE subtree
 * — including the nested `@if`/`@for` content — from cache. This component is a
 * stand-in "route page" with nested embedded views whose conditions never change.
 */
@Component({
  selector: 'route-page',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view class="page">
      <view class="card">
        @if (cond) {
          <image class="cond-img" src="x" />
        }
        @for (n of rows; track n) {
          <text class="row">{{ n }}</text>
        }
      </view>
    </view>
  `,
})
class RoutePage {
  // Never toggled — the route-reuse path re-attaches WITHOUT re-running these.
  readonly cond = true;
  readonly rows = [1, 2, 3];
}

/**
 * Captures the ViewContainerRef anchored at an <ng-container>, exactly as
 * RouterOutlet does. viewChild does not resolve in this jsdom + Lynx-renderer
 * TestBed (see the note by ReprojSlot), so a directive grabs it on construction.
 */
let lastOutletVcr: ViewContainerRef;

@Directive({ selector: '[outletAnchor]', standalone: true })
class OutletAnchor {
  constructor() {
    lastOutletVcr = inject(ViewContainerRef);
  }
}

/**
 * Stands in for the RouterOutlet's ViewContainerRef: the anchor a route view is
 * created in, then detached from and re-inserted into (the reuse-strategy path).
 */
@Component({
  selector: 'route-outlet-host',
  standalone: true,
  imports: [OutletAnchor],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<view class="outlet"><ng-container outletAnchor /></view>`,
})
class RouteOutletHost {}

describe('renderer teardown', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
    // On device the first render happens nested inside native's renderPage(), so
    // end() SKIPS __FlushElementTree() until markFirstRenderComplete() flips the
    // latch (see lynx-render-lifecycle). TestBed never calls renderPage, so we
    // flip it here — otherwise end() never flushes and the painting-layer model
    // (which kills a removed node's painting node at flush) would never fire, and
    // these remount tests would pass vacuously.
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

  it('fully removes an <overlay> subtree when its @if block is destroyed', async () => {
    const fixture = TestBed.createComponent(OverlayHost);
    fixture.detectChanges();

    // Sanity: the overlay is present while the @if is truthy.
    expect(tagsUnderRoot()).toContain('overlay');

    fixture.componentInstance.show.set(false);
    fixture.detectChanges();
    await flush();

    // The whole subtree — overlay included — must be gone from the native tree.
    // A lingering overlay is a live iOS window with no owning Angular view, and
    // the orphaned subtree leaks native element-pool slots.
    expect(tagsUnderRoot()).not.toContain('overlay');
    expect(tagsUnderRoot()).not.toContain('backdrop');
    expect(findByClass('wrapper')).toHaveLength(0);
    expect(findByClass('backdrop')).toHaveLength(0);
  });

  it("fully removes a <block>'s children when destroyed", async () => {
    const fixture = TestBed.createComponent(BlockHost);
    fixture.detectChanges();

    // Sanity: the block and its children are present while the @if is truthy.
    expect(tagsUnderRoot()).toContain('wrapper');
    expect(findByClass('a')).toHaveLength(1);
    expect(findByClass('b')).toHaveLength(1);

    fixture.componentInstance.show.set(false);
    fixture.detectChanges();
    await flush();

    // The whole subtree must be gone — <block> is a layout-only flatten
    // container, so its children have no independent native subtree to preserve.
    expect(tagsUnderRoot()).not.toContain('wrapper');
    expect(findByClass('a')).toHaveLength(0);
    expect(findByClass('b')).toHaveLength(0);
  });

  it('re-projects component-wrapped <ng-content> when a wrapping @if toggles off and on', async () => {
    const fixture = TestBed.createComponent(ReprojHost);
    fixture.detectChanges();
    const slot = lastSlot;

    // Projected content starts inside the component's own <view slot>.
    expect(findByClass('projected')).toHaveLength(1);
    expect(findByClass('slot')).toHaveLength(1);
    expect(
      isAncestorOf(findByClass('slot')[0], findByClass('projected')[0]),
    ).toBe(true);

    // Toggle the slot off and back on.
    slot.open.set(false);
    fixture.detectChanges();
    await flush();
    slot.open.set(true);
    fixture.detectChanges();
    await flush();

    // The wrapper <view slot> is re-created, and the consumer's projected content
    // is RENDERED again (live painting node) inside it — on re-show its painting
    // node was dead, so LynxElement recreated a fresh native ref from cache and
    // re-attached that. Asserting via findRenderedByClass (not findByClass) is the
    // point: a stale re-attached ref would still be in the tree but not rendered.
    const projected = findRenderedByClass('projected');
    const newSlot = findRenderedByClass('slot');
    expect(projected).toHaveLength(1);
    expect(newSlot).toHaveLength(1);
    expect(isAncestorOf(newSlot[0], projected[0])).toBe(true);
    // And its text child rode along (rebuilt from the cached raw-text).
    expect(projected[0].children.map((c) => c.text)).toContain('hi');
  });

  it('re-projects component-wrapped content across repeated cycles when it starts collapsed (accordion)', async () => {
    const fixture = TestBed.createComponent(ReprojCycleHost);
    fixture.detectChanges();
    await flush();
    const slot = lastCycleSlot;

    // Starts collapsed — no slot rendered, content not yet projected anywhere.
    expect(findByClass('cyc-slot')).toHaveLength(0);

    const expand = async (): Promise<void> => {
      slot.open.set(true);
      fixture.detectChanges();
      await flush();
    };
    const collapse = async (): Promise<void> => {
      slot.open.set(false);
      fixture.detectChanges();
      await flush();
    };

    // The device symptom: expand #1 shows content, expand #2 shows an empty
    // wrapper. Drive several full cycles and require RENDERED content after EVERY
    // expand — findRenderedByClass prunes dead-painting-node subtrees, so without
    // recreate-on-remount this fails from expand #2 (the stale ref re-attaches but
    // renders nothing).
    for (let cycle = 1; cycle <= 3; cycle++) {
      await expand();
      const slotEls = findRenderedByClass('cyc-slot');
      const content = findRenderedByClass('cyc-content');
      expect(slotEls, `expand #${cycle}: wrapper present`).toHaveLength(1);
      expect(content, `expand #${cycle}: content present`).toHaveLength(1);
      expect(
        isAncestorOf(slotEls[0], content[0]),
        `expand #${cycle}: content nested in wrapper`,
      ).toBe(true);

      await collapse();
      expect(
        findRenderedByClass('cyc-slot'),
        `collapse #${cycle}`,
      ).toHaveLength(0);
    }
  });

  it("restores a projected root's NESTED child when a bare <ng-content> @if toggles", async () => {
    const fixture = TestBed.createComponent(ReprojNestedHost);
    fixture.detectChanges();
    await flush();
    const slot = lastNestedSlot;

    // The inner <text> starts nested inside the outer <view>.
    expect(findByClass('outer')).toHaveLength(1);
    expect(findByClass('inner')).toHaveLength(1);
    expect(isAncestorOf(findByClass('outer')[0], findByClass('inner')[0])).toBe(
      true,
    );

    // Hide then re-show (the LynxTransition panel scenario).
    slot.open.set(false);
    fixture.detectChanges();
    await flush();
    slot.open.set(true);
    fixture.detectChanges();
    await flush();

    const outer = findRenderedByClass('outer');
    const inner = findRenderedByClass('inner');
    expect(outer).toHaveLength(1);
    expect(inner).toHaveLength(1);
    // The inner child must be back INSIDE the outer view and RENDERED — Angular
    // re-inserts the outer projected root, whose painting node was dead, so
    // LynxElement rebuilds it and its nested child from cache.
    expect(inner[0].parent).toBe(outer[0]);
    expect(isAncestorOf(outer[0], inner[0])).toBe(true);
  });

  it('preserves item subtrees when @for reorders (a move must be reparented intact)', async () => {
    const fixture = TestBed.createComponent(ReorderHost);
    fixture.detectChanges();
    await flush();

    // Sanity: three items, each owning its <text> label.
    expect(findByClass('item')).toHaveLength(3);
    expect(findByClass('label')).toHaveLength(3);
    const idOf = (el: FakeEl): unknown => el.attrs.get('id');
    // Capture each item's FakeEl by id so we can prove the MOVE reuses the same
    // native object rather than recreating it (recreate-on-remount would mint a
    // fresh FakeEl with a new id).
    const before = new Map(findByClass('item').map((el) => [idOf(el), el]));

    // Move the first item to the end — forces Angular to MOVE the surviving
    // item views (detach-then-reinsert), the operation that gutted them.
    fixture.componentInstance.items.set([
      { id: 2, label: 'two' },
      { id: 3, label: 'three' },
      { id: 1, label: 'one' },
    ]);
    fixture.detectChanges();
    await flush();

    const items = findByClass('item');
    const labels = findByClass('label');
    // Nothing gutted or lost: still 3 items and 3 labels…
    expect(items).toHaveLength(3);
    expect(labels).toHaveLength(3);
    // …and every label is still nested inside an <item>, NOT torn off during
    // the move (the failure mode: a move committed as a destroy would gut it).
    for (const label of labels) {
      expect(label.parent?.classes.has('item')).toBe(true);
    }
    // The views were moved (not recreated) into the new order.
    expect(items.map((i) => i.attrs.get('id'))).toEqual([2, 3, 1]);
    // A move is canceled before it becomes a genuine removal, so it is NEVER
    // painting-dead and NEVER recreated: each surviving item is the SAME FakeEl
    // instance, not a rebuilt one. This guards recreate-on-remount from firing on
    // the hot reorder path.
    for (const item of items) {
      expect(item).toBe(before.get(idOf(item)));
    }
  });

  it("re-registers a projected element's event handler after remount", async () => {
    const fixture = TestBed.createComponent(ReprojEventHost);
    fixture.detectChanges();
    await flush();
    const slot = lastSlot;

    const tapRegs = (): { id: number }[] =>
      addEventCalls.filter((c) => c.type === 'bindEvent' && c.name === 'tap');
    expect(tapRegs()).toHaveLength(1);
    const firstId = tapRegs()[0]!.id;

    // Hide then re-show — the tappy view's painting node dies while hidden.
    slot.open.set(false);
    fixture.detectChanges();
    await flush();
    slot.open.set(true);
    fixture.detectChanges();
    await flush();

    // The rebuilt element re-registered its handler on a FRESH native ref (new
    // id). Without the replay, the remounted view would be inert on tap.
    const regs = tapRegs();
    expect(regs.length).toBeGreaterThanOrEqual(2);
    expect(regs.at(-1)!.id).not.toBe(firstId);
  });

  it('replays class, attribute and inline style onto a remounted projected element', async () => {
    const fixture = TestBed.createComponent(ReprojAttrHost);
    fixture.detectChanges();
    await flush();
    const slot = lastSlot;

    slot.open.set(false);
    fixture.detectChanges();
    await flush();
    slot.open.set(true);
    fixture.detectChanges();
    await flush();

    // The rebuilt element is a fresh FakeEl, yet carries every cached property.
    const styled = findRenderedByClass('styled');
    expect(styled).toHaveLength(1);
    expect(styled[0].classes.has('styled')).toBe(true);
    expect(styled[0].attrs.get('aria-label')).toBe('hi');
    expect(styled[0].styles.get('color')).toBe('rgb(1, 2, 3)');
  });

  it('rebuilds a projected layout-only <block> root and relinks its child on remount', async () => {
    const fixture = TestBed.createComponent(ReprojBlockHost);
    fixture.detectChanges();
    await flush();
    const slot = lastNestedSlot;

    expect(findRenderedByClass('bkinner')).toHaveLength(1);

    slot.open.set(false);
    fixture.detectChanges();
    await flush();
    slot.open.set(true);
    fixture.detectChanges();
    await flush();

    // The block wrapper (native tag 'wrapper') is rebuilt and its <text> child is
    // rendered again inside it.
    const inner = findRenderedByClass('bkinner');
    expect(inner).toHaveLength(1);
    expect(inner[0].parent?.tag).toBe('wrapper');
    expect(inner[0].parent?.hasPaintingNode).toBe(true);
  });

  it('rebuilds interpolated raw-text with its current value on remount', async () => {
    const fixture = TestBed.createComponent(ReprojRawTextHost);
    fixture.detectChanges();
    await flush();
    const slot = lastSlot;

    slot.open.set(false);
    fixture.detectChanges();
    await flush();
    slot.open.set(true);
    fixture.detectChanges();
    await flush();

    // The <text class="rt"> is rebuilt with a fresh raw-text child carrying the
    // interpolated value — proves #text is rebuilt via __CreateRawText.
    const rt = findRenderedByClass('rt');
    expect(rt).toHaveLength(1);
    expect(rt[0].children.map((c) => c.text)).toContain('dynamic');
  });

  it('leaks projected content moved outside a component subtree on destroy (why "parking" is unsafe)', async () => {
    // Historical guard. Recreate-on-remount (LynxElement.#recreateSubtree) is now
    // how projected content survives an @if toggle — a removed element's painting
    // node is rebuilt from cache on re-insert, so nothing is relocated. This test
    // locks in WHY we did NOT instead keep the old ref alive by relocating
    // ("parking") it: once content is moved OUT of its component subtree, Angular
    // can no longer clean it up. An earlier renderer parked a collapsed wrapper's
    // projected children into a holder; over a session that holder grew without
    // bound and blew the 5s teardown watchdog. This proves the leak is real and
    // unfixable via the renderer's remove hooks — so the renderer must never
    // relocate content, which recreate-on-remount is careful not to do.
    const g = globalThis as unknown as FakeNativeGlobal<FakeEl>;
    const fixture = TestBed.createComponent(ReprojHost);
    fixture.detectChanges();
    await flush();

    const content = findByClass('projected')[0];
    expect(content).toBeTruthy();

    // Move the projected content OUT of the component's subtree into a standalone
    // holder — exactly what "parking" did on a collapse.
    const holder = makeEl('view');
    g.__AppendElement(pageRoot, holder);
    g.__AppendElement(holder, content);
    expect(holder.children).toContain(content);

    // Destroy the whole component tree (navigate away / app teardown).
    fixture.destroy();
    processPendingRemovals();
    await flush();

    // Angular removed the component's own subtree but issued NO removal for the
    // relocated content (removeChild is never called on it, and destroyNode is
    // called only on an anchor node, never this one). So it is stranded in the
    // holder forever — the unbounded leak that hung teardown.
    expect(holder.children).toContain(content);
  });

  it('restores nested @if/@for content when a detached route view is re-attached (route reuse)', async () => {
    const fixture = TestBed.createComponent(RouteOutletHost);
    fixture.detectChanges();
    await flush();
    const vcr = lastOutletVcr;

    // "Activate route": create the page component inside the outlet's container,
    // exactly as RouterOutlet.activateWith does.
    const ref = vcr.createComponent(RoutePage);
    fixture.detectChanges();
    await flush();

    // Nested @if image and @for rows are rendered on first activation.
    expect(findRenderedByClass('cond-img')).toHaveLength(1);
    expect(findRenderedByClass('row')).toHaveLength(3);

    // "Navigate away": LynxRouteReuseStrategy detaches (keeps the ComponentRef);
    // Angular removes only the top-level route node from the native tree.
    vcr.detach(0);
    // Intervening flush — in the app this is the settle-flush armed by the next
    // lazy route's element creation. It commits the queued removal, so the whole
    // detached subtree's painting nodes die (is_move=false) BEFORE re-attach.
    fixture.detectChanges();
    await flush();

    // "Navigate back": re-insert the SAME view. The route's @if/@for are NOT
    // re-evaluated (conditions unchanged), so recreate-on-remount is the only
    // thing that can bring the nested embedded content back.
    vcr.insert(ref.hostView);
    fixture.detectChanges();
    await flush();

    // The nested @if image and @for rows must be RENDERED again (live painting
    // nodes) — findRenderedByClass prunes dead-ref subtrees, so a remount that
    // fails to rebuild the embedded content shows up as missing here, matching
    // the on-device "blank after returning to the route" symptom. This regressed
    // because @if/@for content was adopted into a throwaway parentNode() wrapper
    // instead of the canonical #children (fixed via LynxElement.#byNativeId).
    expect(findRenderedByClass('cond-img')).toHaveLength(1);
    expect(findRenderedByClass('row')).toHaveLength(3);
  });
});
