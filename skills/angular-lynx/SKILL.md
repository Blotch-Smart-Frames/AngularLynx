---
name: angular-lynx
description: >-
  Build Angular applications for the Lynx native runtime. Use when creating Lynx
  components, using Lynx elements (view, text, image, scroll-view, list),
  handling Lynx events (bindtap, catchtap, bindinput), configuring
  bootstrapApplication, provideRenderer, provideRouter, debugging
  on-device errors, working with Lynx CSS differences, or building and testing
  with the Angular CLI (ng build, ng serve, ng test), pluginAngularLynx and
  rspeedy.
license: MIT
metadata:
  author: Blotch Smart Frames
  version: '0.1'
---

# AngularLynx Development

Build Angular apps that render natively on mobile via the Lynx runtime. Uses Angular's Renderer2 to map component templates to Lynx native elements (`view`, `text`, `image`, etc.) instead of browser DOM. Requires zoneless change detection — Zone.js is not available in Lynx.

## Critical Rules

These prevent crashes and silent failures. Violating any will break your app on-device.

1. **Bind Lynx event names.** A tap is `(bindtap)` (or `(catchtap)` to stop it bubbling). `(click)` also runs on a tap, which is what makes Angular's `routerLink` work, and pointer events (`(pointerdown)`, `(pointermove)`…) come from touches. DOM names Lynx also sends (`(input)`, `(focus)`, `(blur)`, `(scroll)`, `(load)`, `(error)`, touch, animation and transition events) listen as `bind` does, and `(keyup.enter)` runs on the return key; any other DOM event name, such as `(mouseover)` or `(keydown)`, is silently ignored. Handlers can do anything they would on the web, navigation included: no `setTimeout` needed.

2. **Put visible text inside `<text>`.** Lynx has no text nodes — only `<text>` elements display characters. Raw text straight in a `<view>` (or a `<div>`, `<li>` or component host) is drawn in an anonymous `<text>`, with the HTML inline tags beside it on one line, and inherits text styles through CSS variables the build adds. HTML text tags (`<p>`, `<span>`, `<h1>`, `<a>`, `<button>`, `<label>`…) render as `<text>` and inherit too. A `<text>` written as a Lynx element inherits nothing: set its text styles on it.

3. **`scroll-view` requires an explicit height.** Without `height: 100vh` or a flex constraint, scroll-view expands to fit content and never scrolls.

4. **Use `provideZonelessChangeDetection()`.** Zone.js crashes in the Lynx runtime. Zoneless change detection is mandatory.

5. **Import `LYNX_ELEMENTS` in components.** Without the element directives, Lynx elements silently fall through as unknown custom elements with no type-checking.

## Bootstrap & Project Setup

How to create and configure an AngularLynx application. Covers `bootstrapApplication()`, `provideRenderer()`, `provideRouter()`, app config, and the builders `ng add` sets up in `angular.json`.

Read [bootstrap-and-setup.md](references/bootstrap-and-setup.md)

## Lynx Elements

All available native elements: `view`, `text`, `image`, `scroll-view`, `list`, `list-item`, `input`, `textarea`, `overlay`, `blur-view`, `frame`, `svg`, `canvas`, `block`, `raw-text`. Includes attributes, the `LYNX_ELEMENTS` import, setting a field's text with `[value]` and calling UI methods with `invoke()`, the `page` root element, the HTML tags that render as Lynx elements (`<div>` as `<view>`, `<p>` as `<text>`, `<img>` as `<image>`), and 3D in a `<canvas>` with WebGL2, three.js and angular-three.

Read [lynx-elements.md](references/lynx-elements.md)

## Events & Interactions

The `bind`/`catch`/`capture-bind`/`capture-catch` prefix system, and `global-bind` for touches anywhere. Event types: `tap`, `longpress`, `input`, `scroll`, `load`, `animationend`, `layoutchange`, `uiappear`. Elements coming into view with `[lynxExposure]`, `IntersectionObserver` and `LynxGlobalExposure`. `(click)` as an alias for tap, the DOM names Lynx also sends (`(input)`, `(keyup.enter)`…) and `$event.target.value`, pointer events made from touches, `document:`/`window:`/`body:` listeners and `window.innerWidth`, several handlers on one element. Touch coordinates on each platform, drags, and gestures (`[lynxGesture]` with pan, tap, long press and fling) and how they compete. Angular template syntax: `(bindtap)="handler($event)"`, and the typed `$event` (`LynxEvent<Detail>` and each event's detail type) that replaces casting to `Event` or `CustomEvent`.

Read [events-and-interactions.md](references/events-and-interactions.md)

## Styling & CSS

Lynx uses a subset of CSS with different defaults. Default display is `linear` (not `block`), and `display: block` becomes `linear`. No CSS inheritance (except nested `<text>`, CSS variables, and HTML text tags and loose text, which inherit through variables the build adds). No `@media` queries, `::before`/`::after`, `:hover`, or `:focus`. The `rpx` responsive unit. Component styles are scoped as in Angular (`ViewEncapsulation.Emulated`), and type selectors match component hosts (`app-card { … }`). CSS variables from `[style.--x]` bindings, and dark mode and Android's wallpaper colors with `LynxTheme`. Safe-area padding with `env(safe-area-inset-*)`, and the edge-to-edge layout of the apps `ng build --platform` makes.

Read [styling-and-css.md](references/styling-and-css.md)

## Routing

In-memory routing (no browser History API). `provideRouter(routes)` sets up `LynxLocationStrategy`. Leaving a route destroys it, as on the web; `LynxRouteReuseStrategy` is an opt-in that keeps route views alive. `<lynx-stack-outlet>` replaces `<router-outlet>` to slide screens in and out as iOS and Android do, with a swipe back, keeping the screens under the top one alive, and takes the tab bar or dock away from pushed screens (`LynxStackChrome`; on iOS the covered screen carries the bar, `LynxStackBottomBar`). Lazy-loaded routes with `loadComponent`. Angular's own `routerLink` and `routerLinkActive` work on any element, and the active link gets the `selected` accessibility trait.

Read [routing.md](references/routing.md)

## Signals & State

All state via `signal()`, `computed()`, `linkedSignal()`. No RxJS required for state management. Zoneless change detection propagates signal changes automatically. `effect()` for side effects.

Read [signals-and-state.md](references/signals-and-state.md)

## Animations

Three approaches: CSS `transition`, CSS `@keyframes`, and JS `element.animate()`. The animate API is main-thread only. Supported easing functions and the property whitelist. Animation events: `bindanimationend`, `bindtransitionend`.

Read [animations.md](references/animations.md)

## List Virtualization

`<list>` and `<list-item>` for virtualized lists. Requires `item-key` attribute. The native recycling engine manages creation/reuse. Use `list-type="flow"` for waterfall/masonry layouts. Scrolling from code (`scrollToPosition` takes `position`), and a chat's list: loading older items above while keeping the person's place, and opening at the end.

Read [list-virtualization.md](references/list-virtualization.md)

## Debugging

No browser console on device. `LynxLogger` sends logs to the dev server. `globalThis.__lynxLastError` captures uncaught errors. Render errors on screen with `<text>` elements.

Read [debugging.md](references/debugging.md)

## Threading Model

Lynx runs on two threads: main thread (native UI rendering, PrimJS ES2019) and background thread (background-only APIs). The Angular app runs on the main thread only; the background thread loads only the files that define `backgroundFn()`s or `MainThreadRef`s at top level. `__MAIN_THREAD__` global flag for branching. `NativeModules` only available on background thread: use `LynxNativeModule`, which relays, or a `backgroundFn()`.

Read [threading-model.md](references/threading-model.md)

## HTTP Requests

`provideHttpClient()`, `HttpClient`, `httpResource` and `fetch()` work on the main thread: the runtime relays each request to the background thread's `fetch`. URLs must be absolute, except a file the app bundles in an `ng build --platform` app; no `FormData` bodies; `Blob` bodies go with their type. OAuth sign-in through a web page with `LynxWebAuthSession`; photos from the phone's picker as a `Blob` with `LynxImagePicker`; the share sheet (files, text, links, Save Image) with `LynxShare`. Links out of the app (browser, browser sheet, mail, other apps) with `LynxLinking`.

Read [http-requests.md](references/http-requests.md)

## Build Configuration

`ng build` / `ng serve` / `ng test` run the `@blotch/angular-lynx-build` builders, configured in `angular.json`; `optimization` picks a production or development build, and `budgets` are enforced. `lynx.config.ts` is optional (import `defineConfig` from `@blotch/angular-lynx-build`). `pluginAngularLynx()` handles Angular compilation, entry splitting (main + background bundles), and CSS scoping. Dev server with QR code for Lynx Explorer; `ng serve --platform ios|android` opens the app's own development build loading from it.

Read [build-configuration.md](references/build-configuration.md)

## Lynx Platform Gotchas

Curated list of 50+ differences between Lynx and the web platform. Organized by severity: critical (crashes), layout, text, missing APIs, and surprising defaults.

Read [lynx-gotchas.md](references/lynx-gotchas.md)
