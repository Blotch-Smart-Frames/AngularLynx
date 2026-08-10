import {
  Component,
  contentChild,
  effect,
  type EmbeddedViewRef,
  inject,
  input,
  output,
  Renderer2,
  TemplateRef,
  viewChild,
  ViewContainerRef,
  type ViewRef,
} from '@angular/core';

type ViewEntry<T> = {
  viewRef: EmbeddedViewRef<{ $implicit: T }>;
  item: T;
  leaving: boolean;
  enterTimer: ReturnType<typeof setTimeout> | null;
  leaveTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Animates enter/leave of list items using CSS `@keyframes`.
 *
 * Unlike `LynxTransition` (single element), this manages a collection. Items are
 * rendered from a user-provided `<ng-template>`, and the component diffs the list
 * on each change to animate additions and removals.
 *
 * Each item's root element gets a single class toggled: `{name}-enter` on
 * insertion, `{name}-leave` before removal. See `LynxTransition` for why a
 * single `@keyframes` class is used instead of a two-phase CSS `transition` (the
 * two-phase approach can't get a reliable paint gap on Lynx's background thread).
 *
 * @usageNotes
 * ```html
 * <lynx-transition-group [each]="items()" [trackBy]="idFn" name="list" [duration]="300">
 *   <ng-template let-item>
 *     <view>
 *       <text>{{ item.name }}</text>
 *     </view>
 *   </ng-template>
 * </lynx-transition-group>
 * ```
 *
 * ```css
 * @keyframes list-enter { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
 * @keyframes list-leave { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-30px); } }
 * .list-enter { animation: list-enter 300ms ease both; }
 * .list-leave { animation: list-leave 300ms ease both; }
 * ```
 */
@Component({
  selector: 'lynx-transition-group',
  standalone: true,
  template: `<ng-template #anchor />`,
})
export class LynxTransitionGroup<T> {
  readonly each = input<T[]>([]);
  readonly trackBy = input<(item: T) => unknown>((item: any) => item);
  readonly name = input<string>('v');
  readonly duration = input<number>(300);

  readonly afterEnter = output<T>();
  readonly afterLeave = output<T>();

  readonly itemTemplate = contentChild(TemplateRef);

  protected readonly vcr = viewChild.required('anchor', {
    read: ViewContainerRef,
  });

  readonly #renderer = inject(Renderer2);
  #entries = new Map<unknown, ViewEntry<T>>();
  #initialized = false;

  constructor() {
    effect(() => {
      const items = this.each();
      const trackBy = this.trackBy();

      if (!this.#initialized) {
        this.#initialized = true;
        this.#initialRender(items, trackBy);
        return;
      }

      this.#reconcile(items, trackBy);
    });
  }

  #initialRender(items: T[], trackBy: (item: T) => unknown): void {
    const template = this.itemTemplate();
    if (!template) return;
    for (const item of items) {
      const key = trackBy(item);
      const viewRef = this.vcr().createEmbeddedView(template, {
        $implicit: item,
      });
      this.#entries.set(key, {
        viewRef,
        item,
        leaving: false,
        enterTimer: null,
        leaveTimer: null,
      });
    }
  }

  /**
   * Three-phase reconciliation against the trackBy-keyed entry map:
   * 1. Leave pass: items absent from new list get animated out
   *    (items that reappear during their leave animation are rescued)
   * 2. Enter pass: new items get created and animated in
   *    (retained items get their context updated for change detection)
   * 3. Reorder pass: surviving views are moved to match the new list order via
   *    ViewContainerRef.move() (→ Lynx's __InsertElementBefore, which reorders
   *    without recreating), while LEAVING views stay pinned in their current
   *    slot so they animate out in place instead of jumping to the bottom.
   */
  #reconcile(items: T[], trackBy: (item: T) => unknown): void {
    const newKeys = new Set<unknown>();
    const newKeyOrder: unknown[] = [];

    for (const item of items) {
      const key = trackBy(item);
      newKeys.add(key);
      newKeyOrder.push(key);
    }

    // Leave: entries not in new list.
    for (const [key, entry] of this.#entries) {
      if (!newKeys.has(key) && !entry.leaving) {
        this.#animateLeave(key, entry);
      } else if (newKeys.has(key) && entry.leaving) {
        // Item reappeared during leave animation — cancel the leave, keep the
        // existing view. This avoids destroying+recreating native elements.
        this.#cancelLeave(key, entry);
      }
    }

    // Enter: items in new list but not in entries (or was leaving).
    const template = this.itemTemplate();
    if (!template) return;
    for (const item of items) {
      const key = trackBy(item);
      const existing = this.#entries.get(key);

      if (!existing) {
        const viewRef = this.vcr().createEmbeddedView(template, {
          $implicit: item,
        });
        const entry: ViewEntry<T> = {
          viewRef,
          item,
          leaving: false,
          enterTimer: null,
          leaveTimer: null,
        };
        this.#entries.set(key, entry);
        this.#animateEnter(entry);
      } else if (!existing.leaving) {
        // Update context for retained items so template bindings reflect
        // the latest item value (handles reference-identity changes).
        existing.item = item;
        existing.viewRef.context.$implicit = item;
        existing.viewRef.markForCheck();
      }
    }

    // Reorder non-leaving views to match new list order.
    this.#reorderViews(newKeyOrder);
  }

  /**
   * Reorders mounted views to match the new list order, keeping LEAVING views
   * pinned to their current slot so they animate out where they sit.
   *
   * The naive approach — pack every surviving view into indices 0..N-1 — bubbles
   * a mid-list leaving item to the bottom: to pull the survivors below it up into
   * the low indices, `vcr.move` slides the leaving view past them to the end, so
   * a deleted middle item visibly jumps to the bottom before its leave animation
   * plays there (the reported bug).
   *
   * Instead we build the target order of ALL mounted views: each leaving view
   * keeps the slot it currently occupies, and the survivors fill the remaining
   * slots in `keyOrder`. A pure delete then needs zero moves — the survivors are
   * already in relative order and the leaving item stays put — so it animates out
   * exactly where it was.
   */
  #reorderViews(keyOrder: unknown[]): void {
    const vcr = this.vcr();
    const total = vcr.length;
    if (total === 0) return;

    // Reverse-map mounted views → entries so each slot can be classified as a
    // survivor (fillable) or a leaving view (pinned in place).
    const entryByView = new Map<ViewRef, ViewEntry<T>>();
    for (const entry of this.#entries.values()) {
      entryByView.set(entry.viewRef, entry);
    }

    // Survivors in their target order — the leaving views are woven in below.
    const survivorViews: ViewRef[] = [];
    for (const key of keyOrder) {
      const entry = this.#entries.get(key);
      if (entry && !entry.leaving) survivorViews.push(entry.viewRef);
    }

    // Weave: a slot currently holding a survivor takes the next survivor in
    // target order; every other slot (a leaving or untracked view) stays put.
    const target: ViewRef[] = [];
    let s = 0;
    for (let i = 0; i < total; i++) {
      const view = vcr.get(i);
      if (!view) continue;
      const entry = entryByView.get(view);
      if (entry && !entry.leaving && s < survivorViews.length) {
        target.push(survivorViews[s++]);
      } else {
        target.push(view);
      }
    }

    // Realize the target order. Moving a view to index i only shifts views at
    // >= i, so slots already settled at 0..i-1 stay correct — the pass is stable
    // and skips a move when the view is already in position.
    for (let i = 0; i < target.length; i++) {
      const view = target[i];
      if (vcr.indexOf(view) !== i) {
        vcr.move(view, i);
      }
    }
  }

  #animateEnter(entry: ViewEntry<T>): void {
    const rootEl = entry.viewRef.rootNodes[0];
    if (!rootEl) return;

    const name = this.name();

    // Applied inside the reconcile effect (a change-detection pass), so the
    // class flushes in the same commit that mounts the item — the native engine
    // then plays the ${name}-enter @keyframes from 0%. No requestAnimationFrame
    // (see LynxTransition for why the two-phase transition approach fails here).
    this.#renderer.removeClass(rootEl, `${name}-leave`);
    this.#renderer.addClass(rootEl, `${name}-enter`);

    // Timer-based completion (no animationend bridge on the background thread).
    // The enter class holds the final frame (fill: both) = the resting state, so
    // it stays applied until the item leaves; #animateLeave removes it inside the
    // reconcile effect, where a class change flushes reliably.
    entry.enterTimer = setTimeout(() => {
      entry.enterTimer = null;
      this.afterEnter.emit(entry.item);
    }, this.duration());
  }

  #animateLeave(key: unknown, entry: ViewEntry<T>): void {
    entry.leaving = true;

    const rootEl = entry.viewRef.rootNodes[0];
    if (!rootEl) {
      this.#destroyEntry(key);
      return;
    }

    const name = this.name();

    this.#renderer.removeClass(rootEl, `${name}-enter`);
    this.#renderer.addClass(rootEl, `${name}-leave`);

    // Keep the view mounted until the leave animation finishes, then destroy it.
    entry.leaveTimer = setTimeout(() => {
      entry.leaveTimer = null;
      const item = entry.item;
      this.#destroyEntry(key);
      this.afterLeave.emit(item);
    }, this.duration());
  }

  #cancelLeave(_key: unknown, entry: ViewEntry<T>): void {
    if (entry.leaveTimer !== null) {
      clearTimeout(entry.leaveTimer);
      entry.leaveTimer = null;
    }

    const rootEl = entry.viewRef.rootNodes[0];
    if (rootEl) {
      const name = this.name();
      // Item reappeared mid-leave — drop the leave class so it's visible again.
      this.#renderer.removeClass(rootEl, `${name}-leave`);
    }

    entry.leaving = false;
  }

  #destroyEntry(key: unknown): void {
    const entry = this.#entries.get(key);
    if (!entry) return;

    if (entry.enterTimer !== null) clearTimeout(entry.enterTimer);
    if (entry.leaveTimer !== null) clearTimeout(entry.leaveTimer);

    const index = this.vcr().indexOf(entry.viewRef);
    if (index >= 0) {
      this.vcr().remove(index);
    }
    this.#entries.delete(key);
  }
}
