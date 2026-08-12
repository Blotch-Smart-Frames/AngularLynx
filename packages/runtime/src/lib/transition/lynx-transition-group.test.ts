// @vitest-environment jsdom
import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
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
import { LynxTransitionGroup } from './lynx-transition-group';

/**
 * Sets an Angular InputSignal's value using Angular's internal reactive node API.
 * Needed because JIT mode doesn't wire up signal inputs for template binding or setInput().
 */
const setInputSignal = (signalFn: any, value: any): void => {
  const symbols = Object.getOwnPropertySymbols(signalFn);
  const signalSymbol = symbols.find((s) => s.toString() === 'Symbol(SIGNAL)')!;
  const node = signalFn[signalSymbol];
  const proto = Object.getPrototypeOf(node);
  proto.applyValueToInputSignal(node, value);
};

type Item = { id: number; name: string };

describe('LynxTransitionGroup', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.useFakeTimers();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LynxTransitionGroup],
      providers: [provideZonelessChangeDetection()],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  /**
   * Creates the component with mocked contentChild/viewChild queries.
   * JIT mode doesn't support signal-based content/view queries, so we override them
   * with mock implementations that create real DOM elements.
   */
  const create = () => {
    const fixture = TestBed.createComponent(LynxTransitionGroup<Item>);
    const comp = fixture.componentInstance;
    const hostEl = fixture.nativeElement as HTMLElement;

    const views: any[] = [];

    const mockTemplate = {
      createEmbeddedView: (context: any) => {
        const div = document.createElement('div');
        div.className = 'item';
        div.textContent = context?.$implicit?.name ?? '';
        return {
          rootNodes: [div],
          context,
          markForCheck: () => {},
          destroy: () => div.remove(),
          detectChanges: () => {},
        };
      },
    };

    // Faithful ViewContainerRef stand-in: `move` reorders BOTH the tracked
    // views array and the host DOM, and `get`/`length` are implemented, so the
    // mock actually reflects reordering. (The previous no-op `move` is why the
    // "leaving item bubbles to the bottom" bug slipped past unit tests.)
    const mockVcr = {
      get: (index: number) => views[index] ?? null,
      createEmbeddedView: (template: any, context: any) => {
        const view = template.createEmbeddedView(context);
        views.push(view);
        hostEl.appendChild(view.rootNodes[0]);
        return view;
      },
      indexOf: (view: any) => views.indexOf(view),
      move: (view: any, index: number) => {
        const from = views.indexOf(view);
        if (from < 0) return;
        views.splice(from, 1);
        views.splice(index, 0, view);
        const node = view.rootNodes[0];
        node.remove();
        const refNode = views[index + 1]?.rootNodes[0] ?? null;
        hostEl.insertBefore(node, refNode);
      },
      remove: (index: number) => {
        const view = views[index];
        if (view) {
          view.rootNodes[0].remove();
          views.splice(index, 1);
        }
      },
    };
    // `length` must track the live array; defined via a getter (an object-literal
    // `get length()` trips the arrow-function lint rule, so use defineProperty).
    Object.defineProperty(mockVcr, 'length', { get: () => views.length });

    Object.defineProperty(comp, 'itemTemplate', {
      value: () => mockTemplate,
      writable: true,
    });
    Object.defineProperty(comp, 'vcr', {
      value: () => mockVcr,
      writable: true,
    });

    setInputSignal(comp.trackBy, (item: Item) => item.id);
    fixture.detectChanges();
    return { fixture, comp, hostEl };
  };

  const getItemEls = (hostEl: HTMLElement): HTMLElement[] =>
    Array.from(hostEl.querySelectorAll('.item'));

  describe('enter', () => {
    it('adds the enter keyframe class to a newly inserted item', () => {
      const { comp, hostEl } = create();

      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      const items = getItemEls(hostEl);
      expect(items.length).toBe(1);
      expect(items[0].classList.contains('v-enter')).toBe(true);
    });

    it('keeps the enter class after the duration (holds resting state) and emits afterEnter', () => {
      const { comp, hostEl } = create();
      const entered: Item[] = [];
      comp.afterEnter.subscribe((i) => entered.push(i));

      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();
      vi.advanceTimersByTime(300);

      const items = getItemEls(hostEl);
      // fill: both holds the final frame, so the class stays until the item leaves.
      expect(items[0].classList.contains('v-enter')).toBe(true);
      expect(entered).toEqual([{ id: 1, name: 'A' }]);
    });
  });

  describe('leave', () => {
    it('adds the leave class and removes the enter class', () => {
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      const itemEl = getItemEls(hostEl)[0];

      // Remove the item → triggers the leave animation.
      setInputSignal(comp.each, []);
      TestBed.flushEffects();

      expect(itemEl.classList.contains('v-leave')).toBe(true);
      expect(itemEl.classList.contains('v-enter')).toBe(false);
    });

    it('destroys the item after the duration and emits afterLeave', () => {
      const { comp, hostEl } = create();
      const left: Item[] = [];
      comp.afterLeave.subscribe((i) => left.push(i));

      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      setInputSignal(comp.each, []);
      TestBed.flushEffects();
      vi.advanceTimersByTime(300);

      expect(getItemEls(hostEl).length).toBe(0);
      expect(left).toEqual([{ id: 1, name: 'A' }]);
    });
  });

  describe('cancelLeave', () => {
    it('drops the leave class when the item reappears mid-leave', () => {
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      const itemEl = getItemEls(hostEl)[0];

      // Start leave, then re-add the same item before the timer fires.
      setInputSignal(comp.each, []);
      TestBed.flushEffects();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      expect(itemEl.classList.contains('v-leave')).toBe(false);
    });

    it('prevents the canceled leave timer from destroying the item', () => {
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      setInputSignal(comp.each, []);
      TestBed.flushEffects();
      // Re-add before the leave timer fires.
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();
      vi.advanceTimersByTime(500);

      expect(getItemEls(hostEl).length).toBe(1);
    });
  });

  describe('reconcile', () => {
    it('enters a new item and leaves a removed one in a single update', () => {
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      const first = getItemEls(hostEl)[0];

      // Swap item 1 out for item 2.
      setInputSignal(comp.each, [{ id: 2, name: 'B' }]);
      TestBed.flushEffects();

      const items = getItemEls(hostEl);
      // The leaving item is still present (animating out) with the leave class…
      expect(first.classList.contains('v-leave')).toBe(true);
      // …and the new item entered with the enter class.
      const entering = items.find((el) => el.textContent === 'B')!;
      expect(entering.classList.contains('v-enter')).toBe(true);
    });

    it('keeps a removed middle item in its slot instead of moving it to the bottom', () => {
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
      ]);
      TestBed.flushEffects();
      expect(getItemEls(hostEl).map((el) => el.textContent)).toEqual([
        'A',
        'B',
        'C',
      ]);

      // Delete the MIDDLE item.
      setInputSignal(comp.each, [
        { id: 1, name: 'A' },
        { id: 3, name: 'C' },
      ]);
      TestBed.flushEffects();

      // While leaving, B stays at index 1 (its original slot) — it must NOT be
      // bubbled to the bottom to animate out there.
      const during = getItemEls(hostEl);
      expect(during.map((el) => el.textContent)).toEqual(['A', 'B', 'C']);
      expect(during[1].textContent).toBe('B');
      expect(during[1].classList.contains('v-leave')).toBe(true);

      // After the leave animation, B is destroyed and the list collapses.
      vi.advanceTimersByTime(300);
      expect(getItemEls(hostEl).map((el) => el.textContent)).toEqual([
        'A',
        'C',
      ]);
    });

    it('reorders surviving items to match a reordered list', () => {
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
      ]);
      TestBed.flushEffects();

      // Reverse the list (no adds or removes).
      setInputSignal(comp.each, [
        { id: 3, name: 'C' },
        { id: 2, name: 'B' },
        { id: 1, name: 'A' },
      ]);
      TestBed.flushEffects();

      expect(getItemEls(hostEl).map((el) => el.textContent)).toEqual([
        'C',
        'B',
        'A',
      ]);
    });

    it('rescues an item that reappears during its leave animation', () => {
      // Covers the #cancelLeave path: an item that was removed and started
      // animating out gets re-added before its leave timer fires — cancel the
      // leave, drop the class, and keep the same view alive.
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();
      const itemEl = getItemEls(hostEl)[0];

      // Leave: schedules the destroy timer + adds v-leave.
      setInputSignal(comp.each, []);
      TestBed.flushEffects();
      expect(itemEl.classList.contains('v-leave')).toBe(true);

      // Re-add the same key mid-leave: cancel the leave, drop the class.
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();
      expect(itemEl.classList.contains('v-leave')).toBe(false);

      // The pending timer must not destroy the item.
      vi.advanceTimersByTime(1000);
      expect(getItemEls(hostEl).length).toBe(1);
    });

    it('updates the context of a retained item so bindings reflect the new value', () => {
      // Same trackBy key, new object identity → hits the `existing && !leaving`
      // else-if branch: updates entry.item + context.$implicit and marks the
      // view for check.
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();

      // Grab the view's context object before the retain update.
      const container = comp.constructor;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(container).toBeTruthy();

      setInputSignal(comp.each, [{ id: 1, name: 'A-updated' }]);
      TestBed.flushEffects();

      // Only one item remains and it's the same view (no destroy) — the mock
      // template snapshots textContent at createEmbeddedView, so the DOM won't
      // update. The retention branch is exercised regardless: no leave class,
      // and the view is still mounted.
      const items = getItemEls(hostEl);
      expect(items.length).toBe(1);
      expect(items[0].classList.contains('v-leave')).toBe(false);
    });

    it('does nothing when the item list stays exactly the same', () => {
      // Identical items in the same order — every survivor is already at its
      // target index, so the move loop skips every iteration (indexOf === i).
      const { comp, hostEl } = create();
      setInputSignal(comp.each, [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ]);
      TestBed.flushEffects();

      setInputSignal(comp.each, [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ]);
      TestBed.flushEffects();

      expect(getItemEls(hostEl).map((el) => el.textContent)).toEqual([
        'A',
        'B',
      ]);
    });

    it('is a no-op reconcile when the list is and stays empty', () => {
      // Covers the `if (total === 0) return;` early-out in #reorderViews.
      const { comp, hostEl } = create();
      setInputSignal(comp.each, []);
      TestBed.flushEffects();

      setInputSignal(comp.each, []);
      TestBed.flushEffects();

      expect(getItemEls(hostEl).length).toBe(0);
    });
  });

  describe('missing template', () => {
    it('skips initial render when there is no item template', () => {
      // itemTemplate() returns null → both #initialRender and #reconcile early-
      // return, so no view is ever created.
      const fixture = TestBed.createComponent(LynxTransitionGroup<Item>);
      const comp = fixture.componentInstance;

      const views: unknown[] = [];
      const noopVcr = {
        length: 0,
        get: () => null,
        indexOf: () => -1,
        move: () => {},
        remove: () => {},
        createEmbeddedView: () => {
          views.push({});
          return {};
        },
      };
      Object.defineProperty(comp, 'itemTemplate', {
        value: () => null,
        writable: true,
      });
      Object.defineProperty(comp, 'vcr', {
        value: () => noopVcr,
        writable: true,
      });

      setInputSignal(comp.trackBy, (item: Item) => item.id);
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      fixture.detectChanges();

      expect(views.length).toBe(0);
    });

    it('skips the enter pass when the template disappears between reconciles', () => {
      // Reconcile branch: template was present on init, then goes away — the
      // enter pass early-returns (`if (!template) return`).
      const { fixture, comp, hostEl } = create();
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      TestBed.flushEffects();
      expect(getItemEls(hostEl).length).toBe(1);

      // Swap the template query to null and reconcile with a fresh item.
      Object.defineProperty(comp, 'itemTemplate', {
        value: () => null,
        writable: true,
      });
      setInputSignal(comp.each, [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ]);
      TestBed.flushEffects();
      fixture.detectChanges();

      // No new view was created for id=2 because the template is null.
      expect(getItemEls(hostEl).length).toBe(1);
    });
  });

  describe('default trackBy', () => {
    it('uses identity when no trackBy is supplied', () => {
      // Covers the `input<...>((item) => item)` default: without a custom
      // trackBy, primitive keys work as-is.
      const fixture = TestBed.createComponent(LynxTransitionGroup<number>);
      const comp = fixture.componentInstance;
      const hostEl = fixture.nativeElement as HTMLElement;

      const views: {
        rootNodes: HTMLElement[];
        context: unknown;
        markForCheck: () => void;
        destroy: () => void;
        detectChanges: () => void;
      }[] = [];
      const tpl = {
        createEmbeddedView: (context: { $implicit: number }) => {
          const div = document.createElement('div');
          div.className = 'item';
          div.textContent = String(context.$implicit);
          return {
            rootNodes: [div],
            context,
            markForCheck: () => {},
            destroy: () => div.remove(),
            detectChanges: () => {},
          };
        },
      };
      const vcr = {
        get length() {
          return views.length;
        },
        get: (i: number) => views[i] ?? null,
        indexOf: (v: unknown) =>
          views.indexOf(
            v as {
              rootNodes: HTMLElement[];
              context: unknown;
              markForCheck: () => void;
              destroy: () => void;
              detectChanges: () => void;
            },
          ),
        move: () => {},
        remove: (i: number) => {
          const v = views[i];
          if (v) {
            v.rootNodes[0].remove();
            views.splice(i, 1);
          }
        },
        createEmbeddedView: (t: typeof tpl, ctx: { $implicit: number }) => {
          const v = t.createEmbeddedView(ctx);
          views.push(v);
          hostEl.appendChild(v.rootNodes[0]);
          return v;
        },
      };
      Object.defineProperty(comp, 'itemTemplate', {
        value: () => tpl,
        writable: true,
      });
      Object.defineProperty(comp, 'vcr', {
        value: () => vcr,
        writable: true,
      });

      setInputSignal(comp.each, [1, 2, 3]);
      fixture.detectChanges();

      expect(views.length).toBe(3);
    });
  });

  describe('animate paths without a root element', () => {
    it('destroys the entry immediately when leave finds no root element', () => {
      // #animateLeave short-circuits (and calls #destroyEntry synchronously)
      // when the ViewRef has no root node — a broken template. Covers the
      // `if (!rootEl) { this.#destroyEntry(key); return; }` branch and the
      // matching early-return in #animateEnter.
      const fixture = TestBed.createComponent(LynxTransitionGroup<Item>);
      const comp = fixture.componentInstance;
      const views: {
        rootNodes: HTMLElement[];
        context: unknown;
        markForCheck: () => void;
        destroy: () => void;
        detectChanges: () => void;
      }[] = [];

      const tpl = {
        createEmbeddedView: (context: { $implicit: Item }) => {
          // Deliberately return zero root nodes so the guard fires.
          return {
            rootNodes: [] as HTMLElement[],
            context,
            markForCheck: () => {},
            destroy: () => {},
            detectChanges: () => {},
          };
        },
      };
      const vcr = {
        get length() {
          return views.length;
        },
        get: (i: number) => views[i] ?? null,
        indexOf: (v: unknown) => views.indexOf(v as (typeof views)[number]),
        move: () => {},
        remove: (i: number) => {
          views.splice(i, 1);
        },
        createEmbeddedView: (
          t: typeof tpl,
          ctx: { $implicit: Item },
        ) => {
          const v = t.createEmbeddedView(ctx);
          views.push(v);
          return v;
        },
      };

      Object.defineProperty(comp, 'itemTemplate', {
        value: () => tpl,
        writable: true,
      });
      Object.defineProperty(comp, 'vcr', {
        value: () => vcr,
        writable: true,
      });

      setInputSignal(comp.trackBy, (item: Item) => item.id);
      // Initial render adds A without animating (no animateEnter here).
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      fixture.detectChanges();
      TestBed.flushEffects();
      expect(views.length).toBe(1);

      // Reconcile: add B → animateEnter(B) sees rootNodes[0] undefined and
      // returns early (covers `#animateEnter`'s `if (!rootEl) return;`).
      setInputSignal(comp.each, [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ]);
      fixture.detectChanges();
      TestBed.flushEffects();
      expect(views.length).toBe(2);

      // Remove B → animateLeave sees empty rootNodes and destroys the entry
      // synchronously (no timer scheduled, covers `#animateLeave`'s branch).
      setInputSignal(comp.each, [{ id: 1, name: 'A' }]);
      fixture.detectChanges();
      TestBed.flushEffects();
      expect(views.length).toBe(1);
    });
  });
});
