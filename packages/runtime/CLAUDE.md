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

`page`, `view`, `text`, `inline-truncation`, `image`, `scroll-view`, `list`, `block`, `if`, `for`, `raw-text`, `frame`, `input`, `textarea`, `overlay`, `svg`, `viewpager`, `viewpager-item`, `refresh`, `refresh-header`, `title-bar-view`, `scroll-coordinator`, `scroll-coordinator-header`, `scroll-coordinator-toolbar`, `scroll-coordinator-slot`, `scroll-coordinator-slot-drag`, `blur-view`, `webview`, `video`, `cover-view`

`page` is special — it returns the existing root page element (created by `createRootElement()`), not a new element. Only one `<page>` is allowed per app. The element has `_isRootPageElement = true` which prevents Angular from reparenting or removing it.

Unknown tags fall back to `view` with a console warning. Unlike React Lynx (which passes any tag to `__CreateElement`), this fallback is required because Angular component host elements (`<app-card>`) are created through the same path. So every native Lynx tag needs an explicit case in `create-native-ref.ts`, or it silently renders as a plain view.

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
