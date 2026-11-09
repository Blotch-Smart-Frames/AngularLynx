# List Virtualization

## Overview

`<list>` is Lynx's native virtualized list. It manages element creation, recycling, and visibility internally. Use it for any list with more than a handful of items.

## Basic Usage

```html
<list
  class="item-list"
  list-type="single"
  scroll-orientation="vertical"
  span-count="1"
>
  @for (item of items(); track item.id) {
  <list-item item-key="{{ item.id }}" class="item">
    <text class="item-text">{{ item.name }}</text>
  </list-item>
  }
</list>
```

### Required Attributes

- **`item-key`** on every `<list-item>` — a unique string identifier. **Missing `item-key` causes a native crash.** The native recycling engine uses this to track and reuse items.
- **`list-type`** — `"single"` for standard lists, `"flow"` for waterfall/masonry layouts
- **`scroll-orientation`** — `"vertical"` or `"horizontal"`

### Optional Attributes

- **`span-count`** — number of columns (for grid/flow layouts). Default is `1`.
- **`upper-threshold-item-count`** / **`lower-threshold-item-count`** — `(bindscrolltoupper)` / `(bindscrolltolower)` fire when fewer than this many items remain above or below the screen (`upper-threshold` and `lower-threshold`, in px, are `<scroll-view>`'s)
- **`initial-scroll-index`** — the item to start at
- **`need-visible-item-info`** — adds `attachedCells` to the scroll events

## How It Works

The native list engine manages element creation and recycling:

1. When an item scrolls into view, the engine calls `componentAtIndex(index)` to create it
2. When an item scrolls out of view, the engine calls `enqueueComponent(element)` to recycle it
3. Recycled elements are reused for new items, preserving the finite element pool

The AngularLynx renderer handles this transparently — you use `@for` as normal, and the renderer's `LynxListElement` intercepts `appendChild`/`insertBefore` calls to communicate with the native engine via batched `update-list-info` attribute updates.

## Styling

```css
.item-list {
  height: 400px; /* explicit height required, same as scroll-view */
  width: 100%;
}

.item {
  padding: 12px;
  border-bottom-width: 1px;
  border-bottom-color: #e0e0e0;
}
```

## Flow Layout (Waterfall/Masonry)

```html
<list
  list-type="flow"
  span-count="2"
  scroll-orientation="vertical"
  class="grid"
>
  @for (item of items(); track item.id) {
  <list-item item-key="{{ item.id }}" class="grid-item">
    <image [src]="item.imageUrl" mode="aspectFit" />
    <text>{{ item.title }}</text>
  </list-item>
  }
</list>
```

## Scrolling From Code

`scrollToPosition` takes **`position`**, the item's index (`index` is ignored, and the call does nothing):

```typescript
this.list().nativeElement.invoke?.('scrollToPosition', {
  position: this.items().length - 1,
  alignTo: 'bottom', // 'top' (default), 'middle' or 'bottom'
  offset: 0, // px further, after aligning
  smooth: true,
});
```

In the web preview the list scrolls to the item's top plus `offset` and ignores `alignTo` and `itemKey`, and it can't scroll to items Angular has just added until they're in the page, a frame or two later, with no event to say so (`bindlayoutcomplete` isn't sent there): retry each frame for a few frames.

## Loading Older Items Above (a Chat)

A chat opens on its newest message and loads older ones as the person scrolls up: `[upper-threshold-item-count]="4"` and `(bindscrolltoupper)` to fetch a page, prepended to the items.

- **Nothing keeps the person's place.** Items inserted above the visible ones push them down, so the new page slides into view (measured in the web preview). Put the list back yourself: give the rows above the first item fixed heights, so where that item sits is their sum less the `scrollTop` from `(bindscroll)`; after the page renders, `scrollToPosition` to that item with `alignTo: 'top'` and `offset` minus that distance, from `(bindlayoutcomplete)` on iOS and Android and retried each frame in the web preview.
- **Opening at the end:** on iOS, `initial-scroll-index` and a `scrollToPosition` in the first frames don't land while a `<lynx-stack-outlet>` screen slides in. Scroll to the last item each frame for the first ~40 frames, and stop when the person drags (`(bindscrollstatechange)` state `2`, or a `(bindscroll)` with `eventSource` `2` in the web preview).
- **`attachedCells`** (with `need-visible-item-info`) in the web preview lists every item the list has rendered, not only those on screen, with `top` relative to the list's top: filter it before taking the first one as the topmost visible item.

`examples/chat` (Par Avion) does all of this.

## Important Rules

1. **Never use `<view>` for long lists** — it creates all elements upfront, exhausting the element pool
2. **`item-key` is mandatory** — without it, the native engine crashes
3. **`<list-item>` must be a direct child of `<list>`** — wrapping it in other elements breaks recycling
4. **Don't set `z-index` on `<list-item>`** — it interferes with the recycling mechanism. Set z-index on content inside the list item instead
5. **Explicit height required** — same as `<scroll-view>`, the list needs a bounded height to scroll
6. **Keep a footer out of a flow list** — a `full-span="true"` item at the end of a `list-type="flow"` list opened the list scrolled to its end on iOS (measured once, Lynx 4.4). Put a footnote above or below the list, and clear a floating bar with `padding-bottom` on the list

## List vs Scroll-View

|                     | `<list>`                       | `<scroll-view>`                    |
| ------------------- | ------------------------------ | ---------------------------------- |
| Virtualization      | Yes — only visible items exist | No — all items created upfront     |
| Element pool impact | Minimal — recycles elements    | High — one element per item        |
| Use for             | 10+ items, dynamic content     | Small fixed content, mixed layouts |
| Recycling           | Automatic via native engine    | None                               |
