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

### What AngularLynx does now: `<lynx-stack-outlet>`

`LynxStackOutlet` (`packages/runtime/src/lib/router/stack/`, November 2026) is a `RouterOutlet` subclass, as Ionic's `ion-router-outlet` and NativeScript's `page-router-outlet` are. It keeps the pages under the top one alive, each in a frame of its own, and moves the frames with `element.animate()` (UIKit's push and pop, measured from the iOS 27 Simulator's Settings app, or Android's activity transition) and with inline styles while a finger drags the top page back. Choices that differ from the conceptual plan above:

- **Touch events, not `PanGesture`.** Bubbling `touchstart`/`touchmove` on the outlet keep arriving through a sideways drag over a vertical `<scroll-view>` on iOS (no `touchcancel`), as `PanGesture` does, and a control that catches its own touches (`catchtouchmove`, as a slider's) keeps them. Lynx's arena gave no edge over them: a pan on the outlet also activated during a vertical scroll.
- **The router commits the swipe.** Letting go past the middle slides the page away, then goes back through the history (`historyGo` to the entry before the page's), so guards run; a refused navigation slides the page back.
- **The stack follows the URL** (`stack-change.ts`): deeper pushes, a URL in the stack pops, a same-depth URL starts a new stack at once (tabs). The navigation's `info` overrides it.
- **No `@lynx-js/motion`.** `element.animate()` runs natively once the element has been flushed; a release continues at the finger's speed by picking the duration.
- **The bottom bar follows signals** (`stack-chrome.ts`, `LynxStackChrome`, issue #337). A tab bar or dock outside the stack can't be animated by the outlet, so the outlet publishes where the bar is going: a push or a pop sets `bottomBarProgress` to its end and `bottomBarMotion` to the pages' duration and curve, which the bar uses as a CSS `transition`; a drag sets the progress on every touch move, with no transition. Measured on the iOS 27 Simulator (frame by frame, 60 fps recordings of the ui-dock and ui-tab-bar examples): the bar's transition stayed on the pushed page's edge through a push, started about one frame after the pages on a pop, and through a slow drag the bar and the covered page moved within 2 px of each other, frame after frame, with no main-thread script. Android (emulator, Material motion) slid the bar down on the same curve as the pages.
- **The pushed page can't cover a bar outside the outlet,** which is drawn over it. #342 first had the bar cover itself, clipped along the pushed page's left edge, but a straight clip can't follow the page's rounded corner (62pt at the screen's bottom), so the corner showed a gap with no bar in it, and the page's shadow and the 6% scrim never reached the bar: the cut was plain to see. UIKit does it the other way round: during the transition it moves the tab bar into the view of the view controller that has it, so the incoming view, with its corners and shadow, slides over it, and the dimming view dims it. `LynxStackBottomBar` (`stack-bottom-bar.ts`) does the same: the outlet moves the bar's element into the frame of the page that shows it, last child, absolutely along its bottom, with a comment holding its place (as CDK's `DomPortal` does), and back once that page is on top again or the router leaves the outlet.
  - **Moves happen synchronously in the outlet,** where the transition starts and ends, and a move out of change detection reaches native in the settle flush (a microtask), before Angular's change detection runs. So the bar must look the same in both places at the moment it moves: carried, its `progress` is 0 (at rest), and the frame moves it. It's only ever carried away from, or back to, its own place while it shows, and it stays in the covered page for as long as it's away, rather than going home hidden after a push: a home-hidden bar would need its hidden look applied in the same flush.
  - **The router deactivates the outlet on every navigation inside it,** and comes straight back in the same pass. The outlet hands the bar back on deactivation (the router may be leaving the stack for another tab, whose view it then destroys, releasing everything under it at the commit), and takes it back into the same page if it's activated again in that pass.
  - **A tab bar under the outlet leaves the layout when it's carried,** so the outlet grows to the screen's bottom, but only once Lynx lays it out again: a push works out the pushed page's corners from the outlet's box plus the room the carried bar leaves right under it, or the bottom corners would stay square over the bar.
  - Verified on the iOS 27 Simulator (ui-dock and ui-tab-bar, 60 fps recordings): the pushed page's corner and shadow pass over the dock and the tab bar through a push, a pop, a slow swipe back and a cancelled one, the bar dims with the covered page, and it settles back in place with no jump.

---

## Files Reference

| File                                                                                                                                                                            | Purpose                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/runtime/src/lib/lynx-router.ts`                                                                                                                                       | `provideRouter()` — wraps `provideRouter()` with memory-based location strategies             |
| `packages/runtime/src/lib/lynx-location-strategy.ts`                                                                                                                            | `LynxLocationStrategy` — in-memory `LocationStrategy` (equivalent to `createMemoryHistory()`) |
| `packages/runtime/src/lib/lynx-platform-location.ts`                                                                                                                            | `LynxPlatformLocation` — in-memory `PlatformLocation`, manual URL parsing (no `new URL()`)    |
| `packages/runtime/src/lib/lynx-router-outlet.ts`                                                                                                                                | `LynxRouterOutlet` — content projection + `@switch` for rendering matched routes              |
| [`lynx-website/docs/en/react/routing/react-router.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/react/routing/react-router.mdx)                           | Official React Router on Lynx docs                                                            |
| [`lynx-website/docs/en/react/routing/tanstack-router.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/react/routing/tanstack-router.mdx)                     | Official TanStack Router on Lynx docs                                                         |
| [`lynx-website/docs/en/guide/use-data-from-host-platform.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/guide/use-data-from-host-platform.mdx)             | `initData` / `globalProps` / native page data flow                                            |
| [`lynx-website/docs/en/api/lynx-native-api/lynx-view/lynx-view.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/api/lynx-native-api/lynx-view/lynx-view.mdx) | `<lynx-view>` — host-side API for loading and updating pages                                  |
| [`lynx-website/docs/en/api/elements/built-in/frame.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/api/elements/built-in/frame.mdx)                         | `<frame>` element — embedded sub-pages                                                        |
| [`lynx-website/docs/en/guide/styling/animation.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/guide/styling/animation.mdx)                                 | CSS animation guide                                                                           |
| [`lynx-website/docs/en/react/main-thread-script.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/react/main-thread-script.mdx)                               | Main thread scripting — key for 60fps gesture-driven animations                               |
| [`lynx-stack/packages/lynx/gesture-runtime/`](https://github.com/lynx-family/lynx-stack/tree/main/packages/lynx/gesture-runtime/)                                               | `@lynx-js/gesture-runtime` — PanGesture, FlingGesture, etc.                                   |
| [`lynx-stack/packages/motion/`](https://github.com/lynx-family/lynx-stack/tree/main/packages/motion/)                                                                           | `@lynx-js/motion` — Framer Motion port, spring animations                                     |
