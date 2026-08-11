# Navigation Crash Investigation

## Problem

Routing works (AbortController polyfill fixed the dead pipeline), but tapping navigation buttons intermittently crashes the app. After the x-list use-after-free fix, a new symptom appeared: occasional blank screen.

---

## Fix 1: x-list Use-After-Free (2026-05-08)

### Root Cause

`LynxListElement._scheduleUpdate()` uses `setTimeout` to batch list updates. When navigating away from a route containing `<x-list>` (e.g. `ElementsShowcaseComponent`):

1. Angular removes x-list children → `removeVirtualChild()` → `_scheduleUpdate()` schedules a `setTimeout`
2. The x-list element itself is removed from native tree via `__RemoveElement` → native element freed
3. `setTimeout` fires → `__SetAttribute(this.element, 'update-list-info', ...)` on freed native reference → **crash**

This is a classic use-after-free: the native element is freed in step 2, but the JS callback still holds a reference to it.

### Fix Applied

`packages/runtime/src/lib/lynx-element.ts` — `LynxListElement`:

- Added `_destroyed` flag and `_updateTimer` tracking
- Override `remove()` to set `_destroyed = true` and cancel the pending `setTimeout` via `clearTimeout`
- `_scheduleUpdate()` checks `_destroyed` at both scheduling time and callback time

### Outcome

Fixed the x-list use-after-free. But the app still crashes intermittently (non-showcase routes too), and occasional blank screens appeared.

---

## Fix 2: Defer Navigation Out of Worklet (2026-05-08)

### Hypothesis

When `navigateTo(path)` is called from a `(bindtap)` event handler, it runs **inside a Lynx worklet callback** (`runWorklet`). Angular's Router processes the entire navigation synchronously (no guards/resolvers/lazy loading), which means all DOM mutations happen during the worklet:

- `__RemoveElement` — old component's elements
- `__CreateView`, `__AppendElement`, `__InsertElementBefore` — new component's elements

**React Lynx never does this.** In React Lynx:

- Event handlers only update React state
- All DOM mutations happen in a deferred render cycle after the event handler returns
- `__FlushElementTree()` is always deferred via `Promise.resolve().then(...)`, never called synchronously

Evidence from React Lynx reference:

- `worklet-runtime/api/element.ts`: `flushElementTree()` always defers via `Promise.resolve().then()`
- `lifecycle/patch/updateMainThread.ts`: Uses `setEomShouldFlushElementTree(false)` during batched worklet execution
- `worklet-runtime/utils/mainThreadFlushLoopGuard.ts`: Exists to detect re-entrant flush loops — proving this is a known Lynx hazard

### Fix Applied

`packages/kitchen-sink-app/src/app/app.component.ts`:

```typescript
navigateTo(path: string): void {
  setTimeout(() => this.#router.navigateByUrl(path), 0);
}
```

This moves all DOM mutations into a `setTimeout` macrotask, after the worklet callback returns — matching React Lynx's pattern.

### Diagnostics Added

Since there is no console on the Lynx device, added on-screen error rendering:

- `packages/runtime/src/lib/runtime.ts`: `globalThis.onerror` and `globalThis.onunhandledrejection` handlers store errors in `globalThis.__lynxLastError`
- `packages/kitchen-sink-app/src/app/app.component.ts`: Red `<x-text>` panel displays `lastError` signal when non-empty

---

## Fix 3: `LynxRouteReuseStrategy` — Element Pool Exhaustion (2026-05-08)

### Root Cause Found

**Lynx has a finite native element pool (~256 slots on device). `__RemoveElement` detaches elements from the tree but does NOT free pool slots. There is no `__ReleaseElement` API in Lynx's public surface.**

Angular's default `RouteReuseStrategy` destroys components on every navigation, creating fresh native elements each time. Destroyed elements stay in the pool. With `ScrollExampleComponent` creating ~50 elements per visit, after 5 scroll visits (= 9 total navigations back and forth with list), the pool exceeds capacity → **hard native crash** (app returns to home screen, no JS error caught).

Evidence:

- Crash is always on the **9th navigation** — deterministic, not a race condition
- `__ReleaseElement` exists in React Lynx source but is **commented out everywhere** — API is not finalized
- Our `lynx.ts` types have no destroy/free API beyond `__RemoveElement`
- React Lynx doesn't hit this because it patches the existing element tree rather than destroying and recreating component subtrees

### Fix Applied

`packages/runtime/src/lib/lynx-route-reuse-strategy.ts` — `LynxRouteReuseStrategy`:

- `shouldDetach()` returns `true` — always detach instead of destroy
- `store()` / `retrieve()` keep the `DetachedRouteHandle` alive in a Map
- On revisit, `shouldAttach()` / `retrieve()` return the stored handle → Angular re-inserts the existing native elements (reusing pool slots, no new allocations)
- Pool size caps at: initial elements + max(elements per distinct route)

Wired into `provideRouter()` via `{ provide: RouteReuseStrategy, useClass: LynxRouteReuseStrategy }` — transparent to app developers.

### Status

Fix applied. Testing on device required.

---

## Key Architecture Context

| API                     | Where called                   | When                                                  |
| ----------------------- | ------------------------------ | ----------------------------------------------------- |
| `__RemoveElement`       | `LynxElement.remove()`         | During router deactivation                            |
| `__CreateView`          | `LynxDocument.createElement()` | During router activation                              |
| `__AppendElement`       | `LynxElement.appendChild()`    | During template rendering                             |
| `__InsertElementBefore` | `LynxElement.insertBefore()`   | During ViewContainerRef insertion                     |
| `__FlushElementTree()`  | `LynxRendererFactory2.end()`   | End of Angular CD cycle (deferred via `markForCheck`) |

Angular's `RendererFactory2.begin()`/`end()` are called by `detectChangesInternal()` which runs in the scheduled CD cycle — NOT during the synchronous `navigateByUrl()` call. So `__FlushElementTree()` is NOT called during the worklet event handler.

However, `__RemoveElement`, `__CreateView`, etc. ARE called during the synchronous navigation (inside the worklet). Whether Lynx's native side tolerates tree structure mutations during worklet execution is unknown without native source access.

---

## Files Modified

| File                                                 | Change                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/runtime/src/lib/lynx-element.ts`           | `LynxListElement`: `_destroyed` flag, cancel pending `_scheduleUpdate` on remove |
| `packages/runtime/src/lib/runtime.ts`                | Global `onerror`/`onunhandledrejection` diagnostics                              |
| `packages/kitchen-sink-app/src/app/app.component.ts` | Defer navigation via `setTimeout`, show `lastError` on screen                    |
