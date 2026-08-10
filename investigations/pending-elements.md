# Pending Lynx Elements

Elements from the Lynx platform (official docs + web-platform reference implementation) that are **not yet supported** by the AngularLynx renderer (`packages/runtime/src/lib/lynx-document.ts`).

Sources:

- Official Lynx docs: `references/lynx-website-main/docs/en/api/elements/`
- Compat data: `references/lynx-website-main/packages/lynx-compat-data/elements/`
- React Lynx: `references/lynx-stack-main/packages/react/`
- Web platform elements: `references/lynx-stack-main/packages/web-platform/web-elements/src/elements/`

---

## Currently Supported

| Element         | Creation API                   | Notes                                                     |
| --------------- | ------------------------------ | --------------------------------------------------------- |
| `x-view`        | `__CreateView`                 | Container/layout                                          |
| `x-text`        | `__CreateText`                 | Text display                                              |
| `x-image`       | `__CreateImage`                | Image display                                             |
| `x-scroll-view` | `__CreateScrollView`           | Scrollable container                                      |
| `x-list`        | `__CreateList`                 | Virtualized list (has special `LynxListElement` handling) |
| `list-item`     | `__CreateElement('list-item')` | Direct child of `x-list`                                  |
| `x-raw-text`    | `__CreateRawText`              | Raw text node                                             |
| `x-block`       | `__CreateBlock`                | Block container                                           |
| `x-if`          | `__CreateIf`                   | Structural conditional (Lynx-native, not used by Angular) |
| `x-for`         | `__CreateFor`                  | Structural loop (Lynx-native, not used by Angular)        |
| `x-page`        | `__CreatePage`                 | Root page element (internal)                              |

---

## Pending: Core Built-in Elements

### `<frame>`

**What it does:** Embeds a separate Lynx page inside the current page (analogous to `<iframe>`). Can pass `initData` and `globalProps` to the embedded page.

**Platform:** Android, iOS (v3.4+), HarmonyOS

**Priority:** Low — niche use case (micro-frontends / embedded sub-pages). Not needed for typical Angular apps.

**Implementation:** Has a **dedicated `__CreateFrame(pageId)`** function in the snapshot compiler (like `__CreateView`, `__CreateText`, etc. — not the generic `__CreateElement`). We should add `__CreateFrame` to our Lynx type declarations and use it directly.

**Source:** `references/lynx-stack-main/packages/react/transform/crates/swc_plugin_snapshot/lib.rs:416-422`

---

## Pending: XElements (Extended Elements)

> XElements require additional **native-side dependencies** to be integrated by the app host. Creating the element on the JS side alone is not enough — the native renderer must have the XElement plugin registered.

### `<input>`

**What it does:** Single-line text input. Supports types: `text`, `number`, `digit`, `password`, `tel`, `email`.

**Platform:** All (requires native dependency)

**Priority:** High — essential for any app with user input (forms, search, login).

**Key differences from HTML `<input>`:**

- No `.value` property — must use `SelectorQuery` with `.getValue()` / `.setValue()`
- Events: `bindfocus`, `bindblur`, `bindconfirm`, `bindinput`, `bindselection`
- Attributes: `confirm-type`, `input-filter` (regex), `show-soft-input-on-focus`
- Keyboard avoidance built-in

**Implementation considerations:**

- Needs `__CreateElement('input', pageId)`
- May need a specialized `LynxInputElement` class for Angular forms integration (`ControlValueAccessor`)
- Event handling must map `bindinput` → Angular reactive forms

---

### `<textarea>`

**What it does:** Multi-line text input. Supports `::placeholder` pseudo-element for placeholder styling.

**Platform:** All (requires native dependency)

**Priority:** High — same as `<input>`, needed for any multi-line text input.

**Implementation:** Similar to `<input>`. `__CreateElement('textarea', pageId)`.

---

### `<overlay>`

**What it does:** Container that does **not participate in page layout**. Content is detached from the Lynx document flow and promoted to a rendering layer outside of Lynx. Used for building dialogs/modals that cover entire embedded pages.

**Platform:** All (requires native dependency)

**Constraints:**

- Can only have one direct child node
- Child must set `position: fixed`
- For full-Lynx pages, `position: fixed` on a regular view works instead

**Priority:** Medium — needed for modal dialogs, bottom sheets, dropdowns.

**Implementation:** `__CreateElement('overlay', pageId)`. Likely no special element class needed — just attribute passthrough.

---

### `<svg>`

**What it does:** Renders SVG vector graphics. Parses SVG in background thread, renders entire graphic as a single native view.

**Supported SVG tags (17):** `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`, `text`, `image`, `linearGradient`, `radialGradient`, `stop`, `defs`, `use`, `clipPath`

**Platform:** All (requires native dependency)

**Priority:** Medium — needed for icons, illustrations, charts. Without this, all graphics must be raster images.

**Implementation:** `__CreateElement('svg', pageId)`. SVG content is likely passed as a string attribute or child text content. Need to investigate how React Lynx passes SVG markup.

---

### `<refresh>`

**What it does:** Pull-to-refresh gesture container. Reveals a customizable header view while new data is fetched.

**Children:** Up to two direct children: `<refresh-header>` and a vertically scrollable `<view>`

**Platform:** All (requires native dependency)

**Priority:** Medium — common pattern in list-based apps. Can be worked around with native bridge calls.

**Events:** `refresh` (fired when user pulls past threshold)

**Methods:** `autoStartRefresh()`, `finishRefresh()`

**Implementation:**

- `__CreateElement('refresh', pageId)` for the container
- `__CreateElement('refresh-header', pageId)` for the header child
- May need method access via `SelectorQuery`

---

### `<viewpager>`

**What it does:** Horizontally swipeable paging component. Used for tabbed/paging experiences (e.g., onboarding screens, tab pages).

**Children:** Direct children must be `<viewpager-item>`

**Platform:** All (requires native dependency)

**Priority:** Medium — common for tabbed UIs and onboarding flows.

**Implementation:**

- `__CreateElement('viewpager', pageId)` for the container
- `__CreateElement('viewpager-item', pageId)` for each page

---

### `<scroll-coordinator>`

**What it does:** Coordinates scrolling between multiple nested scrollable containers. Implements smooth handover of scroll control between outer and inner scroll views.

**Children:**

- `<scroll-coordinator-header>` — sticky header
- `<scroll-coordinator-toolbar>` — fixed toolbar (stays visible)
- `<scroll-coordinator-slot>` — scrollable content area

**Platform:** All (requires native dependency)

**Priority:** Low-Medium — used for complex sticky-header patterns (profile pages, product detail pages). Can be approximated with simpler layouts.

**Implementation:**

- `__CreateElement('scroll-coordinator', pageId)` + child elements
- Layout constraint: container height == slot height + toolbar height

---

### `<title-bar-view>`

**What it does:** Customizes the draggable area of a desktop window title bar.

**Platform:** Windows and macOS only (Clay)

**Priority:** Very Low — desktop-only, not relevant for mobile Lynx apps.

**Implementation:** `__CreateElement('title-bar-view', pageId)`. Only if targeting desktop.

---

## Pending: Child/Associated Elements

These only make sense in the context of their parent XElements:

| Element                      | Parent                 | Purpose                     |
| ---------------------------- | ---------------------- | --------------------------- |
| `viewpager-item`             | `<viewpager>`          | Individual page in pager    |
| `refresh-header`             | `<refresh>`            | Pull-to-refresh header view |
| `scroll-coordinator-header`  | `<scroll-coordinator>` | Sticky header               |
| `scroll-coordinator-toolbar` | `<scroll-coordinator>` | Fixed toolbar               |
| `scroll-coordinator-slot`    | `<scroll-coordinator>` | Scrollable content          |

---

## Pending: Web-Platform Elements (Not Yet in Official Docs)

These elements exist in the Lynx web-platform implementation (`@lynx-js/web-elements`) and are used in production but do **not yet have official documentation pages**. They are mentioned in the [Lynx 2025 roadmap blog post](references/lynx-website-main/docs/en/blog/lynx-open-source-roadmap-2025.mdx) as planned additions.

### `<x-swiper>` (aka `swiper`)

**What it does:** Carousel/swiper component with auto-scroll, circular mode, and indicator dots. Similar to `<viewpager>` but with more features (auto-play, indicator dots, circular swiping).

**Children:** `<x-swiper-item>` for each slide

**Web-platform tag:** `x-swiper` (registered as custom element)

**Priority:** Medium — common carousel pattern. May overlap with `<viewpager>`.

**Key attributes:** `smooth-scroll`, `indicator-dots`, auto-scroll settings, circular mode

**Implementation:** `__CreateElement('x-swiper', pageId)` + `__CreateElement('x-swiper-item', pageId)`

---

### `<x-blur-view>` (aka `blur-view`)

**What it does:** A view with a native `backdrop-filter: blur()` effect. Creates a frosted-glass background effect behind the element's content.

**Web-platform tag:** `x-blur-view`

**Key attributes:** `blur-radius` (pixels)

**Priority:** Low-Medium — cosmetic effect for overlays, headers. Can be approximated with `filter: blur()` on images, but this provides native backdrop blur.

**Implementation:** `__CreateElement('x-blur-view', pageId)`. Simple passthrough — just needs the `blur-radius` attribute.

---

### `<x-canvas>` (aka `canvas`)

**What it does:** 2D drawing canvas element. Provides a pixel-level drawing surface for custom graphics, charts, and procedural visuals.

**Web-platform tag:** `x-canvas`

**Key attributes:** `name`, `width`, `height`

**Priority:** Low-Medium — needed for custom charts, drawing, games. Niche but enables use cases that nothing else can.

**Implementation:** `__CreateElement('x-canvas', pageId)`. Likely needs a bridge for the canvas 2D context API (similar to HTML Canvas). The drawing API is accessed via `SelectorQuery` + node methods.

---

### `<x-audio-tt>` (aka `audio`)

**What it does:** Audio playback element. Supports playing audio files, controlling playback state, volume, and reporting events.

**Web-platform tag:** `x-audio-tt`

**Key attributes:** `src`, playback controls

**Events:** Play, pause, ended, error, timeupdate, etc.

**Priority:** Low — audio playback is a niche use case for most apps.

**Implementation:** `__CreateElement('x-audio-tt', pageId)`. Event-driven — register playback listeners.

---

### `<x-webview>` (aka `webview`)

**What it does:** Embeds a web page inside the Lynx app (like an iframe). Renders HTML content via a native WebView/WKWebView/WebEngine.

**Web-platform tag:** `x-webview`

**Key attributes:** `src` (URL to load)

**Events:** `load`

**Registered via:** Native `RegisterNativeView("x-webview")` in the Lynx extension module

**Priority:** Low-Medium — needed for embedding third-party web content, OAuth flows, T&C pages. More limited than `<frame>` (which embeds another Lynx page).

**Implementation:** `__CreateElement('x-webview', pageId)`. Requires native-side registration.

---

### `<x-markdown>` (aka `markdown`)

**What it does:** Renders Markdown content as styled native text. Lazily loads markdown-it and DOMPurify for parsing and sanitization.

**Web-platform tag:** `x-markdown`

**Priority:** Very Low — niche element for rendering user-generated markdown content. Could also be done with a custom component that parses markdown to `<x-text>` elements.

**Implementation:** `__CreateElement('x-markdown', pageId)`. Likely takes markdown content as an attribute or child text.

---

## Pending: Clay-Platform Variants

The Clay platform (Lynx on web/desktop) uses alternative element names for some XElements. These are functionally equivalent to their counterparts but have different tag names in the web-platform implementation:

| Clay tag         | Equivalent official element | Notes                                  |
| ---------------- | --------------------------- | -------------------------------------- |
| `x-refresh-view` | `<refresh>`                 | Same pull-to-refresh, different name   |
| `x-viewpager-ng` | `<viewpager>`               | "Next gen" viewpager variant           |
| `x-foldview-ng`  | `<scroll-coordinator>`      | Foldable header/toolbar/content layout |
| `x-overlay-ng`   | `<overlay>`                 | "Next gen" overlay variant             |

### Child elements of Clay variants

| Element                   | Parent           | Purpose                              |
| ------------------------- | ---------------- | ------------------------------------ |
| `x-foldview-header-ng`    | `x-foldview-ng`  | Collapsible header                   |
| `x-foldview-toolbar-ng`   | `x-foldview-ng`  | Fixed toolbar (stays visible)        |
| `x-foldview-slot-ng`      | `x-foldview-ng`  | Scrollable content area              |
| `x-foldview-slot-drag-ng` | `x-foldview-ng`  | Drag-enabled scrollable content area |
| `x-refresh-header`        | `x-refresh-view` | Pull-to-refresh header               |
| `x-refresh-footer`        | `x-refresh-view` | Pull-to-load-more footer             |
| `x-viewpager-item-ng`     | `x-viewpager-ng` | Individual page                      |
| `x-swiper-item`           | `x-swiper`       | Individual slide                     |

> **Note:** It's unclear whether the Angular renderer should support both naming conventions (official + Clay) or just one. The web-platform uses the `x-*-ng` names; official docs use bare names (`refresh`, `viewpager`, `scroll-coordinator`). The native Lynx runtime likely uses the official names. Need to test which `__CreateElement` tag string the native runtime accepts.

---

## Pending: Web-Platform-Only Elements (Not Native Lynx)

These elements exist **only in the web-platform** implementation and are NOT native Lynx elements. They are web-specific internal shims. The Angular renderer targets native Lynx, so these should NOT be implemented — they're listed here for completeness to avoid future confusion.

| Element        | Purpose                                                       | Why not needed                                                                                                                               |
| -------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter-image` | Image with `blur-radius` and `drop-shadow` CSS filter effects | Web-only shim. Native Lynx handles `blur-radius`/`tint-color` on `<image>` directly.                                                         |
| `inline-text`  | Inline text inside `<text>`                                   | **Deprecated.** Use `<x-text>` inside `<x-text>` instead.                                                                                    |
| `inline-image` | Inline image inside `<text>`                                  | **Deprecated.** Use `<x-image>` inside `<x-text>` instead.                                                                                   |
| `lynx-wrapper` | Framework-internal wrapper element                            | Internal to React Lynx's component model. Angular doesn't need it — Angular has its own component hosting. Maps to `__CreateWrapperElement`. |
| `x-svg`        | Web custom element for `<svg>`                                | Web-platform tag name for `svg`. Native Lynx uses bare `svg` tag.                                                                            |
| `x-input-ng`   | "Next gen" input variant                                      | Referenced in some test fixtures but not a distinct element.                                                                                 |

---

## Pending: Text Sub-elements

### `<inline-truncation>`

**What it does:** Used inside `<x-text>` to customize the content displayed at the end of truncated text (e.g., a "Read more" button instead of `...`).

**Priority:** Low — cosmetic enhancement. `text-overflow: ellipsis` works for basic truncation.

**Implementation:** `__CreateElement('inline-truncation', pageId)`. Must be a child of `x-text`.

---

## Pending: Inline Nested Elements

These are documented in the compat data as special element variants when used _inside_ `<text>`:

### `<nested-text>` (text inside text)

**What it does:** A `<text>` element nested inside another `<text>`. Behaves as an inline span — inherits `color` and `font-family` from the parent text. Used for inline styling (bold word, colored phrase, etc.).

**Platform:** All (since v1.5; HarmonyOS since v3.4)

**Priority:** Already works — this is just `<x-text>` inside `<x-text>`. No separate element type needed. The compat data tracks it separately because nested text has different CSS/attribute support than top-level text.

---

### `<nested-image>` (image inside text)

**What it does:** An `<image>` element nested inside a `<text>`. Renders inline alongside text content. Used for emoji, inline icons, inline badges.

**Platform:** All (since v1.5; HarmonyOS since v3.4)

**Priority:** Already works — this is just `<x-image>` inside `<x-text>`. The compat data tracks it separately because inline images have different attribute support (e.g., they support `vertical-align` for alignment with surrounding text).

---

## Implementation Strategy

### Easy wins (just add to the switch statement)

Most missing elements can be supported by adding a case to `lynx-document.ts`. These elements don't need special DOM handling — they're just containers or leaf nodes with attributes:

```typescript
// frame has a dedicated creation function (like view, text, image)
case 'frame': {
  element = __CreateFrame(this.#pageId);
  break;
}
// x-scroll-view is an alias for scroll-view
case 'x-scroll-view': {
  element = __CreateScrollView(this.#pageId);
  break;
}
// All other elements use the generic __CreateElement(tag, pageId)
case 'input':
case 'textarea':
case 'overlay':
case 'svg':
case 'refresh':
case 'refresh-header':
case 'viewpager':
case 'viewpager-item':
case 'scroll-coordinator':
case 'scroll-coordinator-header':
case 'scroll-coordinator-toolbar':
case 'scroll-coordinator-slot':
case 'inline-truncation':
case 'title-bar-view':
// Web-platform / undocumented elements
case 'x-swiper':
case 'x-swiper-item':
case 'x-blur-view':
case 'x-canvas':
case 'x-audio-tt':
case 'x-webview':
case 'x-markdown':
// Clay-platform variant names
case 'x-refresh-view':
case 'x-refresh-header':
case 'x-refresh-footer':
case 'x-viewpager-ng':
case 'x-viewpager-item-ng':
case 'x-foldview-ng':
case 'x-foldview-header-ng':
case 'x-foldview-toolbar-ng':
case 'x-foldview-slot-ng':
case 'x-foldview-slot-drag-ng':
case 'x-overlay-ng': {
  element = __CreateElement(tag, this.#pageId);
  break;
}
```

> **Open question:** Do XElements use the `x-` prefix in Lynx templates or the bare name? React Lynx JSX uses bare names (`<input>`, `<textarea>`, `<overlay>`), but the web-platform registers them with `x-` prefix (`x-input`, `x-overlay-ng`). The native Lynx runtime likely accepts bare names since that's what the snapshot compiler generates. Need to test which `__CreateElement` tag string the native runtime accepts.

### Elements needing special handling

| Element                            | Why                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `<input>`                          | Angular forms integration (`ControlValueAccessor`), value access via `SelectorQuery`  |
| `<textarea>`                       | Same as `<input>`                                                                     |
| `<refresh>` / `<x-refresh-view>`   | Method calls (`finishRefresh()`), lifecycle events                                    |
| `<viewpager>` / `<x-viewpager-ng>` | May need index tracking / page change event coordination                              |
| `<x-canvas>`                       | Canvas 2D context API needs bridge — drawing happens via node methods, not attributes |
| `<x-audio-tt>`                     | Playback state management, media events                                               |
| `<x-swiper>`                       | Auto-scroll, circular mode, indicator state — potentially complex like `<x-list>`     |

### Native dependency requirement

None of the XElements will work unless the native app host includes the appropriate plugins. The Angular renderer can create the elements, but they'll render as empty/invisible without native support. This should be documented clearly.

---

## Element Creation API Reference

The snapshot compiler (`lib.rs`) reveals which elements have **dedicated** creation functions vs the generic fallback:

| Element tag       | Creation function                  | Status                                            |
| ----------------- | ---------------------------------- | ------------------------------------------------- |
| `view`            | `__CreateView(pageId)`             | ✅ Implemented                                    |
| `scroll-view`     | `__CreateScrollView(pageId)`       | ✅ Implemented                                    |
| `x-scroll-view`   | `__CreateScrollView(pageId)`       | ✅ Implemented (alias)                            |
| `image`           | `__CreateImage(pageId)`            | ✅ Implemented                                    |
| `text`            | `__CreateText(pageId)`             | ✅ Implemented                                    |
| `wrapper`         | `__CreateWrapperElement(pageId)`   | N/A (React Lynx internal)                         |
| `list`            | special `snapshotCreateList(...)`  | ✅ Implemented                                    |
| `frame`           | `__CreateFrame(pageId)`            | ❌ **Missing** — needs type decl + implementation |
| `page`            | `__CreatePage(componentId, cssId)` | ✅ Implemented (internal)                         |
| _everything else_ | `__CreateElement(tag, pageId)`     | ❌ **Missing** — generic fallback                 |

### Key insight: `__CreateBlock`, `__CreateIf`, `__CreateFor` are NOT in React Lynx

These functions don't appear anywhere in the React Lynx reference implementation. They are Lynx template engine primitives (for the non-framework Lynx templating DSL). React Lynx uses its own virtual DOM reconciler instead. Our Angular renderer currently uses them, which works but may be unnecessary — Angular's own `@if`/`@for` control flow handles the same responsibility through the comment-node-as-anchor pattern we already implement.

---

## Full Element Inventory

### Total: 39 pending elements (+ 1 alias)

| Category                         | Count | Elements                                                                                                                                                                         |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core built-in                    | 1     | `frame`                                                                                                                                                                          |
| Official XElements               | 8     | `input`, `textarea`, `overlay`, `svg`, `refresh`, `viewpager`, `scroll-coordinator`, `title-bar-view`                                                                            |
| Official child elements          | 6     | `viewpager-item`, `refresh-header`, `scroll-coordinator-header`, `scroll-coordinator-toolbar`, `scroll-coordinator-slot`, `inline-truncation`                                    |
| Web-platform extras              | 6     | `x-swiper`, `x-blur-view`, `x-canvas`, `x-audio-tt`, `x-webview`, `x-markdown`                                                                                                   |
| Web-platform child elements      | 1     | `x-swiper-item`                                                                                                                                                                  |
| Clay-platform variants           | 4     | `x-refresh-view`, `x-viewpager-ng`, `x-foldview-ng`, `x-overlay-ng`                                                                                                              |
| Clay child elements              | 8     | `x-foldview-header-ng`, `x-foldview-toolbar-ng`, `x-foldview-slot-ng`, `x-foldview-slot-drag-ng`, `x-refresh-header`, `x-refresh-footer`, `x-viewpager-item-ng`, `x-swiper-item` |
| Aliases (already work)           | 1     | `x-scroll-view` → maps to same `__CreateScrollView` as `scroll-view`                                                                                                             |
| Already work (no changes needed) | 2     | `nested-text` (= `x-text` in `x-text`), `nested-image` (= `x-image` in `x-text`)                                                                                                 |
| Web-platform only (NOT needed)   | 6     | `filter-image`, `inline-text`, `inline-image`, `lynx-wrapper`, `x-svg`, `x-input-ng`                                                                                             |

---

## Priority Summary

| Priority       | Elements                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **High**       | `input`, `textarea`                                                                                                |
| **Medium**     | `overlay`, `svg`, `refresh` (+ `refresh-header`), `viewpager` (+ `viewpager-item`), `x-swiper` (+ `x-swiper-item`) |
| **Low-Medium** | `scroll-coordinator` (+ children), `x-blur-view`, `x-canvas`, `x-webview`                                          |
| **Low**        | `frame`, `inline-truncation`, `x-audio-tt`                                                                         |
| **Very Low**   | `title-bar-view`, `x-markdown`, Clay-platform variants (if not targeting Clay)                                     |
