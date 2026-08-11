# Scroll View Investigation — Angular on Lynx

## Goal

Ensure `<x-scroll-view>` works correctly in the AngularLynx renderer with proper configuration and modern API usage.

## Starting State

`x-scroll-view` already had partial support:

- Element creation via `__CreateScrollView` in `lynx-document.ts` — working
- Attributes and events flow through generic `LynxElement` paths (`__SetAttribute`, `__AddEvent`) — working
- `__SetConfig` call contained **invalid properties** that don't exist in the Lynx scroll-view API
- Demo component used **deprecated camelCase attributes** (`scrollX`/`scrollY`)

## Investigation

### What the Lynx API actually supports

Referenced `references/lynx-website-main/docs/en/api/elements/built-in/scroll-view-API.mdx` and `references/lynx-website-main/docs/en/guide/ui/scrolling.mdx`.

**Valid `__SetConfig` properties:** `bounces` only. Other properties are attributes, not config.

**Valid attributes (set via `__SetAttribute`):**

- `scroll-orientation` — `"vertical"` (default) or `"horizontal"` (replaces deprecated `scroll-x`/`scroll-y`, v3.0+)
- `enable-scroll` — boolean, enables/disables scrolling
- `scroll-bar-enable` — boolean, show/hide scrollbar
- `initial-scroll-offset` — number, initial scroll position
- `initial-scroll-to-index` — number, initial item index
- `upper-threshold` / `lower-threshold` — number, thresholds for scroll boundary events

**Valid events (set via `__AddEvent`):**

- `bindscroll`, `bindscrollend`, `bindscrolltoupper`, `bindscrolltolower`, `bindcontentsizechanged`

### Root cause: attribute naming

**Lynx uses kebab-case for all element attributes.** The native runtime does NOT recognize camelCase.

The demo had:

```html
<x-scroll-view scrollX="true" scrollY="false">
  <!-- camelCase — NOT recognized --></x-scroll-view
>
```

React Lynx tests and examples consistently use kebab-case:

```jsx
<scroll-view scroll-x scroll-y={true}>           <!-- kebab-case — correct -->
<scroll-view scroll-orientation="horizontal">     <!-- kebab-case — correct -->
```

The attribute flow is: Angular template → `Renderer2.setAttribute()` → `LynxElement.setAttribute()` → `__SetAttribute()`. No camelCase-to-kebab-case conversion happens anywhere. The name passes through **unchanged**, so the exact casing in the template matters.

### Layout model

From `display.mdx`:

> `<scroll-view>` is forced to be a linear layout. `scroll-x`/`scroll-y` will change the main axis to horizontal and vertical respectively.

Scroll-view's linear layout arranges direct children in a single direction. Items should be direct children (no wrapper view needed) — scroll-view handles the linear arrangement itself.

### `display: none` in Lynx

Lynx's `display: none` is NOT the same as web — it **resizes to 0x0** but doesn't remove from layout. This matters because Angular's `@for` creates invisible anchor views (`createComment()` → 0-size `x-view` with `display: none`). These exist as children of scroll-view but at 0x0 shouldn't affect scrolling.

### CSS class-based styling

Lynx has a **native CSS engine** (`enableCSSSelector: true`) that matches class selectors. Component styles are extracted during build to scoped CSS files and loaded by the template engine. CSS classes work — no need for inline styles.

### What was wrong with `__SetConfig`

The `__SetConfig` call set properties that don't exist in the Lynx scroll-view API:

```ts
__SetConfig(element, {
  bounces: true,
  showScrollIndicator: true, // NOT a Lynx API
  pagingEnabled: false, // NOT a Lynx API
  scrollsToTop: true, // NOT a Lynx API
  decelerationRate: 'normal', // NOT a Lynx API
});
```

### What already works (no changes needed)

- **Attribute pass-through:** Template attributes like `scroll-orientation="vertical"` flow through `LynxRenderer.setAttribute` → `LynxElement.setAttribute` → `__SetAttribute` generically.
- **Event pass-through:** Events like `(bindscroll)="onScroll($event)"` flow through `LynxRenderer.listen` → `LynxElement.addEventListener` → `__AddEvent` generically.
- **Scroll methods:** `scrollTo`, `scrollBy`, etc. are native Lynx SelectorQuery APIs — not renderer concerns.
- **CSS engine:** Lynx matches CSS class selectors natively. Component styles work.

## Changes Made

### 1. Fixed `__SetConfig` defaults (`packages/runtime/src/lib/lynx-document.ts`) — committed earlier

Removed all invalid properties, kept only `bounces: true`:

```ts
case 'x-scroll-view': {
  element = __CreateScrollView(this.#pageId);
  // Only set config properties that exist in the Lynx scroll-view API.
  // Attributes like scroll-orientation, enable-scroll, upper-threshold, etc.
  // are set via __SetAttribute by Angular template bindings.
  __SetConfig(element, {
    bounces: true,
  });
  break;
}
```

### 2. Updated demo template (`packages/kitchen-sink-app/src/app/scroll-example/scroll-example.component.ts`)

Two changes:

**a) Fixed attribute names:**

- `scrollX="true" scrollY="false"` → `scroll-orientation="horizontal"` (kebab-case, v3.0+)
- `scrollX="false" scrollY="true"` → `scroll-orientation="vertical"` (kebab-case, v3.0+)

**b) Removed wrapper views:**
Items are now direct children of `<x-scroll-view>` instead of wrapped in a `<x-view class="horizontal-content">` / `<x-view class="vertical-content">`. Scroll-view uses its own linear layout in the scroll direction — no wrapper needed.

React Lynx examples confirm this pattern:

```jsx
<scroll-view
  scroll-orientation="vertical"
  style={{ width: '100%', height: '100px' }}
>
  {Array.from({ length: 10 }).map((item, i) => (
    <view key={i} style={{ width: '100%', height: '50px' }}>
      <text>Inner Item {i}</text>
    </view>
  ))}
</scroll-view>
```

## Round 2: Still Not Scrolling

### Root cause: missing height constraint

The scroll-view in `app.component.ts` had `class="app-container"` but NO CSS defined `.app-container`. In Lynx's linear layout, elements without explicit height **expand to fit their content** — meaning no overflow, meaning no scrolling.

Evidence:

- Every React Lynx example gives scroll-view explicit dimensions: `style={{height: '600px'}}` or `height: 100vh`
- Lynx `display.mdx`: "scroll-view is forced to be a linear layout" — linear layout children size to content without constraints
- The scroll-view's child (`.app` with `min-height: 100vh` + navigation) is taller than the viewport, but the scroll-view expanded to match, so nothing overflowed

### Secondary issue: `__SetConfig` misuse

The Lynx scroll-view API lists `bounces` under "Attributes" (set via `__SetAttribute`), not config. React Lynx tests only use `__SetAttribute` for scroll-view. Our `__SetConfig({ bounces: true })` call was likely a no-op or confusing the native engine. Since `bounces` defaults to `true`, removed entirely.

### Changes

1. **Removed `__SetConfig` from scroll-view** (`lynx-document.ts`) — just `__CreateScrollView(this.#pageId)`, no config
2. **Added `.app-container` CSS** (`app.component.css`) — `height: 100vh; width: 100vw;` to constrain scroll-view to viewport

## If Still Not Working

### Fallback: use `scroll-x`/`scroll-y` instead of `scroll-orientation`

`scroll-orientation` is v3.0+. If the Lynx runtime is pre-3.0, try the older kebab-case attributes:

```html
<x-scroll-view scroll-x>
  <!-- horizontal -->
  <x-scroll-view scroll-y>
    <!-- vertical (default) --></x-scroll-view
  ></x-scroll-view
>
```

### Check `@for` comment nodes

Angular's `@for` creates invisible 0x0 views as anchors inside scroll-view. If these interfere with scroll-view's linear layout (despite being 0x0), we may need to restructure the demo to avoid `@for` inside scroll-view, or implement scroll-view-aware child filtering similar to `LynxListElement.getUIChildren()`.

### Check runtime version

If `scroll-orientation` isn't recognized and `scroll-x`/`scroll-y` also don't work, the attribute names might differ. Check the Lynx runtime version and compare against the API docs.

## Verification

`npm run build` completed successfully across all three packages.

## Status: In Progress — awaiting on-device test
