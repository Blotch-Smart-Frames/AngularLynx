# x-list Crash Investigation — All Attempts

**Status:** Unresolved — no crash, but `componentAtIndex` is never called and items never render

## Problem

`x-list` in `elements-showcase.component.ts` crashes the app to the home screen whenever `__FlushElementTree()` processes a list that has `update-list-info` set.

## Working State (baseline)

After initial fixes (adding `scroll-orientation`, removing invalid `__SetConfig`), the app **did not crash** but list items **did not show**. In this state:

- `_scheduleUpdate()` used `setTimeout(0)` and called `__FlushElementTree(this.element, { triggerLayout: true, listID })` (targeted flush on list element)
- The targeted flush did NOT trigger `componentAtIndex` (items never rendered)
- The bare `__FlushElementTree()` in `end()` ran first (before setTimeout), with no `update-list-info` set yet — so no crash

**Key insight:** The crash occurs specifically when a bare `__FlushElementTree()` (or page-level flush) processes a list element that has `update-list-info` set.

---

## Attempt 1: Bare `__FlushElementTree()` in setTimeout

**Change:** Replaced targeted flush with bare `__FlushElementTree()` in `_scheduleUpdate()`'s setTimeout callback.

**Result:** CRASH to home screen.

**Why:** Bare flush processes `update-list-info`, triggers `componentAtIndex`. Either the setTimeout context is invalid for flushing, or `componentAtIndex` does something that crashes.

---

## Attempt 2: Pre-append children + bare `__FlushElementTree()` in setTimeout

**Change:** Pre-append all children to native list tree via `__AppendElement` before setting `update-list-info`. Simplified `componentAtIndex` to just return element IDs (no append, no flush inside callback).

**Result:** CRASH to home screen.

**Why:** Still calling bare `__FlushElementTree()` from setTimeout. The crash occurs regardless of what `componentAtIndex` does.

---

## Attempt 3: Move to `end()` lifecycle — pre-append + bare flush

**Change:** Eliminated setTimeout entirely. Created `processPendingListUpdates()` called from `LynxRendererFactory2.end()` before `__FlushElementTree()`. The flow:

1. `_scheduleUpdate()` adds list to a module-level `Set<LynxListElement>`
2. `end()` drains the set, calling `_processUpdate()` on each list
3. `_processUpdate()` pre-appends children + sets `update-list-info`
4. `end()` calls `__FlushElementTree()` (bare)

`componentAtIndex` just returns element IDs (no append, no flush).

**Result:** CRASH to home screen.

**Why:** Pre-appending children via `__AppendElement` on a list element may be invalid — the native list might expect children to be appended only inside `componentAtIndex`.

---

## Attempt 4: React Lynx pattern — append + per-item flush inside componentAtIndex

**Change:** Removed pre-append from `_processUpdate()`. Moved append + flush into `componentAtIndex`:

```typescript
const componentAtIndex = (_listRef, listId, cellIndex, opId) => {
  const uiChildren = listEl.getUIChildren();
  if (cellIndex < uiChildren.length) {
    const child = uiChildren[cellIndex];
    listEl.appendChildToNativeList(child);
    const elementID = __GetElementUniqueID(child);
    __FlushElementTree(child, {
      triggerLayout: true,
      operationID: opId,
      elementID,
      listID: listId,
    });
    return elementID;
  }
  return undefined;
};
```

This matches React Lynx exactly (append child, per-item flush with list-specific options, return ID).

**Result:** CRASH to home screen.

**Why:** The nested `__FlushElementTree(child, {...})` inside `componentAtIndex` (triggered by the outer `__FlushElementTree()` from `end()`) is a re-entrant flush. Even though React Lynx does this, something about our setup is different.

---

## Attempt 5: Fixed width + height on x-list CSS

**Change:** Added `width: 100%` to `.mini-list` (which already had `height: 120px`). Lynx docs state: "The width and height of `<list>` represent the size of its viewport, so they need to be fixed values and cannot be expanded by internal content."

**Result:** CRASH to home screen.

**Why:** Width/height alone doesn't fix the underlying issue with `update-list-info` + flush.

---

## Current State of Code

### `lynx-element.ts` — LynxListElement

- Module-level `Set<LynxListElement>` for pending updates
- `processPendingListUpdates()` exported, called from renderer factory `end()`
- `_scheduleUpdate()` just adds `this` to the set (no setTimeout)
- `_processUpdate()` sets `item-key` + `recyclable` on children, sets `update-list-info` (no pre-append)
- `componentAtIndex` in `lynx-document.ts` does append + per-item flush

### `lynx-renderer-factory2.ts`

```typescript
end?(): void {
  if (__MAIN_THREAD__) {
    processPendingListUpdates();
    __FlushElementTree();
  }
}
```

### `lynx-document.ts` — x-list creation

- `__CreateList(pageId, componentAtIndex, enqueueComponent)`
- Sets `list-type: 'single'`, `span-count: 1`, `scroll-orientation: 'vertical'`
- `componentAtIndex`: appends child + per-item flush + returns ID

---

## What We Know For Certain

1. **The crash is native-level** (app closes to home screen, not a JS error)
2. **The crash is triggered by `__FlushElementTree()` processing a list with `update-list-info` set**
3. **A targeted flush `__FlushElementTree(this.element, { triggerLayout: true, listID })` does NOT crash** — but also doesn't render items
4. **The crash happens regardless of:**
   - Whether it's called from setTimeout or synchronous `end()` context
   - Whether children are pre-appended or appended inside componentAtIndex
   - Whether componentAtIndex does work (append + flush) or just returns an ID
   - Whether the list has explicit width/height CSS or not
5. **React Lynx pattern (append + per-item flush in componentAtIndex) also crashes in our setup**

---

## Remaining Hypotheses

### H1: `update-list-info` format is wrong

Our format:

```json
{
  "insertAction": [
    { "position": 0, "type": "__angular_list_item", "item-key": "123" }
  ],
  "removeAction": [],
  "updateAction": []
}
```

React Lynx test example format:

```json
{
  "insertAction": [
    { "position": 0, "type": "__Card__:__snapshot_f75b7_test_2", "item-key": 0 }
  ],
  "removeAction": [],
  "updateAction": []
}
```

Differences:

- React Lynx uses numeric `item-key` (0, 1, 2), we use string (`"123"`)
- React Lynx `type` is more specific, ours is generic
- Maybe additional fields are required (e.g., `estimated-main-axis-size-px`)

### H2: `__FlushElementTree()` with no arguments doesn't support list processing

Maybe bare `__FlushElementTree()` doesn't handle lists. React Lynx calls `__FlushElementTree(__page, flushOptions)` with the page element. Our `end()` calls it with no arguments.

**Potential fix:** Pass the page element to `__FlushElementTree`:

```typescript
__FlushElementTree(this.lynxDocument.page.element);
```

### H3: Need `__UpdateListCallbacks()` before flush

React Lynx calls `__UpdateListCallbacks(listElement, componentAtIndex, enqueueComponent)` in its `listUpdateInfo.flush()` method — re-registering callbacks before each flush cycle. We only register callbacks once during `__CreateList()`. Maybe the native engine invalidates callbacks after processing them.

### H4: The list element isn't fully attached to the page tree when flush happens

If the list is created and `update-list-info` is set before the list's parent chain is connected to the page element, the flush might crash trying to traverse an incomplete tree.

### H5: `list-item` elements created via `__CreateElement('list-item', pageId)` might be wrong

Maybe list-items need to be created differently, or need specific attributes before being used with update-list-info.

### H6: Timing — update-list-info must be set in a specific lifecycle phase

React Lynx sets `update-list-info` during `__pendingListUpdates.flush()` which is called from `updateMainThread()` (a native-initiated callback). Maybe it can only be set from within a native callback context, not from Angular's synchronous rendering.

---

## Attempt 6: Fix update-list-info format (array wrap) + \_\_UpdateListCallbacks before flush

**Changes:**

- Wrapped `update-list-info` value in an array: `[{ insertAction, removeAction, updateAction }]` instead of plain object
- Called `__UpdateListCallbacks(element, componentAtIndex, enqueueComponent)` after setting `update-list-info` (matching React Lynx `listUpdateInfo.ts flush()`)
- Changed `__FlushElementTree()` (bare) → `__FlushElementTree(page.element)` in `end()`

**Result:** No longer crashes. But nothing renders.

**Why:** The array format fixed the crash (native expects `[...]` not `{...}`). Passing page element to `__FlushElementTree` matched React Lynx pattern. But items still don't appear.

---

## Attempt 7: Add componentAtIndexes (batch callback) + microtask timing fix

**Observation via on-screen debug logging:**

- `_processUpdate` does NOT run on first page load — only after navigating away and back
- `componentAtIndex` is **never called** by the native engine even when `_processUpdate` does run

**Root causes identified:**

1. `__CreateList` is missing the 5th arg (`componentAtIndexes`) and 4th arg (`info: {}`). React Lynx always passes `{}, componentAtIndexes` — the engine may require the batch callback to activate list processing.
2. `__UpdateListCallbacks` was missing its 4th arg (`componentAtIndexes`). React Lynx passes all 4 args.
3. First-render timing gap: list items are created during lazy route loading, after the initial `end()` fires. The `pendingListUpdates` set is populated but `end()` never fires again to drain it — causing `_processUpdate` to not run until next navigation.

**Changes:**

- Added `componentAtIndexes` batch callback (iterates cellIndexes, delegates to `componentAtIndex`)
- Passed `{}` + `componentAtIndexes` as 4th/5th args to `__CreateList`
- Passed `componentAtIndexes` as 4th arg to `__UpdateListCallbacks`
- Added `queueMicrotask` fallback in `_scheduleUpdate`: if `end()` doesn't drain `pendingListUpdates`, the microtask calls `processPendingListUpdates()` + `__FlushElementTree(page.element)`

**Result:** Still nothing renders.

**Why:** Unknown. `componentAtIndex` is still not being called by the native engine despite all the above changes. The engine receives `update-list-info` with insertActions but doesn't trigger the callbacks.

---

## What We Know For Certain (updated)

1. **The crash is fixed** by wrapping `update-list-info` in an array
2. **`_processUpdate` runs correctly** — it sees the right number of children and sets `update-list-info`
3. **`componentAtIndex` is never called** — the native engine processes `update-list-info` but doesn't invoke the registered callback
4. This holds even after: providing `componentAtIndexes`, re-registering via `__UpdateListCallbacks` before every flush, passing the page element to `__FlushElementTree`

---

## Remaining Hypotheses

### H1: `update-list-info` format is wrong (still)

Our format:

```json
[
  {
    "insertAction": [
      { "position": 0, "type": "__angular_list_item", "item-key": "123" }
    ],
    "removeAction": [],
    "updateAction": []
  }
]
```

React Lynx test example format:

```json
[
  {
    "insertAction": [
      { "position": 0, "type": "__snapshot_f75b7_test_2", "item-key": 0 }
    ],
    "removeAction": [],
    "updateAction": []
  }
]
```

Differences still present:

- React Lynx uses **numeric** `item-key` (0, 1, 2), we use string (`"123"`)
- React Lynx `type` matches the snapshot class name, ours is generic `"__angular_list_item"`

### H2: `removeAction` format is wrong

Our `removeAction` is `[]`. React Lynx's `removeAction` is `number[]` (indices). Possibly the engine expects the array type to differ between initial vs incremental updates.

### H3: list-item elements don't exist in the native tree when flush happens

`componentAtIndex` appends the child via `__AppendElement` — but the child has never been attached to the page tree before this. The engine might require list-items to already exist in the native tree (not just in our JS-level virtual linked list) before processing `update-list-info`.

### H4: Timing — flush happens before update-list-info is seen

The microtask from `_scheduleUpdate` fires before `end()`. But Angular's `end()` also calls `processPendingListUpdates()`. Both set `update-list-info` then call `__FlushElementTree(page)`. Could double-flush be interfering?

### H5: `__FlushElementTree(page.element)` with no options isn't enough

React Lynx passes `__FlushElementTree(__page, options)` where `options` comes from the native `renderPage`/`updatePage` call (contains pipeline info). Our bare call with just the page element may not carry the required metadata for list processing.

### H6: Need `triggerLayout: true` in the page-level flush

React Lynx's per-item flush uses `{ triggerLayout: true }`. Maybe the page-level flush also needs this option to process lists.

---

## Attempt 8: Numeric item-key + triggerLayout + targeted list flush + componentAtIndexes

**Changes (all combined):**

- Changed `item-key` to numeric (`__GetElementUniqueID(child)` number, not string)
- Added `{ triggerLayout: true }` to both page-level flush and microtask flush
- Added targeted flush `__FlushElementTree(listElement, { triggerLayout: true, listID })` at the end of `_processUpdate()`
- Added `componentAtIndexes` as 4th arg to `__UpdateListCallbacks` (already from Attempt 7)

**Result:** No crash. `componentAtIndex` still never called. `cAI:` never appears in debug log.

---

## Attempt 9: Pre-append children before update-list-info

**Change:** Called `this.appendChildToNativeList(child)` for each child inside `_processUpdate()` before setting `update-list-info`, so children exist in the native list tree when the engine processes the list.

`componentAtIndex` simplified to just flush + return ID (no append).

**Result:** CRASH to home screen.

**Why:** `__AppendElement` on a native list element is invalid outside the `componentAtIndex` callback context. The native list engine only allows children to be appended from within `componentAtIndex`.

---

## Attempt 10: estimated-main-axis-size-px in insertAction

**Hypothesis:** The engine calls `componentAtIndex` only for visible items. Without `estimated-main-axis-size-px`, the engine assumes 0px height per item, so nothing is "in the viewport" and `componentAtIndex` is never called.

**Change:** Added `'estimated-main-axis-size-px': __GetAttributeByName(child, 'estimated-main-axis-size-px') ?? 50` to each insertAction entry.

Also removed `__SetAttribute(child, 'item-key', ...)` from the loop (React Lynx doesn't set platform-info attrs via `__SetAttribute` on the element — they go into insertAction only).

**Result:** No crash. `componentAtIndex` still never called.

---

## Attempt 11: Re-added per-item flush inside componentAtIndex

**Hypothesis:** `componentAtIndex` IS being called asynchronously (after Angular render), but items don't appear because the child is appended without being flushed.

**Change:** Re-added `__FlushElementTree(child, { triggerLayout: true, operationID: opId, elementID, listID: listId })` inside `componentAtIndex`.

**Result:** No crash. No items. `cAI:` still never appears.

**Note:** The original crash in Attempt 4 was likely due to the wrong `update-list-info` format (plain object), not the nested flush. With correct array format, nested flush doesn't crash. But `componentAtIndex` still isn't called.

---

## Attempt 12: \_\_CreateList with 4 args (no info object, componentAtIndexes as 4th)

**Hypothesis:** The test mock signature for `__CreateList` is 4 args: `(pageId, componentAtIndex, enqueueComponent, componentAtIndexes)` — no `info` object. The real native engine may match the test mock. By passing `{}` as 4th arg, `componentAtIndexes` lands in the wrong position and is never registered.

**Change:**

```typescript
// Before:
__CreateList(
  pageId,
  componentAtIndex,
  enqueueComponent,
  {},
  componentAtIndexes,
);
// After:
__CreateList(
  pageId,
  componentAtIndex,
  enqueueComponent,
  componentAtIndexes as any,
);
```

**Result:** No crash. `componentAtIndex` and `componentAtIndexes` still never called. `cAI:` and `cAIbatch:` never appear.

---

## Current State of Code

### `lynx-document.ts`

- `__CreateList(pageId, componentAtIndex, enqueueComponent, componentAtIndexes)` — 4 args
- `componentAtIndex`: appends child + per-item flush + returns ID
- `componentAtIndexes`: logs `cAIbatch:`, iterates and calls `componentAtIndex`

### `lynx-element.ts`

- `_processUpdate()`: sets `item-key` (numeric) + `estimated-main-axis-size-px: 50` in insertAction; `update-list-info` is `[{insertAction, removeAction: [], updateAction: []}]`
- `__UpdateListCallbacks(element, componentAtIndex, enqueueComponent, componentAtIndexes)` — 4 args
- `_scheduleUpdate()`: adds to `pendingListUpdates` + queues `queueMicrotask` fallback

### `lynx-renderer-factory2.ts`

- `end()`: calls `processPendingListUpdates()` then bare `__FlushElementTree()`

---

---

## KEY FINDING: update-list-info must be a PLAIN OBJECT, not an array

**The test mock misled us.** The mock does `(e.props[key] ??= []).push(value)` — it auto-wraps each `__SetAttribute` call into an accumulating array. So when React Lynx passes a plain object, the mock stores `[plainObject]` which looks like an array format.

**The real native engine expects a plain object directly:**

```json
{"insertAction": [...], "removeAction": [], "updateAction": []}
```

NOT wrapped in `[...]`.

Wrapping in an array (our Attempts 6–12) stopped the crash but also stopped the engine from calling `componentAtIndex` — it silently processed the outer array as "no operations".

---

## Attempt 13: Plain object update-list-info + componentAtIndex without nested flush

**Change:** Removed the array wrapper — `update-list-info` is now a plain object. `componentAtIndex` appends child (via stored `listEl.element`) but does NOT call nested `__FlushElementTree`.

**Result:** `componentAtIndex` IS called! Debug shows `cAI:cell=0`, `cAI:cell=1`, `cAI:cell=2`. **App crashes ~50% of the time.**

**Why the crash:** Either `__AppendElement(_listRef, child)` is crashing (flaky), or the missing per-item flush leaves the engine in an inconsistent state.

---

## Attempt 14: Use `_listRef` for append + add per-item flush back

**Hypothesis:**

1. We should use `_listRef` (engine-provided first arg to `componentAtIndex`) for the append, not the stored `listEl.element` — React Lynx always uses the engine-provided ref.
2. The per-item `__FlushElementTree(child, { triggerLayout: true, operationID: opId, elementID, listID })` is required. The original crash in Attempt 4 was due to the array format, not the nested flush itself.

**Changes:**

- `componentAtIndex` uses `__AppendElement(_listRef, child)` instead of `__AppendElement(listEl.element, child)`
- Per-item flush restored: `__FlushElementTree(child, { triggerLayout: true, operationID: opId, elementID, listID: listId })`
- Added `isAppendedToNativeList()` + `markAppendedToNativeList()` helpers to `LynxListElement`

**Result:** Crash ~50% of the time. Same as Attempt 13. Per-item flush does NOT cause the crash (Attempt 13 crashed without it too).

---

## Attempt 15: Full rewrite matching React/Vue Lynx architecture

**Changes:**

- Rewrote `create-list-element.ts` and `lynx-list-element.ts` from scratch
- Synchronous flush in `componentAtIndex` (matching React/Vue Lynx)
- Diff-based `update-list-info` (tracks `_committedUIChildren`, computes insert/remove delta)
- `asyncFlush` support in `componentAtIndexes`
- Changed `__CreateList` to 5-arg form (`pageId, componentAtIndex, enqueueComponent, {}, componentAtIndexes`)
- Removed `__dbg` debug logging
- Removed dead code (`setPageElement`, `appendChildToNativeList`)

**Result:** CRASH. Same ~50% intermittent pattern.

---

## Attempt 16: Match Vue Lynx more closely

**Changes:**

- Removed `__UpdateListCallbacks` from `_processUpdate()` (Vue registers callbacks once at creation, never re-registers)
- Removed programmatic default attributes (`list-type`, `span-count`, `scroll-orientation`) from `createListElement()` — Vue sets these via template bindings
- Added `list-type="single" span-count="1" scroll-orientation="vertical"` to demo template
- Changed insertAction `type` from `'__angular_list_item'` to `'list-item'` (matching Vue and the actual native element type)

**Result:** CRASH. Same pattern.

---

## Attempt 17: Diagnostic build — isolate crash point

**Changes:**

- Split `end()` into two flushes: `__FlushElementTree()` → `processPendingListUpdates()` → `__FlushElementTree()`
  - Flush 1 renders all UI (debug text visible) before list processing
  - Flush 2 processes list updates (may crash)
- Made list items conditional: `showItems = false` by default, toggle button to enable
- Added `__dbg` breadcrumbs at: list creation, `_processUpdate`, `componentAtIndex` entry/append/flush

**Result:** KEY DIAGNOSTIC FINDINGS:

```
Debug text on load (showItems=false):
  pre-createList
  post-createList
  procUpd
  kids:new=0,old=0
  setULI:ins=0,rem=0
  ULI-set
```

1. **Empty list does NOT crash** — list creation + empty update-list-info + flush all succeed
2. **Toggle items ON crashes intermittently** (~50%) — going from 0 to 3 items
3. **Add item does NOT crash** — going from 3 to 4 items (incremental, after successful toggle)
4. **When toggle doesn't crash, items sometimes don't render** (depends on flush approach)
5. **`componentAtIndex` breadcrumbs never visible** — because they're written after Flush 1 renders the debug text, and Flush 2 crashes before the next CD cycle

---

## Attempt 18: Remove per-item flush from componentAtIndex entirely

**Hypothesis:** The re-entrant `__FlushElementTree(child, {...})` inside `componentAtIndex` (called during outer `__FlushElementTree()`) crashes the engine.

**Changes:**

- `componentAtIndex` only does `__AppendElement(listRef, child)` + returns `__GetElementUniqueID(child)`
- NO `__FlushElementTree` call inside `componentAtIndex` at all

**Result:** STILL CRASHES on toggle (~50%). Items don't render when toggle succeeds (confirms per-item flush IS needed for rendering, but crash is NOT caused by per-item flush).

**Key insight:** The crash is NOT in `componentAtIndex`. It happens during the outer `__FlushElementTree()` processing of `update-list-info`, regardless of what `componentAtIndex` does.

---

## Attempt 19: asyncFlush in componentAtIndex + single flush

**Changes:**

- Reverted to single flush in `end()`: `processPendingListUpdates()` → `__FlushElementTree()`
- `componentAtIndex` uses `__FlushElementTree(child, { asyncFlush: true })` — delegates scheduling to native engine, avoids re-entrant synchronous flush

**Result:** CRASH. Same ~50% intermittent pattern.

---

## Attempt 20: Skip empty update-list-info + minimal insertAction format

**Hypothesis:** Sending empty `update-list-info` (`{insertAction: [], removeAction: [], updateAction: []}`) on first render puts the native list in a bad state. Vue Lynx's `flushListUpdates()` skips updates when nothing new (`if (items.length <= reported) continue`).

**Changes:**

- Added early return in `_processUpdate()` when `insertAction.length === 0 && removeAction.length === 0`
- Simplified insertAction to minimal Vue format: only `position`, `type`, `item-key` (removed `estimated-main-axis-size-px` and `recyclable`)
- `item-key` fallback uses `String(__GetElementUniqueID(child))` (string, not number)

**Result:** CRASH. Same ~50% intermittent pattern.

**Debug text after toggle + add-item (when toggle didn't crash):**

```
procUpd
kids:new=0,old=0
skip-empty
procUpd
kids:new=4,old=3
setULI:ins=1,rem=0
ULI-set
procUpd
kids:new=5,old=4
setULI:ins=1,rem=0
```

The initial empty update IS skipped (`skip-empty`). But toggle still crashes.

---

## What We Know For Certain (updated after Attempts 15–20)

1. **`update-list-info` must be a plain object** — array wrapper prevents `componentAtIndex` from being called
2. **`componentAtIndex` IS called** by the engine with plain object format
3. **Pre-appending outside `componentAtIndex` crashes** — only valid inside the callback
4. **The crash is NOT in `componentAtIndex`** — removing all code from the callback (Attempt 18) still crashes
5. **The crash is NOT in per-item `__FlushElementTree`** — removing it doesn't help (Attempt 18)
6. **The crash is NOT in `asyncFlush` vs sync flush** — asyncFlush still crashes (Attempt 19)
7. **The crash is NOT in `__UpdateListCallbacks`** — removing it doesn't help (Attempt 16)
8. **The crash is NOT in insertAction format** — minimal Vue format still crashes (Attempt 20)
9. **The crash is NOT in empty update-list-info** — skipping it doesn't help (Attempt 20)
10. **Empty list (no items) NEVER crashes** — confirmed across all attempts
11. **First population (0→N items) crashes ~50%** — intermittent, native-level crash
12. **Incremental additions (N→N+1) NEVER crash** — only the first batch of items triggers it
13. **The crash is in `__FlushElementTree()` processing a list with update-list-info containing insertActions**

## Current Architecture

### `create-list-element.ts`

- `__CreateList(pageId, componentAtIndex, enqueueComponent, {}, componentAtIndexes)` — 5 args
- `componentAtIndex`: `__AppendElement(listRef, child)` + `__FlushElementTree(child, { asyncFlush: true })` + return elementID
- `componentAtIndexes`: batch version, delegates to same append logic
- No programmatic default attributes (list-type etc. come from template)

### `lynx-list-element.ts`

- Virtual linked list for children (appendChild/insertBefore intercepted)
- `_processUpdate()`: diff-based update-list-info (insert/remove delta), skips empty updates
- `processPendingListUpdates()`: called from `end()`, drains pending set
- `_scheduleUpdate()`: adds to pending set + queueMicrotask safety net

### `lynx-renderer-factory2.ts`

- `end()`: `processPendingListUpdates()` → `__FlushElementTree()` (single bare flush)

### Demo (`list-example.component.ts`)

- `showItems = false` by default, toggle button to enable
- Items: `[{id:1}, {id:2}, {id:3}]`, "Add Item" button appends more

---

## Remaining Hypotheses

### H1: First update-list-info timing — list not ready for items during same CD cycle as creation

The list element is created AND first populated in the same CD cycle (when `showItems` starts as `true`, or when toggle fires). The `__CreateList()` call and the `__SetAttribute(list, 'update-list-info', ...)` both happen before the same `__FlushElementTree()`. Maybe the native list engine needs a flush between creation and first population — it needs to "initialize" before accepting items.

**Evidence:** Empty list works (creation + empty/no update-list-info + flush). Incremental adds work (list already initialized from a previous flush). Only the FIRST population crashes.

**Potential fix:** Force a flush after `__CreateList()` before allowing `update-list-info` to be set. E.g., create the list in one CD cycle, populate it in the next.

### H2: The intermittent nature suggests a race condition in the native engine

The ~50% crash rate suggests the native engine has a race between list initialization (triggered by `__CreateList` during flush) and item processing (triggered by `update-list-info` during the same flush). Sometimes initialization finishes first and items work; sometimes items are processed before initialization completes and it crashes.

**Potential fix:** Same as H1 — separate creation flush from population flush.

### H3: `__FlushElementTree()` bare call vs `__FlushElementTree(page)` for list processing

Earlier attempts showed that `__FlushElementTree(this.element, { triggerLayout: true, listID })` (targeted flush on list element) does NOT crash but also doesn't render items. Maybe the page-level flush approach matters.

### H4: Need `__FlushElementTree(page, pipelineOptions)` with native-provided options

React Lynx's page-level flush uses options from the native `renderPage`/`updatePage` callback. Our bare flush may be missing required metadata. The `__GeneratePipelineOptions()` API exists but we don't use it.
