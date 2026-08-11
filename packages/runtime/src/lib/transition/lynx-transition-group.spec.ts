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
  });
});
