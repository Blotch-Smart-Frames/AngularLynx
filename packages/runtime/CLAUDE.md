# runtime — Angular Renderer2 → Lynx API Bridge

Provides everything needed to run Angular on the Lynx runtime. Maps Angular's `Renderer2` interface to Lynx global `__*` functions.

## Architecture Layers

**Document** (`lynx-document.ts`):

- `LynxDocument` (main thread) — wraps Lynx global `__Create*` functions (`__CreatePage`, `__CreateView`, `__CreateText`, `__CreateImage`, `__CreateScrollView`, `__CreateList`, `__CreateBlock`, `__CreateIf`, `__CreateFor`, `__CreateRawText`, `__CreateFrame`, `__CreateNonElement`)
- `LynxHydrateDocument` (`ssr/hydrate-document.ts`) — reuses the elements of an SSR snapshot
- `LynxDocumentBase` interface — shared contract for both

**Element** (`lynx-element.ts`):

- `BaseLynxElement` interface — common element API (setAttribute, setStyle, appendChild, insertBefore, remove, etc.)
- `LynxElement` (main thread) — wraps `ElementRef`, delegates to global `__*` functions (`__SetAttribute`, `__AddInlineStyle`, `__AppendElement`, `__InsertElementBefore`, `__RemoveElement`, `__AddEvent`, `__AddClass`, `__GetParent`, `__NextElement`, etc.)
- `InMemoryElement` / `InMemoryDocument` (`testing/`) — in-memory test doubles for renderer unit tests, never shipped

**Renderer** (`renderer.ts`):

- `LynxRenderer` implements `Renderer2` — delegates all DOM operations to `LynxDocumentBase`/`BaseLynxElement`

**Factory** (`lynx-renderer-factory2.ts`):

- `LynxRendererFactory2` implements `RendererFactory2` — injects `LYNX_DOCUMENT`, creates `LynxRenderer`

**Bootstrap** (`runtime.ts`):

- `bootstrapApplication(rootComponent, config?)` — on main thread, waits for `renderPage` callback before bootstrapping. On the background thread it doesn't bootstrap and returns a promise that never settles: Angular runs on the main thread only (issue #81). The background thread runs module-level code: each module-level `backgroundFn()` registers, and the side-effect imports install its half of the bridges (`background-call.ts`, `lynx-logger`, `exposure/global-exposure-bridge.ts`, `lazy-bundle/mirrored-imports.ts`)
- Registers global Lynx callbacks: `renderPage`, `updatePage`, `updateGlobalProps`, `processData`, `runWorklet`. Host data updates reach the main thread through `updatePage`/`updateGlobalProps` (and web-core's `__UpdateGlobalProps` engine event), and the background thread through the `updateCardData`/`updateGlobalProps` hooks on `lynx.getApp()`; both publish through `data-flow/host-updates.ts`

**Providers** (`providers.ts`):

- `provideRenderer()` — returns `EnvironmentProviders` that sets up `LYNX_DOCUMENT` (`LynxDocument`, or `LynxHydrateDocument` while SSR hydrates) and `LynxRendererFactory2` as `RendererFactory2`

**DI Token** (`token.ts`):

- `LYNX_DOCUMENT` — `InjectionToken<LynxDocumentBase>` for document injection

## Supported Lynx Elements

`page`, `view`, `text`, `inline-truncation`, `image`, `scroll-view`, `list`, `block`, `if`, `for`, `raw-text`, `frame`, `input`, `textarea`, `overlay`, `svg`, `viewpager`, `viewpager-item`, `refresh`, `refresh-header`, `title-bar-view`, `scroll-coordinator`, `scroll-coordinator-header`, `scroll-coordinator-toolbar`, `scroll-coordinator-slot`, `scroll-coordinator-slot-drag`, `blur-view`, `webview`, `video`, `cover-view`, `canvas`

`canvas` is AngularLynx's, not Lynx's: `LynxCanvasElement` (`canvas/canvas-element.ts`) has HTMLCanvasElement's API, and its WebGL2 context (`canvas/webgl2-context.ts`) batches its calls to the shells' `AngularLynxWebGL` main-thread module (`canvas/webgl-bridge.ts`), whose opcodes (`canvas/webgl-ops.ts`) packages/native generates into the shells (`npm run generate:webgl-ops -w packages/native`). The DOM globals three.js and angular-three need are in `canvas/dom-globals.ts`, pointer events from touches in `lynx-element/pointer-events.ts`, and synchronous layout reads (`getBoundingClientRect()`, `ResizeObserver`) in `lynx-element/layout.ts`. See `investigations/lynx-vs-web-differences.md`.

`document:`, `window:` and `body:` listeners are in `global-events/`: `LynxGlobalDocument` is every LynxElement's `ownerDocument` and `DOCUMENT`'s value, `window.ts` puts the window's listeners and `innerWidth`/`innerHeight` on `globalThis`, and the screen's events come from `global-bind` listeners on the page (`native-source.ts`) or, in the web preview, the browser's events in the `<lynx-view>` (`web-source.ts`). `LynxDocument.createRootElement()` attaches the page.

`page` is special — it returns the existing root page element (created by `createRootElement()`), not a new element. Only one `<page>` is allowed per app. The element has `_isRootPageElement = true` which prevents Angular from reparenting or removing it.

Common HTML tags render as the Lynx element they stand for (`lynx-document/web-tags.ts`): `div` and the other block tags as `view`, `span`, `p`, `a`, `button` and the other text tags as `text`, and `img` as `image` with `auto-size`. `hostElementOf` looks them up after the registered host elements, so the wrapper's `tagName` is the Lynx element, as for `registerHostElement`; that's also what makes `RouterLink` treat an `<a>` as a plain element that navigates on a tap. The build plugin's `HTML_ELEMENT_SUGGESTIONS` (`lynx-diagnostics.ts`) warns only about the tags that aren't mapped, and a test there keeps it apart from the runtime's lists. `LynxElement` turns HTML's `hidden` into `display: none; overflow: hidden` and an image's `alt` into `accessibility-label`, and DOM event names Lynx also sends (`SAME_NAME_DOM_EVENTS` in `lynx-element/types.ts`, `(input)`, `(focus)`, …) listen as `bind` does.

Raw text whose parent isn't a `<text>` (a `<view>`, a `<div>`'s view, a component host) is drawn in an anonymous `<text>` (class `_ngtext`), with the HTML inline tags beside it (`INLINE_FLOW_TAGS`) when the parent lays out as a block (`LynxElement.#regroup`, `lynx-element/text-flow.ts`). Inserts keep Angular's order of the children (the native order with each anonymous `<text>` opened up); which run shares which `<text>` is settled at the end of the cycle by `processPendingFlow()`, after removals and before text normalization and the flush, and changes nothing when nothing changed. Angular never sees an anonymous `<text>`: `parentNode()` of a member returns its parent, `nextSibling()` walks into and out of it, and `byUniqueId` maps a touch on it to its parent. A parent's classes, id and inline `display`/`linear-orientation` decide whether it lays out lines; the classes' part comes from the style index the build plugin prepends to the main-thread script (`globalThis.__angularLynxStyleIndex`, its `style-index.ts`), with Tailwind's display utilities as the fallback without one. An `@if`/`@for` anchor inside a `<text>` is an empty raw-text, not a hidden view, which leaves a gap on iOS (`#anchorFor`). A wrapper holding only blank text is hidden, because a `<text>` holding an empty raw-text takes a line of height. HTML text tags and anonymous texts inherit text styles: each reads `var(--angular-lynx-<property>)` for the properties its own rules don't set (`#inheritStyle`, from the same index), and the build plugin copies each inheritable declaration to that variable (`text-inheritance.ts`). `INHERITED_TEXT_PROPERTIES` has a copy in the plugin, kept the same by a test. The parents that keep raw text as it is are `TAKES_RAW_TEXT`. Hydration skips the anonymous texts in the snapshot by their class (`LynxHydrateDocument.#nextElement`).

Other unknown tags fall back to `view` with a console warning. Unlike React Lynx (which passes any tag to `__CreateElement`), this fallback is required because Angular component host elements (`<app-card>`) are created through the same path. So every native Lynx tag needs an explicit case in `create-native-ref.ts`, or it silently renders as a plain view. Add it to `LYNX_ELEMENT_TAGS` (`lynx-document/element-tags.ts`) and the build plugin's copy in `type-selectors.ts` too (tests check both lists): `LynxRenderer` gives every element whose tag isn't listed a `_ngtag-<tag>` class, and the plugin rewrites type selectors naming such tags to it, so `app-card { … }` matches the host's view.

A component can make its host another element with `registerHostElement(Component, 'text')` (`lynx-document/host-elements.ts`). Both documents look the tag up there first (`hostElementOf`), and the wrapper's `tagName` is the registered element, so text normalization and recreation treat a `<text>` host like any `<text>`. The registry is keyed by tag because `createElement()` gets nothing else: Angular creates a child component's host from the parent's template.

## Angular Constraints

- Signal-based APIs (`input`, `output`, `viewChild`, `viewChildren`, `contentChild`, `contentChildren`, `model`) **must be `public readonly`** — Angular does not support ES private (`#`) or TypeScript `private`/`protected` on these fields.
- Use `inject()` for DI, not constructor injection.
- Use standalone components; no NgModules.
- Use `@if`/`@for`/`@switch` control flow, not `*ngIf`/`*ngFor`/`*ngSwitch`.
- Zoneless change detection (`provideExperimentalZonelessChangeDetection()`) — do not use `NgZone` or trigger change detection imperatively.

## Key Files

```
src/
  public-api.ts                    # Public exports
  lib/
    renderer.ts                    # LynxRenderer (Renderer2 impl)
    lynx-renderer-factory2.ts      # LynxRendererFactory2 (RendererFactory2 impl)
    lynx-document.ts               # LynxDocument
    lynx-element.ts                # LynxElement + BaseLynxElement
    runtime.ts                     # bootstrapApplication(), global callbacks
    providers.ts                   # provideRenderer()
    token.ts                       # LYNX_DOCUMENT injection token
    types/
      lynx.ts                      # Global Lynx API type declarations (__CreateElement, etc.)
      runtime-types.ts             # Runtime type definitions
```
