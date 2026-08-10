# Routing Investigation — Angular on Lynx

## Goal

Make Angular's native `RouterOutlet` work on Lynx so that `ViewContainerRef.createComponent()` handles route rendering — eliminating the need for a custom `LynxRouterOutlet` with `@switch` boilerplate. Components should be defined once in route config, and `<router-outlet />` should just work.

## Current State (as of this investigation)

### What works

- **Custom `LynxRouterOutlet`** (`packages/runtime/src/lib/lynx-router-outlet.ts`) — A component with selector `router-outlet` that uses content projection + `@switch` to render routes. The developer lists components in both `app.routes.ts` AND the template `@switch`. Works but has a ~50% crash rate on initial load (see "Original Crash" below).
- **`NgComponentOutlet`** — Confirmed working after the `createComment()` fix. `ViewContainerRef.createComponent()` successfully creates and renders components dynamically.
- **`provideZonelessChangeDetection()`** — Zoneless CD works for signals, `@if`/`@for` control flow, event handling, etc.
- **`provideRouter(routes)`** — Custom wrapper around `provideRouter()` that provides `LynxLocationStrategy` (in-memory) and `LynxPlatformLocation`.

### What doesn't work

- **Angular's native `RouterOutlet`** from `@angular/router` — The outlet never activates (`isActivated === false`). The Router reports `navigated === false` even after manual `initialNavigation()` calls. `navigateByUrl()` returns a Promise that either never resolves or resolves to `false`. Zero `router.events` are ever emitted. The Router's internal navigation pipeline appears completely dead.

## Architecture Context

### Lynx Runtime Model

- Dual-thread: **main thread** (native UI) and **background thread** (JS/layout)
- No browser DOM — elements via global `__*` functions (`__CreateView`, `__AppendElement`, `__InsertElementBefore`, etc.)
- No `window.location`, `window.history`, `URL` constructor, or browser navigation APIs
- `setTimeout`/`setInterval` polyfilled from `lynx.setTimeout`/`lynx.setInterval` in `runtime.ts`
- `document` polyfilled minimally: `{ defaultView: globalThis, querySelector: () => null }`
- `window` polyfilled as `globalThis`
- `addEventListener`/`removeEventListener` polyfilled as no-ops

### Angular Renderer

- `LynxRenderer` implements `Renderer2` — maps to `__Create*`, `__AppendElement`, `__InsertElementBefore`, etc.
- `LynxRendererFactory2` implements `RendererFactory2` — `end()` calls `__FlushElementTree()` on main thread
- `LynxDocument` creates elements for known tags (`x-view`, `x-text`, `x-image`, etc.), falls back to `x-view` for unknown tags with a console warning

### Routing Infrastructure

- `LynxPlatformLocation` (`packages/runtime/src/lib/lynx-platform-location.ts`) — In-memory `PlatformLocation` with manual URL parsing (no `new URL()`)
- `LynxLocationStrategy` (`packages/runtime/src/lib/lynx-location-strategy.ts`) — In-memory `LocationStrategy` with history stack, popstate listeners
- `provideRouter()` (`packages/runtime/src/lib/lynx-router.ts`) — Wraps `provideRouter()` inside `makeEnvironmentProviders()` with location strategy overrides

### React Lynx Reference

React Lynx (at `references/lynx-stack-main/packages/react`) has **no client-side router**. It uses simple state-based conditional rendering (React state + ternary/map). Navigation between "pages" is handled by the native Lynx platform, not client-side routing. This is the production-proven approach.

---

## Angular Native `RouterOutlet` — Investigation

### Attempt 1: Direct swap

**Change:** Replace `LynxRouterOutlet` import with Angular's `RouterOutlet` from `@angular/router`. Remove `@switch` from template. Just `<router-outlet />`.

**Result:** No crash, but outlet never activates. `rOutlet.isActivated === false`.

### Attempt 2: Check router state

**Diagnostics added:**

```html
<x-text
  >activated:{{rOutlet.isActivated}} navigated:{{routerNavigated}}
  url:{{routerUrl}}</x-text
>
```

**Result:** `activated: false`, `navigated: false`, `url: /`

The Router itself hasn't completed initial navigation. The URL is `/` (initial) but `navigated` is `false`.

### Attempt 3: Router event subscription

**Added** `router.events.subscribe()` in AppComponent constructor to log all events.

**Result:** Zero events emitted. No `NavigationStart`, no `NavigationEnd`, no `NavigationError`, nothing.

### Attempt 4: Manual `initialNavigation()`

**Added** `this.#router.initialNavigation()` call in AppComponent constructor.

**Result:** Still no events. `navigated` stays `false`.

### Attempt 5: `withEnabledBlockingInitialNavigation()`

**Added** to `provideRouter()` to block bootstrap until initial navigation completes.

**Result:** No change. `navigated: false`, no events.

### Attempt 6: Flat provider config (bypass `provideRouter`)

**Hypothesis:** `provideRouter()` nested inside `makeEnvironmentProviders()` might not forward `ENVIRONMENT_INITIALIZER` properly.

**Changed `app.config.ts`:**

```typescript
providers: [
  provideZonelessChangeDetection(),
  provideRenderer(),
  { provide: PlatformLocation, useClass: LynxPlatformLocation },
  { provide: LocationStrategy, useClass: LynxLocationStrategy },
  provideRouter(
    routes,
    withRouterConfig({ resolveNavigationPromiseOnError: true }),
  ),
];
```

**Result:** Same. `navigated: false`, no events. **Nesting is NOT the issue.**

### Attempt 7: Delayed manual `navigateByUrl()`

**Added** `setTimeout(() => router.navigateByUrl('/list-example'), 2000)` to test if Router works at all after everything is initialized.

**Result (after proper build):** Promise resolves to `false`. Navigation fails silently. (`resolveNavigationPromiseOnError: true` converts errors to `false` resolution.) Still zero events emitted.

### Attempt 8: Event subscription + delayed navigation

**Added** both `router.events.subscribe()` AND delayed `navigateByUrl()` with Promise capture.

**Result:** "nav..." appears (setTimeout fires), but zero Router events. Promise doesn't resolve or resolves to `false`. The Router's internal RxJS navigation pipeline is completely non-functional — navigations enter but nothing comes out.

---

## Key Findings

### 1. The Router's RxJS pipeline is dead

Angular's `Router` constructor sets up a navigation pipeline via `NavigationTransitions.setupNavigations().subscribe()`. This subscription processes all navigations. If this subscription errors/completes, ALL future navigations silently fail (no events, no errors, hanging promises).

**Hypothesis:** Something during Router initialization causes the pipeline subscription to error and die. With `resolveNavigationPromiseOnError: true`, the error is swallowed. Without it, the error might be thrown but can't be seen (no console on Lynx device).

### 2. `resolveNavigationPromiseOnError` masks the real error

This setting resolves navigation Promises as `false` instead of rejecting. But it may also prevent `NavigationError` events from being emitted, making debugging impossible.

### 3. The custom `LynxRouterOutlet` WAS catching events before

The original custom outlet subscribed to `NavigationEnd` events and they were firing. This means the Router WAS functional with the original code. Something changed that broke it, but since the user wasn't building between changes, we couldn't pinpoint when it broke.

### 4. `createComponent()` works independently

`NgComponentOutlet` renders components correctly. `ViewContainerRef.createComponent()` is functional after the `createComment()` fix. The issue is specifically with the Router, not with dynamic component instantiation.

---

## Unsolved Questions

1. **Why does the Router's navigation pipeline produce zero events?** Even `NavigationStart` (emitted via `tap` before any processing) never fires. This suggests the navigation never enters the pipeline at all, OR the pipeline subscription died during Router construction.

2. **What error kills the pipeline?** We can't see errors on the Lynx device (no console). `resolveNavigationPromiseOnError` might be masking the error. Need to try:
   - Remove `resolveNavigationPromiseOnError` and capture the rejection
   - Add `try/catch` around Router internals
   - Render the error on screen via signal

3. **Did `createComment()` changes break the Router?** The user reverted `createComment()` multiple times. Current state uses `__CreateRawText('')`. Need to test with a clean build and verify the Router pipeline is functional with the `LynxRouterOutlet` (custom) setup before switching to native `RouterOutlet`.

4. **Is the Router's `ENVIRONMENT_INITIALIZER` running?** `provideRouter()` provides an `ENVIRONMENT_INITIALIZER` that calls `inject(ROUTER_INITIALIZER)` to trigger initial navigation. If this doesn't run, the Router stays uninitialized. Test by logging in a custom `ENVIRONMENT_INITIALIZER`.

5. **Does `provideZonelessChangeDetection()` break the Router?** The Router might depend on NgZone for certain operations. In zoneless mode, `NgZone.isInAngularZone()` returns `false`. Some Router code paths might behave differently.

6. **Are our document/window polyfills sufficient?** The Router might use `document` or `window` properties we haven't polyfilled. For example, `document.baseURI`, `window.history`, `document.createElement()`. An unpolyfilled property access could throw silently and kill the pipeline.

---

## Recommended Next Steps

### Step 1: Verify custom LynxRouterOutlet still works

Revert to `LynxRouterOutlet` + `@switch` pattern with a CLEAN BUILD. Verify the Router fires events and the custom outlet catches `NavigationEnd`. This establishes a working baseline.

### Step 2: Find the error

Remove `resolveNavigationPromiseOnError: true` from the config. Add error capture:

```typescript
this.#router.navigateByUrl('/').then(
  (r) => renderDebug(`ok: ${r}`),
  (e) => renderDebug(`error: ${e?.message}\n${e?.stack}`),
);
```

The stack trace should point to exactly what's failing in the pipeline.

### Step 3: Check if `ENVIRONMENT_INITIALIZER` runs

Add a diagnostic `ENVIRONMENT_INITIALIZER` to `app.config.ts`:

```typescript
{
  provide: ENVIRONMENT_INITIALIZER,
  multi: true,
  useValue: () => { globalThis.__envInitRan = true; },
}
```

Then check `__envInitRan` in the component.

### Step 4: Test without zoneless

If possible, try `provideZoneChangeDetection()` instead of `provideZonelessChangeDetection()` to rule out zoneless-specific issues. (May require Zone.js polyfill for Lynx.)

### Step 5: Minimal reproduction

Create the absolute minimal Angular app with routing:

- One route, one component (just `<x-text>hello</x-text>`)
- `provideRouter([{ path: '', component: MinimalComponent }])`
- `<router-outlet />`
- No custom location strategies
- See if Angular's Router works at ALL in Lynx

### Step 6: Consider alternative approaches

If Angular's native Router can't be made to work:

- **Keep custom `LynxRouterOutlet`** with the `@switch` pattern — it works, just has DX limitations
- **Build a signal-based router** that doesn't use Angular's Router internals — just a signal holding the current path, with `navigateTo()` updating it
- **Use `NgComponentOutlet`** with a signal-based route resolver — the outlet dynamically renders the component matching the current route signal

---

## Files Reference

| File                                                    | Purpose                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/runtime/src/lib/lynx-router.ts`               | `provideRouter()` — wraps `provideRouter()` with Lynx location strategies |
| `packages/runtime/src/lib/lynx-router-outlet.ts`        | Custom `LynxRouterOutlet` — content projection + `@switch`                |
| `packages/runtime/src/lib/lynx-location-strategy.ts`    | In-memory `LocationStrategy`                                              |
| `packages/runtime/src/lib/lynx-platform-location.ts`    | In-memory `PlatformLocation`                                              |
| `packages/runtime/src/lib/lynx-document.ts`             | `createComment()` fix lives here                                          |
| `packages/runtime/src/lib/runtime.ts`                   | Global polyfills (document, window, setTimeout, etc.)                     |
| `packages/runtime/src/lib/renderer.ts`                  | `LynxRenderer` — Renderer2 implementation                                 |
| `packages/runtime/src/lib/lynx-renderer-factory2.ts`    | `end()` calls `__FlushElementTree()`                                      |
| `packages/runtime/src/lib/lynx-element.ts`              | `LynxElement` — wraps native elements                                     |
| `packages/kitchen-sink-app/src/app/app.config.ts`       | App config — currently uses flat `provideRouter()`                        |
| `packages/kitchen-sink-app/src/app/app.routes.ts`       | Route definitions                                                         |
| `packages/kitchen-sink-app/src/app/app.component.ts`    | Root component — currently has debug diagnostics                          |
| `packages/kitchen-sink-app/src/main.ts`                 | Entry point — `bootstrapApplication()`                                    |
| `packages/rsbuild-plugin-angular-lynx/src/polyfills.js` | Pre-entry polyfills (runs before Angular)                                 |

---

## Resolution (2026-05-08)

### Root Cause Found

**`AbortController` is not available in Lynx's PrimJS runtime.**

Angular Router v21 uses `new AbortController()` at the very start of its navigation pipeline (`NavigationTransitions.setupNavigations()`, line 3708 of `_router-chunk.mjs`):

```javascript
setupNavigations(router) {
  this.transitions = new BehaviorSubject(null);
  return this.transitions.pipe(filter(t => t !== null), switchMap(overallTransitionState => {
    const abortController = new AbortController();  // ← THROWS ReferenceError
    ...
```

The Router constructor subscribes with an intentionally empty error handler:

```javascript
this.navigationTransitions.setupNavigations(this).subscribe({
  error: (e) => {}, // line 4410 — silently swallows ALL errors
});
```

**Failure sequence:**

1. `initialNavigation()` pushes to `transitions` BehaviorSubject
2. `switchMap` runs its projection function
3. `new AbortController()` → `ReferenceError: AbortController is not defined`
4. Error propagates to `subscribe({ error: e => {} })` — silently swallowed
5. The subscription terminates permanently (RxJS subscriptions die after error)
6. All future `transitions.next()` calls emit to nobody
7. No events, `navigated: false`, promises hang forever

### Why This Was Hard to Find

1. **Silent error swallowing** — The empty `error: e => {}` handler is intentional in Angular (it's a known pattern for the Router). No logging, no events, nothing.
2. **`resolveNavigationPromiseOnError: true`** masked the error further by resolving promises to `false` instead of rejecting.
3. **No console on Lynx device** — Errors can only be seen by rendering on screen.
4. **The error occurs BEFORE `NavigationStart`** — `AbortController` is at line 3708, `NavigationStart` is emitted at line 3745. So zero events were ever seen.

### Evidence

- React Lynx (`references/lynx-stack-main/packages/motion/src/polyfill/shim.ts`) polyfills `queueMicrotask`, `performance`, `NodeList`, `HTMLElement`, etc. — confirming Lynx needs polyfills for standard Web APIs.
- `AbortController` is a Web Platform API (not core ECMAScript). Lightweight JS engines like PrimJS typically lack it.
- React Lynx has no `AbortController` polyfill because it has no client-side router.

### Fix Applied

Added a minimal `AbortController`/`AbortSignal` polyfill to:

1. **`packages/rsbuild-plugin-angular-lynx/src/polyfills.js`** — Runs as `preEntry` before any Angular code loads (primary)
2. **`packages/runtime/src/lib/runtime.ts`** — Defensive polyfill for consumers not using the rsbuild plugin

Also added `queueMicrotask` polyfill to `runtime.ts` (Angular core uses it for effect scheduling).

The polyfill implements the subset Angular Router needs:

- `signal.aborted` (boolean) — checked in Recognizer
- `signal.reason` (any) — read via `signal.reason + ''` for cancellation messages
- `signal.addEventListener('abort', fn)` / `removeEventListener` — used by `abortSignalToObservable()`
- `controller.abort(reason?)` — called in `finalize()`

### Previous Unsolved Questions — Answered

| Question                                           | Answer                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why zero events?                                   | Error at line 3708 (before NavigationStart at 3745) kills the subscription                                                                        |
| Why does `navigateByUrl()` hang?                   | The promise's resolve/reject are inside the dead pipeline                                                                                         |
| Why did the custom `LynxRouterOutlet` work before? | It subscribed to `NavigationEnd` — but that was in an earlier version of the code before `AbortController` was added to Angular Router's pipeline |
| Is `createComment()` related?                      | No — it affects `ViewContainerRef` anchors, not the Router's RxJS pipeline                                                                        |
| Is zoneless related?                               | No — the error is in the Router initialization, not change detection                                                                              |
