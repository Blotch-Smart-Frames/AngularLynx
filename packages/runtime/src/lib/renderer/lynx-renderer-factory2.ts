import {
  ApplicationRef,
  Injectable,
  Injector,
  inject,
  LOCALE_ID,
  type Renderer2,
  type RendererFactory2,
  type RendererType2,
  ViewEncapsulation,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
} from '@angular/core';
import { devStats, endCdTiming, startCdTiming } from '../devtools/stats';
import type { LynxDocumentBase } from '../lynx-document';
import {
  flushTreeWithListUpdates,
  markTreeFlushed,
  processPendingAttributeRemovals,
  processPendingClasses,
  processPendingFlow,
  processPendingInvokes,
  processPendingListUpdates,
  processPendingRemovals,
  processPendingTextNormalization,
} from '../lynx-element';
import { setDocumentLanguage } from '../lynx-element/quotes';
import {
  isBindingListItem,
  isFirstRenderPending,
  setInsideChangeDetection,
  setRunComingTick,
} from '../lynx-render-lifecycle';
import { stopMatchingDeclarationOnlyElements } from '../lynx-elements/declaration-only';
import { EmulatedLynxRenderer } from './emulated-lynx-renderer';
import { LynxRenderer } from './renderer';
import { LYNX_DOCUMENT } from './token';

@Injectable()
export class LynxRendererFactory2 implements RendererFactory2 {
  lynxDocument: LynxDocumentBase = inject(LYNX_DOCUMENT);
  #defaultRenderer: LynxRenderer | null = null;
  #emulatedRenderers = new Map<string, EmulatedLynxRenderer>();

  constructor() {
    setRunComingTick(comingTickRunner(inject(Injector)));
    // The language of an element no `lang` is on or above, whose
    // quotation marks a <q> draws (see quotes.ts): the app's locale, as an
    // Angular app localized for the web sets <html lang> to it. An app's
    // root injector always has it; an injector made without a parent (as
    // some tests make) doesn't, and English stands in.
    setDocumentLanguage(inject(LOCALE_ID, { optional: true }) ?? '');
  }

  /**
   * Angular calls createRenderer once per component type. The renderer is
   * cached by encapsulation mode + component ID, so each component type gets
   * at most one renderer instance that's reused across all instances of that
   * component.
   */
  createRenderer(hostElement: any, type: RendererType2 | null): Renderer2 {
    // Angular passes the component's definition, before it first renders
    // the component's template: none of that template's elements gets a
    // directive that does what this renderer does itself.
    if (type) stopMatchingDeclarationOnlyElements(type);
    if (!type || type.encapsulation !== ViewEncapsulation.Emulated) {
      // ShadowDom (and Angular's experimental isolated variant) needs a shadow
      // root, which Lynx elements don't have. Their styles compile unscoped,
      // so they apply app-wide, as with None.
      if (type && type.encapsulation !== ViewEncapsulation.None) {
        console.warn(
          'ViewEncapsulation.ShadowDom is not supported in Lynx. Falling back to no encapsulation.',
        );
      }
      if (!this.#defaultRenderer) {
        this.#defaultRenderer = new LynxRenderer(this.lynxDocument);
      }
      return this.#defaultRenderer;
    }

    // ViewEncapsulation.Emulated (default) — one EmulatedLynxRenderer per
    // component type, keyed by type.id (the ɵcmp.id we set in angular.ts).
    let renderer = this.#emulatedRenderers.get(type.id);
    if (!renderer) {
      renderer = new EmulatedLynxRenderer(this.lynxDocument, type.id);
      this.#emulatedRenderers.set(type.id, renderer);
    }
    // Angular calls createRenderer for each component instance, with its host
    // element. The bootstrap root has none here; selectRootElement marks it.
    if (hostElement) {
      renderer.applyToHost(hostElement);
    }
    return renderer;
  }
  /**
   * Angular calls begin()/end() around every change-detection tick. We track
   * whether a cycle is in progress so element creation can tell in-cycle
   * rendering (flushed by end() below) apart from content built OUTSIDE a cycle
   * — e.g. a lazy route component instantiated by RouterOutlet during
   * navigation — which needs its own safety-net flush (see scheduleSettleFlush
   * in lynx-element.ts).
   */
  begin?(): void {
    setInsideChangeDetection(true);
    // Build-time `define` gate — false in the Vitest config, so this
    // profiling call is dead code from the test bundle's point of view.
    /* v8 ignore start */
    if (__PROFILE__) {
      startCdTiming();
    }
    /* v8 ignore stop */
  }
  /**
   * Called by Angular after every change detection cycle completes.
   * The order is critical:
   *   0. processPendingClasses() — writes the classes changed during the
   *      cycle, one __SetClasses per element, on every return path.
   *   1. processPendingRemovals() — commits genuine element removals queued
   *      during this cycle. MUST run before the flush so the __RemoveElement
   *      calls land in the SAME flush as the cycle's other mutations; draining
   *      them later (the old queueMicrotask) left removed subtrees occupying
   *      native layout until a later cycle happened to flush ("hidden element
   *      leaves a gap"). The cycle's loose text is regrouped next, then its
   *      attribute removals follow, for the same flush (see
   *      processPendingFlow and processPendingAttributeRemovals).
   *   2. flushTreeWithListUpdates() — sends update-list-info for the lists
   *      that gained, lost or moved items during this CD cycle, then makes the
   *      cycle's one __FlushElementTree(), which commits all pending element
   *      mutations to native and lays out once. Native asks each list for its
   *      items (componentAtIndex) in that layout, after it has resolved the
   *      rest of the tree. componentAtIndex appends each item and flushes it
   *      with native's operation id, which commits the item's subtree: until
   *      it's appended, an item isn't in the page's tree, so no root flush
   *      reaches it, before or after. React Lynx sends a commit's lists
   *      before its one flush the same way; each list used to flush on its
   *      own after the cycle's, N + 1 flushes for N lists.
   *   3. processPendingInvokes() — makes again the UI method calls native
   *      dropped this cycle because their element had no UI yet (see
   *      LynxElement.invoke), now that the flush has made it. After the
   *      lists' update-list-info too: a call on a list (a scroll to an item)
   *      must reach it once the list has the item.
   * Flushing inside componentAtIndex's layout pass instead (see below) crashes
   * from re-entrant __FlushElementTree.
   *
   * Step 2's flush is skipped entirely while isFirstRenderPending() — see that
   * function's doc comment. Every CD cycle that runs as part of the initial
   * bootstrap is still nested inside the native engine's own renderPage call;
   * we avoid driving a layout-triggering flush (which, for pages with a
   * <list>, reentrantly calls back into componentAtIndex) from inside a call
   * frame native hasn't finished unwinding. Native performs its own implicit
   * flush once renderPage returns, so skipping this is safe — element
   * creation/attribute calls above already mutate native elements directly,
   * independent of flushing.
   *
   * In development builds, the cycle's duration, timed from begin(), is
   * recorded on every return path, the flush included: it's how long the
   * cycle kept the main thread busy.
   *
   * The cycle of a `*lynxListFor` item that a list's componentAtIndex is
   * building (see bindListItem) commits its queued work too, and updates any
   * list inside the item, but leaves the flush to componentAtIndex: its flush
   * of the item, tagged with native's operation id, is the one native waits
   * for, and a full flush here would re-enter native's layout pass. The UI
   * method calls wait for the flush after it (see settleAfterListItems).
   * Lists the first render changes wait for it to finish, and then share one
   * flush (see processPendingListUpdates).
   */
  end?(): void {
    try {
      // This change-detection cycle is finishing: clear the flag first, on
      // EVERY return path, so mutations after this point are correctly seen
      // as outside-a-cycle (see begin() / scheduleSettleFlush). The flush
      // below is unconditional, so clearing the flag now does not affect it.
      setInsideChangeDetection(false);
      // The classes changed during the cycle, one __SetClasses per element
      // (see LynxElement's #pendingClasses). First, so that every path
      // below has them: the flush, the first render's (which native makes
      // after renderPage), a list item's (which componentAtIndex makes),
      // and a server render's hydration, which flushes nothing here but had
      // each class written as it changed.
      processPendingClasses();
      // During SSR hydration the native tree already exists from the snapshot
      // — flushing would be redundant and could cause visual glitches.
      // `__ENABLE_SSR__` is a build-time `define` (false in the Vitest config)
      // so this guard is dead from the test bundle's point of view.
      /* v8 ignore start */
      if (__ENABLE_SSR__ && (globalThis as any).__LYNX_IS_HYDRATING__) {
        return;
      }
      /* v8 ignore stop */

      // Build-time `define` gate — false in the Vitest config, so this
      // profiling block is dead code from the test bundle's point of view.
      /* v8 ignore start */
      if (__PROFILE__) {
        devStats.cdCycles++;
        devStats.flushCount++;
      }
      /* v8 ignore stop */

      // Commit queued removals into this cycle's flush (see doc above).
      // Drained even while the first-render flush is skipped: the
      // __RemoveElement calls mutate native elements directly, and native
      // performs its own flush once renderPage returns.
      processPendingRemovals();
      // Then the cycle's loose text, regrouped now that the cycle's inserts,
      // moves and removals are in, so it's trimmed and drawn in this flush
      // (see LynxElement's #regroup).
      processPendingFlow();
      // Then the attributes removed this cycle and not set again: Lynx would
      // apply a removal after a value set in the same flush (see
      // LynxElement's #removedAttributes), so they wait until now.
      processPendingAttributeRemovals();
      // Re-derive positional edge whitespace for texts mutated this cycle,
      // after removals (so torn-down subtrees are skipped) and before the
      // flush (so the corrected text is painted in the same pass). Runs even
      // while the first render's explicit flush is skipped: it only mutates
      // native `text` attributes directly, which native commits in its own
      // post-renderPage flush — same rationale as processPendingRemovals
      // above.
      processPendingTextNormalization();
      if (isBindingListItem()) {
        processPendingListUpdates();
        return;
      }
      try {
        if (isFirstRenderPending()) {
          // Native's own flush after renderPage commits the cycle; the lists
          // wait for the first render to finish (see
          // processPendingListUpdates).
          processPendingListUpdates();
        } else {
          // Everything written so far goes with this flush, the commit
          // passes' writes included: the next native event has nothing to
          // flush for them (see markTreeFlushed). So do the lists'
          // update-list-info, sent right before it. A list that throws
          // doesn't keep the flush from coming; its error is thrown after.
          markTreeFlushed();
          flushTreeWithListUpdates();
        }
      } finally {
        // Then the UI method calls made on elements this cycle created, which
        // have their UIs now (see LynxElement.invoke), and on lists, which
        // have their items: after the flush, which was made even if a list
        // threw.
        processPendingInvokes();
      }
    } finally {
      // In `finally` so a cycle that returns early or throws still ends its
      // timing: the start times nest, so a missed end would pair every later
      // cycle's end with the wrong start. Gated like the counters above.
      /* v8 ignore start */
      if (__PROFILE__) {
        endCdTiming();
      }
      /* v8 ignore stop */
    }
  }
}

/**
 * The parts of Angular's zoneless scheduler (ChangeDetectionSchedulerImpl)
 * and ApplicationRef that tell whether a tick is scheduled, and run it. None
 * of them is public API: Angular's own `exhaustiveCheckNoChangesInterval`
 * reads `pendingRenderTaskId` the same way. If a later Angular renames them,
 * no tick runs early, and elements built outside a cycle flush as before.
 */
type SchedulerState = {
  pendingRenderTaskId?: number | null;
  tick?: () => void;
};
type ApplicationRefState = {
  destroyed: boolean;
  dirtyFlags?: number;
};

/**
 * Runs the tick Angular's scheduler has scheduled, if it will refresh, and
 * says whether it did (see runComingTick in lynx-render-lifecycle.ts).
 *
 * The scheduler has a tick scheduled while `pendingRenderTaskId` is set. Its
 * `tick()` runs it as the timer would: errors go to the app's error handler,
 * and the timer is canceled. The tick only refreshes, and calls begin() and
 * end(), if ApplicationRef has something dirty: one scheduled when a pending
 * task ends (to let the app become stable) marks nothing and returns without
 * a flush, so it's left to its timer, and the caller flushes.
 *
 * Both are resolved at the first call, as they're made after the renderer
 * factory, and kept: a destroyed app's injector throws, and a settle flush
 * can come after the app it was scheduled in is destroyed (a test's).
 */
const comingTickRunner = (injector: Injector): (() => boolean) => {
  let state: {
    scheduler: SchedulerState | null;
    appRef: ApplicationRefState | null;
  } | null = null;
  return () => {
    try {
      state ??= {
        scheduler: injector.get(ChangeDetectionScheduler, null, {
          optional: true,
        }) as SchedulerState | null,
        appRef: injector.get(ApplicationRef, null, {
          optional: true,
        }) as ApplicationRefState | null,
      };
    } catch {
      // The app was destroyed before its first call: no tick is coming.
      return false;
    }
    const { scheduler, appRef } = state;
    if (
      scheduler?.pendingRenderTaskId == null ||
      typeof scheduler.tick !== 'function' ||
      !appRef ||
      appRef.destroyed ||
      !appRef.dirtyFlags
    ) {
      return false;
    }
    scheduler.tick();
    return true;
  };
};
