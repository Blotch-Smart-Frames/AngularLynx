# x-list Investigation

**Status:** In Progress — crashes on device when rendering list items

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

After reading the official Lynx docs (`references/lynx-website-main/docs/en/api/elements/built-in/list.mdx`) and confirming against the React Lynx codebase:

1. **Missing required `scroll-orientation` attribute** — The Lynx docs mark `scroll-orientation` as Required on `<list>`. We only set `list-type` and `span-count`. Added `scroll-orientation: "vertical"` default.

2. **Removed invalid `__SetConfig()` call** — `recycleEnabled`, `estimatedItemSize`, `overscrollEnabled` are NOT valid list config properties. React Lynx never uses `__SetConfig` for lists (confirmed via grep). Removed entirely.

3. **Fixed `__FlushElementTree()` call** (H1) — Replaced bare `__FlushElementTree()` with `__FlushElementTree(this.element, { triggerLayout: true, listID })`. React Lynx always passes element + list-specific options. The bare call flushed the entire page causing re-entrant crashes when `componentAtIndex` did its own per-item flush.

4. **Added `recyclable: false`** on each list-item — Since we don't implement recycling in `enqueueComponent`, tell the native engine not to recycle items.

## Next Steps (if still crashing)

1. **Try `queueMicrotask`** instead of `setTimeout(0)` — more predictable timing in Lynx runtime.
2. **Add `estimated-main-axis-size-px`** on each list-item — Lynx docs say "strongly recommended".
3. **Add on-screen debug logging** to see which stage fails.

## Reference: React Lynx approach (production-proven)

```
references/lynx-stack-main/packages/react/runtime/src/snapshot/snapshot/list.ts
```

React Lynx renders items **lazily inside `componentAtIndex`**:

1. `componentAtIndex(cellIndex)` is called by native engine
2. It calls `ensureElements()` to render the component tree for that item
3. Calls `__AppendElement(list, root)` to attach item to list
4. Calls `__FlushElementTree(root, { triggerLayout: true, operationID, elementID, listID })`
5. Returns `__GetElementUniqueID(root)`

Key difference: React never pre-appends all children. It renders on-demand per `componentAtIndex` call. The `update-list-info` insertAction tells the engine _how many_ items exist, then the engine calls `componentAtIndex` for each visible index.
