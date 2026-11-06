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

`display: block` would lay out as a `flex` row on Lynx, so AngularLynx turns it into `linear`: the build in stylesheets, the runtime in inline styles. `inline` and `inline-block` become `linear` too, and `inline-flex` and `inline-grid` become `flex` and `grid`. A test that reads the style back sees the Lynx value: after `[style.display]="'block'"`, `element.style.display` is `'linear'`. A value from a `var()` (`display: var(--d)`) isn't rewritten.

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

Lynx shrinks a hidden element and everything in it to 0×0, but on iOS a `<text>` inside still draws its glyphs, spilling out from the element's top-left corner. Give the element `overflow: hidden` while it's hidden. HTML's `hidden` attribute (`[hidden]="!open()"`) does both.

### No CSS inheritance

Every element must declare its own `font-size`, `color`, etc. Exceptions: nested `<text>` inherits `color`/`font-family` from parent `<text>`, CSS variables (`--x`) inherit, and HTML text tags (`<p>`, `<span>`…) and loose text take the text styles their ancestors' classes set, through variables the build adds (see [lynx-elements.md](lynx-elements.md)).

### A hidden view in a `<text>` leaves a gap on iOS

On iOS, a `display: none` `<view>` inside a `<text>` still takes room in the line, and adds an empty line above it. Angular's `@if`/`@for` anchors are such views, so `<text>Hi @if (x) {…}</text>` used to show a gap. The runtime makes an anchor in a `<text>` an empty raw-text, which draws nothing, and a hidden view again when it leaves.

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

### Raw text in `<view>` gets an anonymous `<text>`

Lynx draws text only inside `<text>`, so the runtime draws raw text whose parent is a `<view>` (a `<div>`, `<li>`, component host or any other element that isn't a `<text>`) in an anonymous `<text>` (class `_ngtext`), with the HTML inline tags beside it when the parent lays out as a block. Angular never sees it: `parentNode()` of the text is the `<view>`. It reads the text styles its ancestors' classes set (see [lynx-elements.md](lynx-elements.md)). A Lynx element beside it (`<view>Hi <text>there</text></view>`) still ends the line: "Hi" stacks above "there". While its text is blank (an empty `{{ name() }}`), the anonymous `<text>` is hidden, so it takes no room. The grouping is settled at the end of each change detection, before the flush.

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

### `LynxSystemInfo.platform` is spelled as Lynx reports it

Compare it with the exact strings in `PlatformType` (exported from `@blotch/angular-lynx`): `'Android'`, `'iOS'`, `'Harmony'`, `'windows'`, `'macOS'` or `'web'`. The casing is uneven, and `platform === 'ios'` never matches. `'web'` is the web preview. Type against the runtime's `PlatformType`, not `@lynx-js/types`' one, which leaves out `'web'` and still lists the retired `'pc'`.

### No `::before` / `::after`

Use explicit `<view>` elements for decorative content.

### No `:hover` / `:focus`

`:active` works (tracks touch state). Use signal-driven class toggling.

### No `pointer-events`

Use DOM ordering (earlier siblings = lower z-order, later = higher).

### No SVG images

`<image>` doesn't support SVG. Supported: png, jpg, jpeg, bmp, gif, webp. Inline `<svg>` element partially works (17 SVG tags).

Write `xmlns="http://www.w3.org/2000/svg"` on the root of an `<svg content>` string. The phone draws it either way, but the web preview shows `content` as an SVG image, which a browser leaves blank without the namespace. SVG copied from an HTML page often leaves it out. `<ui-icon [svg]>` adds it for you.

### No `<input type="file">`

Pick photos with `LynxImagePicker`, which opens the phone's picker and resolves with a `Blob`. Show it with `<image [src]>` and `URL.createObjectURL()`. See [http-requests.md](http-requests.md#pick-a-photo-to-upload).

### No `<select>`, `<input type="checkbox">`, `<input type="radio">`

Build custom selection UI with `<view>` and state. Mark the chosen option for screen readers with `[lynxAccessibilityTraits]="{ selected: chosen() }"`.

### No `localStorage` / `sessionStorage`

- **Data kept after the app closes:** `LynxLocalStorage`, or `LynxSecureStorage` for tokens (Keychain on iOS, Android Keystore encryption on Android). Async: `await storage.setItem(key, value)`, `await storage.getItem<T>(key)` (`null` when unset), `removeItem(key)`, `clear()`. Values are JSON. Only `ng build --platform` apps have the native modules; Lynx Explorer and tests keep values in memory, and the web uses `localStorage`.
- **State shared between pages while the app runs:** `LynxSessionStorage`, which empties when the app quits.

### HTTP needs absolute URLs

`HttpClient` and `fetch()` work on the main thread (the runtime relays them to the background thread), but there's no page URL to resolve `/api/x` against. Files the app bundles are the exception in `ng build --platform` apps. See [http-requests.md](http-requests.md).

### No `navigator.clipboard`

Copy and paste text with `LynxClipboard`: `await clipboard.setString(text)` and `await clipboard.getString()` (`''` when it holds no text). It uses `UIPasteboard` on iOS, `ClipboardManager` on Android and the page's Clipboard API in the web preview, where you call `setString()` straight from the tap's handler, before any `await`. Only `ng build --platform` apps have the native module: in Lynx Explorer both reject with a `ClipboardError` whose `code` is `unavailable`.

- **Don't read the clipboard on launch.** iOS 16+ asks "Allow Paste?" before the app reads text another app copied (a refusal reads as `''`), and Android 12+ shows a "pasted" message.
- **Android 13+ confirms every copy itself,** in a panel TalkBack reads. Check `clipboard.confirmsCopies` before showing or announcing your own "Copied".
- For a ready-made button, `npx @blotch/dolan add copy-button` adds `<ui-copy-button [value]="code()">Copy code</ui-copy-button>`, which does both.

### No 2D canvas, and WebGL only in built apps

`<canvas>` has only a WebGL2 context, and only in apps built with `ng build --platform ios|android` and the web preview: Lynx Explorer's `getContext('webgl2')` is `null`. Libraries that draw with `getContext('2d')`, such as most chart libraries, don't work. See "3D with `<canvas>`" in [lynx-elements.md](lynx-elements.md).

### `<video>` in the web preview only plays and pauses

The web preview plays `<video>` in the browser's own HTML video. `invoke('play')` and `invoke('pause')` work, and `(bindplaying)`, `(bindtimeupdate)`, `(bindended)` and `(binderror)` fire with the same `detail` as on the phone. `(bindfirstframe)`, `(bindpaused)` and `(bindstopped)` never fire there, and `stop` and `seek` do nothing, so don't rely on them to keep the UI's state.

### `getBoundingClientRect()` is the last layout's

An element's `getBoundingClientRect()`, `clientWidth` and `clientHeight` answer synchronously from its last `layoutchange`, so they're empty until it's laid out. `ResizeObserver` works on Lynx elements. For a box native measures now, use `SelectorQuery`'s `boundingClientRect`.

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

### `var()` inside `calc()` doesn't work in an inline style

`style="height: calc(10px + var(--h))"`, or the same value in a `[style.height]` binding, gives the element no height: Lynx takes any inline `calc()` as a length without substituting the `var()` in it. The same declaration works in a stylesheet, and so does a bare `var()` inline. Compute the value in TypeScript, or move the `calc()` to a class. `env(safe-area-inset-*)` inside an inline `calc()` is fine: the runtime fills in the inset itself.

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

---

## Memory

### A shorter `length` keeps what it cut off

PrimJS, which runs the main thread, keeps the values an array held in the slots past its length until something writes over them, so a long-lived array keeps what it removed for as long as the array lives. The build makes `pop()`, `shift()` and `splice()` clear those slots, but nothing can hook `array.length = 0` or `delete array[array.length - 1]`. Empty a long-lived array that holds objects with `array.splice(0)`.

---

## Build

### A hex color that reads as an exponent is mangled

The CSS pipeline minifies `rgba(92, 94, 102, 1)` to `#5c5e66`, and a later tokenizer reads `5e66` as a number: the web preview's stylesheet holds `#5c9999`. Any hex with a digit, `e`, digit run (`#3e4048` too) is at risk; `#71717a` or `#3f3f46` is fine. Pick a neighbouring value (`rgba(92, 95, 102, 1)`) until it's fixed. Not yet checked on iOS and Android.

### `this.#field?.()[key]` throws when the field is unset

The Lynx bundle compiles first-party `#private` fields to properties, and that pass puts the `[key]` outside the optional chain's short-circuit, so `this.#onColors?.()[scheme]` throws `Cannot read properties of undefined` instead of giving `undefined`. Split it: `const fn = this.#onColors; const colors = fn ? fn()[scheme] : undefined;`. A local constant in the same shape compiles correctly.
