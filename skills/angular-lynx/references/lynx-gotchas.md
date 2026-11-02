# Lynx Platform Gotchas

Curated list of Lynx-vs-web differences that cause bugs. Organized by severity.

## Critical (Will Crash or Break Your App)

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

Does NOT stay fixed during scroll. Lynx lifts a fixed view to the page root, above the page, and hit-tests it like any other view, so it's also how to float a panel that leaves the rest of the screen usable (see "`<overlay>` takes every touch").

### `position: sticky` only works in `<scroll-view>`

Has no effect in other contexts.

### No margin collapsing

Two siblings with `margin-bottom: 16px` and `margin-top: 8px` produce 24px of space (not 16px).

### Default `box-sizing` is `border-box`

Not `content-box`. Width/height include padding and border.

### `display: none` text still draws on iOS

Lynx shrinks a hidden element and everything in it to 0×0, but on iOS a `<text>` inside still draws its glyphs, spilling out from the element's top-left corner. Give the element `overflow: hidden` while it's hidden.

### No CSS inheritance

Every element must declare its own `font-size`, `color`, etc. Exceptions: nested `<text>` inherits `color`/`font-family` from parent `<text>`, and CSS variables (`--x`) inherit.

### `flex-shrink` can shrink below min-content

Lynx treats min-content as 0px. Set explicit `min-width`/`min-height` to prevent over-shrinking.

### `visibility: hidden` can't be overridden by children

Once a parent is hidden, all descendants stay hidden regardless of their `visibility` value.

### A component's host is a real `<view>`

Every component's host element is a `<view>` in the layout, between the parent and the component's template. Angular writes each static attribute written on a component onto its host, whether or not it's an input, so a component that also passes its `class` input to an inner view applies it twice: `<app-card-content class="pt-6">` gets double padding. A component can't stop that, since a template's static classes outrank a host `[class]` binding. Make the host the element instead: bind the classes on it and drop the wrapper view. A component that shows text can make its host a `<text>` with `registerHostElement()`, from `@blotch/angular-lynx`:

```typescript
@Component({
  selector: 'app-title',
  host: { class: 'text-2xl font-semibold' },
  template: '<ng-content />',
})
export class AppTitle {}

registerHostElement(AppTitle, 'text'); // or 'image', 'scroll-view', 'svg', 'blur-view'
```

Content projected into a `<text>` host follows `<text>`'s rules: raw text, and nested `<text>`. An attribute meant for an inner element, such as an `<input>`'s `placeholder`, also lands on the host; remove it there with `host: { '[attr.placeholder]': 'null' }`. A bound `[class]="x"` doesn't have the problem: when the component has a `class` input, Angular gives the binding to the input only.

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

Use runtime logic with conditional classes. For `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`, inject `LynxAccessibilitySettings`: its `reduceMotion()`, `reduceTransparency()` and `increaseContrast()` signals come from the host app's global props (the `ng build --platform` apps send them) and, in the web preview, from the browser's media queries.

### `SystemInfo.osVersion` is missing where Angular runs

Lynx builds the native main thread's `SystemInfo` without the OS version. `LynxSystemInfo.osVersion` fills it in from the host's `osVersion` global prop (the generated apps send it), or else from the background thread shortly after the first frame; read it in a `computed()`.

### No `::before` / `::after`

Use explicit `<view>` elements for decorative content.

### No `:hover` / `:focus`

`:active` works (tracks touch state). Use signal-driven class toggling.

### No `pointer-events`

Use DOM ordering (earlier siblings = lower z-order, later = higher).

### No SVG images

`<image>` doesn't support SVG. Supported: png, jpg, jpeg, bmp, gif, webp. Inline `<svg>` element partially works (17 SVG tags).

Write `xmlns="http://www.w3.org/2000/svg"` on the root of an `<svg content>` string. The phone draws it either way, but the web preview shows `content` as an SVG image, which a browser leaves blank without the namespace. SVG copied from an HTML page often leaves it out. `<ui-icon [svg]>` adds it for you.

### No `<select>`, `<input type="checkbox">`, `<input type="radio">`

Build custom selection UI with `<view>` and state. Mark the chosen option for screen readers with `[lynxAccessibilityTraits]="{ selected: chosen() }"`.

### No `localStorage` / `sessionStorage`

- **Data kept after the app closes:** `LynxLocalStorage`, or `LynxSecureStorage` for tokens (Keychain on iOS, Android Keystore encryption on Android). Async: `await storage.setItem(key, value)`, `await storage.getItem<T>(key)` (`null` when unset), `removeItem(key)`, `clear()`. Values are JSON. Only `ng build --platform` apps have the native modules; Lynx Explorer and tests keep values in memory, and the web uses `localStorage`.
- **State shared between pages while the app runs:** `LynxSessionStorage`, which empties when the app quits.

### HTTP needs absolute URLs

`HttpClient` and `fetch()` work on the main thread (the runtime relays them to the background thread), but there's no page URL to resolve `/api/x` against. See [http-requests.md](http-requests.md).

### `TextEncoder` / `TextDecoder` are UTF-8 only

The runtime adds them to the main thread. Any other encoding label throws a `RangeError`.

### The keyboard covers a focused field

Lynx doesn't scroll or pan to keep a field above the keyboard. `avoid-keyboard="true"` on an `<input>` (with `avoid-keyboard-spacing="8px"`: Android needs a unit) moves the whole page up until the field clears it, which suits a form but not a bar at the bottom of the screen. To move one element instead, read the input's `(bindkeyboardheightchange)` while it's focused. `detail.height` is in points from the bottom of the window on iOS, and in physical pixels from the bottom of the Lynx view on Android, and 0 as the keyboard hides.

### VoiceOver can't swipe an `adjustable` element

`accessibility-traits="adjustable"` makes VoiceOver announce the element as adjustable, but Lynx's iOS views don't respond to its swipe up and down, and Android ignores the trait. Offer `[accessibility-actions]="['Increase', 'Decrease']"` and handle `(bindaccessibilityaction)`: VoiceOver lists the actions in its Actions rotor, and TalkBack in its actions menu.

### `URL` and `URLSearchParams` come from the runtime

PrimJS has neither on the main thread. The runtime installs standards-following versions, because Angular's Router, `HttpClient` and `NgOptimizedImage` loaders call `new URL()`. Use them as on the web.

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

### No `backdrop-filter`

iOS and Android drop it, so Tailwind's `backdrop-blur-*` blurs nothing there (the Lynx Tailwind 3 preset doesn't even generate it). To blur what's behind an element, use `<blur-view>`.

### Don't fade a `<blur-view>` itself

On iOS, a blur view's own opacity below 1 makes its material vanish. Animate the opacity of a plain `<view>` around it instead: iOS then draws the glass as a translucent sheet that fades, as UIKit's alerts do.

### Don't reveal glass with `visibility` during a fade

On iOS, a glass `<blur-view>` whose ancestor turns from `visibility: hidden` to `visible` while `animate()` fades that ancestor in draws nothing, even after the fade ends: its children show, the glass doesn't. To keep glass out of sight while it waits, such as for a measurement, move it off screen with a `transform` instead, and show it with the fade alone.

### Glass takes one corner radius on iOS

A glass `<blur-view>` with per-corner radii (`rounded-t-3xl rounded-b-[54px]`) draws square on iOS: only a single `border-radius` shapes the glass. Lynx can't animate `border-radius` either, so a glass shape keeps its corners while it moves or resizes. Give glass one radius, and change its shape through its size and position, which iOS's glass follows frame by frame. Per-corner radii work on a plain `<view>` laid over it.

### `mask-image` on a `<scroll-view>` doesn't work on Android

A gradient `mask-image` works on a `<view>` everywhere, but on a `<scroll-view>` only on iOS and the web: Android draws the scroll view unmasked. Put the mask on a view around the scroll view. On iOS and Android, gradient stops must be percentages, so a stop a fixed distance from an edge has to come from the element's measured height.

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

`scroll`, `input`, `load`, `animationend` etc. only reach the target element. No bubble/capture. Mouse, wheel and key events bubble too, on the platforms that send them: Lynx's desktop engine and Lynx for Web. iOS and Android don't send them.

### `tap` and `longpress` are mutually exclusive

If both are registered, `longpress` takes priority — `tap` won't fire on long press.

### `layoutchange` positions differ by platform

`width` and `height` agree everywhere, but `top` and `left` are measured from the page on iOS and from the parent on Android. Read only the size from `(bindlayoutchange)`, and measure a position with `boundingClientRect` (see `SelectorQuery` below).

### `<overlay>` takes every touch

While an `<overlay>` is shown, nothing else on screen gets touches: right for a modal, wrong for a popover or a toast. Float those in a `position: fixed` view instead, and close a popover on a touch anywhere else with `(global-bindtouchstart)`, which runs for a touch on any element, before that element's own listeners. `npx @blotch/dolan add popover` adds one that does this.

### `capture-bind` listeners didn't run on iOS

In Lynx Explorer 4.1 on iOS, `capture-bindtouchstart` and `capture-bindtap` on a view never ran, while a `bindtouchstart` on the same element did. Don't rely on the capture phase on iOS; a `global-bind` listener hears every touch first.

### `SelectorQuery` is async

No synchronous `querySelector`. Must use `lynx.createSelectorQuery().select().exec(callback)`.

---

## Animation

### Animatable properties are whitelisted

Only: `left`, `right`, `top`, `bottom`, `width`, `height`, `opacity`, `background-color`, `color`, `transform`, `transform-origin`, `max-*`, `min-*`, `padding-*`, `margin-*`, `border-*-width`, `border-*-color`, `flex-basis`, `flex-grow`, `filter`.

### `animation-iteration-count: 0` fires lifecycle events

Unlike web where it's a no-op.

### On Android, a shadow inside an animated view can draw twice

A `box-shadow` inside a view that `animate()` scales or fades can draw a second time on Android, offset by twice the animated view's position. Give the animated view a native view of its own with `[flatten]="false"`.

### `rotate3d()` and `scale3d()` not supported

Use `rotateX()`/`rotateY()`/`rotateZ()` and `scaleX()`/`scaleY()`/`scaleZ()` separately.

---

## Surprising Defaults

| Property       | Web Default   | Lynx Default |
| -------------- | ------------- | ------------ |
| `display`      | `block`       | `linear`     |
| `box-sizing`   | `content-box` | `border-box` |
| `position`     | `static`      | `relative`   |
| `border-style` | `none`        | `solid`      |
| `font-size`    | `16px`        | `14px`       |
