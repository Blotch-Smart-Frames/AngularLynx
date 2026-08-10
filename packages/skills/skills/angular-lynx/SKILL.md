---
name: angular-lynx
description: >-
  Build Angular applications for the Lynx native runtime. Use when creating Lynx
  components, using Lynx elements (view, text, image, scroll-view, list),
  handling Lynx events (bindtap, catchtap, bindinput), configuring
  bootstrapApplication, provideRenderer, provideRouter, debugging
  on-device errors, working with Lynx CSS differences, or building with
  pluginAngularLynx and rspeedy.
license: MIT
metadata:
  author: Blotch Smart Frames
  version: '0.1'
---

# AngularLynx Development

Build Angular apps that render natively on mobile via the Lynx runtime. Uses Angular's Renderer2 to map component templates to Lynx native elements (`view`, `text`, `image`, etc.) instead of browser DOM. Requires zoneless change detection — Zone.js is not available in Lynx.

## Critical Rules

These prevent crashes and silent failures. Violating any will break your app on-device.

1. **Defer DOM-mutating operations out of event handlers.** Lynx event callbacks run inside a worklet context where tree mutations are forbidden. Wrap navigation, signal updates that add/remove elements, and any operation that changes the element tree in `setTimeout(() => { ... }, 0)`.

2. **All visible text must be inside `<text>`.** Raw text inside `<view>` does not render. Lynx has no text nodes — only `<text>` elements display characters.

3. **`scroll-view` requires an explicit height.** Without `height: 100vh` or a flex constraint, scroll-view expands to fit content and never scrolls.

4. **Use `provideZonelessChangeDetection()`.** Zone.js crashes in the Lynx runtime. Zoneless change detection is mandatory.

5. **Import `LYNX_ELEMENTS` in components.** Without the element directives, Lynx elements silently fall through as unknown custom elements with no type-checking.

6. **The element pool is limited (~256 slots).** `__RemoveElement` only detaches, it doesn't free slots. Use the built-in `LynxRouteReuseStrategy` (provided by `provideRouter`) to avoid pool exhaustion during navigation.

## Bootstrap & Project Setup

How to create and configure a AngularLynx application. Covers `bootstrapApplication()`, `provideRenderer()`, `provideRouter()`, app config, and `lynx.config.ts` with `pluginAngularLynx()`.

Read [bootstrap-and-setup.md](references/bootstrap-and-setup.md)

## Lynx Elements

All available native elements: `view`, `text`, `image`, `scroll-view`, `list`, `list-item`, `input`, `textarea`, `overlay`, `frame`, `svg`, `block`, `raw-text`. Includes attributes, the `LYNX_ELEMENTS` import, and the `page` root element.

Read [lynx-elements.md](references/lynx-elements.md)

## Events & Interactions

The `bind`/`catch`/`capture-bind`/`capture-catch` prefix system. Event types: `tap`, `longpress`, `input`, `scroll`, `load`, `animationend`. The `setTimeout` requirement for mutations. Angular template syntax: `(bindtap)="handler($event)"`.

Read [events-and-interactions.md](references/events-and-interactions.md)

## Styling & CSS

Lynx uses a subset of CSS with different defaults. Default display is `linear` (not `block`). No CSS inheritance (except nested `<text>`). No `@media` queries, `::before`/`::after`, `:hover`, or `:focus`. The `rpx` responsive unit. Global style scope by default.

Read [styling-and-css.md](references/styling-and-css.md)

## Routing

In-memory routing (no browser History API). `provideRouter(routes)` sets up `LynxLocationStrategy` and `LynxRouteReuseStrategy`. Lazy-loaded routes with `loadComponent`. Navigation must use `setTimeout` to escape event worklets.

Read [routing.md](references/routing.md)

## Signals & State

All state via `signal()`, `computed()`, `linkedSignal()`. No RxJS required for state management. Zoneless change detection propagates signal changes automatically. `effect()` for side effects.

Read [signals-and-state.md](references/signals-and-state.md)

## Animations

Three approaches: CSS `transition`, CSS `@keyframes`, and JS `element.animate()`. The animate API is main-thread only. Supported easing functions and the property whitelist. Animation events: `bindanimationend`, `bindtransitionend`.

Read [animations.md](references/animations.md)

## List Virtualization

`<list>` and `<list-item>` for virtualized lists. Requires `item-key` attribute. The native recycling engine manages creation/reuse. Use `list-type="flow"` for waterfall/masonry layouts.

Read [list-virtualization.md](references/list-virtualization.md)

## Debugging

No browser console on device. `LynxLogger` sends logs to the dev server. `globalThis.__lynxLastError` captures uncaught errors. Render errors on screen with `<text>` elements.

Read [debugging.md](references/debugging.md)

## Threading Model

Lynx runs on two threads: main thread (native UI rendering, PrimJS ES2019) and background thread (JS execution, Angular app). `__MAIN_THREAD__` global flag for branching. `fetch()` only available on background thread.

Read [threading-model.md](references/threading-model.md)

## Build Configuration

`lynx.config.ts` with `defineConfig` from `@lynx-js/rspeedy`. `pluginAngularLynx()` handles Angular compilation, entry splitting (main + background bundles), and CSS scoping. Dev server with QR code for Lynx Explorer.

Read [build-configuration.md](references/build-configuration.md)

## Lynx Platform Gotchas

Curated list of 50+ differences between Lynx and the web platform. Organized by severity: critical (crashes), layout, text, missing APIs, and surprising defaults.

Read [lynx-gotchas.md](references/lynx-gotchas.md)
