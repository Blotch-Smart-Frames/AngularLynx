import {
  Injectable,
  inject,
  type Renderer2,
  type RendererFactory2,
  type RendererType2,
  ViewEncapsulation,
} from '@angular/core';
import { devStats } from '../devtools/stats';
import type { LynxDocumentBase } from '../lynx-document';
import {
  processPendingListUpdates,
  processPendingRemovals,
  processPendingTextNormalization,
} from '../lynx-element';
import {
  isFirstRenderPending,
  setInsideChangeDetection,
} from '../lynx-render-lifecycle';
import { EmulatedLynxRenderer } from './emulated-lynx-renderer';
import { LynxRenderer } from './renderer';
import { LYNX_DOCUMENT } from './token';

@Injectable()
export class LynxRendererFactory2 implements RendererFactory2 {
  lynxDocument: LynxDocumentBase = inject(LYNX_DOCUMENT);
  #defaultRenderer: LynxRenderer | null = null;
  #emulatedRenderers = new Map<string, EmulatedLynxRenderer>();

  /**
   * Angular calls createRenderer once per component type. The renderer is
   * cached by encapsulation mode + component ID, so each component type gets
   * at most one renderer instance that's reused across all instances of that
   * component.
   */
  createRenderer(_hostElement: any, type: RendererType2 | null): Renderer2 {
    if (!type || type.encapsulation === ViewEncapsulation.None) {
      if (!this.#defaultRenderer) {
        this.#defaultRenderer = new LynxRenderer(this.lynxDocument);
      }
      return this.#defaultRenderer;
    }

    if (type.encapsulation === ViewEncapsulation.ShadowDom) {
      console.warn(
        'ViewEncapsulation.ShadowDom is not supported in Lynx. Falling back to no encapsulation.',
      );
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
  }
  /**
   * Called by Angular after every change detection cycle completes.
   * On the background thread this is a no-op — there's no native tree to flush.
   * On the main thread, the order is critical:
   *   1. processPendingRemovals() — commits genuine element removals queued
   *      during this cycle. MUST run before the flush so the __RemoveElement
   *      calls land in the SAME flush as the cycle's other mutations; draining
   *      them later (the old queueMicrotask) left removed subtrees occupying
   *      native layout until a later cycle happened to flush ("hidden element
   *      leaves a gap").
   *   2. __FlushElementTree() — commits all pending element mutations to native
   *   3. processPendingListUpdates() — sends update-list-info for lists that
   *      gained/lost children during this CD cycle, then does a targeted flush
   *      per list. This MUST run after the bare flush so list children's subtrees
   *      are already committed when componentAtIndex appends them.
   * Reversing this order causes list items to appear empty (subtree not committed)
   * or crashes from re-entrant __FlushElementTree.
   *
   * Step 1 is skipped entirely while isFirstRenderPending() — see that
   * function's doc comment. Every CD cycle that runs as part of the initial
   * bootstrap is still nested inside the native engine's own renderPage call;
   * we avoid driving a layout-triggering flush (which, for pages with a
   * <list>, reentrantly calls back into componentAtIndex) from inside a call
   * frame native hasn't finished unwinding. Native performs its own implicit
   * flush once renderPage returns, so skipping this is safe — element
   * creation/attribute calls above already mutate native elements directly,
   * independent of flushing.
   */
  end?(): void {
    // This change-detection cycle is finishing: clear the flag first, on EVERY
    // return path, so mutations after this point are correctly seen as
    // outside-a-cycle (see begin() / scheduleSettleFlush). The flush below is
    // unconditional, so clearing the flag now does not affect it.
    setInsideChangeDetection(false);
    if (__MAIN_THREAD__) {
      // During SSR hydration the native tree already exists from the snapshot
      // — flushing would be redundant and could cause visual glitches.
      if (__ENABLE_SSR__ && (globalThis as any).__LYNX_IS_HYDRATING__) {
        return;
      }

      if (__PROFILE__) {
        devStats.cdCycles++;
        devStats.flushCount++;
      }

      // Commit queued removals into this cycle's flush (see doc above). Drained
      // even while the first-render flush is skipped: the __RemoveElement calls
      // mutate native elements directly, and native performs its own flush once
      // renderPage returns.
      processPendingRemovals();
      // Re-derive positional edge whitespace for texts mutated this cycle, after
      // removals (so torn-down subtrees are skipped) and before the flush (so the
      // corrected text is painted in the same pass). Runs even while the first
      // render's explicit flush is skipped: it only mutates native `text`
      // attributes directly, which native commits in its own post-renderPage
      // flush — same rationale as processPendingRemovals above.
      processPendingTextNormalization();
      if (!isFirstRenderPending()) {
        __FlushElementTree();
      }
      processPendingListUpdates();
    }
  }
}
