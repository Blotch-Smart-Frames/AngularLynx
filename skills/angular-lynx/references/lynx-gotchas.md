# Lynx Platform Gotchas

Curated list of Lynx-vs-web differences that cause bugs. Organized by severity.

## Critical (Will Crash or Break Your App)

### Missing `item-key` on `<list-item>`

The native list engine requires a unique `item-key` attribute on every `<list-item>`. Without it, the engine crashes. **Fix:** Always set `item-key="{{ uniqueId }}"`. With `*lynxListFor`, `trackBy` gives it.

### Zone.js incompatibility

Zone.js depends on browser globals that don't exist in Lynx. Using it crashes at bootstrap. **Fix:** Use `provideZonelessChangeDetection()` (mandatory).

### `AbortController` / `queueMicrotask` missing

Angular Router v21+ and the zoneless scheduler use these internally. Without polyfills, navigation silently dies. **Fix:** The build polyfills both automatically.

### Timer APIs not on `globalThis`

`setTimeout`/`setInterval`/`requestAnimationFrame` live on the `lynx` object, not `globalThis`. Without polyfills, Angular's scheduler never fires. **Fix:** Runtime polyfills these automatically.

### `\p{…}` in a regex literal

The build compiles the main thread's script to bytecode, and that compiler rejects every Unicode property escape in a regex literal (`/\p{L}/u`, `/[\p{P}\p{Z}]/u`, `/\p{Script=Latin}/u`): `Compile error: main-thread.js exception: SyntaxError: invalid escape sequence in regular expression`. **Fix:** The build writes each escape out as the characters it matches, in the app's own code and in its packages' JavaScript in `node_modules` alike, so both forms work everywhere. A package's file is only rewritten if it has one.

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

### `display: none` content still draws on iOS

Lynx shrinks a hidden element and everything in it to 0×0, but on iOS what's inside still draws: a `<text>`'s glyphs and an `<svg>` spill out from the element's top-left corner, and several hidden elements pile up there on top of each other. Give the element `overflow: hidden` while it's hidden (Tailwind's `hidden overflow-hidden`). HTML's `hidden` attribute (`[hidden]="!open()"`) does both. Don't remove the content with an `@if` instead where it's projected: on iOS, `<ng-content>` inside a toggled `@if` can come back without the projected content (issue #380).

### No CSS inheritance

Every element must declare its own `color`, `line-height`, etc. Exceptions: `font-size` inherits (the build turns on Lynx's inheritance for it alone, so a `<text>` with no size takes its parent's), nested `<text>` inherits `color`/`font-family` from the `<text>` directly around it (a `<view>` in between stops it: text inside a `<view>` you project into a component's `<text>` draws black), CSS variables (`--x`) inherit, and HTML text tags (`<p>`, `<span>`…) and loose text take the text styles their ancestors' classes set, through variables the build adds (see [lynx-elements.md](lynx-elements.md)).

### A hidden view in a `<text>` leaves a gap on iOS

On iOS, a `display: none` `<view>` inside a `<text>` still takes room in the line, and adds an empty line above it. Angular's `@if`/`@for` anchors are such views, so `<text>Hi @if (x) {…}</text>` used to show a gap. The runtime makes an anchor in a `<text>` an empty raw-text, which draws nothing, and a hidden view again when it leaves.

### `flex-shrink` can shrink below min-content

Lynx treats min-content as 0px. Set explicit `min-width`/`min-height` to prevent over-shrinking.

A `<text>` squeezed narrower than one of its words breaks the word between letters (a tab's "Community" put its "y" on a second line), where a browser would keep the word whole. For a label that must stay on one line (a tab, a chip), set `text-maxline="1"` with `text-ellipsis`. On the web, a one-line `<text>` is as wide as its whole text, so a row that hugs its content (`self-start`) grows past the screen there instead of shrinking as it does on native: give the row `max-w-full`.

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

Lynx draws text only inside `<text>`, so the runtime draws raw text whose parent is a `<view>` (a `<div>`, `<li>`, component host or any other element that isn't a `<text>`) in an anonymous `<text>` (class `_ngtext`), with the HTML inline tags beside it when the parent lays out as a block. Angular never sees it: `parentNode()` of the text is the `<view>`. Lynx's CSS sees it, as the inline tags' parent: the build gives a child combinator a second selector through it, so `.row > b` still styles the `<b>` in `<div class="row">Total: <b>12</b></div>`. It reads the text styles its ancestors' classes set (see [lynx-elements.md](lynx-elements.md)). A Lynx element beside it (`<view>Hi <text>there</text></view>`) still ends the line: "Hi" stacks above "there". While its text is blank (an empty `{{ name() }}`), the anonymous `<text>` is hidden, so it takes no room. The grouping is settled at the end of each change detection, before the flush.

### Default `font-size` is 14px (not 16px), and so is `1rem`

Every `rem` size is an eighth smaller than in a browser: Tailwind's `h-12` is 42px, not 48px. `page { font-size: 16px; }` makes `1rem` 16px (the dolan UI theme sets it), and so the text of HTML text tags, loose text and a `<text>` with no font size of its own, which inherits it, or its parent's (see "No CSS inheritance"). No keyword sizes (`small`, `medium`, `large`).

### Text follows the phone's text size through `rem`, not `px`

The `ng build --platform` apps follow Dynamic Type (iOS) and the font size (Android), at launch and when it changes: the native build writes a `page` rule's px `font-size` in `sp` (adding `page { font-size: 14px }` for an app without one), and only `sp` takes the phone's scale, so `1rem`, and everything sized in `rem` (Tailwind's `text-base`, `h-12`, `p-4`, the dolan components), grows by it. A size in `px` stays as written: use it only for what mustn't grow. A `<text>` with no font size of its own inherits its parent's size: the page's, unless an element above sets one. So it grows with the phone, nested in another `<text>` as well, unless that size is in `px`: under a `text-[18px]` `<view>` it stays 18px. Lay out for growth: a fixed `px` height around `rem` text overflows at the large sizes, which reach about 3.1 on iOS. `inject(LynxAccessibilitySettings).textScale()` is the scale (1 at the default) for a layout that has to change. `"textScaling": false` in the build target's options keeps the default size, and `{ "max": 1.6 }` caps it. The web preview and Lynx Explorer stay at 1.

### `line-height` only works on `<text>` elements

Setting it on a container `<view>` has no effect.

### `white-space` only supports `normal` and `nowrap`

No `pre`, `pre-wrap`, `pre-line`.

### `text-align: justify` not supported

Only `left`, `right`, `center`, `start`/`end`.

### No `text-transform`

Must handle uppercase/lowercase in JavaScript.

### `text-maxline` needs `text-overflow: ellipsis`

`text-maxline` only sizes the box: iOS cuts the rest off without "…", and Android draws the extra lines over what follows. Pair it with `text-overflow: ellipsis` (Tailwind's `text-ellipsis`) on every platform.

```html
<text class="text-ellipsis text-sm" [text-maxline]="2">{{ title }}</text>
```

The build warns about each element with `text-maxline` and no ellipsis (`[Lynx] Capped text without an ellipsis`). It accepts `text-ellipsis` or `truncate`, an inline `text-overflow: ellipsis`, `[class.text-ellipsis]` or `[style.text-overflow]`, or a class that the component's styles or a global stylesheet end with an ellipsis. It can't read a `[class]` expression, so it trusts one when the component mentions an ellipsis anywhere. `npx @blotch/dolan add typography` adds `<ui-text [maxLines]="2">`, which sets both.

### An `<input>`'s `placeholder-color` attribute does nothing on iOS

iOS keeps the system's pale gray: its setter takes a color a string attribute never becomes. Set the CSS property in the style too, and keep the attribute for the web preview: `placeholder-color="#54607c" style="-x-placeholder-color: #54607c"`, or bound, `[attr.placeholder-color]="color()" [style.-x-placeholder-color]="color()"`.

---

## Missing APIs

### No `@media` queries

Use runtime logic with conditional classes. `prefers-color-scheme` on its own works: the build turns it into rules under `page.dark` (see "Dark Mode" in [styling-and-css.md](styling-and-css.md)). For `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`, inject `LynxAccessibilitySettings`: its `reduceMotion()`, `reduceTransparency()` and `increaseContrast()` signals come from the host app's global props (the `ng build --platform` apps send them) and, in the web preview, from the browser's media queries. Its `textScale()`, the phone's text size, comes from the global props only, and is 1 in the web preview.

### No visibility event when the app leaves the screen or comes back

Lynx pauses timers in the background and tells the app's code nothing, and a paused `setTimeout` can fire late once the app wakes. Inject `LynxAppState` instead: `state()` is `'active'`, `'inactive'` (on screen but not taking touches: Control Center, a call, split screen) or `'background'`, and `active()` is `state() === 'active'`. The `ng build --platform` apps send it in the `appState` global prop, the web preview follows the page's visibility, and Lynx Explorer stays `'active'`. Catch up on the way back:

```typescript
const appState = inject(LynxAppState);
effect(() => {
  if (appState.active()) untracked(() => this.#now.set(new Date()));
});
```

In a spec, `setAppState('background')` and `setAppState('active')` from the testing library move it; `await waitForUpdate()` after each, or an `effect()` never sees the app leave.

### `SystemInfo.osVersion` is missing where Angular runs

Lynx builds the native main thread's `SystemInfo` without the OS version. `LynxSystemInfo.osVersion` fills it in from the host's `osVersion` global prop (the generated apps send it), or else from the background thread shortly after the first frame; read it in a `computed()`.

### `LynxSystemInfo.platform` is spelled as Lynx reports it

Compare it with the exact strings in `PlatformType` (exported from `@blotch/angular-lynx`): `'Android'`, `'iOS'`, `'Harmony'`, `'windows'`, `'macOS'` or `'web'`. The casing is uneven, and `platform === 'ios'` never matches. `'web'` is the web preview. Type against the runtime's `PlatformType`, not `@lynx-js/types`' one, which leaves out `'web'` and still lists the retired `'pc'`.

### No `::before` / `::after`

Use explicit `<view>` elements for decorative content.

### No `:hover` / `:focus`, and `:active` doesn't apply

Use signal-driven class toggling. For a pressed state, set the signal on `(bindtouchstart)` and `(bindmousedown)` and clear it on `(bindtouchend)`, `(bindtouchcancel)`, `(bindmouseup)` and `(bindmouseleave)`: `:active` rules didn't take effect in these builds when measured on Android.

### No `pointer-events`

Use DOM ordering (earlier siblings = lower z-order, later = higher).

### No SVG images

`<image>` doesn't support SVG. Supported: png, jpg, jpeg, bmp, gif, webp. Inline `<svg>` element partially works (17 SVG tags).

Write `xmlns="http://www.w3.org/2000/svg"` on the root of an `<svg content>` string. The phone draws it either way, but the web preview shows `content` as an SVG image, which a browser leaves blank without the namespace. SVG copied from an HTML page often leaves it out. `<ui-icon [svg]>`, and the `[svg]` of the tab bar's, dock's, menu's and toolbar's items and the empty state, add it for you.

### No `<input type="file">`

Pick photos with `LynxImagePicker`, which opens the phone's picker and resolves with a `Blob`. Show it with `<image [src]>` and `URL.createObjectURL()`. See [http-requests.md](http-requests.md#pick-a-photo-to-upload).

### No `<input type="date">`

Lynx has no date field and no date picker. Don't build a calendar by hand: `npx @blotch/dolan add date-picker` adds `<ui-date-picker label="Ends on" clearable [(value)]="endsOn" />`, a field that opens a month calendar in a bottom sheet, and `npx @blotch/dolan add calendar` adds the calendar on its own (`<ui-calendar [(value)]="day" [min]="today" />`). The value is a `Date` at local midnight, or `null`. Both write their month names, weekdays and screen reader labels from `LOCALE_ID` with Angular's `formatDate()`, so a language needs `registerLocaleData()`, not the `intl` option.

### No `navigator.share()` or `File`

Share with `LynxShare`: `await sharing.share({ files: [{ blob, name: 'photo.jpg' }], title, text, url })` opens the phone's share sheet and resolves `true`, or `false` when closed (on Android, `true` once the person picks an app). Only the `--platform` apps (`ng build` and `ng serve`) and the web preview have it; Lynx Explorer and specs reject with `unavailable`. See [http-requests.md](http-requests.md#share-files-and-links).

### No `<select>`, `<input type="checkbox">`, `<input type="radio">`

Build custom selection UI with `<view>` and state. Mark the chosen option for screen readers with `[lynxAccessibilityTraits]="{ selected: chosen() }"`.

Or add ready-made controls with `npx @blotch/dolan add <name>`: `checkbox`, `radio-group`, and `select`, whose `<ui-select [(value)]>` opens a bottom sheet of `<ui-select-item value label>`s. Give a long list `searchable` for a search field that filters the items by label, or `[filter]="false"` with `[(query)]` to show results of your own, such as a server's. `multi-select` adds `<ui-multi-select [(value)]>` (a `string[]`), with a checkbox per `<ui-multi-select-item>` and the chosen items as chips in the field, and the same search.

### No `localStorage` / `sessionStorage`

- **Data kept after the app closes:** `LynxLocalStorage`, or `LynxSecureStorage` for tokens (Keychain on iOS, Android Keystore encryption on Android). Async: `await storage.setItem(key, value)`, `await storage.getItem<T>(key)` (`null` when unset), `removeItem(key)`, `clear()`. Values are JSON. Only the `--platform` apps (`ng build` and `ng serve`) have the native modules; Lynx Explorer and tests keep values in memory, and the web uses `localStorage`. `LynxSecureStorage.setItem(key, value, { requireBiometrics: true })` keeps a secret behind Face ID, Touch ID or a fingerprint (a `.biometryCurrentSet` Keychain item, a Keystore key needing a strong biometric per use): storing doesn't prompt, each `getItem(key, { reason })` does and rejects with a `BiometricsError` when the person cancels, and a newly enrolled face or finger makes every such value read `null` for good. It needs `permissions.biometrics` (below), and rejects with `unavailable` without it, in the web preview and in Lynx Explorer.
- **State shared between pages while the app runs:** `LynxSessionStorage`, which empties when the app quits.

### No `window.open`, `location` or `<a href>`

Open links with `LynxLinking`: `openURL()` for the browser, mail or another app, `openInApp()` for a browser sheet over the app, `canOpenURL()` to check first (declare other apps' schemes in `canOpenURLSchemes`). Only the `--platform` apps (`ng build` and `ng serve`) have its native module; Lynx Explorer rejects with `unavailable`. See [http-requests.md](http-requests.md).

### HTTP needs absolute URLs

`HttpClient` and `fetch()` work on the main thread (the runtime relays them to the background thread), but there's no page URL to resolve `/api/x` against. Files the app bundles are the exception in `ng build --platform` apps. See [http-requests.md](http-requests.md).

### No `navigator.clipboard`

Copy and paste text with `LynxClipboard`: `await clipboard.setString(text)` and `await clipboard.getString()` (`''` when it holds no text). It uses `UIPasteboard` on iOS, `ClipboardManager` on Android and the page's Clipboard API in the web preview, where you call `setString()` straight from the tap's handler, before any `await`. Only the `--platform` apps (`ng build` and `ng serve`) have the native module: in Lynx Explorer both reject with a `ClipboardError` whose `code` is `unavailable`.

- **Don't read the clipboard on launch.** iOS 16+ asks "Allow Paste?" before the app reads text another app copied (a refusal reads as `''`), and Android 12+ shows a "pasted" message.
- **Android 13+ confirms every copy itself,** in a panel TalkBack reads. Check `clipboard.confirmsCopies` before showing or announcing your own "Copied".
- For a ready-made button, `npx @blotch/dolan add copy-button` adds `<ui-copy-button [value]="code()">Copy code</ui-copy-button>`, which does both.

### No `navigator.vibrate()`

Tap the phone with `LynxHaptics`: `haptics.impact('light' | 'medium' | 'heavy' | 'soft' | 'rigid')`, `haptics.selection()` for a selection or a value moving one place, and `haptics.notification('success' | 'warning' | 'error')`. It uses UIKit's feedback generators on iOS and `View.performHapticFeedback()` on Android (no permission, and it follows the touch feedback setting), and the page's `navigator.vibrate()` in the web preview. The methods return nothing and never throw: Lynx Explorer and the testing library play nothing. To check feedback in a spec, provide a stand-in: `{ provide: LynxHaptics, useValue: { impact: vi.fn(), selection: vi.fn(), notification: vi.fn() } }`. The dolan slider, switch, context menu and segmented controls give their own.

Confirm the person with `LynxBiometrics` (Lynx has no WebAuthn): `await biometrics.availability()` gives `{ type, enrolled, deviceCredential }`, `type` being `faceID`, `touchID`, `opticID`, `fingerprint`, `face`, `iris` or `none` (Android counts strong biometrics only), and never rejects; `await biometrics.authenticate({ reason, allowDeviceCredential?, title?, cancelLabel? })` shows `LAContext` or AndroidX's `BiometricPrompt` and rejects with a `BiometricsError` whose `code` is `canceled`, `lockout`, `notEnrolled`, `unavailable` or `failed`. The native module is only in apps with `"permissions": { "biometrics": "<reason>" }` in angular.json (iOS's `NSFaceIDUsageDescription`, Android's `USE_BIOMETRIC`); without it, and in Lynx Explorer and the web preview, `availability()` says `none`. The testing library stands for a phone with Face ID set up: `setBiometrics({ type, enrolled, deviceCredential })` changes it, `queueBiometricResult('canceled')` ends the next prompt that way, and `biometricPrompts()` lists the prompts shown.

### Bundled images need `baseHref` on the web

An imported image (`import logo from './logo.png'`, typed through `/// <reference types="@blotch/angular-lynx-build/client" />`) becomes `static/image/logo.<hash>.png` next to the bundle. On iOS and Android, Lynx resolves it against the bundle, wherever that is. Lynx for Web puts it on an `<img>` in the page, so the browser resolves it against the page that shows the `<lynx-view>`: a bundle at `/apps/shop/main.web.bundle` on a page at `/` asks for `/static/image/…` and gets nothing. Build with `ng build --base-href=/apps/shop/`, which makes the web bundle ask for `/apps/shop/static/image/…` (see [build-configuration.md](build-configuration.md)). `ng serve` needs nothing: its page and bundle share a root. Fonts never have the problem: the build inlines `@font-face` files as data URLs.

### `ng serve`'s web preview shows other servers' images in Chrome and Firefox, not Safari

The dev server's preview page (`/__web_preview`) is cross-origin isolated, which Lynx for Web needs for `SharedArrayBuffer`. Chrome, Edge and desktop Firefox get it with `Cross-Origin-Embedder-Policy: credentialless`, under which an `<image>` or `<video>` from another origin loads, asked for without cookies. Safari doesn't know that value, nor does Firefox on Android, and they get `require-corp`: a file from another origin whose server sends no `Cross-Origin-Resource-Policy` header is dropped there, with no error, so an app that loads pictures from a museum's or a CMS's image server looks empty. Open the preview in Chrome, Edge or desktop Firefox.

A `<webview src>` loads only in Chrome and Edge there, without the cookies the site has in the browser (the runtime marks its frame `credentialless` in an isolated page). In Firefox and Safari it shows a blocked page while `bindload` still fires: check it with `html`, or on a device. The apps, Lynx Explorer and a page that isn't isolated have none of this.

### Don't scale a `<lynx-view>` with a CSS transform on the web

Inside a transformed (or CSS-`zoom`ed) `<lynx-view>`, `getBoundingClientRect()` returns the scaled box. Lynx for Web's waterfall `<list>` places its items by those measurements, so in a view scaled to 0.8 the items overlap by a fifth. Size the view at the width you want and let it lay out at that size. `innerWidth` and `innerHeight` read the view's layout size, so they're right either way.

### `<canvas>` only in built apps

`<canvas>` has its 2D and WebGL2 contexts only in the `--platform ios|android` apps (`ng build` and `ng serve`) and the web preview: in Lynx Explorer, `getContext('2d')` and `getContext('webgl2')` are `null`. The build includes the WebGL2 context only when some module names `'webgl2'` literally, and the 2D context only when one names `'2d'` in quotes or one of its classes (`Path2D`, `CanvasRenderingContext2D`, …): on iOS and Android, a context name built at runtime gets `null` and a console warning unless another module named it. The canvas itself, and `OffscreenCanvas`, `Image`, `ImageBitmap`, `createImageBitmap()` and `document.createElement('canvas')`/`('img')`, come only where a module names `'canvas'` in quotes (a template's `<canvas>` does) or one of those classes: a `<canvas>` from a tag built at runtime is a plain element unless another module named it, or the app calls `ɵenableCanvas()`. See "2D with `<canvas>`" and "3D with `<canvas>`" in [lynx-elements.md](lynx-elements.md).

### `<video>` in the web preview only plays and pauses

The web preview plays `<video>` in the browser's own HTML video. `invoke('play')` and `invoke('pause')` work, and `(bindplaying)`, `(bindtimeupdate)`, `(bindended)` and `(binderror)` fire with the same `detail` as on the phone. `(bindfirstframe)`, `(bindpaused)` and `(bindstopped)` never fire there, and `stop` and `seek` do nothing, so don't rely on them to keep the UI's state.

### A `<webview>` is empty until its first page draws

`<webview>` is the platform's web view, which starts a process of its own to draw the page (WebKit's web content process on iOS, the WebView's renderer on Android). Until the page draws, its box shows what's behind it, even for an `html` page: 1 to 3 seconds on the iOS Simulator, and over 10 on a busy Mac. Wait for `(bindload)`, not a fixed time, before checking the page or taking a screenshot of it.

### `getBoundingClientRect()` is the last layout's

An element's `getBoundingClientRect()`, `clientWidth` and `clientHeight` answer synchronously from its last `layoutchange`, so they're empty until it's laid out. `ResizeObserver` works on Lynx elements. For a box native measures now, use `SelectorQuery`'s `boundingClientRect`.

### `TextEncoder` / `TextDecoder` are UTF-8 only

The runtime adds them to the main thread, in the apps whose code names them or `fetch` (see [http-requests.md](http-requests.md)). Any other encoding label throws a `RangeError`.

### The keyboard covers a focused field

Lynx doesn't scroll or pan to keep a field above the keyboard. `avoid-keyboard="true"` on an `<input>` (with `avoid-keyboard-spacing="8px"`: Android needs a unit) moves the whole page up until the field clears it, which suits a form but not a bar at the bottom of the screen. To move one element instead, read the input's `(bindkeyboardheightchange)` while it's focused. `detail.height` is in points from the bottom of the window on iOS, and in physical pixels from the bottom of the Lynx view on Android, and 0 as the keyboard hides.

### VoiceOver can't swipe an `adjustable` element

`accessibility-traits="adjustable"` makes VoiceOver announce the element as adjustable, but Lynx's iOS views don't respond to its swipe up and down, and Android ignores the trait. Offer `[accessibility-actions]="['Increase', 'Decrease']"` and handle `(bindaccessibilityaction)`: VoiceOver lists the actions in its Actions rotor, and TalkBack in its actions menu.

### No `Intl`, and `localeCompare` and `toLocaleString` ignore the locale

The main thread has no `Intl`, and neither does the background thread (except the iOS app's, on JavaScriptCore). `new Intl.NumberFormat()` throws on a device while specs pass in Node. `'é'.localeCompare('z')` compares character codes (`111`, so `'é'` sorts after `'z'`), `toLocaleString()` formats numbers the en-US way and dates as `01/15/2026, 01:05:09 PM`, and `String.prototype.normalize` doesn't exist.

List the APIs the code uses in the build target's options, and install the FormatJS packages the build names:

```json
"intl": ["DisplayNames", "NumberFormat", "Collator"]
```

- It takes `Collator`, `DateTimeFormat`, `DisplayNames`, `ListFormat`, `NumberFormat`, `PluralRules` and `RelativeTimeFormat`, and adds them to both threads of the Lynx bundle, with the data of `i18n.sourceLocale` and `i18n.locales`. The web preview uses the browser's `Intl`. With plain rspeedy: `pluginAngularLynx({ intl: [...] })`.
- Without a locale (`n.toLocaleString()`), they use the phone's language (`appLocale`) when the app has its data, else the source locale. Dates are in the phone's time zone; other named zones (`timeZone: 'America/New_York'`) need `@formatjs/intl-datetimeformat/add-golden-tz.js` in `polyfills`.
- `Collator` (and `localeCompare` with a locale) is AngularLynx's own, from ICU's order of each locale's letters at build time. Han ideographs and Hangul sort by code point, `usage: 'search'` sorts as `'sort'`, and the `collation` option is ignored.
- Each API costs a few hundred kB of bundle per thread, and more per locale: add only what the code calls.
- Angular's pipes (`DatePipe`, `CurrencyPipe`, ...) don't use `Intl`: they need `registerLocaleData()`, not this option.

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

### Change classes through Angular, not `__AddClass`

Bind classes (`class`, `[class]`, `[class.x]`) or use `Renderer2.addClass()`/`removeClass()`. On iOS and Android the runtime writes the classes a change detection changed once per element, as a whole class string, at the end of the cycle, so a class added with a raw `__AddClass` or `__SetClasses` on `nativeElement.element` is dropped the next time change detection changes the element's classes. Raw class calls also differ by platform: on iOS and Android `__AddClass` adds a name it has again (`__GetClasses` lists it twice), and Lynx for Web keeps it once.

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

### A `calc()` a variable brings into another `calc()` is dropped

Lynx drops a value with a `calc()` inside another `calc()`, and the element gets none of it. The build and the runtime write each nested `calc()` they can see as parentheses, so `calc(calc(100% - 16px) / 2)` works in stylesheets, inline styles and `[style.x]` bindings, and so does Tailwind 4's `calc(--spacing(3) + env(safe-area-inset-top))`. They can't see one a variable brings in: with `--sixty: calc(50px + 10px)`, `padding-top: calc(var(--sixty) + 40px)` gives no padding. Keep `calc()` out of a variable that a `calc()` reads: give the variable a plain length, or do the arithmetic in the property.

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

While an `<overlay>` is shown, nothing else on screen gets touches: right for a modal, wrong for a popover or a toast. Float those in a `position: fixed` view instead, and close a popover on a touch anywhere else with `(global-bindtouchstart)`, which runs for a touch on any element, before that element's own listeners. Android's back button doesn't reach it either, since only an overlay gets `requestclose`: take back with `LynxBackButton.on()` while it's open (see [routing.md](routing.md)). `npx @blotch/dolan add popover` adds one that does both.

### Android dims the whole page after a key press (ejected projects)

A key press (a hardware keyboard, a D-pad, the keyboard's Enter, a key sent with adb or Maestro) takes Android out of touch mode, and the focused `LynxView` then got Android's default focus highlight: a 12% black over the whole page, so white drew as 224. On Android 14 an app opened afterwards starts out of touch mode too. The shell `ng build --platform android` generates turns the highlight off. A project ejected before the fix needs `lynxView.defaultFocusHighlightEnabled = false` (Android 8+) in `MainActivity.kt` after the `LynxView` is built.

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

### Leaving screens grows memory until a full collection

PrimJS collects garbage as the app runs, but those collections leave behind much of what a screen leaves when it goes, so memory grows with every screen the app shows, though the screens themselves are collected. Lynx runs a full collection, which frees it, when the host app reports memory pressure with `LynxEnv.trimMemory`. The apps `ng build --platform` makes (and `ng serve --platform`) do it for you: the runtime asks the shell for one (`NativeModules.AngularLynxShell.collectGarbage()`) once the app has released about a screen's worth of elements and settled, at most every 10 seconds, and the shell reports the system's memory warnings and the app leaving the screen. Lynx Explorer has no such module, so memory there grows over a long session. In a native app of your own, register an `AngularLynxShell` module whose `collectGarbage()` calls `trimMemory` with moderate pressure, and report memory warnings (the website's "Embed in an existing native app" guide has the code).

### On iOS, a `<webview>` outlives its element outside the `--platform` apps

XElement's iOS loader and its `WKWebView` keep each other, so in Lynx Explorer, in a native app of your own, and in a project ejected before the fix, every `<webview>` the app has shown stays, with its WebContent process, for as long as the app runs (in issue #397, 21 of them held 0.9 to 2.4 GB). Nothing in the app's code can free it. The `--platform ios` apps (`ng build` and `ng serve`) wrap the loader so the web view goes with the element. In a native app of your own, copy the shell's `WebViewLoader.swift` and call `ShellWebViewLoaderProvider.register()` where you register XElement (the website's "Embed in an existing native app" guide). Android's web views go with their elements everywhere.

---

## Build

### A hex color that reads as an exponent is mangled

The CSS pipeline minifies `rgba(92, 94, 102, 1)` to `#5c5e66`, and a later tokenizer reads `5e66` as a number: the web preview's stylesheet holds `#5c9999`. Any hex with a digit, `e`, digit run (`#3e4048` too) is at risk; `#71717a` or `#3f3f46` is fine. Pick a neighbouring value (`rgba(92, 95, 102, 1)`) until it's fixed. Not yet checked on iOS and Android.

### A nullish `#private` member in an optional chain gives `undefined`

`#private` members work in chains and optional chains as on the web: `this.#parent.#depth()`, `other?.#method()`, `this.#onColors?.()[scheme]` and `node?.#name.length`. The build rewrites them before its compiler, which would otherwise lift what follows a private member out of the optional chain's short-circuit and call a private method there without its receiver. The rewrite makes the link after a private member optional, so code the web would throw a TypeError for gives `undefined` instead: `a?.#b.#c` when `a.#b` is nullish, or `a?.#field()` when `#field` holds `null`. It covers the app's own code and AngularLynx's packages; other npm packages' private members compile as they are.
