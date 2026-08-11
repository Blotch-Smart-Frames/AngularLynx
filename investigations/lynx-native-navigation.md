# Lynx Native Navigation Investigation

## Goal

Understand how Lynx handles navigation at the platform level, how React Lynx and third-party routers (React Router, TanStack) integrate with it, and what that means for AngularLynx.

---

## Lynx's Navigation Model

Lynx is a **card-based multi-page platform**, not a web browser. Navigation exists at two completely separate levels.

### Level 1: Native Page Management (between bundles)

The native app (iOS/Android) manages a stack of Lynx "cards". Each card is a separate Lynx bundle with its own JS runtime. The native app controls transitions between them.

**Host app API (from native SDK):**

- `LynxView.loadTemplate(url, { initialData, globalProps })` — load a new Lynx bundle
- `LynxView.updateData(data)` — push new data to the current page
- `LynxView.updateGlobalProps(props)` — update app-wide shared state

**JS-side API (called by Lynx runtime, not by user code):**

- `renderPage(data)` — native calls this to initialize a page
- `updatePage(data, options)` — native calls this to push data updates
- `updateGlobalProps(data)` — native calls this for app-wide state changes

**JS reads this via:**

- `useInitData()` / `useInitDataChanged()` — current page data hooks (React Lynx)
- `lynx.__globalProps` + `onGlobalPropsChanged` event

**Cross-page navigation from JS:**

- `NativeModules.openSchema(url)` — calls into the native layer via JS bridge
- The native app then opens a new Lynx bundle at that URL
- **Must be called from the background thread** (not main thread) — event handlers and `useEffect` are safe; main thread scripts are not

There is also a `<frame>` built-in element (v3.4+) that embeds another Lynx bundle inline, similar to an HTML `<iframe>`. It accepts `data` (initData) and `global-props` attributes, and fires a `bindload` event on completion.

**Key constraint:** Each native page has its own isolated JS runtime. Shared state between pages must go through `globalProps` or be re-passed as `initData`. Angular services, DI, and signal state do NOT cross page boundaries.

### Level 2: Client-Side Routing (within one bundle)

Standard in-memory routing within a single Lynx bundle — one JS runtime, one Angular app.

Lynx has **no browser History API** (`window.history`, `window.location`, `pushState`, etc.) and no `document` object. Routers designed for the web cannot run unmodified.

**Solution used by React Lynx ecosystem:**

- **React Router v6** — use `<MemoryRouter>` instead of `<BrowserRouter>`
- **TanStack Router** — use `createMemoryHistory()` + `isServer: false`
  - `isServer: false` is required because Lynx has no `document`, which makes routers think they're server-side rendering

Both cases also require a `URLSearchParams` polyfill — Lynx's PrimJS runtime lacks it.

---

## React Lynx's Own Router Usage

React Lynx itself has **no built-in client-side router**. The official docs document two external options (React Router + TanStack), both requiring memory routing. Neither provide transition animations — route changes are an instant DOM swap.

React Lynx doesn't do navigation transitions out of the box. No built-in `AnimatePresence` equivalent, no gesture-driven transitions, nothing. Developers are left to wire animations manually if they want them.

---

## How AngularLynx Implements Level 2

`provideRouter()` is the Angular equivalent of `createRouter({ history: createMemoryHistory(), isServer: false })` in TanStack. The implementation is validated by official Lynx documentation.

| TanStack Router on Lynx              | AngularLynx                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `createMemoryHistory()`              | `LynxLocationStrategy` — in-memory history stack                            |
| `isServer: false`                    | `LynxPlatformLocation` — prevents fallback to `BrowserPlatformLocation`     |
| `URLSearchParams` polyfill           | `LynxPlatformLocation.#parseUrl()` — manual URL parsing, avoids `new URL()` |
| `<RouterProvider router={router} />` | `<router-outlet>` + `LynxRouterOutlet`                                      |

---

## Architecture Options for Multiple Pages

### Option 1: Single bundle + memory router (recommended default)

One Angular app, one bundle, `provideRouter()` handles all navigation. Lazy-loaded routes give code splitting without separate runtimes.

This is the correct approach for the vast majority of apps. It's what TanStack and React Router docs recommend on Lynx.

### Option 2: Multiple entry points from one project

If truly separate pages are needed (e.g. different teams, or the native app explicitly manages a page stack), use multiple entry points built from the same codebase:

```
src/
  pages/
    feed/main.ts       → bootstrapApplication(FeedComponent)
    profile/main.ts    → bootstrapApplication(ProfileComponent)
```

Each builds to a separate bundle, shares library code, but has its own Angular DI tree and runtime. Data passes between pages via `initData`/`globalProps`, not Angular services. **This is NOT multiple Angular projects** — it's one project with multiple build entry points.

### Option 3: `<frame>` element

Embed sub-pages as nested Lynx bundles within a shell app. Extremely heavy — each frame is a full Lynx runtime. Only appropriate if sub-pages are truly independent apps.

---

## Navigation Animations and Gestures

Lynx has the building blocks but no pre-built navigation transition system.

**Available primitives:**

- CSS `transition` and `@keyframes` — standard CSS animations on elements
- `animate()` JS API — imperative, returns an Animation object with play/pause/cancel
- `@lynx-js/gesture-runtime` — `PanGesture`, `FlingGesture`, `TapGesture`, `LongPressGesture`
- `@lynx-js/motion` — Framer Motion port, spring + timing animations
- Main Thread Script (`'main thread'` directive) — runs gesture/animation handlers on the UI thread synchronously at 60fps, bypassing the background thread latency

**What's missing:**

- No shared element transitions / hero animations
- No View Transition API
- No route-aware transition component (no `AnimatePresence` equivalent)
- No gesture-to-navigation binding out of the box

**How you'd build slide transitions (conceptual):**

1. Render both current and next route views simultaneously
2. Attach `PanGesture` on main thread driving `translateX` of both views
3. On release, complete with spring animation via `@lynx-js/motion`
4. After animation, commit the route change and clean up the outgoing view

This is what every mobile navigation framework does internally (React Navigation, iOS `UINavigationController`). The `<viewpager>` built-in element may be a useful starting point — it already handles horizontal swipe with native gesture support.

**React Lynx does the same amount here: nothing.** Neither React Lynx, React Router, nor TanStack Router provide navigation transitions on Lynx. This is an unsolved layer in the entire Lynx ecosystem, not a gap specific to AngularLynx.

---

## Files Reference

| File                                                                               | Purpose                                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/runtime/src/lib/lynx-router.ts`                                          | `provideRouter()` — wraps `provideRouter()` with memory-based location strategies             |
| `packages/runtime/src/lib/lynx-location-strategy.ts`                               | `LynxLocationStrategy` — in-memory `LocationStrategy` (equivalent to `createMemoryHistory()`) |
| `packages/runtime/src/lib/lynx-platform-location.ts`                               | `LynxPlatformLocation` — in-memory `PlatformLocation`, manual URL parsing (no `new URL()`)    |
| `packages/runtime/src/lib/lynx-router-outlet.ts`                                   | `LynxRouterOutlet` — content projection + `@switch` for rendering matched routes              |
| `references/lynx-website-main/docs/en/react/routing/react-router.mdx`              | Official React Router on Lynx docs                                                            |
| `references/lynx-website-main/docs/en/react/routing/tanstack-router.mdx`           | Official TanStack Router on Lynx docs                                                         |
| `references/lynx-website-main/docs/en/guide/use-data-from-host-platform.mdx`       | `initData` / `globalProps` / native page data flow                                            |
| `references/lynx-website-main/docs/en/api/lynx-native-api/lynx-view/lynx-view.mdx` | `<lynx-view>` — host-side API for loading and updating pages                                  |
| `references/lynx-website-main/docs/en/api/elements/built-in/frame.mdx`             | `<frame>` element — embedded sub-pages                                                        |
| `references/lynx-website-main/docs/en/guide/styling/animation.mdx`                 | CSS animation guide                                                                           |
| `references/lynx-website-main/docs/en/react/main-thread-script.mdx`                | Main thread scripting — key for 60fps gesture-driven animations                               |
| `references/lynx-stack-main/packages/lynx/gesture-runtime/`                        | `@lynx-js/gesture-runtime` — PanGesture, FlingGesture, etc.                                   |
| `references/lynx-stack-main/packages/motion/`                                      | `@lynx-js/motion` — Framer Motion port, spring animations                                     |
