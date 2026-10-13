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
- **`upper-threshold`** / **`lower-threshold`** — distance from edges to trigger scroll events
- **`scroll-with-animation`** — smooth scroll when programmatically scrolling

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

## Important Rules

1. **Never use `<view>` for long lists** — it creates all elements upfront, exhausting the element pool
2. **`item-key` is mandatory** — without it, the native engine crashes
3. **`<list-item>` must be a direct child of `<list>`** — wrapping it in other elements breaks recycling
4. **Don't set `z-index` on `<list-item>`** — it interferes with the recycling mechanism. Set z-index on content inside the list item instead
5. **Explicit height required** — same as `<scroll-view>`, the list needs a bounded height to scroll

## List vs Scroll-View

|                     | `<list>`                       | `<scroll-view>`                    |
| ------------------- | ------------------------------ | ---------------------------------- |
| Virtualization      | Yes — only visible items exist | No — all items created upfront     |
| Element pool impact | Minimal — recycles elements    | High — one element per item        |
| Use for             | 10+ items, dynamic content     | Small fixed content, mixed layouts |
| Recycling           | Automatic via native engine    | None                               |
