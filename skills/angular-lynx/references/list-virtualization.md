# List Virtualization

## Overview

`<list>` is Lynx's native virtualized list: it draws only the items near the screen. Use it for any list with more than a handful of items, with `@for` for a few dozen, and `*lynxListFor` for hundreds or more, which builds an item's Angular view only when the list asks for it and reuses the views of items scrolled away.

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
- **On a `<list-item>`:** `full-span` (a whole row of a `flow` list, such as a section header), `sticky-top`/`sticky-bottom` (with `sticky` on the list), `estimated-main-axis-size-px` and `recyclable`. Native reads them from `update-list-info`, which the renderer fills in from the `<list-item>`s an `@for` or the template writes (and updates when a binding changes them); `*lynxListFor` takes them from `itemAttributes`

## How It Works

1. The renderer tells the native list which items exist (their `item-key`s, in order) with `update-list-info`, at the end of each change detection
2. When an item scrolls into view, the list asks for it by index (`componentAtIndex`)
3. When an item scrolls away, past `preload-buffer-count`, the list lets go of its element (`enqueueComponent`)

With `@for`, Angular builds every item's view (and its elements) up front, the list only draws the ones near the screen, and every view stays. With `*lynxListFor`, step 2 builds the item's view, or gives it the view of an item from step 3: a list of 1,000 rows builds about as many views as fit on the screen (measured: 14 instead of 1,000, and a third of the memory).

## `*lynxListFor` for Long Lists

Put it on the `<list-item>`, directly in the `<list>` (or in content a component such as `ui-list` projects into one). It's in `LYNX_ELEMENTS`.

```typescript
@Component({
  selector: 'app-contacts',
  imports: [LYNX_ELEMENTS],
  template: `
    <list list-type="single" class="h-full">
      <list-item
        *lynxListFor="
          let contact of contacts();
          trackBy: byId;
          itemAttributes: layout;
          let i = index
        "
      >
        <app-contact-row [contact]="contact" [position]="i" />
      </list-item>
    </list>
  `,
})
export class Contacts {
  readonly contacts = signal<Contact[]>([]);
  readonly byId = (_: number, contact: Contact) => contact.id;
  readonly layout = (contact: Contact): LynxListItemAttributes => ({
    'estimated-main-axis-size-px': 64,
    'reuse-identifier': contact.pinned ? 'pinned' : 'row',
  });
}
```

- **The key and layout come from the data, not the `<list-item>`**: the list needs them before the item has a view. `trackBy` gives the `item-key` (as a string; without it items are keyed by identity, and a repeated key is made unique with a warning). `itemAttributes` gives `estimated-main-axis-size-px`, `full-span`, `sticky-top`, `sticky-bottom`, `recyclable` and `reuse-identifier`; written on the `<list-item>` itself they aren't read until it's built.
- **The context is `@for`'s**: `let item`, `index`, `count`, `first`, `last`, `even`, `odd` (`LynxListForContext`).
- **A reused view keeps what isn't bound to its item**: a child component's own signals, a field's text and focus, a nested scroll position. Derive what a row shows from its item (`input()`, `computed()`, `linkedSignal()`), keep what the user changes in the parent by key, and give an item whose view must stay its own `recyclable: false` (it gets its own view back each time).
- **Different layouts, different `reuse-identifier`s**: an item only reuses the view of an item with the same one, such as a header and a row.
- **Data changes work as with `@for`**: inserts, removals and moves update the native list, and the views on screen show new values. An array changed in place (`push()`) shows too.
- **Tests and the web preview**: native asks for a list's items, `@for`'s or `*lynxListFor`'s, and nothing plays native's part in `ng test`, so a test doesn't see them: test the item's component on its own. Lynx for Web's `<list>` asks for every item at once and never lets one go, so every item gets a view there.

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

On iOS and Android, a call made in the same change detection that changes the list's items goes to the list with the flush that sends them, after them, as in React Lynx.

In the web preview the list scrolls to the item's top plus `offset` and ignores `alignTo` and `itemKey`, and it can't scroll to items Angular has just added until they're in the page, a frame or two later, with no event to say so (`bindlayoutcomplete` isn't sent there): retry each frame for a few frames.

## Loading Older Items Above (a Chat)

A chat opens on its newest message and loads older ones as the person scrolls up: `[upper-threshold-item-count]="4"` and `(bindscrolltoupper)` to fetch a page, prepended to the items.

- **Nothing keeps the person's place.** Items inserted above the visible ones push them down, so the new page slides into view (measured in the web preview). Put the list back yourself: give the rows above the first item fixed heights, so where that item sits is their sum less the `scrollTop` from `(bindscroll)`; after the page renders, `scrollToPosition` to that item with `alignTo: 'top'` and `offset` minus that distance, from `(bindlayoutcomplete)` on iOS and Android and retried each frame in the web preview.
- **Opening at the end:** on iOS, `initial-scroll-index` and a `scrollToPosition` in the first frames don't land while a `<lynx-stack-outlet>` screen slides in. Scroll to the last item each frame for the first ~40 frames, and stop when the person drags (`(bindscrollstatechange)` state `2`, or a `(bindscroll)` with `eventSource` `2` in the web preview).
- **`attachedCells`** (with `need-visible-item-info`) in the web preview lists every item the list has rendered, not only those on screen, with `top` relative to the list's top: filter it before taking the first one as the topmost visible item.

`examples/chat` (Par Avion) does all of this.

## Important Rules

1. **Never use `<view>` for long lists** — it creates all elements upfront, exhausting the element pool. `@for` in a `<list>` does too, on the Angular side: use `*lynxListFor` for hundreds of items or more. Rows added later to a `<view>` or `<scroll-view>` that's on screen cost more with each row already there: Lynx places each row it inserts before a sibling (every `@for` row goes before its anchor) by walking the container's children, so 5,000 rows take about 12.5 million steps. A screen's first rows don't, since the runtime builds them before the screen is first drawn
2. **`item-key` is mandatory** — without it, the native engine crashes. `*lynxListFor` sets it from `trackBy`
3. **`<list-item>` must be a direct child of `<list>`** — wrapping it in other elements breaks recycling
4. **Don't set `z-index` on `<list-item>`** — it interferes with the recycling mechanism. Set z-index on content inside the list item instead
5. **Explicit height required** — same as `<scroll-view>`, the list needs a bounded height to scroll
6. **Check a footer at the end of a flow list on iOS** — a `full-span="true"` item at the end of a `list-type="flow"` list once opened the list scrolled to its end (measured once, Lynx 4.4, before a template's `full-span` reached native). Since then, `ui-bar-scroll`'s full-span spacer at the end of a flow list opened at the top (iOS 27 Simulator). Clear floating bars with `ui-bar-scroll` on the list (see routing.md), or `padding-bottom` on the list

## List vs Scroll-View

|                     | `<list>`                         | `<scroll-view>`                    |
| ------------------- | -------------------------------- | ---------------------------------- |
| Virtualization      | Yes — only visible items exist   | No — all items created upfront     |
| Element pool impact | Minimal — recycles elements      | High — one element per item        |
| Use for             | 10+ items, dynamic content       | Small fixed content, mixed layouts |
| Recycling           | Views reused with `*lynxListFor` | None                               |
