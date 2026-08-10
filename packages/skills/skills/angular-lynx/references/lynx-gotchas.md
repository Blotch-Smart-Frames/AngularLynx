# Lynx Platform Gotchas

Curated list of Lynx-vs-web differences that cause bugs. Organized by severity.

## Critical (Will Crash or Break Your App)

### Element pool exhaustion

Lynx has ~256 native element slots. `__RemoveElement` detaches but doesn't free slots. After ~9 navigations (default Angular destroy-on-navigate), the app crashes. **Fix:** Use `LynxRouteReuseStrategy` (provided automatically by `provideRouter`).

### DOM mutations in event worklets

Synchronous DOM mutations inside `bindtap`/`bindinput` handlers crash the app. **Fix:** Wrap all tree-mutating operations in `setTimeout(() => { ... }, 0)`.

### Missing `item-key` on `<list-item>`

The native list engine requires a unique `item-key` attribute on every `<list-item>`. Without it, the engine crashes. **Fix:** Always set `item-key="{{ uniqueId }}"`.

### Zone.js incompatibility

Zone.js depends on browser globals that don't exist in Lynx. Using it crashes at bootstrap. **Fix:** Use `provideZonelessChangeDetection()` (mandatory).

### `AbortController` / `queueMicrotask` missing

Angular Router v21+ and the zoneless scheduler use these internally. Without polyfills, navigation silently dies. **Fix:** The runtime polyfills both automatically.

### Timer APIs not on `globalThis`

`setTimeout`/`setInterval`/`requestAnimationFrame` live on the `lynx` object, not `globalThis`. Without polyfills, Angular's scheduler never fires. **Fix:** Runtime polyfills these automatically.

---

## Layout

### Default display is `linear`, not `block`

Lynx has no flow layout. Default is `linear` (like Android LinearLayout). Only `linear`, `flex`, `grid`, `relative`, `none` are supported.

### `scroll-view` requires explicit height

Without `height: 100vh` or a flex constraint, scroll-view expands to fit content and never scrolls.

### `overflow: scroll`/`auto` don't work on `<view>`

Only `<scroll-view>` and `<list>` can scroll. `overflow` only supports `visible` and `hidden`.

### `position: fixed` = absolute relative to root

Does NOT stay fixed during scroll. Use for full-screen overlays only.

### `position: sticky` only works in `<scroll-view>`

Has no effect in other contexts.

### No margin collapsing

Two siblings with `margin-bottom: 16px` and `margin-top: 8px` produce 24px of space (not 16px).

### Default `box-sizing` is `border-box`

Not `content-box`. Width/height include padding and border.

### No CSS inheritance

Every element must declare its own `font-size`, `color`, etc. Exception: nested `<text>` inherits `color`/`font-family` from parent `<text>`.

### `flex-shrink` can shrink below min-content

Lynx treats min-content as 0px. Set explicit `min-width`/`min-height` to prevent over-shrinking.

### `visibility: hidden` can't be overridden by children

Once a parent is hidden, all descendants stay hidden regardless of their `visibility` value.

---

## Text

### Raw text in `<view>` doesn't render

All visible text must be inside `<text>`. No text nodes in `<view>`.

### Default `font-size` is 14px (not 16px)

No keyword sizes (`small`, `medium`, `large`).

### `line-height` only works on `<text>` elements

Setting it on a container `<view>` has no effect.

### `white-space` only supports `normal` and `nowrap`

No `pre`, `pre-wrap`, `pre-line`.

### `text-align: justify` not supported

Only `left`, `right`, `center`, `start`/`end`.

### No `text-transform`

Must handle uppercase/lowercase in JavaScript.

---

## Missing APIs

### No `@media` queries

Use runtime logic with conditional classes.

### No `::before` / `::after`

Use explicit `<view>` elements for decorative content.

### No `:hover` / `:focus`

`:active` works (tracks touch state). Use signal-driven class toggling.

### No `pointer-events`

Use DOM ordering (earlier siblings = lower z-order, later = higher).

### No SVG images

`<image>` doesn't support SVG. Supported: png, jpg, jpeg, bmp, gif, webp. Inline `<svg>` element partially works (17 SVG tags).

### No `<select>`, `<input type="checkbox">`, `<input type="radio">`

Build custom selection UI with `<view>` and state.

### No `localStorage` / `sessionStorage`

Use `lynx.setSessionStorage(key, value)` / `lynx.getSessionStorage(key)`.

### No `fetch` on main thread

Only available on background thread. Use IPC to relay if needed.

### No `TextEncoder` / `TextDecoder`

Use `lynx.requireModule('TextCodecHelper')`.

### No `URL` constructor

Manual string parsing needed. `LynxPlatformLocation` handles this.

---

## Styling Quirks

### Default `border-style` is `solid` (not `none`)

Setting `border-style: none` doesn't collapse width — also set `border-width: 0`.

### `!important` not supported

Use specificity-based overrides.

### `border-style: dotted`/`dashed` render as solid

Simulate with background images if needed.

### `border-width` keywords differ

`thin` = 2px, `medium` = 4px, `thick` = 6px (web: 1/3/5px). Default = 0.

### `filter` limited to one function

Supported: `blur`, `grayscale`, `brightness`, `contrast`, `saturate`. No chaining.

### `box-shadow: inset` not supported

Only outer shadows.

### `perspective` applies to the element itself, not children

Set perspective on the same element being transformed (opposite of web).

### `opacity` causes offscreen rendering

Performance cost. Children may clip unexpectedly on Android.

### `object-fit` not supported — use `mode` attribute

On `<image>`: `aspectFit`, `aspectFill`, `scaleToFill`, `center`.

---

## Events

### Only touch events propagate

`scroll`, `input`, `load`, `animationend` etc. only reach the target element. No bubble/capture.

### `tap` and `longpress` are mutually exclusive

If both are registered, `longpress` takes priority — `tap` won't fire on long press.

### `SelectorQuery` is async

No synchronous `querySelector`. Must use `lynx.createSelectorQuery().select().exec(callback)`.

---

## Animation

### Animatable properties are whitelisted

Only: `left`, `right`, `top`, `bottom`, `width`, `height`, `opacity`, `background-color`, `color`, `transform`, `transform-origin`, `max-*`, `min-*`, `padding-*`, `margin-*`, `border-*-width`, `border-*-color`, `flex-basis`, `flex-grow`, `filter`.

### `animation-iteration-count: 0` fires lifecycle events

Unlike web where it's a no-op.

### `rotate3d()` and `scale3d()` not supported

Use `rotateX()`/`rotateY()`/`rotateZ()` and `scaleX()`/`scaleY()`/`scaleZ()` separately.

---

## Surprising Defaults

| Property       | Web Default   | Lynx Default                   |
| -------------- | ------------- | ------------------------------ |
| `display`      | `block`       | `linear`                       |
| `box-sizing`   | `content-box` | `border-box`                   |
| `position`     | `static`      | `relative`                     |
| `border-style` | `none`        | `solid`                        |
| `font-size`    | `16px`        | `14px`                         |
| `image mode`   | `fill`        | `aspectFit` (Angular renderer) |
