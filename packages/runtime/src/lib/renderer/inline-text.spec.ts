// @vitest-environment jsdom
// cspell:words interp Reproj
//
// Integration harness for the flush-time whitespace normalization pass. It
// drives the REAL main-thread renderer (LynxDocument + LynxElement) against an
// in-memory fake of the native tree — a trimmed clone of teardown.spec.ts's
// harness — so Angular's actual create/attach/remove sequence exercises
// LynxElement's positional edge-trimming (processPendingTextNormalization).
//
// Why an integration harness and not renderer.spec.ts: the pass needs a real
// text SUBTREE (nested <text> + raw-text leaves) and the end()/flush lifecycle,
// neither of which the LynxBackgroundElement stand-in in renderer.spec.ts has.
//
// Reading the displayed text: a raw-text is created via __CreateRawText (which
// seeds FakeEl.text with the collapsed value) and the pass writes the trimmed
// DISPLAY via __SetAttribute('text', …) (which lands in FakeEl.attrs) — but only
// when it differs from the current value. So the effective on-screen text is
// `attrs['text'] ?? text` (see leafText).
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
let flushCount = 0;
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
  flushCount = 0;
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
  g.__SetConfig = () => {};
  g.__AddInlineStyle = () => {};
  g.__SetInlineStyles = () => {};
  g.__AddEvent = () => {};
  g.__FlushElementTree = () => {
    flushCount++;
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

/**
 * The concatenated on-screen text of the single live <text> with `cls`.
 */
const renderedText = (cls: string): string => {
  const roots = descendants().filter((n) => n.classes.has(cls));
  if (roots.length !== 1) {
    throw new Error(`expected exactly one live .${cls}, got ${roots.length}`);
  }
  return rawTextLeaves(roots[0]).map(leafText).join('');
};

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve));

// --- Test components ----------------------------------------------------------

/**
 * Projects <ng-content> into a native <text>, mirroring @blotch/ui wrappers.
 */
@Component({
  selector: 'wrap-text',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="wrap"><ng-content /></text>`,
})
class WrapText {}

/**
 * The flagship-demo regression: three styled runs projected into one <text>.
 */
@Component({
  selector: 'multi-run-host',
  standalone: true,
  imports: [WrapText],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<wrap-text
    ><text class="a">One </text><text class="b">two</text
    ><text class="c"> three</text></wrap-text
  >`,
})
class MultiRunHost {}

/**
 * A single plain string projected into a <text>.
 */
@Component({
  selector: 'single-run-host',
  standalone: true,
  imports: [WrapText],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<wrap-text>Hello from Angular</wrap-text>`,
})
class SingleRunHost {}

/**
 * Multi-line prose in a block <text> — the original leading-space bug.
 */
@Component({
  selector: 'prose-host',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: ` <text class="prose"> The quick brown fox </text> `,
})
class ProseHost {}

/**
 * Runs driven by a signal via @for — lets one component test every run combo.
 */
@Component({
  selector: 'dynamic-runs-host',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="dyn">
    @for (r of runs(); track $index) {
      <text>{{ r }}</text>
    }
  </text>`,
})
class DynamicRunsHost {
  readonly runs = signal<string[]>([]);
}

/**
 * A single interpolated run — value carries edge whitespace at runtime.
 */
@Component({
  selector: 'interp-host',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<text class="interp">{{ label() }}</text>`,
})
class InterpHost {
  readonly label = signal('');
}

/**
 * The multi-run text wrapped in an @if, to exercise remount (recreate).
 */
@Component({
  selector: 'toggle-host',
  standalone: true,
  imports: [WrapText],
  encapsulation: ViewEncapsulation.None,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `@if (show()) {
    <wrap-text
      ><text class="a">One </text><text class="b">two</text
      ><text class="c"> three</text></wrap-text
    >
  }`,
})
class ToggleHost {
  readonly show = signal(true);
}

describe('inline text whitespace normalization', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.stubGlobal('__MAIN_THREAD__', true);
    installNativeFakes();
    // Without this, end() skips __FlushElementTree() (first-render latch) and the
    // painting model never fires — see teardown.spec.ts's note.
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

  it('preserves the spaces between adjacent projected runs (One two three)', () => {
    // The regression: blanket per-node trimming rendered "Onetwothree".
    const fixture = TestBed.createComponent(MultiRunHost);
    fixture.detectChanges();
    expect(renderedText('wrap')).toBe('One two three');
  });

  it('collapses a space shared across a run boundary to one', () => {
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set(['One ', ' two']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('One two');
  });

  it('trims the leading edge of the first run and trailing edge of the last', () => {
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set([' One ', 'two ']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('One two');
  });

  // A run that collapses to '' (e.g. an interpolated/@for value that is only
  // whitespace, or a genuinely empty string) contributes no inline box. It must
  // not swallow the boundary-space state carried from the run before it, or
  // claim an edge trim in place of the real first/last run — regression coverage
  // for a bug where the pass derived that state from the (now-empty) leaf itself.
  it('carries the boundary space across a whitespace-only middle run', () => {
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set(['A ', ' ', ' B']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('A B');
  });

  it('carries the boundary space across a genuinely empty middle run', () => {
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set(['A ', '', ' B']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('A B');
  });

  it('trims the trailing edge past a whitespace-only trailing run', () => {
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set(['x ', ' ']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('x');
  });

  it('trims the leading edge past a whitespace-only leading run', () => {
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set([' ', ' x']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('x');
  });

  it('leaves a single clean projected run untouched', () => {
    const fixture = TestBed.createComponent(SingleRunHost);
    fixture.detectChanges();
    expect(renderedText('wrap')).toBe('Hello from Angular');
  });

  it('trims a single multi-line prose run (the original leading-space bug)', () => {
    const fixture = TestBed.createComponent(ProseHost);
    fixture.detectChanges();
    expect(renderedText('prose')).toBe('The quick brown fox');
  });

  it('re-normalizes an interpolated run when its value changes', () => {
    const fixture = TestBed.createComponent(InterpHost);
    fixture.componentInstance.label.set(' hi ');
    fixture.detectChanges();
    expect(renderedText('interp')).toBe('hi');

    fixture.componentInstance.label.set(' goodbye ');
    fixture.detectChanges();
    expect(renderedText('interp')).toBe('goodbye');
  });

  it('re-normalizes projected runs after an @if remount', async () => {
    const fixture = TestBed.createComponent(ToggleHost);
    fixture.detectChanges();
    expect(renderedText('wrap')).toBe('One two three');

    fixture.componentInstance.show.set(false);
    fixture.detectChanges();
    await flush();
    fixture.componentInstance.show.set(true);
    fixture.detectChanges();
    await flush();

    // The subtree's painting nodes died while hidden; recreate-on-remount rebuilds
    // them and the pass re-derives the display — still "One two three", not
    // "Onetwothree" and not blank.
    expect(renderedText('wrap')).toBe('One two three');
  });

  it('restores a trimmed trailing space when a run stops being last', () => {
    // Proves #rawText is load-bearing: "a " renders "a" while alone (trailing
    // trimmed as the last run), then its space must come BACK when "b" is added
    // after it — impossible from the trimmed display alone.
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set(['a ']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('a');

    fixture.componentInstance.runs.set(['a ', 'b']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('a b');
  });

  it('re-trims survivors when a middle run is removed', () => {
    const fixture = TestBed.createComponent(DynamicRunsHost);
    fixture.componentInstance.runs.set(['A ', 'B ', 'C ']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('A B C');

    fixture.componentInstance.runs.set(['A ', 'C ']);
    fixture.detectChanges();
    expect(renderedText('dyn')).toBe('A C');
  });

  it('normalizes within the same flush — correct after one detectChanges, no async', () => {
    const fixture = TestBed.createComponent(MultiRunHost);
    const before = flushCount;
    fixture.detectChanges();
    // No await: the pass runs inside end(), before __FlushElementTree, so the
    // display is already correct in the same paint (no second flush needed).
    expect(renderedText('wrap')).toBe('One two three');
    expect(flushCount).toBeGreaterThan(before);
  });

  it('preserves a non-breaking space at the edge (escape hatch)', () => {
    const fixture = TestBed.createComponent(InterpHost);
    fixture.componentInstance.label.set('\u00A0hi');
    fixture.detectChanges();
    expect(renderedText('interp')).toBe('\u00A0hi');
  });

  describe('recreate-on-remount (created and destroyed in the same cycle)', () => {
    // Normalization is SKIPPED for a subtree that is #paintingDead this cycle
    // (see commitPendingTextNormalization) \u2014 necessarily, since its native refs
    // are gone. If a multi-run <text> is created AND torn down within the SAME
    // cycle, before it is ever normalized even once, its raw-text leaves keep
    // their raw, UNTRIMMED #text. #recreateSubtree bakes whatever #text
    // currently holds into the rebuilt native ref on a later re-show, so without
    // re-enqueueing each recreated leaf the remounted text stays wrong forever
    // (concretely: the untrimmed leading space on a middle/last run never gets a
    // chance to collapse against its predecessor, producing a double space).
    //
    // Driven at the LynxDocument/LynxElement level, not TestBed: reproducing
    // "created and removed in the exact same change-detection cycle" needs
    // finer control than per-tick TestBed cycles give (each signal .set() +
    // detectChanges() here is its own cycle, so content is always normalized at
    // least once before any removal \u2014 this scenario needs both to land in one).
    it('re-normalizes a multi-run text torn down before its first normalization', () => {
      const doc = new LynxDocument();
      doc.createRootElement();

      const textRoot = doc.createElement('text') as any;
      textRoot.setAttribute('class', 'wrap');
      const runA = doc.createText('One ') as any;
      const runB = doc.createText(' two') as any;
      textRoot.appendChild(runA);
      textRoot.appendChild(runB);

      const host = doc.createElement('view') as any;
      host.appendChild(textRoot);
      doc.page.appendChild(host);
      host.remove();

      // One end()-equivalent cycle: removals mark the whole host subtree
      // #paintingDead (host, textRoot, runA, runB) BEFORE normalization runs, so
      // the drain must skip it \u2014 runA/runB's #text stays raw and untrimmed.
      processPendingRemovals();
      processPendingTextNormalization();
      (globalThis as any).__FlushElementTree();

      // Later cycle: re-show the SAME host instance \u2014 the recreate-on-remount
      // path (see teardown.spec.ts's ReprojSlot for the Angular-driven
      // equivalent of this same shape).
      doc.page.appendChild(host);
      processPendingRemovals();
      processPendingTextNormalization();
      (globalThis as any).__FlushElementTree();

      expect(renderedText('wrap')).toBe('One two');
    });
  });
});
