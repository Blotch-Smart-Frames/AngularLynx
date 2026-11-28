# x-list Investigation

**Status:** Resolved. Lists render on iOS, Android and the web; the sections after "Lazy items and view recycling" are the history of getting there (the crashes came from keying a `WeakSet` on element refs inside `componentAtIndex`, see `create-list-element.ts`).

## Lazy items and view recycling (`*lynxListFor`, 2026-11-14)

`@for` in a `<list>` builds every item's Angular view and elements up front; the native list draws only the items near the screen, and every view stays. `*lynxListFor` (`packages/runtime/src/lib/list-for/`) builds an item's view only when native asks for it, and reuses views native let go of, following React Lynx's protocol (`lynx-stack/packages/react/runtime/src/snapshot/list/list.ts`):

- **The list's model.** `LynxListElement` diffs _slots_: each element child (static `<list-item>`, `@for` item) and each item of a `*lynxListFor` run, which sits where the directive's anchor comment sits among the children (`attachItemSource`). A run gives each item's key (`trackBy`), reuse type and layout attributes (`itemAttributes`) without a view; `commit()` fixes the run that `componentAtIndex` indexes into until the next update, and the list's `committedSlot(index)` maps native's index to a slot.
- **The diff.** Identity is `#<unique id>` for an element, `<run>|<type>|<key>` for a run's item. The items outside the longest run that kept their order (LIS) are moves, sent as a removal and an insertion of the same `item-key`, as React Lynx sends them: native keeps the item's holder by key and asks for it again. (Before, a reordered `@for` sent nothing, and native kept the old order.) A run's item whose attributes changed gets an `updateAction` with `flush: false`.
- **componentAtIndex.** For a run's item, `ListItemViews.bind()` gives the item its own view back if native let go of it and nothing reused it yet, takes the oldest pooled view of its type otherwise (React's recycle map is insertion-ordered too), or builds one (`TemplateRef.createEmbeddedView`, then `ViewContainerRef.insert`, which reaches the list as an `appendChild` it skips: the root is marked `_ownedByListSource`). It sets the context, runs `detectChanges()`, and componentAtIndex appends a new element and flushes with the operation id, as for an element child. If native asks for an item whose element it still holds (a move, or a cell bound anew), the item gets another view, as React's `takeElements()` clones: one element in two cells would show one empty. `enableReuseNotification` passes `listReuseNotification` when an element shows another item.
- **enqueueComponent.** The view goes to its type's pool, still claimed by its item. An item with `recyclable: false` keeps its view out of the pool (the platform lists on iOS and Android ignore the attribute; Lynx's C++ list honors it).
- **No other flush inside componentAtIndex.** The item is built inside native's layout pass (sync list) or a native task of its own (`enable-async-list`). `bindListItem()` (`lynx-render-lifecycle.ts`) marks the scope: `LynxRendererFactory2.end()`, which the item's `detectChanges()` runs, commits removals, flow and text normalization but doesn't flush; a list inside the item sets its `update-list-info` without a root flush (React's `ensureElements` → `flushWithId`), so the item's own flush lays it out; `scheduleSettleFlush()` schedules nothing (Lynx's main thread runs a call's microtasks before it returns to native, so a settle flush would land in the layout pass). Calls waiting for a flush (`afterNextFlush`) get one on a `setTimeout` after (`settleAfterListItems`).
- **Views stay attached to change detection**, in the pool too. `reattach()` and every view insert notify Angular's scheduler, and a tick with nothing to check still runs `begin()`/`end()`: a tick would have followed every item native asked for while scrolling. A pooled view is checked with its parent on its last item; there are a handful. (`end()` no longer flushes for a cycle that wrote nothing, see below, but the tick itself still costs a timer task.)
- **Under `enable-async-list`**, componentAtIndex and enqueueComponent read only what the last update committed, so a call that arrives between the directive's `ngDoCheck` and the next update, or after the directive is destroyed (bind gives `null`), still answers for the items native was told about.
- **An edit that keeps every key, type and layout attribute** (a row replaced by a changed copy, a refetch of the same rows) has nothing for native: `ListItemViews.setItems()` commits the items itself and the directive doesn't schedule the list, whose update would collect and diff every item to send nothing.
- **Lynx for Web** calls componentAtIndex for every inserted position in a microtask after `update-list-info`, and enqueueComponent only for removals, so every item gets a view there.

Measured on the iOS Simulator (Lynx Explorer 4.1, iPhone 18 Pro, iOS 27), 1,000 rows of `examples/element-list` (a row component with two texts and a tap target), a fresh Explorer process for each run. The simulator runs on the Mac's CPU, shared with other simulators, so read the numbers against each other:

|                                                                      | `@for`       | `*lynxListFor` |
| -------------------------------------------------------------------- | ------------ | -------------- |
| Rows built at launch                                                 | 1,000        | 14             |
| Rows built after flinging to the last row                            | 1,000        | 19–28          |
| App component created → list's first `bindlayoutcomplete` (5–6 runs) | 726–1,164 ms | 39–87 ms       |
| Explorer's memory footprint with the list shown (`footprint`)        | 307 MB       | 92–93 MB       |
| The same after flinging to the last row                              | 560–745 MB   | 110–114 MB     |
| componentAtIndex per call while flinging, average                    | 5.3–9.1 ms   | 3.8–9.5 ms     |
| … of which the item's `__FlushElementTree` (instrumented runs)       | 9.0 ms       | 4.4–8.4 ms     |
| … calls over 16 ms, of ~1,000 (instrumented runs)                    | 76           | 37–45          |

The native flush of the item is most of componentAtIndex's cost either way; checking a reused row's view (`detectChanges()`) adds 0.7–1 ms on the simulator. Both modes have the odd call of several hundred ms, all of it inside the native flush. A recording of 12 flings (`simctl io recordVideo`) shows the same frame pacing for both, 56–57 changed frames a second while the list moves, with the recorder's own noise bigger than any difference.

The example switches between the two and counts the rows built.

## The tick after a bind: no walk from the root, and no flush for an item's own writes (2026-11-28, #877)

After componentAtIndex binds a `*lynxListFor` row, Angular has a tick scheduled. The row's check sets its child component's signal input, which marks the child for check and, through `markAncestorsForTraversal`, every view above the row up to the root, and notifies the scheduler. The tick then walked down from the root along those marks to find the row checked already, ran `begin()`/`end()` and the after-render hooks, and `end()` flushed the whole tree, since the row's writes counted as unflushed.

- **The row is checked out of change detection.** `ListItemViews.bind()` detaches the view, calls `detectChanges()`, then reattaches it, so the marks stop at the view: Angular's walk breaks at a view that isn't attached. `reattach()` notifies the scheduler, so a tick still follows every bind, as it did after most of them. It refreshes no view, and calls `begin()`/`end()` once (`synchronizeOnce`'s `!ranDetectChanges` branch). A rebind whose check throws leaves the view as it was: attached, or out of change detection if its item was gone.
- **A bind's writes inside its item count as flushed by the item's flush.** While a list item is bound (`bindListItemElement`, around `bindListItem`), each write a `LynxElement` counts notes where it is (`#noteBindingWrite`): it walks up from the element through `#jsParent` (or `_virtualParent`) to the `<list-item>` the run named (`setBoundListItem`). The walk also stops, as inside, at an element in no tree yet (`#jsParent` undefined: the view the run is building), since the insert that places it is itself a write to the new parent. A walk that reaches the page, or an element whose place the runtime doesn't know (`#jsParent` null), counts as outside, and so does any write counted without an element: `scheduleSettleFlush()`'s other callers (a page's color scheme or safe area, a gesture, a layout read) and a main-thread script's animation (`countNativeWrite`). An insert also checks the parent the child is moved from. Writes waiting from before the bind count too, unless the last bind left them (the next item of a batch). After componentAtIndex's flush, `settleAfterListItems()` marks the tree flushed if nothing was outside; otherwise it leaves it for the next cycle and the next event, as before. The note (`itemsLeftWork`) stays until a flush of the whole tree, so an item built inside another's flush doesn't mark the outer one's work flushed.

Measured under `node --jitless` against `list-for.test.ts`'s fake list, Angular in production mode, with a PokemonItem-like row (an `@if`/`@for` of type dots, a heart child, both with inputs that set signals), a 10-row window, 8,000 binds and `appRef.tick()` after each, three rounds alternating:

|                                  | Before       | After        |
| -------------------------------- | ------------ | ------------ |
| Bind (componentAtIndex), per row | 75.5–78.2 µs | 77.3–84.2 µs |
| The tick after it                | 13.5–14.1 µs | 10.9–11.9 µs |
| Whole-tree flushes per bind      | 1.00         | 0            |

What's left of the tick is Angular's: its scheduler and `afterTick` subscribers, and `end()`'s commit passes with nothing to commit. A row whose check marks nothing (no child components) used to schedule no tick, and now gets one from its `reattach()`, with nothing to flush. The fake flushes cost nothing here, so the table shows none of the native flush's cost; #871 found empty flushes too cheap for the simulator to tell apart.

## No flush for a cycle that wrote nothing (2026-11-28, #856)

Angular ends as many change detection cycles that change nothing as ones that do. A tick that refreshes no view still calls the renderer's `begin()` and `end()` (`synchronizeOnce`'s `!ranDetectChanges` branch), and one runs after most `*lynxListFor` binds: a reused row whose `@if` lets go of a view makes Angular's `detachViewFromDOM` notify the scheduler. `end()` flushed the whole tree every time. In the benchmark Pokédex (iOS Simulator, 5 swipes) a probe counted 38 rows bound, 38 detail responses, about 86 ticks and about 86 cycles that wrote nothing, each with its flush.

`end()` now flushes only when something was written since the last flush of the whole tree, a list has an `update-list-info` to send, or a call waits for a flush (`needsTreeFlush()`, `hasPendingListUpdates()`). For that, `nativeWriteEpoch` counts every write: the ones that leave their flush to their caller, as before, and the ones that call `scheduleSettleFlush()`, which now counts itself. `markTreeFlushed()` also clears `settleSkippedForListItem`, since a whole-tree flush carries whatever a list item left. What componentAtIndex wrote still counts: the items' flushes commit the items only, and a bind can write outside its item (a directive reaching another element, an overlay it opens), so the cycle after a bind still flushes the tree. Telling an item's writes from the others would take a walk up from each element written to, on every bind (#871's review). #877 does that walk, below.

Empty flushes turned out cheap: skipping them made no difference to CPU per swipe that the simulator could measure. Most of what AngularLynx's engine thread did beyond ReactLynx's was the rows fetching their details as they were bound, a tick, flush and layout per response while the list scrolled, where ReactLynx fetches a page's details when it arrives. The benchmark app now does that too (`benchmarks/apps/angular-lynx`): about 850M instructions per swipe went down to about 690M, against ReactLynx's 460M. What's left is mostly Angular checking each bound row on the main thread.

## One flush for every list a cycle changes (2026-11-16)

`LynxRendererFactory2.end()` used to flush the tree, then each list the cycle changed set its `update-list-info` and flushed from the root with `triggerLayout`: N + 1 whole-tree flushes for N lists. Outside a cycle, the settle flush came first and then a flush per list. Each one is a native patch pass (resolve, `FinishTasmOperation`, layout) that also queues UI-thread work.

Now the lists send their `update-list-info` (and their callbacks) right before the one flush (`flushTreeWithListUpdates()`, `lynx-element/list-updates.ts`), as React Lynx does: `updateMainThread.ts` and `renderPage` call `__pendingListUpdates.flush()`, which only sets each list's attribute, then make one `__FlushElementTree(__page, flushOptions)`. The settle flush carries lists changed outside a cycle (a lazy route's static `<list-item>`s); lists changed in one task outside a cycle with no settle flush share one microtask's flush; the lists the first render changes wait for it, as before, and then share one flush.

- **Why one flush does what the N + 1 did.** Native resolves everything dirty from the root first, the lists' `update-list-info` included, then lays out once; each list asks for its items in that layout. componentAtIndex appends an item and flushes it with the operation id, which is what commits the item's subtree: until then the item isn't in the page's tree, and a root flush walks only the tree (`Element::FlushActionsAsRoot`), so the bare flush before never committed it. A flush with no options lays out by default (`trigger_layout_ = true`, `core/public/pipeline_option.h`), but inside a pipeline context it takes that context's options (`renderer_functions.cc`, `FiberFlushElementTree`); the merged flush passes `{ triggerLayout: true }` when lists were sent, as theirs did.
- **Unchanged:** no flush while a `*lynxListFor` item is being built (`bindListItem`), never an empty `update-list-info`, and the UI method calls waiting for a flush run after it, once lists have their items.
- **A list that throws** while its update is sent (native refusing its `update-list-info`) doesn't cost the flush: the other lists are sent, the flush is made, the calls waiting for it run, and then the first error is thrown. Before, `end()`'s bare flush had already gone out by then.
- **A UI method on a list, in the cycle that changes the list, now reaches it after the list's new items.** `invoke()` calls `__InvokeUIMethod` at once, and with pending invokes native keeps the call until the element's next flush, where it runs after the element's props (`FlushPendingInvokeTasks`, `fiber_element.cc`). The bare flush used to be that flush, so a `scrollToPosition` from a view effect (a chat scrolling to its newest row) reached the list while it still had its old items, and the update came with the next flush. Now the call and the `update-list-info` go in the same flush, the call after: React Lynx's order, and what an app means. `list-update-flush.test.ts` pins it.
- **A list made and filled in one cycle** goes out in the same flush that makes it, as React Lynx's first screen does. The crash `list-item.md` once blamed on that (H1, H2) was the `WeakSet` keyed on element refs, fixed since; the probe below made and filled two lists in one cycle on iOS without a problem.

Measured with a probe app on the iOS Simulator (Lynx Explorer 4.1, iPhone 18 Pro, iOS 27), which wrapped `__FlushElementTree` to count the calls with no element (whole tree) and time them. Screen: a `*lynxListFor` list, an `@for` list, and a `*lynxListFor` list whose items each hold a horizontal `@for` list; a step adds a row to the three lists and a chip to every nested list. The Mac was heavily loaded (load average 30–44), so the times are ranges:

|                                                                        | Before            | After                            |
| ---------------------------------------------------------------------- | ----------------- | -------------------------------- |
| Whole-tree flushes, one step (3 lists + 3 nested lists shown)          | 7 (6 with layout) | 1                                |
| Two lists made and filled in one cycle (`@if`)                         | 3 (2 with layout) | 1                                |
| Navigating to a lazy route with two lists (static + `@for`)            | 8 (6 with layout) | 2 (the settle flush, the tick's) |
| A row added to both of its lists                                       | 3 (2 with layout) | 1                                |
| 30 steps in a row with `ApplicationRef.tick()`, per step (6 runs each) | 12.3–29.2 ms      | 8.1–12.7 ms (one run 32 ms)      |

Rows appeared, scrolled and updated the same before and after, on iOS and in the web preview (where Lynx for Web asks for items in a microtask after `update-list-info`, whatever the flushes). `end()` itself costs the same JS either way: under `node --jitless` against fake native functions, a cycle changing 2–4 lists ran within noise of before, with K + 1 flushes down to 1.

## Problem

`x-list` in `elements-showcase.component.ts` crashes when the Layout Elements Section loads:

```html
<x-list class="mini-list">
  @for (i of [1, 2, 3]; track i) {
  <list-item class="list-item">
    <x-text>List Item {{ i }}</x-text>
  </list-item>
  }
</x-list>
```

The `list-example` component also has its x-list commented out — it has never worked.

## Current Implementation

### Architecture

Lynx's native `x-list` is a **virtualized list** driven by engine callbacks, not a simple container. It works fundamentally differently from web DOM:

1. **Native engine calls `componentAtIndex(listRef, listId, cellIndex, opId)`** to request the element ID at a given index
2. **`update-list-info` attribute** tells the engine which indices exist (insertAction/removeAction/updateAction)
3. **`enqueueComponent`** signals items scrolled off-screen (recycling — currently disabled)

### How Angular's `LynxListElement` bridges this

Since Angular's `Renderer2` uses normal `appendChild()` / `insertBefore()`, `LynxListElement` intercepts these calls:

1. `appendChild()` → adds child to a **JS-level virtual linked list** (not the native tree)
2. `_scheduleUpdate()` → batches via `setTimeout(0)`, then:
   - Filters out Angular comment nodes (from `@for`/`@if`)
   - Sets `item-key` attribute on each list-item
   - Pre-appends children to the native list tree via `__AppendElement`
   - Sets `update-list-info` with `insertAction` array
   - Calls `__FlushElementTree()`
3. `componentAtIndex` → returns `__GetElementUniqueID(uiChildren[cellIndex])`

### Key files

| File                                                       | Role                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `packages/runtime/src/lib/lynx-document.ts` (lines 59–118) | Creates native list, registers callbacks, sets config |
| `packages/runtime/src/lib/lynx-element.ts` (lines 201–353) | `LynxListElement` — virtual tree, batching, flush     |
| `packages/runtime/src/lib/types/lynx.ts` (lines 109–123)   | `__CreateList` type signature                         |

## Fixes Already Applied (didn't resolve crash)

### 1. Added `type` field to `insertAction`

The React Lynx reference always includes a `type` (reuse-identifier) in each insertAction entry. Added `type: '__angular_list_item'` to match.

### 2. Set required `list-type` and `span-count` attributes

Lynx docs state these are required on x-list. Added defaults: `list-type="single"`, `span-count=1`.

## Remaining Hypotheses

### H1: `__FlushElementTree()` needs list-specific arguments

Current code calls `__FlushElementTree()` with no arguments. But the type signature shows:

```typescript
function __FlushElementTree(
  element?: ElementRef,
  options?: {
    triggerLayout?: boolean;
    operationID?: number;
    elementID?: number;
    listID?: number;
    // ...
  },
): void;
```

The React Lynx reference calls it with the **list element** and `{ listID, elementID, operationID, triggerLayout: true }`. Without `listID`, the native engine may not know this flush is list-related and may skip calling `componentAtIndex`.

**Potential fix:**

```typescript
const listId = __GetElementUniqueID(this.element);
__FlushElementTree(this.element, {
  triggerLayout: true,
  listID: listId,
});
```

### H2: Pre-appending children before `update-list-info` causes the issue

The current flow:

1. `__AppendElement(list, child)` for each child
2. `__SetAttribute(list, 'update-list-info', {...})`
3. `__FlushElementTree()`

But the React Lynx reference does it differently inside `componentAtIndex`:

1. Appends child to list
2. Calls `__FlushElementTree(child, { listID, ... })`

The native engine might not support pre-appending all children before the flush. It may expect children to be appended **during** `componentAtIndex` (one at a time, per-item flush).

**Potential fix:** Instead of pre-appending, do the append + flush inside `componentAtIndex`:

```typescript
const componentAtIndex = (listRef, listId, cellIndex, opId) => {
  const uiChildren = listEl.getUIChildren();
  if (cellIndex < uiChildren.length) {
    const child = uiChildren[cellIndex];
    if (!listEl.isAppendedToNative(child)) {
      __AppendElement(listEl.element, child);
      listEl.markAppendedToNative(child);
      __FlushElementTree(child, {
        triggerLayout: true,
        operationID: opId,
        elementID: __GetElementUniqueID(child),
        listID: listId,
      });
    }
    return __GetElementUniqueID(child);
  }
  return undefined;
};
```

**Risk:** The existing code comments warn that calling `__AppendElement` or `__FlushElementTree` inside `componentAtIndex` is "re-entrant and crashes on device." However, this is exactly what the React Lynx reference does. The previous crash may have been from calling `__FlushElementTree()` without arguments (full tree flush) inside the callback, rather than flushing just the child element.

### H3: `update-list-info` format is wrong

The exact format expected might differ from what we send. Current:

```json
{
  "insertAction": [
    { "position": 0, "type": "__angular_list_item", "item-key": "123" }
  ],
  "removeAction": [],
  "updateAction": []
}
```

Possible issues:

- Maybe the value needs to be a JSON **string**, not an object
- Maybe `position` should be string type
- Maybe additional fields are needed (e.g., `estimatedMainAxisSizePx`)

### H4: `setTimeout(0)` timing issue in Lynx runtime

Lynx's JS runtime may not support standard `setTimeout` semantics. The batching approach relies on `setTimeout(0)` firing after Angular's synchronous render completes. If Lynx's runtime executes `setTimeout(0)` callbacks differently (or the native list attempts to render before the callback fires), children won't be ready.

**Potential fix:** Use `queueMicrotask()` instead (fires sooner, before any native layout pass):

```typescript
queueMicrotask(() => {
  /* ... */
});
```

Or use `Promise.resolve().then(...)`.

### H5: The native list needs explicit height on list-items

The CSS sets `.mini-list { height: 120px }` but list-items only have `padding: 8px`. If the native engine needs `estimated-main-axis-size-px` on each `list-item` element (not just `estimatedItemSize` on the list config), items may have zero height causing layout failures.

## Fixes Applied

### Round 2 — Root causes from Lynx docs + React Lynx reference

After reading the official Lynx docs ([`lynx-website/docs/en/api/elements/built-in/list.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/api/elements/built-in/list.mdx)) and confirming against the React Lynx codebase:

1. **Missing required `scroll-orientation` attribute** — The Lynx docs mark `scroll-orientation` as Required on `<list>`. We only set `list-type` and `span-count`. Added `scroll-orientation: "vertical"` default.

2. **Removed invalid `__SetConfig()` call** — `recycleEnabled`, `estimatedItemSize`, `overscrollEnabled` are NOT valid list config properties. React Lynx never uses `__SetConfig` for lists (confirmed via grep). Removed entirely.

3. **Fixed `__FlushElementTree()` call** (H1) — Replaced bare `__FlushElementTree()` with `__FlushElementTree(this.element, { triggerLayout: true, listID })`. React Lynx always passes element + list-specific options. The bare call flushed the entire page causing re-entrant crashes when `componentAtIndex` did its own per-item flush.

4. **Added `recyclable: false`** on each list-item — Since we don't implement recycling in `enqueueComponent`, tell the native engine not to recycle items.

## Next Steps (if still crashing)

1. **Try `queueMicrotask`** instead of `setTimeout(0)` — more predictable timing in Lynx runtime.
2. **Add `estimated-main-axis-size-px`** on each list-item — Lynx docs say "strongly recommended".
3. **Add on-screen debug logging** to see which stage fails.

## Reference: React Lynx approach (production-proven)

[`lynx-stack/packages/react/runtime/src/snapshot/snapshot/list.ts`](https://github.com/lynx-family/lynx-stack/blob/main/packages/react/runtime/src/snapshot/snapshot/list.ts)

React Lynx renders items **lazily inside `componentAtIndex`**:

1. `componentAtIndex(cellIndex)` is called by native engine
2. It calls `ensureElements()` to render the component tree for that item
3. Calls `__AppendElement(list, root)` to attach item to list
4. Calls `__FlushElementTree(root, { triggerLayout: true, operationID, elementID, listID })`
5. Returns `__GetElementUniqueID(root)`

Key difference: React never pre-appends all children. It renders on-demand per `componentAtIndex` call. The `update-list-info` insertAction tells the engine _how many_ items exist, then the engine calls `componentAtIndex` for each visible index.
