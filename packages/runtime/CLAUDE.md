# runtime — Angular Renderer2 → Lynx API Bridge

Provides everything needed to run Angular on the Lynx runtime. Maps Angular's `Renderer2` interface to Lynx global `__*` functions.

## Architecture Layers

**Document** (`lynx-document.ts`):

- `LynxDocument` (main thread) — wraps Lynx global `__Create*` functions (`__CreatePage`, `__CreateView`, `__CreateText`, `__CreateImage`, `__CreateScrollView`, `__CreateList`, `__CreateBlock`, `__CreateIf`, `__CreateFor`, `__CreateRawText`, `__CreateFrame`, `__CreateNonElement`)
- `LynxBackgroundDocument` (background thread) — creates virtual `LynxBackgroundElement` nodes with tag metadata
- `LynxDocumentBase` interface — shared contract for both

**Element** (`lynx-element.ts`):

- `BaseLynxElement` interface — common element API (setAttribute, setStyle, appendChild, insertBefore, remove, etc.)
- `LynxElement` (main thread) — wraps `ElementRef`, delegates to global `__*` functions (`__SetAttribute`, `__AddInlineStyle`, `__AppendElement`, `__InsertElementBefore`, `__RemoveElement`, `__AddEvent`, `__AddClass`, `__GetParent`, `__NextElement`, etc.)
- `LynxBackgroundElement` (background thread) — in-memory linked-list tree (no native calls), stores props/styles/classes in Maps/Sets

**Renderer** (`renderer.ts`):

- `LynxRenderer` implements `Renderer2` — delegates all DOM operations to `LynxDocumentBase`/`BaseLynxElement`

**Factory** (`lynx-renderer-factory2.ts`):

- `LynxRendererFactory2` implements `RendererFactory2` — injects `LYNX_DOCUMENT`, creates `LynxRenderer`

**Bootstrap** (`runtime.ts`):

- `bootstrapApplication(rootComponent, config?)` — on main thread, waits for `renderPage` callback before bootstrapping; on background thread, bootstraps immediately
- Registers global Lynx callbacks: `renderPage`, `updatePage`, `updateGlobalProps`, `processData`, `runWorklet`. Host data updates reach the main thread through `updatePage`/`updateGlobalProps` (and web-core's `__UpdateGlobalProps` engine event), and the background thread through the `updateCardData`/`updateGlobalProps` hooks on `lynx.getApp()`; both publish through `data-flow/host-updates.ts`

**Providers** (`providers.ts`):

- `provideRenderer()` — returns `EnvironmentProviders` that sets up `LYNX_DOCUMENT` (thread-aware factory: `LynxDocument` if `__MAIN_THREAD__`, else `LynxBackgroundDocument`) and `LynxRendererFactory2` as `RendererFactory2`

**DI Token** (`token.ts`):

- `LYNX_DOCUMENT` — `InjectionToken<LynxDocumentBase>` for thread-aware document injection

## Supported Lynx Elements

`page`, `view`, `text`, `inline-truncation`, `image`, `scroll-view`, `list`, `block`, `if`, `for`, `raw-text`, `frame`, `input`, `textarea`, `overlay`, `svg`, `viewpager`, `viewpager-item`, `refresh`, `refresh-header`, `title-bar-view`, `scroll-coordinator`, `scroll-coordinator-header`, `scroll-coordinator-toolbar`, `scroll-coordinator-slot`, `scroll-coordinator-slot-drag`, `blur-view`, `webview`, `video`, `cover-view`

`page` is special — it returns the existing root page element (created by `createRootElement()`), not a new element. Only one `<page>` is allowed per app. The element has `_isRootPageElement = true` which prevents Angular from reparenting or removing it.

Unknown tags fall back to `view` with a console warning. Unlike React Lynx (which passes any tag to `__CreateElement`), this fallback is required because Angular component host elements (`<app-card>`) are created through the same path. So every native Lynx tag needs an explicit case in `create-native-ref.ts`, or it silently renders as a plain view.

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
    lynx-document.ts               # LynxDocument + LynxBackgroundDocument
    lynx-element.ts                # LynxElement + LynxBackgroundElement + BaseLynxElement
    runtime.ts                     # bootstrapApplication(), global callbacks
    providers.ts                   # provideRenderer()
    token.ts                       # LYNX_DOCUMENT injection token
    types/
      lynx.ts                      # Global Lynx API type declarations (__CreateElement, etc.)
      runtime-types.ts             # Runtime type definitions
```
