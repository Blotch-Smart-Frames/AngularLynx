# Lynx vs Web Differences

Gotchas discovered while building Angular on Lynx. These are places where Lynx behaves differently from the web platform in ways that are non-obvious.

---

## `pointer-events: none` does not work for scroll gesture interception

### What you'd expect (web)

Setting `pointer-events: none` on an overlay element makes it transparent to all pointer events, including scroll gestures. Underlying scrollable elements receive the scroll unobstructed.

### What Lynx does

`pointer-events` is **not supported by the Lynx CSS encoder** — using it causes a build error:

```
Error: "pointer-events" is not supported now!
```

Even if it were supported, it would not help. The Lynx `view` element docs for `user-interaction-enabled` (the closest equivalent) explicitly state:

> "This property does not affect platform-level gestures (such as scrolling of `scroll-view`)."

Platform scroll gestures are handled by the native gesture recognizer, which attaches to the topmost view in the hit-test stack. Lynx-level event properties (`pointer-events`, `user-interaction-enabled`) only affect Lynx touch events, not the native scroll recognizer.

### The fix

Use **DOM order / stacking context** instead of `pointer-events`. Place the overlay element **before** the scroll-view in DOM order (lower stacking context). The scroll-view, rendered after, sits on top and the native gesture recognizer attaches to it.

```html
<!-- background BEFORE scroll-view → lower stacking context → scroll-view wins -->
<x-view class="background" />
<x-scroll-view scroll-orientation="vertical"> ... </x-scroll-view>
```

Do NOT put a `position: fixed`/`position: absolute` overlay element inside the scroll-view — even with `position: fixed` (which in Lynx makes the element a direct child of root), it ends up above the scroll-view in z-order and blocks scroll gestures.

---

## Gestures have THREE independent silent-failure points: the `enableNewGesture` flag, object-wrapped callbacks, and the event payload shape

Gestures via the `[lynxGesture]` directive (`PanGesture`, `TapGesture`, `Gesture.Exclusive`, …) fail silently in **three** independent ways. All must be fixed; fixing only some yields gestures that stay dead, or fire but produce `NaN` — never an error or log.

### What you'd expect (web)

You attach a gesture/pointer handler and it fires. There's no global build switch to flip first, and a handler function is just a function.

### What Lynx does

**(1) The `enableNewGesture` page-config flag — off by default.** `__SetGestureDetector` plus the `waitFor` / `simultaneousWith` / `continueWith` relations is Lynx's **"new gesture" system**, and the native engine only processes it when the page config has `enableNewGesture: true`. With the flag off, `RadonNode` skips gesture-detector flushing entirely (`GetEnableNewGesture()` gate in `core/renderer/dom/vdom/radon/radon_node.cc`), so every `__SetGestureDetector` call is dropped — no crash, no warning, no log. The flag is baked into the compiled template's `sourceContent.config` at build time (verify with `grep -a enableNewGesture dist/main.lynx.bundle`), not set at runtime.

**(2) Gesture callbacks must be OBJECTS, not raw functions — under fiber arch.** The native binding (`renderer_functions.cc InnerCreateGestureDetector`) routes a _callable_ callback into `GestureCallback.lepus_function_`, but a callback that is an _object_ into `lepus_object_`. Under fiber architecture (`enableFiberArch: true`, hardcoded on in `LynxTemplatePlugin`), the dispatch path `TriggerFiberElementWorklet` (`core/renderer/events/touch_event_handler.cc`) reads **only `lepus_object_`** and bails immediately if it's empty. So a plain-function callback is registered, the gesture is recognized natively, and then the callback is **silently never invoked**. This is the subtle one: the gesture _works_, but your handler never runs — indistinguishable on-device from "gestures are dead."

When it does fire, native calls the main-thread global `runWorklet(callbackObject, [event, gestureManager], { source })` — so the callback object must be something `runWorklet` can dispatch.

Related native fact: `has-react-gesture` (which React Lynx sets alongside the detector) is **React-only bookkeeping** — the native core never reads it, so the Angular directive omits it.

Also (Android-only): registering a gesture does **not** auto-mark the element non-flatten (unlike adding a DOM event listener, which does). A flattened view can't receive its own gestures, so the directive sets `flatten: false` explicitly, mirroring React Lynx. No-op on iOS.

**(3) The event payload is a nested envelope, and Lynx gives position — never translation.** Once callbacks fire, the object handed to them is `{ type, timestamp, target, currentTarget, params: {...}, detail: {...} }` (built by `GetCustomEventParam`), where the data lives under `params`. Critically, the iOS handlers (`LynxPanGestureHandler` / `LynxBaseGestureHandler`) populate `params` with the finger's **position** — `x`/`y` (element-relative), `pageX`/`pageY` (page-relative), `clientX`/`clientY` — plus `scrollX`/`scrollY`, which are the gesture member's **scroll offset** (0 for a non-scrolling `<view>`), NOT the drag distance. There is **no** native `translationX`/`translationY`. So a react-native-gesture-handler-style handler reading `event.translationX` gets `undefined` → `NaN`; and naively aliasing it to `scrollX` gives `0` forever (a static view never scrolls). Accumulated translation has to be computed by the framework.

### The fix

1. `@blotch/rsbuild-plugin-angular-lynx` defaults `enableNewGesture` to **`true`** (unlike React Lynx, which defaults it `false` to keep its legacy gesture system — AngularLynx has no legacy gesture path, so nothing to preserve). Override only to explicitly disable: `pluginAngularLynx({ enableNewGesture: false })`.
2. `LynxGestureDetector` wraps each callback as `{ _fn: (event) => … }` so it lands in `lepus_object_`, and `runtime.ts`'s `runWorklet` unwraps `_fn` and calls it. (Events registered via `__AddEvent` are a _different_ native path that does accept raw functions — which is why events worked but gestures didn't, obscuring the asymmetry.)
3. `mapGestureEvent` (`gesture/event.ts`) adapts the native envelope into AngularLynx's flat event: it spreads `params` (so every native field stays reachable, incl. `x`/`y`, pinch `scale`, rotation `rotation`, `isAtStart`/`isAtEnd`), keeps raw `params` as an escape hatch, maps `pageX`/`pageY`→`absoluteX`/`absoluteY`, and **derives** `translationX`/`translationY` by anchoring a per-gesture origin (`createGestureOrigin`, held by the directive) at the gesture's first event and subtracting — resetting it on `onEnd`. This reproduces react-native-gesture-handler's translation semantics on top of Lynx's position-only events.

---

## A discrete gesture's `onEnd` fires on failure too, `numberOfTaps` is a native no-op, and partial configs zero the rest

Three separate Lynx gesture facts break naive `TapGesture`/`LongPressGesture` handlers. Each fails silently: the wrong callback runs, or a config value you never set becomes `0`.

### What you'd expect (web / react-native-gesture-handler)

`onEnd` fires when a gesture succeeds. Setting one config option leaves the others at their documented defaults. `numberOfTaps(2)` gives you a double-tap.

### What Lynx does

**(1) `onEnd` fires on success AND failure.** The iOS `LynxTapGestureHandler` calls `onEnd` from its `fail` override (`LynxTapGestureHandler.m`), not only on a recognized tap. A drag past `maxDistance` fails the tap but still emits `onEnd`. So counting taps on `onEnd` counts every drag and long-hold as well. Only `onStart` fires exclusively on recognition: the success path is `activate → onStart → onEnd`, the failure path is just `fail → onEnd`. Long-press behaves the same way.

**(2) `numberOfTaps` is a no-op on-device.** No native platform implements multi-tap counting — a whole-tree search of the Lynx source for `numberOfTaps` returns nothing. `TapGesture().numberOfTaps(2)` recognizes on the FIRST tap. A real native double-tap is impossible; time successive taps yourself.

**(3) A partial config zeroes every key you didn't set.** The iOS handlers read each option with `[[config objectForKey:@"maxDuration"] floatValue]`, and `[nil floatValue]` is `0`. The built-in defaults (`maxDistance = 10`, `maxDuration = 500`) apply only when the WHOLE config is absent — `handleConfigMap` early-returns on a nil map. Send `{ numberOfTaps: 2 }` and both `maxDuration` and `maxDistance` become `0`. `maxDuration = 0` then schedules the tap to fail on a 0 ms timer the instant a finger lands. That fires `onEnd` (see #1) before you lift — an instant, phantom "tap". `renderer_functions.cc InnerCreateGestureDetector` passes the JS config straight through to this handler.

### The fix

1. **Always send a full default config.** `TapGesture` / `LongPressGesture` / `PanGesture` seed the complete default set into `_config` on construction (`gesture/const.ts`), so a partial config can never zero a native key. This mirrors Lynx's own gesture-runtime, which seeds defaults for the same reason.
2. **`onEnd` normalized for discrete gestures.** `LynxGestureDetector` (`gesture/gesture-detector.ts`) observes `onStart` — registering its own observer when you didn't — to learn whether a tap/long-press was recognized, then drops the failed-gesture `onEnd`. `onEnd` now means "the gesture happened", matching react-native-gesture-handler. Continuous gestures (pan/fling/rotation/pinch) pass through unchanged.
3. **`numberOfTaps` documented as a no-op.** Kept on `TapGesture` for API parity, with a JSDoc warning. For a double-tap, time taps in your own callback.

---

## `position: fixed` is absolute-relative-to-root, not viewport-fixed

### What you'd expect (web)

`position: fixed` positions an element relative to the viewport and keeps it fixed during scroll.

### What Lynx does

> "The element will be treated as a direct child of root node with the property `position` as `absolute`."

`position: fixed` in Lynx = `position: absolute` relative to the root page node. It does NOT stay fixed during scroll — it's just taken out of normal flow and positioned against the page root. Use it for full-screen overlays, but don't expect viewport-fixed behavior during scrolling.

---

## `<overlay>` is 0×0 and only sizes its FIRST child; a bare `position: absolute` child collapses to the top-left

### What you'd expect (web)

An overlay/portal container fills the screen, so a child with `position: absolute; bottom: 0` docks to the bottom of the viewport.

### What Lynx does

The native `<overlay>` element occupies **no space** (`OverlayShadowNode::Measure` returns `0×0`) and establishes **no containing block**. Instead it measures **only its first child** against the full screen dimensions (`MeasureMode::Definite` screen width/height). If that first child is itself `position: absolute` with no size, it collapses to its content at the top-left — so a toast whose overlay's first child is a bare `<view style="position: absolute; bottom: 0">` renders at the **top**, not the bottom.

### The fix

Make the overlay's first child a **full-size backdrop view** (`class="h-full w-full"`), then position content inside it. This is why `bottom-sheet` (overlay → `h-full w-full` backdrop → `position: absolute; bottom: 0` panel) docks correctly, and the toast did not until wrapped the same way.

Caveats for **non-modal** overlays (e.g. toast): a full-screen first child captures touches for the app behind it, and on iOS this held true no matter what was tried — `pointer-events` errors the build (see above), `events-pass-through`/`custom-layout` are web-platform-only overlay attributes (the native overlay API exposes only `ios-enable-swipe-back`, `level`, `mode`, `visible`), and even the general-purpose `event-through` attribute did not help in practice, despite checking out against the native source on paper:

- **Harmony**: `UIOverlay::OnNodeEvent` (`platform/harmony/lynx_xelement/overlay/ui_overlay.cc`) hit-tests its own subtree, and if the deepest hit element has `EventThrough` set, redispatches the touch to the page root instead of handling it.
- **iOS**: `LynxOverlayContainer.hitTest:withEvent:` (`platform/darwin/ios/lynx_xelement/overlay/LynxOverlayContainer.m`) does a real hit test and returns `nil` when the hit element has `eventThrough` set, so standard UIKit hit-testing *should* give the touch to whatever's behind it.
- **Android**: `LynxOverlayDialog` is a genuine separate `Dialog`/window, so passthrough is coarser — `LynxOverlayView.needHandleEvent()` (`LynxOverlayView.kt`) checks the overlay's own `event-through` plus its *direct* children's bounding boxes, not a deep per-descendant hit test. A single full-screen direct-child backdrop may make this always resolve to "handled," swallowing touches meant for nested interactive content. Not yet verified on-device.

**Both `event-through` and `mode="page"` were tried on-device for `packages/ui/src/lib/components/toast/toast.ts` and neither fixed it — this is a documented dead end, not a suggestion.** `<overlay>`'s `mode` prop (`LynxUIOverlay.m`) defaults to `LynxOverlayModeWindow` (`LynxOverlayContainer.h`) when left unset — a genuinely separate native `UIWindow`, not a layered sibling view — which was one plausible reason `event-through`'s same-window hit-test redispatch wouldn't reach the app. Setting `mode="page"` (attaching the overlay inside the same view controller/window as the page) was tried on top of `event-through` and *also* made no observable difference: confirmed with an on-screen tap counter (there's no attachable console on-device) showing zero taps registering anywhere in the app — including a header button nowhere near the toast — for as long as any toast was visible, identical before and after both attempted fixes. Why iOS's own hit-test source didn't produce the expected behavior remains unexplained.

### The actual fix

Don't use `<overlay>` for non-modal content at all. `<overlay>`'s bespoke hit-testing is fundamentally a modal-window primitive — correct for `bottom-sheet`/`dialog`/`action-sheet`, wrong for anything that must leave the rest of the app interactive. `packages/ui/src/lib/components/toast/toast.ts` instead uses a plain `<view style="position: fixed; ...">`, relying on the "position:fixed reparents to page root" behavior (see below) for the same "renders on top, positioned against the full screen" effect, but going through the SAME ordinary hit-testing every other element in the app uses — no special attribute needed. The one adjustment this requires: give that view a small, explicit, non-zero height (not full-screen) instead of `h-full w-full`, so it only occupies real screen space near the toast and doesn't shadow the rest of the screen; `overflow: visible` (already needed for the stack's peek-through effect) means content taller than that floor still paints and stays fully hit-testable, so the height doesn't need to precisely match real content.

---

## A move is remove-then-reinsert — it must not "park" the element's children

### What you'd expect (web)

Reordering `@for` items — or any `ViewContainerRef.move()` — relocates an element with its whole subtree intact. In the DOM the children come along automatically.

### What Lynx does

Angular implements a move as **detach-then-reinsert in the same change-detection tick**: `renderer.removeChild(el)` immediately followed by `renderer.insertBefore(el, …)`. The renderer's `remove()` used to run its full teardown on that detach — including "parking" the element's children (see the parking-crash entry below). So every moved item was gutted: its `<text>` label and buttons were re-homed away, and the re-inserted item arrived empty.

This broke `examples/transitions`. Deleting a non-last item reorders every following item (each a `move()`), so their content vanished. Deleting the last item triggers no moves, so it stayed intact — the tell-tale signature.

For a same-tick move this is completely safe: the element is removed and re-inserted in **one** flush (`is_move=true`), so both its fiber node and its native painting node survive. `RemoveNodeInternal` (`references/lynx/core/renderer/dom/fiber/fiber_element.cc`) only unlinks the node and clears its parent pointer; `InsertNodeBeforeInternal` auto-reparents it on re-insert, exactly as React Lynx moves reused nodes via `__RemoveElement` then `__InsertElementBefore` on the same element (`snapshot.ts`). (A removal that is **not** re-inserted in the same flush is different — its painting node dies and re-inserting the stale ref renders empty; see the recreate-on-remount entry below.)

### The fix

`remove()` defers its native teardown by one microtask (`#pendingRemovals` in `packages/runtime/src/lib/lynx-element/lynx-element.ts`). A re-insert in the same tick — `appendChild`/`insertBefore` — cancels the queued removal, so a move relocates the element with its subtree intact. Only a genuine destroy (never re-inserted) reaches `#doRemove()`. Covered by the reorder test in `packages/runtime/src/lib/renderer/teardown.spec.ts`.

---

## An orphaned `<overlay>` is a live native window — destroying its `@if` must tear it down with the whole subtree

### What you'd expect (web)

Removing a subtree from the DOM removes everything in it, including any overlay/portal element. A detached DOM node is inert and garbage-collected; there is no lingering "window."

### What Lynx does

An `<overlay>` is a standalone **native window**, not an in-flow element. When the `@if` containing one is destroyed (e.g. a `ui-select`/`dialog`/`sheet` inside a step that toggles off), the overlay's native window must be torn down with the rest of the subtree. An overlay left detached-but-alive with no owning Angular view is a live window that corrupts the native window hierarchy and **crashes to the home screen** (observed on `examples/checkout-form`: pressing Continue destroys the step-1 `@if`, which contains the Country `ui-select`).

This once crashed for a subtler reason: the renderer's old child-"parking" mechanism (see the parking-crash entry below) re-homed a destroyed element's children onto the page root to rescue projected content — which left the overlay orphaned there. That mechanism has since been removed.

### The fix

`#doRemove()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) removes each subtree **as a single unit**, so an overlay is torn down together with its ancestor and no window is orphaned. No overlay-specific exception is needed any more, and the old page-root re-home **leak** (non-overlay subtrees stranded on the page root) is gone with it. Covered by `packages/runtime/src/lib/renderer/teardown.spec.ts` (a TestBed harness over a fake native tree, asserting overlay teardown as a unit, bare-`<ng-content>` re-projection, and `@for` reorder-as-move).

---

## Projected content in a toggled `@if` needs recreate-on-remount — the fiber survives a removal, but its painting node does not

### What you'd expect (web)

Toggle an `@if` off and on and the projected content comes back exactly as it was — the browser preserves the whole detached subtree and re-attaches it wherever Angular re-projects it.

### What Lynx does

Lynx has **two element layers**, and a removal treats them differently:

- **Fiber layer** — `__RemoveElement` (`FiberElement::RemoveNodeInternal`, `references/lynx/core/renderer/dom/fiber/fiber_element.cc`) is a pure detach: it erases the node from its parent's `scoped_children_` and calls `set_parent(nullptr)`. The node and its whole subtree stay valid JS objects, re-insertable via `__AppendElement`/`__InsertElementBefore`.
- **Painting layer** — the rendered native view. At flush (`ElementContainer::RemoveSelf` → `PaintingContext::RemovePaintingNode`), a node that was removed and **not** re-inserted in that *same* flush has `is_move=false` and its painting node is **destroyed**. There is **no** API to re-create a painting node on a later re-insert (`CreateElementContainer` runs once, under `kDirtyCreated`). Re-attaching such a node in a later flush renders an **empty** element.

A same-tick MOVE stays `is_move=true` (removed and re-inserted in one flush), so it keeps its painting node — that's why `@for` reorders work (see the move entry above). But an `@if` toggle spans **two change-detection cycles**: the content is removed on collapse (painting node dies at that flush) and re-inserted on expand (a later flush).

This bites projected content specifically. The projected nodes are owned by the **surviving consumer**, so Angular **reuses** the same element across the toggle instead of recreating it — and that reused element's painting node is already dead. On-device symptom: an accordion/collapsible panel shows on the first expand, then an **empty wrapper** on every expand after (`@if(open){ <view.slot><ng-content/></view> }`). The bare-`<ng-content>` shape (`LynxTransition`, `@if(show){ <ng-content/> }`) has the same failure — its projected root is likewise reused across the toggle.

React Lynx (the production reference) never hits this: on unmount it drops the native refs, and on remount it **creates fresh** native elements (`reconstructInstanceTree` → `ensureElements` → `__CreateElement`), never re-inserting a dead painting node.

### The fix

**Recreate on remount**, mirroring React Lynx. `LynxElement` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) caches each element's state as it is set (tag, attributes, id, dataset, classes, inline styles, event listeners, text, ordered children). `#doRemove()` marks the removed subtree painting-dead; the next `appendChild`/`insertBefore` of a painting-dead element rebuilds a fresh native ref for it and its whole subtree from cache (`#recreateSubtree`), then attaches that. A same-tick move is canceled before it becomes a removal, so it is never painting-dead and never recreated — the reorder fast-path is untouched.

Covered by `packages/runtime/src/lib/renderer/teardown.spec.ts`, whose fake native tree models **both** layers (a removed node's painting node dies at flush unless reinserted in the same flush). The accordion-cycle, bare-`<ng-content>`, event-rebind, attribute-replay and raw-text tests fail without recreation and pass with it.

**Known limitation:** native-only state not tracked by Angular (uncontrolled input text, scroll position, focus) resets on remount — the same semantics as Angular's web `@if`, which also destroys and rebuilds the DOM subtree on toggle.

---

## Attaching an element into its own subtree silently builds a cycle and hangs layout forever (no `HierarchyRequestError`)

### What you'd expect (web)

`parent.insertBefore(node, ref)` where `node` is an ancestor of `parent` throws `HierarchyRequestError` — the DOM refuses to create a cycle. Reparenting is always safe: the worst case is an exception, never a corrupt tree.

### What Lynx does

`FiberElement::InsertNode`/`InsertNodeBeforeInternal` auto-reparents a node that still has a parent, but **never checks whether the new parent lives inside the node's own subtree**. Ask it to attach an element under one of its own descendants and it happily writes a self-referential `parent`/`child` link. Nothing throws — the corruption would only bite at the next layout pass (a naive cycle-walk with no visited set would recurse forever).

How the renderer could in principle hand Lynx a cyclic attach: an Angular reorder or re-projection can ask to re-insert an element underneath one of its own former descendants (e.g. two siblings swap places and one lands inside the other). The raw `__AppendElement`/`__InsertElementBefore` would then close the loop. This is a real, structurally-possible hazard, but **it turned out not to be what caused the observed `LynxTransition` panel freeze** — see the parking-crash entry below for the actual mechanism and why the crash signature (a shallow, ~7-frame recursion plus a watchdog timeout, not a near-instant stack overflow) doesn't match a true cyclic tree walk in the first place.

### The fix

`wouldFormCycle(parent, candidate)` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) walks `parent`→root via `__GetParent`, comparing `__GetElementUniqueID`s (native refs can't be used as keys or reliably `===`-compared). `appendChild` and `insertBefore` skip the attach when it would form a cycle — the DOM's ancestor check, minus the throw. The walk is bounded by tree depth, two cheap native reads per step. Kept as defensive coding for a real hazard even though it wasn't the cause below. Covered by `packages/runtime/src/lib/lynx-element/lynx-element-cycle.spec.ts`.

---

## Two watchdog crashes traced to the renderer's child-"parking" machinery (now removed)

### What you'd expect (web)

Detach a node to a scratch location and move it back later, and the browser lays it out wherever it ends up. There is no location that is toxic to detach to, and an offscreen scratch area doesn't accumulate cost over time.

### What Lynx does

To keep projected content **rendering** across an `@if` toggle, earlier renderer revisions **"parked"** a removed element's children somewhere live on a genuine destroy, then moved them back on re-insert. Parking was genuinely **load-bearing**: keeping the child attached to a live parent meant it was never left removed across a flush, so its painting node stayed alive (`is_move` never went false) — the real problem the pure-detach fiber layer does NOT solve on its own (see the recreate-on-remount entry above). But parking produced two main-thread **watchdog SIGKILLs** (`0x8BADF00D`, "failed to terminate gracefully after 5.0s"):

1. **Page-root parking → layout livelock on re-show.** Parking onto the live, laid-out page root laid each child out as a direct in-flow child of `<page>`; moving it back out of that position into a deep descendant on re-show drove a *single* layout pass into a non-terminating state. Stack: `setTimeout` → `FiberFlushElementTree` → `LayoutContext::Layout` → stuck in `RemoveAlgorithmRecursive`. Not a cycle: `RemoveAlgorithmRecursive` is a per-relayout cache clear that recurses only to tree depth (~7 frames), and `Layout` calls `CalculateLayout` exactly once with no C++ loop — one pass failing to terminate on a pathological (lattice-shaped) tree, not a stack overflow (a real cycle overflows near-instantly as `EXC_BAD_ACCESS`).
2. **`display:none`-holder parking → teardown hang.** Moving parking into a `display:none` holder (which layout skips wholesale) fixed the re-show livelock, but children of a *permanently* destroyed element leaked into the holder forever — nothing ever cleaned it. Eventually destroying that ever-growing tree at shell teardown (`LynxShell::Destroy` → `~LayoutContext` → destroying the `unordered_map<int, LayoutNode>`) blew the 5s watchdog on the next reload/startup.

Also **disproven** along the way, recorded so they aren't re-attempted: a genuine tree cycle (ruled out by the crash signature above); and a "defer the restore to a macrotask" timing fix (the re-show crash was byte-identical after it shipped, proving the restore *timing* was irrelevant).

### The fix

Parking was **removed entirely** and replaced by **recreate-on-remount** (see the recreate-on-remount entry above). `#doRemove()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) now removes each subtree as one unit and marks it painting-dead; a later re-insert rebuilds it from cache. So nothing is stranded on the page root, nothing accumulates in a holder, and the projected content still renders on re-show. Why parking couldn't just be fixed in place: content parked outside its component's own subtree can no longer be cleaned up by Angular on destroy (Angular removes only its own subtree, and `destroyNode` isn't called on the relocated nodes), so the holder leaks unrecoverably — proven by the leak test in `teardown.spec.ts`. Recreate-on-remount never relocates content, so it has no such leak. The move/destroy split (`#pendingRemovals`) and the `wouldFormCycle` guards are kept.

**Confirmed on-device:** both watchdog crashes are gone — `examples/transitions` shows/hides/re-shows without freezing, and reloads without the teardown hang. Removing parking then surfaced a separate, pre-existing bug (removed elements leaving a layout gap / stale panels) that had been masked by the crashes — see the flush-timing entry below.

---

## Deferred element removals must be committed inside the CD flush, not a later microtask

### What you'd expect (web)

Remove a node during a framework's render pass and it's gone from layout by the time that pass paints. There's no gap where a removed node still occupies space.

### What Lynx does

Element mutations only reach the main thread (and layout) on `__FlushElementTree()`, which the renderer calls once per change-detection cycle in `LynxRendererFactory2.end()`. `remove()` **queues** a genuine removal rather than applying it immediately, so a same-tick re-insert can cancel it (an Angular move — see the postmortem above). The bug: that queue was drained in a `queueMicrotask`, which fires **after** `end()` has already flushed. So the `__RemoveElement` ran too late — the node was gone from the JS element tree but not committed to native until some *later* cycle happened to flush. Until then it kept occupying layout space, often invisibly: a `LynxTransition` panel whose leave animation faded it to `opacity: 0` "hid" but left a gap; an accordion panel collapsed with leftover padding.

### The fix

Drain the queue from `end()`, **before** `__FlushElementTree()`, via `processPendingRemovals()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`), so a genuine removal lands in the same flush as the cycle's other mutations. A move still cancels its queued removal during the render traversal, before `end()` runs, so moves are unaffected. Covered by `packages/runtime/src/lib/renderer/teardown.spec.ts`.

---

## Native mutations made outside a change-detection cycle need their own flush

Content created outside a `begin()`/`end()` bracket paints only after a later, unrelated change-detection cycle. Arm a settle flush so it paints immediately.

### What you'd expect (web)

Create elements at any time — from a router navigation, a dynamic `createComponent()`, a timer — and they show up on the next frame. There is no "commit" step you have to trigger.

### What Lynx does

`__FlushElementTree()` is what commits (lays out and paints) element mutations, and the renderer calls it once per CD cycle from `LynxRendererFactory2.end()`. Work done *outside* a CD cycle never hits that call. Angular's `RouterOutlet` builds a lazy route component **during navigation** — before any `begin()`/`end()` bracket — so its freshly created native elements land in the fiber tree but sit unflushed. The core's `OnPatchFinishForFiber` lays out only when a flush actually runs (`references/lynx/core/renderer/dom/element_manager.cc`), so the content stays invisible until something else triggers a cycle.

The `<list>` path already guarded this exact case (`LynxListElement.#scheduleUpdate`'s `queueMicrotask` safety net, whose comment names "lazy-loaded route components on first navigation"); nothing covered non-list content.

**Scope:** this is about content *created* out of cycle. A different bug made `@if`/`@for` content vanish specifically on route **re-entry** — that was a canonical-wrapper mismatch, not a missed flush; see the next entry.

### The fix

`scheduleSettleFlush()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) schedules ONE coalesced `queueMicrotask` flush whenever native work happens outside a CD cycle. Two call sites arm it:

- `LynxDocument`'s element creators — for content *created* out of cycle (first navigation to a lazy route, a dynamic `createComponent()`).
- `LynxElement.#recreateIfDead()` — recreate-on-remount builds fresh refs via `createNativeRefByTag` directly (bypassing `LynxDocument.createElement`), and a route re-attach runs out of cycle, so the rebuilt subtree needs its own flush.

`LynxRendererFactory2.begin()`/`end()` maintain the in-cycle flag (`setInsideChangeDetection`, `packages/runtime/src/lib/lynx-render-lifecycle.ts`), so in-cycle rendering stays a no-op — its `end()` already flushes. It uses `queueMicrotask`, never `setTimeout` (a macrotask flush crashes the native engine), stands down if a real CD cycle starts first, and is skipped while the first render is pending (native flushes after `renderPage`). Covered by `packages/runtime/src/lib/lynx-element/settle-flush.spec.ts`.

---

## `@if`/`@for` content vanishes after leaving and returning to a route

Nested `@if`/`@for` content renders on first visit, then comes back **blank** after you navigate away and return — while static template content survives. The cause: embedded-view content was adopted into a throwaway parent wrapper, so recreate-on-remount could not rebuild it.

### What you'd expect (web)

Navigate away from a route and back, and the whole view returns exactly as it was — `@if` blocks, `@for` rows, interpolated text, images, all of it.

### What Lynx does

`LynxRouteReuseStrategy` **detaches** a route on navigate-away and re-**inserts** the same view on return (to spare the finite native element pool — see the route-reuse entry below). Angular re-attaches a detached view by re-inserting only its **top-level** native node; nested `@if`/`@for` containers ride that node's subtree (`applyNodes` in `@angular/core` walks children only for `ng-container`/projection, not plain elements). On Lynx that subtree's painting nodes were destroyed on detach, so the renderer must rebuild the whole subtree from cache via `#recreateSubtree()`.

That rebuild walks each wrapper's **canonical** `#children` — the wrapper list Angular stores in its LView. The break: `parentNode()`/`nextSibling()/querySelector()` used to mint a **throwaway** `LynxElement` for a native ref (there is no native-ref → wrapper lookup). Angular finds an embedded view's insertion parent via `renderer.parentNode(anchorComment)`, so `@if`/`@for` content was inserted through that throwaway and adopted into *its* `#children`, not the canonical parent's. It rendered fine on first paint (the throwaway drives the same native ref), but was invisible to `#recreateSubtree` — so on route re-entry the containers rebuilt and the embedded content did not.

Static template content survives because its wrappers are adopted canonically at creation; only embedded-view content routed through `parentNode()` hit the throwaway.

### The fix

A native-id → canonical-wrapper registry, `LynxElement.#byNativeId` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`), keyed by `__GetElementUniqueID` (a number — hashing a native ref crashes the Lepus engine). The constructor registers each wrapper; `parentNode()`/`nextSibling()`/`querySelector()` return the registered canonical wrapper instead of a throwaway, so every adoption lands in the canonical tree. `#recreateSubtree` moves the entry from the stale ref's id to the fresh one on remount, and `LynxRenderer.destroyNode` (now non-null) drops the entry when Angular tears the element down. Covered by the route-reuse test in `packages/runtime/src/lib/renderer/teardown.spec.ts`, which drives `ViewContainerRef.detach()` + `insert()` with an intervening settle-flush — the detach/reattach path every prior remount test missed (they all toggled a signal, which creates a *fresh* embedded view).

---

## `<block>` has no native paintable UI — it must be created as a layout-only element, and its children can't be picked apart on teardown

### What you'd expect (web)

A grouping element used purely to satisfy a template's structural requirements (e.g. Angular's `@if` needing a single root node) can be any element — the browser doesn't care whether it paints anything.

### What Lynx does

Lynx's native fiber engine has a dedicated `BlockElement` C++ class for exactly this "invisible grouping container" role, created via the specialized `__CreateBlock()` PAPI. Creating it instead via the generic `__CreateElement('block', pageId)` — which is the normal, cross-platform-safe way to create every _other_ element, including `<if>`/`<for>` — produces a plain generic `FiberElement` whose tag merely happens to be the string `"block"`. That element is not layout-only, so it reaches the native painting pipeline and tries to create a real UI for tag `"block"` — which no platform registers a UI class for, crashing with `"block ui not found when create UI"`.

React Lynx (the production reference) sidesteps this entirely: it never creates a `"block"`/`"if"`/`"for"`-tagged element at all. Its equivalent invisible container is `__CreateWrapperElement`, backed by the native `WrapperElement` class, which unconditionally sets `is_layout_only_ = true` — the native painting pipeline (`ElementContainer::CreatePaintingNode`) skips creating a UI for any layout-only element, so it never needs a registered native UI class. `__CreateWrapperElement` is implemented on both native platforms and the web platform (unlike `__CreateBlock`/`__CreateIf`/`__CreateFor`, which only exist natively — the web platform only implements the generic `__CreateElement`).

A second property matters for teardown once `<block>` uses `__CreateWrapperElement`: layout-only elements are **flattened** into the nearest real ancestor at the native painting layer — their children have no native UI subtree that belongs to the wrapper itself. Removing such a wrapper's children individually would corrupt that flatten bookkeeping and **crash to the home screen**. The renderer's old child-"parking" mechanism did exactly that — one `__AppendElement` per child before removing the now-empty container — so `<block>` once needed a special exception. Parking has since been removed and every subtree is removed as a unit, so this is handled for free.

### The fix

- `createBlockElement()` (`packages/runtime/src/lib/lynx-document/element-creators/create-block-element.ts`) calls `__CreateWrapperElement(pageId)` instead of `__CreateElement('block', pageId)`.
- `#doRemove()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) removes every subtree as a single unit, so a `<block>`'s flattened children are never picked apart mid-teardown. (This once needed a `<block>`-specific exception, back when the renderer "parked" children individually; parking has since been removed.)
- Covered by `packages/runtime/src/lib/renderer/teardown.spec.ts`.

`<if>` and `<for>` are still created via the generic `__CreateElement` path and share the same theoretical "unregistered native UI" risk as `<block>` did — but neither is exercised anywhere in the codebase today, so this is a known latent gap, not a confirmed bug.

---

## Enter/leave animations need a single `@keyframes` class, not a two-phase CSS `transition`

### What you'd expect (web)

Vue-style transitions mount an element in a `-enter-from` state, then swap to `-enter-to` one frame later (via `requestAnimationFrame`) so a CSS `transition` interpolates. The one-frame gap lets the browser paint the initial state first.

### What Lynx does

The two-phase approach is unreliable on Lynx's background thread, where Angular runs, for two reasons:

- **No frame boundary.** `requestAnimationFrame` is microtask-mapped or absent (React Lynx maps it to a microtask; AngularLynx only polyfills it when `lynx.requestAnimationFrame` exists). Microtasks drain within the same native call frame, so they never separate two paints.
- **No flush.** Class changes made from an rAF/`setTimeout` callback skip change detection, so they never reliably flush to the main thread. The element tree is committed once per CD cycle in `LynxRendererFactory2.end()`, and calling `__FlushElementTree` from `setTimeout` crashes the engine.

Native `element.animate()` can't drive them either: it's main-thread-only and a no-op on the background thread (`packages/runtime/src/lib/animation/noop-animation.ts`).

### The fix

`LynxTransition` and `LynxTransitionGroup` toggle a single `@keyframes` class — `{name}-enter` on insertion, `{name}-leave` before removal — applied inside the effect (a CD pass) so it flushes in the same commit that mounts the element. The native engine then plays the keyframes from 0%. No rAF, no paint gap.

```css
@keyframes fade-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.fade-enter {
  animation: fade-enter 300ms ease both;
}
```

This mirrors the proven single-class pattern in `examples/animations`. Completion is timer-based (the `duration` input) because the background thread has no `animationend` bridge, so `duration` must match the CSS animation length.

---

## A `position: absolute` element's auto **height** collapses against a zero-height containing block

### What you'd expect (web)

An absolutely positioned element with `bottom` set (and no `top`/`height`) sizes its height to its content — shrink-to-fit — regardless of the containing block's height. So an absolute card inside a zero-height wrapper still grows to fit its text.

### What Lynx does

Lynx resolves an absolute element's `height: auto` against its **containing block's** height. If the nearest positioned ancestor has collapsed to 0 (e.g. a `position: relative` wrapper whose only children are themselves absolute, so nothing gives it height), the absolute child gets ~0 usable height. Its flex content is then squeezed below its intrinsic minimum (Lynx treats `min-content` as `0px` — see the flex-shrink note), so **text lines overlap as if they had no line-height**.

This is distinct from the "docks to top-left" overlay note above: there the _position_ was wrong; here the _height_ silently collapses even though the position (bottom-docked) is correct.

### The fix

Position the absolute element against a **definite, full-height containing block** — the same `h-full w-full` view the bottom-sheet uses — not a collapsed wrapper. This is exactly why the stacked toast squished: the toasts were absolute inside a 0-height `position: relative` wrapper. Moving them to be direct absolute children of the overlay's `h-full w-full` view (with `left/right` insets + `bottom: calc(env(safe-area-inset-bottom) + 1rem)`) let each card's auto height resolve from its content again.

---

## `display: none` resizes to 0×0, does not remove from layout

### What you'd expect (web)

`display: none` removes the element from the layout entirely — no space, no interaction, invisible to siblings.

### What Lynx does

> "Element and its descents will be resized to 0×0."

The element still exists in the layout tree at 0×0. It participates in the stacking context and can still intercept gestures (see pointer-events note above). This matters for Angular's invisible comment/anchor nodes created by `@for`/`@if` — they exist as 0×0 views inside the element tree.

---

## `scroll-view` requires an explicit height constraint to scroll

### What you'd expect (web)

A scrollable container with `overflow: scroll` and `height: 100%` or similar will scroll when content overflows.

### What Lynx does

`scroll-view` is forced into linear layout. Without an explicit height, it **expands to fit its content** — no overflow means no scrolling.

Every `scroll-view` must have an explicit `height` (e.g., `height: 100vh`, `height: 300px`) or inherit one via `h-full` from a parent that is itself bounded. Content that exceeds that bound becomes scrollable.

```css
/* Required — scroll-view won't scroll without this */
.my-scroll-view {
  height: 100vh;
  width: 100vw;
}
```

**`flex: 1` directly on the `scroll-view` does NOT bound it.** Because the
scroll-view expands to fit its content, it ignores the flex-computed height and
grows past its slot — e.g. a long list inside a header/scroll/footer column
spills over the footer instead of scrolling. The fix has two parts:

1. Put `flex: 1` on the **plain view that is the actual flex child** — a plain
   view honours flex sizing where the scroll-view won't. Make that view a
   **column** container (`flex flex-col`), NOT the default `flex` (which is a
   **row** — its child then shrinks to content width, so the scroll-view no
   longer fills the width). A `flex-col` parent also stretches the child to full
   width by default (Lynx `align-items: stretch`).
2. Give the scroll-view `h-full w-full` so it fills that now-definite height.

```html
<!-- Header/scroll/footer column: the middle section scrolls -->
<view class="flex-col flex" style="height: 100vh">
  <view><!-- header --></view>
  <view class="flex-1 flex-col flex">        <!-- column, claims remaining height -->
    <scroll-view scroll-orientation="vertical" class="h-full w-full">
      <!-- long content scrolls here -->
    </scroll-view>
  </view>
  <view><!-- footer --></view>
</view>
```

**When the scrollable section is its own component, the `flex: 1` must go on the
component's HOST element, not an inner view** — the host is the real flex child
of the parent column. An inner-only `flex: 1` leaves the host sizing to content,
so the section still overflows. Set it via `host` metadata (same lesson as
`ui-tabs-content` and `ui-separator`):

```ts
@Component({
  selector: 'ui-nav-drawer-content',
  host: { class: 'flex-1 flex-col flex' },   // host = the flex child
  template: `<scroll-view scroll-orientation="vertical" class="h-full w-full"><ng-content /></scroll-view>`,
})
```

This is the pattern the app shell, `demo-screen`, and `ui-nav-drawer-content`
all use.

**A routed component's host is itself a flex child that must claim the height.**
Angular's `<router-outlet>` inserts each routed component as a *real Lynx
element* (`<app-home>`, `<app-motion-demo>`, …) — a sibling of `<router-outlet>`
inside the outlet's container. That host arrives unstyled (no flex-grow, no
height), so it collapses to its content and every `scroll-view` inside the route
resolves `h-full` against a content-sized ancestor and expands instead of
scrolling. The container must be a bounded `flex flex-col`, and **each routed
screen must carry `flex-1 flex-col flex` on its own host** — an inner wrapper is
not enough, exactly as with a scrollable child component above. In
`kitchen-sink-app` this is centralised in a shared `ScreenHost` directive applied
via `hostDirectives` to every routed screen and to the `demo-screen` frame; the
app shell's outlet container is `<view class="flex-1 flex-col flex">`. Symptom
without it: no route scrolls, even though each route's own markup looks correct.

---

## Scroll direction uses kebab-case attributes, not camelCase

### What you'd expect (web / React camelCase props)

`scrollX`, `scrollY` — camelCase property names as you'd use in React DOM or Angular property bindings.

### What Lynx does

Lynx native elements use **kebab-case attributes** passed directly to `__SetAttribute`. No camelCase-to-kebab conversion happens. Use:

- `scroll-orientation="horizontal"` / `scroll-orientation="vertical"` (v3.0+)
- Or the older `scroll-x` / `scroll-y` boolean attributes (pre-3.0 compatible)

`scrollX`/`scrollY` are silently ignored by the native runtime.

---

## `display` values: no `block`/`inline`, default is `linear`

### What you'd expect (web)

Default display is `block` for block elements, `inline` for inline. `display: flex` and `display: grid` work as expected.

### What Lynx does

Lynx does not have flow layout. **Default display is `linear`** (Lynx's own layout model, inspired by Android LinearLayout). Supported values: `linear`, `flex`, `grid`, `relative`, `none`. `block` and `inline` are not supported.

`scroll-view` is always forced to `linear`, regardless of what CSS you set.

---

## `box-sizing` default is `border-box`, not `content-box`

### What you'd expect (web)

`box-sizing: content-box` is the default — `width`/`height` only covers the content area; padding and border are added on top.

### What Lynx does

The default `box-sizing` is **`border-box`**. `width` and `height` already include padding and border. This matches the mental model of most mobile layout systems (Android, iOS) but silently breaks any CSS that assumes `content-box` semantics.

---

## No margin collapsing

### What you'd expect (web)

Adjacent vertical margins between block elements collapse into the larger of the two (e.g., a 16px margin-bottom above a 8px margin-top produces 16px of space, not 24px).

### What Lynx does

Margins **never collapse**. Both margins are applied in full. Two siblings with `margin-bottom: 16px` and `margin-top: 8px` produce 24px of space between them.

---

## Text cannot be placed directly in `<x-view>` — must use `<x-text>`

### What you'd expect (web)

Text nodes can live directly inside any block element (`<div>`, `<section>`, etc.).

### What Lynx does

Text must be wrapped in a `<text>` element (`<x-text>` in AngularLynx). Raw text nodes inside a `<view>` are unsupported and will not render. This applies to all text content — even a single word.

```html
<!-- WRONG — raw text in x-view doesn't render -->
<x-view>Hello world</x-view>

<!-- CORRECT -->
<x-view><x-text>Hello world</x-text></x-view>
```

---

## `overflow: scroll` does not work on `<x-view>` — only `<x-scroll-view>` and `<x-list>` scroll

### What you'd expect (web)

Any element can be made scrollable by setting `overflow: scroll` or `overflow: auto`.

### What Lynx does

Regular `<view>` elements cannot scroll, regardless of CSS `overflow` value. Only the dedicated `<scroll-view>` and `<list>` elements scroll. Use:

- `<x-scroll-view>` for small data sets and simple scrolling
- `<x-list>` for large data sets requiring lazy loading / recycling

---

## CSS inheritance is NOT enabled by default

### What you'd expect (web)

Properties like `color`, `font-size`, `font-family`, `line-height` inherit from parent to child automatically.

### What Lynx does

CSS inheritance is **disabled by default**. Every element must declare its own styles — parent styles do not flow down. This matches the native mobile model (each view is styled independently).

**Exception:** Nested `<text>` inside `<text>` **does** inherit `color` and `font-family` from the parent `<text>`, even without explicit declaration.

```css
/* On web, children inherit font-size from .container.
   On Lynx, you must set font-size on every x-text individually. */
.container {
  font-size: 16px;
}
```

---

## `flex-shrink` can shrink elements below their minimum content size

### What you'd expect (web)

Flex items won't shrink below their intrinsic minimum content size, even with `flex-shrink: 1`. An element containing text won't collapse to smaller than the text requires.

### What Lynx does

Lynx treats `min-content` as `0px`. Flex items **can** shrink below their content minimum, potentially clipping or overflowing text. If you need to prevent over-shrinking, set `min-width` or `min-height` explicitly.

---

## `position: sticky` only works inside `<x-scroll-view>`

### What you'd expect (web)

`position: sticky` sticks an element relative to its nearest scrolling ancestor.

### What Lynx does

`position: sticky` only has effect when the parent is a `<scroll-view>`. It does nothing in other contexts (e.g., inside a flex container or a regular view). There is no general "nearest scrolling ancestor" concept in Lynx.

---

## SVG is not supported

### What you'd expect (web)

SVG is a first-class format — rendered via `<svg>` elements or loaded as `<img src="icon.svg">`.

### What Lynx does

Lynx has **no `<svg>` element** and the `<image>` element does not support SVG files. Supported image formats are: `png`, `jpg`, `jpeg`, `bmp`, `gif`, `webp`. Use PNG/WebP for icons and illustrations, or implement a custom component if vector graphics are required.

---

## `AbortController` and `queueMicrotask` are missing in PrimJS

### What you'd expect (web)

`AbortController`, `AbortSignal`, and `queueMicrotask` are standard globals available in all modern browsers and Node.js.

### What Lynx does

Lynx's PrimJS JavaScript runtime **does not provide** `AbortController`, `AbortSignal`, or `queueMicrotask`. They throw `ReferenceError` at runtime. This is particularly critical for Angular:

- Angular Router v21+ uses `new AbortController()` internally; its error handler silently swallows the resulting `ReferenceError`, killing the entire navigation pipeline.
- Angular's zoneless change detection scheduler uses `queueMicrotask` to schedule change detection ticks.

### The fix

Polyfill both before Angular bootstraps (see `packages/runtime/src/lib/runtime.ts`):

- `AbortController`/`AbortSignal`: implement the minimal subset (`signal.aborted`, `signal.reason`, `addEventListener/removeEventListener`, `controller.abort()`).
- `queueMicrotask`: implement as `Promise.resolve().then(fn)`.

---

## Timer/scheduling APIs live on `lynx` global, not `globalThis`

### What you'd expect (web)

`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `requestAnimationFrame`, and `cancelAnimationFrame` are available on `globalThis` / `window`.

### What Lynx does

These APIs are **methods of the `lynx` global object**, not on `globalThis`. `globalThis.setTimeout` is undefined. Since Angular's change detection scheduler and many internal timers call `setTimeout(fn, delay)` as a global, they silently never fire without a polyfill.

### The fix

At app startup (before Angular bootstraps), copy them onto `globalThis`:

```ts
globalThis.setTimeout = lynx.setTimeout.bind(lynx);
globalThis.clearTimeout = lynx.clearTimeout.bind(lynx);
// ... same for setInterval, requestAnimationFrame, etc.
```

See `packages/runtime/src/lib/runtime.ts` lines 129-145.

---

## No browser navigation/location APIs (`window.location`, `history`, `URL`)

### What you'd expect (web)

`window.location`, `window.history`, the `URL` constructor, and `window.addEventListener` / `window.removeEventListener` are all standard globals.

### What Lynx does

None of these exist in Lynx. `window` itself is not a global (though we shim it to `globalThis`). Attempting to use `new URL(string)` or `location.pathname` throws at runtime. `addEventListener` / `removeEventListener` as globals are also absent.

### The fix

- Shim `window = globalThis`, `document = { defaultView: globalThis, querySelector: () => null }`, and no-op `addEventListener` / `removeEventListener` at startup (see `runtime.ts`).
- Implement a custom `LynxPlatformLocation` that stores the current path in a signal and provides manual URL string parsing, bypassing the `URL` constructor entirely (see `packages/runtime/src/lib/lynx-platform-location.ts`).

---

## Native element pool is finite (~256 slots); `__RemoveElement` does not free slots

### What you'd expect (web)

DOM elements are garbage-collected when removed from the tree and no longer referenced. There is no practical upper limit on elements.

### What Lynx does

Lynx maintains a **fixed-size native element pool** (~256 slots on device). `__RemoveElement` detaches an element from the tree but **does not free its pool slot**. There is no public `__ReleaseElement` API (it exists in React Lynx source but is commented out). Once the pool is exhausted, the app crashes with a hard native crash — deterministically on around the 9th navigation when using Angular's default destroy-on-navigate behavior.

### The fix

Use `LynxRouteReuseStrategy` (see `packages/runtime/src/lib/lynx-route-reuse-strategy.ts`) to detach and reattach route component trees instead of destroying and recreating them. The same native elements are reused across navigations, preventing pool exhaustion.

---

## DOM mutations during worklet event handler callbacks cause crashes

### What you'd expect (web)

DOM mutations (`createElement`, `appendChild`, `removeChild`) are safe to perform inside any event handler synchronously.

### What Lynx does

Performing synchronous DOM mutations (`__CreateElement`, `__RemoveElement`, `__AppendElement`, etc.) **inside a worklet callback** (e.g., an `bindtap` event handler) causes a native crash or produces a blank screen. The Lynx worklet executes in a synchronous native call frame; mutating the element tree during that frame corrupts internal state.

React Lynx avoids this by never mutating the tree directly in event handlers — it only updates state and defers mutations to the next render cycle.

### The fix

Defer all DOM-mutating operations (including Angular Router navigation, which triggers component destroy/create) via `setTimeout`:

```ts
bindtap() {
  // WRONG — navigating synchronously inside a worklet event crashes
  this.router.navigateByUrl('/other');

  // CORRECT — defer to next macrotask, after the worklet returns
  setTimeout(() => this.router.navigateByUrl('/other'), 0);
}
```

---

## ECMAScript support is limited: ES2019 on main thread, ES2015 on background thread

### What you'd expect (web)

Modern browsers support ES2023+ (optional chaining `?.`, nullish coalescing `??`, `Array.at()`, `structuredClone()`, etc.).

### What Lynx does

- **Main thread (PrimJS):** ES2019 (ES10) — supports `Array.flat()`, `Object.fromEntries()`, optional catch binding; no optional chaining or nullish coalescing.
- **Background thread:** ES2015 (ES6) — `let`/`const`, arrow functions, classes, template literals, `Promise`, destructuring; nothing newer.

Transpilation via the Rsbuild/RSpeedy build pipeline handles most of this automatically, but be aware that polyfills for newer built-ins (e.g., `Array.prototype.at`, `structuredClone`) may still be needed and are not guaranteed by the runtime.

---

## `String.prototype.replaceAll()` is missing on the main thread (ES2021 method, PrimJS is ES2019)

### What you'd expect (web)

`'a-b-a'.replaceAll('a', 'x')` replaces every occurrence — available in all modern browsers and Node 15+.

### What Lynx does

`replaceAll` is an **ES2021** method. The main thread runs on PrimJS at an ES2019 target, and because `replaceAll` is a _runtime method_ (not syntax), TypeScript down-leveling does **not** polyfill it. Calling it on the main thread throws:

```
main-thread.js exception: not a function
```

This is especially nasty because the throw happens **inside Angular change detection** (e.g., from a template-bound method or `computed()`). The exception aborts the change-detection tick before Lynx flushes the element tree, so **nothing paints** — not just the component that called `replaceAll`. The failure then repeats on every subsequent tick (each render, each interaction), so the error count climbs. The symptom ("element is there but invisible", crash frame deep inside `detectChangesInView`) looks nothing like a missing string method, which makes it easy to misattribute to the signals/reactivity machinery.

### The fix

Use an ES2019-safe equivalent:

```ts
// WRONG — ES2021, throws "not a function" on the Lynx main thread
svg = svg.replaceAll('currentColor', color);

// CORRECT — split/join is ES2019-safe (no regex escaping needed for a literal)
svg = svg.split('currentColor').join(color);

// Also fine — regex with the global flag
svg = svg.replace(/currentColor/g, color);
```

This bit the `ui-icon` component (`packages/ui/src/lib/components/icon/icon.ts` and its generated example copies), which substitutes `currentColor` in SVG markup strings. The same caution applies to any other ES2021+ runtime method on the main thread.

---

## Event attribute naming uses `bind`/`catch` prefixes, not `on*`

### What you'd expect (web)

Events are registered with `on*` attributes or `addEventListener`: `onclick`, `ontouchstart`, `onscroll`, etc.

### What Lynx does

Lynx has its own event binding syntax. Event attributes use explicit phase/propagation prefixes:

| Prefix             | Web equivalent                        | Behavior                                          |
| ------------------ | ------------------------------------- | ------------------------------------------------- |
| `bindtap`          | `onclick`                             | Bubble phase, propagates                          |
| `catchtap`         | `onclick` + `stopPropagation()`       | Bubble phase, stops propagation                   |
| `capture-bindtap`  | `addEventListener('click', fn, true)` | Capture phase, propagates                         |
| `capture-catchtap` | Capture + stop                        | Capture phase, stops propagation                  |
| `global-bindtap`   | —                                     | Cross-element global listener (no web equivalent) |

Additionally, events can be prefixed with `main-thread:` to execute the handler on the rendering thread (e.g., `main-thread:bindtap`). This has no web equivalent — on web, all event handlers run in the same thread.

In templates, these are set as kebab-case attributes (e.g., `bind:tap`, `catch:tap`).

---

## `tap` and `longpress` are mutually exclusive; `longpress` takes priority

### What you'd expect (web)

`click` and a custom long-press handler can coexist independently.

### What Lynx does

If both `bindtap` and `bindlongpress` listeners are present on the same element, they are **mutually exclusive**. `longpress` takes priority — if a long press is detected, `tap` will NOT fire. Plan UI interactions accordingly; don't rely on both firing for different gesture durations on the same element.

---

## `touchstart`/`touchend` never fire from a mouse on web — press feedback must also bind mouse events

### What you'd expect (web)

A press-down/press-up interaction wired to `touchstart`/`touchend` works everywhere, because either the browser synthesizes touch events for a mouse, or a single pointer abstraction covers both.

### What Lynx does

On web, `@lynx-js/web-core` runs the app's UI on the browser's main thread and delivers events straight from the DOM. A mouse **click** fires the browser `click` event, which Lynx maps to `tap` (`W3cEventNameToLynx` in `web-core/ts/constants.ts`), so `(bindtap)` works from a mouse. But `touchstart`/`touchend`/`touchcancel` are the raw DOM touch events — on a desktop browser with a mouse they **never fire** (only real touch input generates them). So any interaction driven purely by touch is dead when clicked with a mouse, while the `tap` action on the same element still fires — a confusing "the button works but gives no feedback" split.

This bit every pressable `@blotch/ui` component: their scale-down/scale-up press animation (`pressDown`/`pressRelease`, driven off `(bindtouchstart)`/`(bindtouchend)`/`(bindtouchcancel)`) played on iOS/Android but not on the web preview. Note the `element.animate()` itself is fine on web — web-core's client main-thread `__ElementAnimate` is a real Web-Animations implementation; the missing piece was purely the event that triggers it.

### The fix

Bind the **mouse** press events alongside the touch ones on the same element, pointing at the same handlers:

```html
<view
  (bindtouchstart)="onPressStart()"  (bindmousedown)="onPressStart()"
  (bindtouchend)="onPressEnd()"      (bindmouseup)="onPressEnd()"
  (bindtouchcancel)="onPressCancel()" (bindmouseleave)="onPressCancel()"
>
```

`mouseleave` is the `touchcancel` analogue — it restores the scale if the cursor leaves while pressed. Mouse events never fire on touch-only devices, so this is inert on native and touch continues to drive the animation there; the two platforms end up with identical feedback. Lynx has a documented Mouse Event API (`mousedown`/`mouseup`/`mouseenter`/`mouseleave`; see the Lynx docs — note its `button` numbering is non-standard, below), and the renderer's `EVENT_PREFIXES` accepts `bind` + any event name, so no renderer change is needed. Applied to `button`, `toggle`, `card`, `action-sheet`, `nav-drawer`, and `button-group`; the shared rationale lives in the `pressDown`/`pressRelease` JSDoc in `packages/ui/src/lib/utils/animate.ts`.

---

## No `:hover`, `:focus` pseudo-classes; no `::before`/`::after` pseudo-elements

### What you'd expect (web)

`:hover` styles change on mouse-over. `:focus` styles apply when an element has keyboard/programmatic focus. `::before`/`::after` inject decorative content via CSS.

### What Lynx does

- **`:hover`** — not supported. Lynx runs on touch devices; there is no cursor/hover concept.
- **`:focus`** — not supported as a CSS pseudo-class. Input focus is a programmatic state, not a CSS selector.
- **`::before` / `::after`** — not supported. There is no CSS generated content in Lynx. Use explicit `<x-view>` elements instead.
- **`:active`** — IS supported, but it tracks touch state (finger on screen), not mouse click.
- **`::selection`** — IS supported on `<x-text>` for styling text selection handles. Supports `background-color`, `-x-handle-size`, `-x-handle-color`.

---

## No `@media` queries

### What you'd expect (web)

`@media (max-width: 768px) { ... }` applies styles conditionally based on viewport size, device type, color scheme, etc.

### What Lynx does

`@media` queries are **not supported**. Responsive layout must be done in JavaScript/TypeScript using Lynx's screen metrics APIs, or by conditionally applying classes based on runtime logic.

---

## `rpx` is a Lynx-specific responsive unit

### What you'd expect (web)

Common units: `px`, `em`, `rem`, `%`, `vw`, `vh`. No `rpx`.

### What Lynx does

Lynx adds `rpx` (responsive pixels) — a unit that scales proportionally to the device screen width. `750rpx` always equals the full screen width regardless of physical pixel density. This is commonly used in mini-program/native UI frameworks (similar to `rpx` in WeChat Mini Program). Use `rpx` for layouts that should scale across device sizes without JavaScript.

---

## `rem` resolves against a **14px** root font-size, not 16px — so Tailwind's `w-11` etc. are smaller than on web

### What you'd expect (web)

`1rem` equals the root (`<html>`) font-size, which defaults to `16px` in every browser. Tailwind's default spacing scale is expressed in `rem` (`w-11` → `2.75rem`), so `w-11` renders as `2.75 × 16 = 44px`, `w-5` as `20px`, etc. Designs (e.g. shadcn/ui) are laid out around these 16px-based pixel values.

### What Lynx does

`rem` resolves against the root `<page>` font-size, and Lynx's default font-size is **`14px`** (`DEFAULT_FONT_SIZE_DP`, see `core/renderer/tasm/config.h`), not 16px. Nothing sets a root font-size in the `@blotch/ui` theme, so every rem-based Tailwind utility is scaled by 14/16:

| Tailwind class | rem value | Web (16px) | **Lynx (14px)** |
| -------------- | --------- | ---------- | --------------- |
| `w-5` / `h-5`  | `1.25rem` | 20px       | **17.5px**      |
| `h-6`          | `1.5rem`  | 24px       | **21px**        |
| `w-11`         | `2.75rem` | 44px       | **38.5px**      |

This is silent — the web preview looks right, the device is ~12.5% smaller.

### The fix

For most elements the uniform 12.5% shrink is harmless (everything scales together). It bites when you **mix rem-based sizing with a `px`-based value** — the two no longer agree. This broke the `ui-switch` thumb: the track was sized `w-11` (38.5px on device) but the thumb was positioned with a hardcoded `translateX(22px)` computed for a 44px track, so the ON thumb overshot the right edge.

When an element's geometry must be pixel-exact and self-consistent with px transforms/positions, size it in **explicit px** via Tailwind arbitrary values (`w-[44px]`, `h-[20px]`) rather than the rem scale (`w-11`, `h-5`). Arbitrary px values compile straight to `width: 44px` and are immune to the root font-size. (Alternatively, set a `16px` font-size on `page` to make rem match web — but that would resize all existing rem-based layouts.)

---

## `white-space` only supports `normal` and `nowrap`

### What you'd expect (web)

`white-space` supports: `normal`, `nowrap`, `pre`, `pre-wrap`, `pre-line`, `break-spaces`.

### What Lynx does

Only `normal` and `nowrap` are supported. `pre`, `pre-wrap`, `pre-line`, and `break-spaces` are **not supported** — whitespace in text will always be collapsed. To display preformatted text, you must handle whitespace in JavaScript before rendering.

---

## `line-height` only works on `<x-text>` elements

### What you'd expect (web)

`line-height` can be set on any block element and inherits to all text descendants.

### What Lynx does

`line-height` is only effective when set on a `<text>` (`<x-text>`) element directly. Setting it on a container `<view>` has no effect. Since CSS inheritance is also disabled by default, every `<x-text>` that needs non-default line height must declare it explicitly.

---

## `text-align: justify` is not supported

### What you'd expect (web)

`text-align: justify` spreads words across the full line width.

### What Lynx does

`justify` and `justify-all` are **not supported**. Only `left`, `right`, `center`, and `start`/`end` are available. `match-parent` is also not supported.

---

## `text-shadow` only supports one shadow layer and requires all parameters

### What you'd expect (web)

`text-shadow` accepts a comma-separated list of shadows, and `blur-radius` and `color` are optional.

### What Lynx does

- Only **one shadow layer** is supported; additional comma-separated shadows are ignored.
- **All four parameters are required**: `offset-x offset-y blur-radius color`. Omitting any parameter is invalid.

```css
/* Web: valid (blur and color optional, multiple shadows OK) */
text-shadow:
  1px 1px red,
  2px 2px blue;

/* Lynx: only this form works */
text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
```

---

## `font-weight` does not support `lighter` or `bolder`

### What you'd expect (web)

`font-weight: bolder` / `font-weight: lighter` compute relative to the parent's weight.

### What Lynx does

Only `normal`, `bold`, and numeric values `100`–`1000` (integers only) are supported. `bolder` and `lighter` are **not supported** — they will have no effect or be ignored.

---

## `letter-spacing` does not accept the `normal` keyword

### What you'd expect (web)

`letter-spacing: normal` resets to the font's default tracking.

### What Lynx does

Only `<length>` values are accepted (e.g., `0px`, `2px`, `0.1em`). The keyword `normal` is **not supported** — use `0px` to achieve default letter spacing.

---

## `filter` only supports 5 functions and cannot be chained

### What you'd expect (web)

`filter` accepts a space-separated list of functions: `blur()`, `brightness()`, `contrast()`, `grayscale()`, `saturate()`, `sepia()`, `hue-rotate()`, `invert()`, `drop-shadow()`, `opacity()`.

### What Lynx does

- Only **one filter function** per `filter` property — chaining multiple functions is **not supported**.
- Only these 5 functions are available: `blur`, `grayscale`, `brightness`, `contrast`, `saturate`.
- `opacity` via `filter` causes **offscreen rendering on Android**, which has a performance cost.

---

## `box-shadow` does not support `inset`

### What you'd expect (web)

`box-shadow: inset 0 2px 4px rgba(0,0,0,0.5)` draws a shadow inside the element's border.

### What Lynx does

The `inset` keyword is **not supported** (marked as temporarily unsupported in Lynx docs). Only outer drop shadows work.

---

## `clip-path` is restricted: only on `<view>`, no `polygon()`, custom `super-ellipse` syntax

### What you'd expect (web)

`clip-path` works on any element and supports `polygon()`, `circle()`, `ellipse()`, `inset()`, `path()`.

### What Lynx does

- Only works on `<view>` elements — not on `<text>`, `<image>`, etc.
- `polygon()` is **not supported**.
- `inset()` supports a custom Lynx `super-ellipse` exponent parameter not present in the web spec.
- `path()` does not support the `<clip-rule>` parameter.

---

## CSS `@keyframes` can only animate a limited set of properties

### What you'd expect (web)

Any animatable CSS property can be used in `@keyframes`.

### What Lynx does

Only the following properties can be animated in `@keyframes`:
`left`, `right`, `top`, `bottom`, `width`, `height`, `opacity`, `background-color`, `color`, `transform`, `transform-origin`, `max-width`, `min-width`, `max-height`, `min-height`, `padding-*`, `margin-*`, `border-*-width`, `border-*-color`, `flex-basis`, `flex-grow`, `filter`.

Attempting to animate other properties (e.g., `border-radius`, `font-size`) in keyframes has no effect.

---

## `animation-iteration-count: 0` plays a zero-duration animation rather than being ignored

### What you'd expect (web)

Setting `animation-iteration-count: 0` means the animation never plays — it is effectively a no-op.

### What Lynx does

Lynx treats it as a zero-duration animation that still fires the full lifecycle (`animationstart`, `animationend`). If you're listening to animation lifecycle events, be careful — you will receive events even for a "zero" iteration count.

---

## `border-style: dotted` and `dashed` render as solid

### What you'd expect (web)

`border-style: dotted` renders a series of dots; `dashed` renders dashes.

### What Lynx does

Both `dotted` and `dashed` are **rendered as solid lines** in most Lynx environments. If your design requires dotted/dashed borders, simulate them with a background image (repeating gradient) or a custom drawn element.

---

## `border-style` default is `solid`, not `none`; setting `none`/`hidden` doesn't collapse the border width

### What you'd expect (web)

Default `border-style` is `none`. Setting `none` or `hidden` collapses the border to 0 width.

### What Lynx does

- Default `border-style` is **`solid`**.
- Setting `border-style: none` or `hidden` does NOT collapse the border width to 0 — the element still reserves space for the border. You must also explicitly set `border-width: 0`.

---

## `border-width` keywords map to different pixel values

### What you'd expect (web)

`thin` ≈ 1px, `medium` ≈ 3px, `thick` ≈ 5px (browser-defined, typically those values).

### What Lynx does

- `thin` = **2px**
- `medium` = **4px**
- `thick` = **6px**
- Default `border-width` is `0` (web default: `medium`)

---

## `max-height` and `max-width` do not support `none`, `max-content`, `min-content`, or `fit-content`

### What you'd expect (web)

`max-width: none` removes the maximum constraint. `max-content`, `min-content`, `fit-content` size to intrinsic content size.

### What Lynx does

None of these keywords are supported — only explicit `<length>` and `<percentage>` values work. To remove a max constraint, either don't set the property or set a very large value.

---

## `align-content: space-evenly` and baseline values are not supported

### What you'd expect (web)

`align-content` supports `normal`, `stretch`, `center`, `flex-start`, `flex-end`, `space-between`, `space-around`, `space-evenly`, `baseline`, `first baseline`, `last baseline`.

### What Lynx does

`space-evenly`, `normal`, `baseline`, `first baseline`, and `last baseline` are **not supported**. `justify-content` also does not support `normal`, `left`, or `right` — and its default is `stretch` (not `normal` as on web).

---

## `visibility: hidden` cannot be overridden by `visibility: visible` on a descendant

### What you'd expect (web)

A child can set `visibility: visible` to become visible even inside a `visibility: hidden` parent.

### What Lynx does

Once a parent sets `visibility: hidden`, **all descendants remain hidden** regardless of their own `visibility` value. There is no way to make a child visible inside a hidden parent. Structure your component tree to avoid this pattern.

---

## `background-repeat: space` and `round` are accepted but render as `repeat`

### What you'd expect (web)

`space` distributes tiles evenly without clipping. `round` scales tiles to fill the area without partial tiles.

### What Lynx does

Both `space` and `round` are accepted by the parser but are **not implemented** — they render identically to `repeat`. Use `repeat`, `no-repeat`, `repeat-x`, or `repeat-y` only.

---

## `background-image` color stops only accept `<percentage>`, not `<length>`

### What you'd expect (web)

Gradient color stops accept both lengths and percentages: `linear-gradient(red 20px, blue 100px)`.

### What Lynx does

Color stop positions only accept `<percentage>` values — `<length>` values (e.g., `20px`) are **not supported** in gradient definitions. Also, `linear-color-hint` (midpoint interpolation like `red, 20%, blue`) is not supported.

---

## No `<select>` element; no `<input type="checkbox">` or `<input type="radio">`

### What you'd expect (web)

HTML form controls include `<select>`, `<input type="checkbox">`, `<input type="radio">`, `<input type="file">`, etc.

### What Lynx does

Lynx has no `<select>` element and no checkbox or radio input types. The supported `<input>` types are: `text`, `number`, `digit`, `password`, `tel`, `email`. For selection UI, build custom components using `<x-view>` and state management.

---

## `<x-input>` has a Lynx-specific API that differs from HTML `<input>`

### What you'd expect (web)

HTML `<input>` is controlled via `.value`, `.focus()`, `.blur()`, and DOM events.

### What Lynx does

The Lynx `<input>` element has a distinct API:

- **`confirm-type`** — changes the soft keyboard's action button: `'send' | 'search' | 'go' | 'done' | 'next'`
- **`input-filter`** — a regex string that filters which characters can be typed (no web equivalent)
- **`show-soft-input-on-focus`** — controls whether the software keyboard appears (no web equivalent)
- **Programmatic control** requires `SelectorQuery` to get a node reference, then call `.getValue()`, `.setValue(value)`, `.setSelectionRange(start, end)` — there is no direct property access like `element.value`
- Events: `bindfocus`, `bindblur`, `bindconfirm` (keyboard action button), `bindinput` (with `isComposing` field), `bindselection` (cursor moved)

---

## `object-fit` and `object-position` are not supported — use the `mode` attribute

### What you'd expect (web)

`object-fit: cover` / `object-fit: contain` on an `<img>` controls how the image scales inside its box.

### What Lynx does

`object-fit` and `object-position` are **not CSS properties in Lynx**. Instead, use the `mode` attribute on `<x-image>`:

| `mode` value  | Equivalent `object-fit` | Behavior                                    |
| ------------- | ----------------------- | ------------------------------------------- |
| `scaleToFill` | `fill`                  | Stretches to fill box; ignores aspect ratio |
| `aspectFit`   | `contain`               | Scales to fit, letterboxes if needed        |
| `aspectFill`  | `cover`                 | Scales to fill shortest side, may crop      |
| `center`      | `none`                  | No scaling, centers image                   |

Note: The AngularLynx renderer defaults images to `aspectFit` (see `lynx-document.ts`), while the Lynx native default is `scaleToFill`.

---

## `float`, `clear`, `outline`, `writing-mode`, `touch-action`, `will-change`, `mix-blend-mode`, and `columns` are not supported

### What you'd expect (web)

These are standard CSS properties with wide browser support.

### What Lynx does

None of these properties are supported in Lynx:

- **`float` / `clear`** — Lynx has no flow layout, so float-based layout is irrelevant. Use flex or linear layout.
- **`outline`** — Not supported. Use `border` for visual outlines.
- **`writing-mode`** — Not supported. Grid layout always uses horizontal inline axis.
- **`touch-action`** — Not supported. Use Lynx's native gesture attributes (`pan-intercept-direction`, `consume-slide-event`) on `<x-view>` instead.
- **`will-change`** — Not supported. Lynx manages layer promotion natively.
- **`mix-blend-mode`** / **`isolation`** — Not supported.
- **`columns`** / multi-column layout — Not supported. Use `<x-list list-type="flow">` for multi-column grids.

---

## `perspective` applies to the element itself, not its children

### What you'd expect (web)

`perspective` on a parent element creates a 3D perspective context for its children's 3D transforms.

### What Lynx does

`perspective` in Lynx is applied to the **element it's set on**, not its children. To make `rotateX`/`rotateY` on an element look three-dimensional, set `perspective` on that same element:

```css
/* Web: set perspective on parent */
.parent {
  perspective: 500px;
}
.child {
  transform: rotateX(45deg);
} /* child gets 3D effect */

/* Lynx: set perspective on the element being transformed */
.child {
  perspective: 500px;
  transform: rotateX(45deg);
}
```

Also: `rotate3d()` and `scale3d()` are **not supported** in Lynx. Use `rotateX()`/`rotateY()`/`rotateZ()` and `scaleX()`/`scaleY()`/`scaleZ()` separately.

---

## `overflow: auto` and `overflow: scroll` are not supported on `<x-view>`

### What you'd expect (web)

`overflow: auto` / `overflow: scroll` makes any element scrollable when content overflows.

### What Lynx does

`overflow` only supports **`visible`** (default) and **`hidden`**. There is no `auto` or `scroll` value for `<view>`. This is consistent with the earlier documented difference that scrolling only works via `<scroll-view>` / `<list>`.

Performance tip: explicitly set `overflow: hidden` on non-scrolling animated elements — especially on Android, it reduces the redraw region size and significantly improves animation performance.

---

## `z-index: 0` should be set on `<x-scroll-view>` to prevent children from escaping during scroll

### What you'd expect (web)

`z-index` creates stacking contexts but has no interaction with scroll clipping.

### What Lynx does

Without `z-index: 0`, children of a `<scroll-view>` can visually "escape" the scroll container during scrolling animations. Setting `z-index: 0` on the scroll-view creates a stacking context that clips its children correctly. Additionally, **do not set `z-index` directly on `<x-list>` children** — it interferes with the list's recycling mechanism. Set z-index inside the list item content instead.

---

## `aspect-ratio: auto` is not supported

### What you'd expect (web)

`aspect-ratio: auto` uses the element's intrinsic aspect ratio (e.g., an image's natural size).

### What Lynx does

The `auto` keyword is **not supported**. Only explicit ratio values work (`aspect-ratio: 16/9`, `aspect-ratio: 1`, etc.). If you need an image to maintain its intrinsic ratio, use `<x-image mode="aspectFit">` with the `auto-size` attribute instead.

---

## `text-indent` with `%` requires the `<x-text>` element to have an explicit width

### What you'd expect (web)

`text-indent: 2em` or `text-indent: 10%` works on any block element with text.

### What Lynx does

`text-indent` is supported, but when using a percentage value, the `<x-text>` element **must have an explicit `width`** declared — otherwise the percentage has nothing to compute against and the indent is ignored. Length values (`px`, `em`, `rpx`) work without this requirement.

---

## `vertical-align` only works for inline elements nested inside `<x-text>`

### What you'd expect (web)

`vertical-align` controls alignment for inline and table-cell elements in their line box.

### What Lynx does

`vertical-align` is only effective for content **inline inside a `<text>` element** — specifically nested `<text>`, `<image>`, or `<view>` elements that appear inline inside a parent `<text>`. It has no effect on block-level elements.

Additionally, when a `<text>` is nested inside a `<view>`, the default baseline is the **bottom of the view** rather than the text baseline. Use `vertical-align: baseline` explicitly on the inner `<text>` if you need text-baseline alignment.

---

## `mask` is supported but does not accept SVG sources and lacks `mask-composite`/`mask-type`

### What you'd expect (web)

`mask-image` accepts SVG `<mask>` element references (`url(#my-mask)`), images, and gradients. `mask-composite` composes multiple mask layers.

### What Lynx does

- `mask` shorthand and its longhand properties (`mask-image`, `mask-repeat`, `mask-position`, `mask-clip`, `mask-origin`, `mask-size`) are supported.
- `mask-image` accepts: bitmap images via `url()`, and CSS shapes (`circle()`, `ellipse()`, `inset()`, `path()`).
- **SVG element references are NOT supported** in `mask-image`.
- **`mask-composite`** and **`mask-type`** are not supported.

---

## `-x-auto-font-size`: Lynx-specific automatic font sizing

### What you'd expect (web)

No equivalent. Web developers use JavaScript resize observers or viewport units for responsive font sizes.

### What Lynx does

Lynx provides a proprietary `-x-auto-font-size` CSS property that automatically adjusts a `<text>` element's font size to fit its container:

```css
/* Enable with defaults */
-x-auto-font-size: true;

/* Enable with min/max size */
-x-auto-font-size: true 10px 30px;

/* Enable with min, max, and step granularity */
-x-auto-font-size: true 10px 30px 2px;
```

Parameters: `(enabled) (min-size) (max-size) (granularity)`. This shrinks/grows the font within the bounds to prevent overflow or excessive whitespace.

---

## `linear-weight` and `linear-direction`: Lynx-specific linear layout properties

### What you'd expect (web)

No direct equivalent. The closest analogy is `flex-grow` inside a flex container.

### What Lynx does

When `display: linear` (the Lynx default), two custom properties control layout:

- **`linear-direction`**: Sets the main axis direction — `column` (default), `row`, `column-reverse`, `row-reverse`. Behaves like `flex-direction` but for linear layout. Note that `row` is affected by `direction: rtl`.
- **`linear-weight`**: Distributes remaining space proportionally among children, like `flex-grow`. Elements with weight `0` are sized first; remaining space is divided among weighted elements. Mixing fixed sizes with weights in the same container is not recommended for performance.

---

## Network APIs (`fetch`, `XMLHttpRequest`, `WebSocket`) are not available

### What you'd expect (web)

`fetch()`, `XMLHttpRequest`, and `WebSocket` are universally available browser globals.

### What Lynx does

**None of these are available** in the Lynx JS runtime. There is no `fetch`, no `XHR`, no `WebSocket`. Network requests must be made via native bridge modules exposed through `lynx.requireModule()`. This means standard Angular `HttpClient` (which ultimately uses `fetch` or `XHR`) **cannot work without a custom HTTP adapter**.

---

## `localStorage` and `sessionStorage` use a different API

### What you'd expect (web)

`localStorage.setItem('key', value)` / `localStorage.getItem('key')` — synchronous, string-based storage.

### What Lynx does

The standard `localStorage` / `sessionStorage` globals **do not exist**. Use the native Lynx storage API instead:

- `lynx.setSessionStorage(key, value)` — persistent key-value store
- `lynx.getSessionStorage(key)` — retrieve a value
- `lynx.subscribeSessionStorage(key, callback)` — reactively listen to changes

The naming is "session" but the storage is actually persistent (analogous to `localStorage`).

---

## Inline `<svg>` elements are partially supported; SVG as image source is not

### What you'd expect (web)

SVG works both as an `<img src="icon.svg">` source and as inline `<svg>` markup inside HTML.

### What Lynx does

- **SVG as image source** (e.g., `<x-image src="icon.svg">`) — **not supported** (as noted in the earlier entry).
- **Inline `<svg>` element** — **partially supported** via a dedicated `<svg>` element. Lynx supports 17 common SVG tags: `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`, `text`, `image`, `linearGradient`, `radialGradient`, `stop`, `defs`, `use`, `clipPath`. **`line` is listed but does not render reliably — see below.**

The `<svg>` element is parsed on the **background thread** and rendered as a single native view — the entire SVG is composited as a flat image, so you cannot animate individual SVG child elements or apply CSS to them as you would on web.

### `<line>` does not render — use `<path>` instead

`<line>` elements vanish on device. Build every icon from `<path>` (and `<circle>`), never `<line>`.

Lynx's native SVG engine (ServalSVG) only paints a `<line>` when its stroke is set _directly on the line_. `SrSVGLine::onDraw` guards on the line's own stroke, whereas `<path>`, `<circle>`, and `<rect>` paint unconditionally and resolve stroke/fill later. Icons set `stroke="currentColor"` once on the root `<svg>` and let children inherit it — so each `<line>` has no direct stroke and is skipped.

This is native-only. On web the `content` string renders as an `<img>`, so the browser's SVG engine draws `<line>` correctly. The icon looks fine in a browser preview but disappears on iOS/Android.

**Fix:** replace each `<line>` with an equivalent `<path>`:

```
<line x1="4" x2="20" y1="12" y2="12"/>   →   <path d="M4 12h16"/>   (horizontal)
<line x1="10" x2="10" y1="11" y2="17"/>  →   <path d="M10 11v6"/>   (vertical)
```

---

## `ShadowDom` ViewEncapsulation is not supported — falls back to `None`

### What you'd expect (Angular web)

`ViewEncapsulation.ShadowDom` uses the browser's native Shadow DOM for true style isolation.

### What Lynx does

Lynx has no Shadow DOM. Setting `encapsulation: ViewEncapsulation.ShadowDom` on a component logs a warning and falls back to `ViewEncapsulation.None` — no style scoping at all. Only `ViewEncapsulation.Emulated` (the default, which adds `_nghost-*` class to the host element) and `ViewEncapsulation.None` are supported.

---

## Unknown element tags silently fall back to `<x-view>` with a console warning

### What you'd expect (web)

Unknown HTML tags are rendered as `HTMLUnknownElement` and still appear in the DOM.

### What Lynx does

If you use an unrecognized element tag in a Lynx template, the renderer **silently creates an `<x-view>` in its place** and logs a console warning. Since there is no device console, this warning is invisible on-device. This means typos in element names (e.g., `<x-veiw>` instead of `<x-view>`) fail silently and produce an unexpectedly-styled `<x-view>`.

---

## `<x-list>` requires `item-key` on every list item — missing it causes a native crash

### What you'd expect (web)

In web frameworks, keys are an optional optimization hint. Missing a `key` prop is a warning, not a crash.

### What Lynx does

The `item-key` attribute (which provides the unique key for `<x-list>` items) is **required**. If it is missing, Lynx's native list engine cannot correctly identify items for recycling and crashes with a native error. When implementing lists, always ensure every `<list-item>` has a unique `item-key` attribute set.

---

## `<x-list>` children must not be appended via normal DOM methods — the list engine manages them

### What you'd expect (web)

You add children to a scrollable list by appending them to the container element.

### What Lynx does

`<x-list>` is a **virtualized native list** driven by engine callbacks. The native engine calls `componentAtIndex(index)` to request each item and `enqueueComponent(element)` to recycle items no longer visible. You must **never directly `__AppendElement`** a child to an `x-list` — doing so bypasses the recycling mechanism and corrupts the list state.

The AngularLynx renderer handles this transparently: `LynxListElement` intercepts all `appendChild`/`insertBefore` calls, maintains a JS-level virtual tree, and communicates changes to the native engine via `update-list-info` attribute updates (batched via `setTimeout`).

---

## `<x-scroll-view>` bounces defaults to `true`; `<x-image>` defaults to `aspectFit` in the renderer

### What you'd expect

Scrolling without bounce and images stretching to fill (web default `object-fit: fill` / Lynx native default `scaleToFill`).

### What Lynx does

Two default behaviors set by the AngularLynx renderer differ from what you might expect:

- **`<x-scroll-view>`**: The native `bounces` property (iOS over-scroll bounce) defaults to `true` in the Lynx API.
- **`<x-image>`**: The AngularLynx renderer's `LynxDocument` creates image elements with `mode: 'aspectFit'` by default (not `scaleToFill` which is the Lynx native default). This means images preserve their aspect ratio by default in the Angular renderer.

Be explicit with `mode` on every `<x-image>` to avoid surprising platform-specific defaults.

---

## `!important` is not supported in Lynx CSS

### What you'd expect (web)

`!important` overrides all other declarations regardless of specificity.

### What Lynx does

`!important` is **not supported**. Specificity and cascade order work normally, but `!important` has no effect. Do not rely on it for style overrides.

---

## `transition` and `@keyframes` only animate a fixed whitelist of CSS properties

### What you'd expect (web)

Any animatable CSS property can be transitioned or used in `@keyframes`.

### What Lynx does

Both `transition-property` and `@keyframes` are restricted to the **same explicit whitelist**:

`left`, `right`, `top`, `bottom`, `width`, `height`, `opacity`, `background-color`, `color`, `transform`, `transform-origin`, `max-width`, `min-width`, `max-height`, `min-height`, `padding-left/right/top/bottom`, `margin-left/right/top/bottom`, `border-left/right/top/bottom-width`, `border-left/right/top/bottom-color`, `flex-basis`, `flex-grow`, `filter`.

Properties like `font-size`, `border-radius`, `letter-spacing`, etc. **cannot be animated**. Additionally, style changes that happen during component initialization may trigger unexpected transitions if the element transitions from its initial value — set transitions only after the element has rendered.

---

## `animation-timing-function: frames()` is a Lynx-specific non-standard easing

### What you'd expect (web)

Timing functions: `ease`, `ease-in`, `ease-out`, `ease-in-out`, `linear`, `cubic-bezier()`, `steps()`.

### What Lynx does

All standard timing functions are supported, plus a Lynx-specific **`frames(n)`** function that divides the animation into `n` equal frames (similar to `steps()` but with different semantics). `frames()` is not part of the web CSS standard and will not work in a browser.

---

## `font-size` default is `14px`, not `16px`; keyword sizes are not supported

### What you'd expect (web)

Default `font-size` is `16px` (user agent default). Keyword values like `small`, `medium`, `large`, `xx-large` are also supported.

### What Lynx does

- The default `font-size` is **`14px`**, not `16px`. Any layout designed around browser defaults needs adjustment.
- The keyword size values (`xx-small`, `x-small`, `small`, `medium`, `large`, `x-large`, `xx-large`) are **not supported** — only explicit length/percentage values work.

---

## `text-decoration` supports only one layer and has no `text-decoration-thickness`

### What you'd expect (web)

Multiple `text-decoration` layers can be stacked via comma separation. `text-decoration-thickness` controls line weight independently.

### What Lynx does

- Only **one decoration layer** is supported; multiple comma-separated values are ignored.
- `text-decoration-thickness` is **not supported**.

---

## `text-overflow` only supports `clip` and `ellipsis`

### What you'd expect (web)

`text-overflow` supports `clip`, `ellipsis`, `fade`, and a custom string to use as the overflow marker.

### What Lynx does

Only `clip` (default) and `ellipsis` are supported. `fade` (a gradient fade-out) and custom truncation strings are **not available**.

---

## `currentColor` keyword is not supported

### What you'd expect (web)

`currentColor` references the element's computed `color` value and can be used in any CSS property that accepts a color.

### What Lynx does

`currentColor` is **not documented** as a supported color value in Lynx, and there is no evidence it works. Use explicit color values or CSS variables instead.

---

## `background-position` does not support edge-offset syntax

### What you'd expect (web)

`background-position: bottom 10px right 20px` positions a background image 10px from the bottom and 20px from the right.

### What Lynx does

The edge-offset syntax (`<edge> <offset> <edge> <offset>`) is **not supported**. Only the standard two-value form is available: keyword/percentage/length for X and Y axes. To achieve bottom-right anchoring, calculate the equivalent percentage or combine with `background-size`.

---

## `opacity` causes offscreen rendering — explicit `overflow: hidden` is needed for correct clipping

### What you'd expect (web)

`opacity` is straightforward; elements clip to their parent naturally.

### What Lynx does

`opacity` causes the element to be rendered in an **offscreen layer**, which has two consequences:

1. **Performance cost** on both iOS and Android — avoid applying opacity to deeply nested or frequently-updated elements.
2. **On Android**, `overflow: visible` becomes ineffective on an element with `opacity` — children that would normally extend outside the element's bounds are clipped. This is controlled by the `overlap` attribute (default `true` on Android); setting `overlap={false}` separates background and content transparency but causes other artifacts.

---

## Grid layout: no named lines, no `grid-area` shorthand, no `min-content`/`subgrid`/`masonry`

### What you'd expect (web)

CSS Grid supports named lines (`[sidebar-start]`), the `grid-area` shorthand (sets all four start/end values), and keywords like `min-content`, `subgrid`, `masonry`.

### What Lynx does

- **Named grid lines** (`[linename]` syntax) — not supported in `grid-template-columns`/`grid-template-rows`.
- **`grid-area` shorthand** — not documented/not supported. Set `grid-column-start`, `grid-column-end`, `grid-row-start`, `grid-row-end` individually.
- **`min-content`, `subgrid`, `masonry`** — not supported in track sizing functions.
- **`writing-mode`** — not supported; grid always uses horizontal inline axis.
- Lynx has deprecated non-standard `grid-column-span`/`grid-row-span` properties — do not use them (they conflict with the standard start/end properties when both are set).

---

## `SelectorQuery` queries are batched and asynchronous — unlike `querySelector()` which is immediate

### What you'd expect (web)

`document.querySelector('#my-element')` returns the element synchronously and immediately.

### What Lynx does

Lynx has no direct DOM access. Element queries use `lynx.createSelectorQuery()`, which is **batched and asynchronous**:

```ts
lynx
  .createSelectorQuery()
  .select('#my-element')
  .invoke({ method: 'getValue', params: [] })
  .exec((res) => {
    // res[0] contains the result
  });
```

You must chain `.select()` or `.selectAll()`, then `.invoke()` to specify the operation, then `.exec()` to actually run all batched queries together. There is no way to synchronously read an element's state. This affects any pattern that reads DOM state (e.g., checking input value, getting scroll position) — all must use callbacks.

---

## Non-touch events do not propagate — they only reach the exact target element

### What you'd expect (web)

Events like `scroll`, `change`, `input` propagate through the DOM tree (bubble phase) unless stopped.

### What Lynx does

In Lynx, **only touch events** (`tap`, `longpress`, `click`, `touchstart`, `touchmove`, `touchend`) travel through the capture/bubble propagation chain. All other events are delivered **only to the target element** — there is no capture or bubble phase. Listener ancestors will not receive them.

---

## `GlobalEventEmitter`: cross-component event broadcasting (no web equivalent)

### What you'd expect (web)

Cross-component communication uses custom DOM events, RxJS subjects, or global state. No built-in framework-level event bus.

### What Lynx does

Lynx provides a built-in `GlobalEventEmitter` available on the background thread:

```ts
const emitter = lynx.getJSModule('GlobalEventEmitter');
emitter.addListener('my-event', handler);
emitter.trigger('my-event', data);
emitter.removeListener('my-event', handler);
```

This is a native-level event bus that broadcasts across all components in the page. It is also used internally by Lynx for system-level events.

---

## System global events: `keyboardstatuschanged` and `onWindowResize`

### What you'd expect (web)

Keyboard visibility is tracked with `visualViewport.addEventListener('resize', ...)` or `window.addEventListener('resize', ...)`. `window.resize` fires when the window size changes.

### What Lynx does

Global events are dispatched through the `GlobalEventEmitter`:

- **`keyboardstatuschanged`** — fires when the software keyboard appears or disappears. Payload: `{ status: 'show' | 'hide', height, compatHeight }`. There is no web `resize` equivalent that is reliable for keyboard detection on mobile.
- **`onWindowResize`** — fires when the Lynx view container is resized. Payload: `{ width, height }`.

Subscribe via:

```ts
lynx
  .getJSModule('GlobalEventEmitter')
  .addListener('keyboardstatuschanged', handler);
```

---

## `fetch` is available but without CORS, FormData, Blob, or redirect support

### What you'd expect (web)

The Fetch API is available with CORS enforcement, `FormData`, `Blob`, redirects, and `keepalive`.

### What Lynx does

`fetch()` IS available in Lynx, but with important differences:

- **No CORS** — Lynx runs as a native client, not a browser origin. All requests are allowed regardless of `Access-Control-Allow-Origin` headers.
- **No `FormData`** — cannot send multipart form data.
- **No `Blob`** — binary data handling is limited.
- **No redirect** — redirect behavior may differ from web.
- **Streaming IS supported** — `response.body.getReader()` works for server-sent streams.
- **EventSource IS supported** — for Server-Sent Events.

---

## `TextEncoder` and `TextDecoder` are not available in PrimJS — use `TextCodecHelper`

### What you'd expect (web)

`TextEncoder` and `TextDecoder` are standard globals for encoding/decoding UTF-8 strings to/from `Uint8Array`.

### What Lynx does

PrimJS does not provide `TextEncoder` or `TextDecoder`. Use Lynx's **`TextCodecHelper`** module instead:

```ts
const helper = lynx.requireModule('TextCodecHelper');
const encoded = helper.encode('hello'); // returns Uint8Array
const decoded = helper.decode(uint8Array); // returns string
```

---

## `text-maxline` attribute limits visible lines (no CSS equivalent)

### What you'd expect (web)

Multi-line truncation requires `-webkit-line-clamp` (a non-standard prefix) combined with `display: -webkit-box` and `overflow: hidden`.

### What Lynx does

Lynx provides a first-class `text-maxline` attribute on `<x-text>` that limits the number of visible lines. Combine with `overflow: hidden` and `text-overflow: ellipsis` to add an ellipsis:

```html
<x-text style="text-overflow: ellipsis; overflow: hidden;" text-maxline="3">
  Long content that will be truncated at 3 lines...
</x-text>
```

The `<inline-truncation>` child element can be used instead of `...` as a fully custom truncation indicator (e.g., a "Read more" button).

---

## `<x-text>` exposes a `layout` event with per-line geometry

### What you'd expect (web)

There is no native DOM event that tells you the line layout of a text element. You must use `Range` + `getBoundingClientRect()` workarounds.

### What Lynx does

`<x-text>` fires a `layout` event after each render containing detailed line information:

- `lineCount` — total number of lines rendered
- `lines` array — each entry contains the character start/end position and `ellipsisCount` for truncated lines

This is useful for implementing "Show more" logic or aligning decorations to specific lines.

---

## `<x-text>` supports programmatic text selection via attributes and methods

### What you'd expect (web)

`window.getSelection()`, `Range`, and `Selection` API handle text selection. CSS `user-select` controls selectability.

### What Lynx does

Text selection uses Lynx-specific APIs:

- Set **`text-selection="true"`** (plus `flatten={false}`) on `<x-text>` to enable selection.
- **`setTextSelection(startX, startY, endX, endY, showStartHandle, showEndHandle)`** — programmatically set the selection by coordinate.
- **`getTextBoundingRect(startOffset, endOffset)`** — returns the bounding boxes for a character range (useful for custom highlight overlays).
- **`getSelectedText()`** — returns the currently selected string.
- **`selectionchange`** event fires when the selection range changes.
- **`custom-text-selection="true"`** delegates all selection gesture handling to the developer (no default selection handles).

---

## `<x-image>` has native attributes with no CSS equivalents: `tint-color`, `blur-radius`, `cap-insets`

### What you'd expect (web)

Image effects use CSS (`filter: blur()`, CSS blend modes). 9-patch scaling requires the actual Android `.9.png` format.

### What Lynx does

`<x-image>` supports several native image features without CSS equivalents:

- **`tint-color`** — changes all non-transparent pixels to the specified color (like CSS `fill` for SVG but for raster images). No web equivalent.
- **`blur-radius`** — applies a native Gaussian blur to the image source (distinct from CSS `filter: blur()` which blurs the rendered element). Useful for blurred placeholder effects.
- **`cap-insets="top right bottom left"`** — enables 9-patch-like scaling: the specified inset regions are not stretched while the center scales. Does NOT require the Android `.9.png` format. No direct web equivalent (CSS `border-image-slice` is the closest).
- **`auto-size`** — after the image loads, automatically resizes the element to match the image's intrinsic aspect ratio. Unlike web intrinsic sizing, this requires the explicit attribute and is triggered post-load.
- **`image-config`** (Android only) — set to `'RGB_565'` to use 16-bit color (lower memory) or `'ARGB_8888'` for 32-bit with transparency. Note: `RGB_565` may affect `border-radius` rendering.

---

## `<x-list>` supports waterfall (masonry), scroll snapping, and update animations — no CSS equivalents

### What you'd expect (web)

CSS Grid provides multi-column and masonry (experimental `grid-template-rows: masonry`). Scroll snap uses `scroll-snap-type`. Data-change animations require custom JavaScript.

### What Lynx does

`<x-list>` has three native layout types:

- **`list-type="single"`** — single-column scroll list
- **`list-type="flow"`** — grid layout with aligned row tops (all items same height per row)
- **`list-type="waterfall"`** — masonry layout: items fill the shortest column, so variable-height items don't leave gaps

Additional features:

- **`item-snap`** — page-snap scrolling: `{ factor: 0-1, offset: px }` where `factor=0` snaps item to list top and `factor=1` to list bottom. More precise than CSS `scroll-snap-type`.
- **`preload-buffer-count`** — pre-renders N items outside the visible area to reduce pop-in. Set to approximately one screen's worth of items.
- **`update-animation`** — when `"default"`, list animates item insertions and deletions when `update-list-info` changes. `"none"` disables this. No web equivalent.
- **`reuse-identifier`** on `<list-item>` — groups item templates so that only compatible layouts are reused during recycling (prevents wrong-size items from being recycled into wrong slots).

---

## Accessibility uses `accessibility-*` attributes instead of ARIA

### What you'd expect (web)

Accessibility is implemented via `role`, `aria-label`, `aria-hidden`, `aria-live`, `tabindex`, etc.

### What Lynx does

Lynx uses its own attribute system:

- **`accessibility-element="true/false"`** — marks an element as an accessible node (default `true` for `<text>`/`<image>`, `false` for `<view>`).
- **`accessibility-label`** — equivalent to `aria-label`.
- **`accessibility-trait`** — element type hint: `'button' | 'image' | 'text'` (simpler than ARIA roles).
- **`accessibility-elements`** — comma-separated IDs controlling focus order and limiting which children are accessible (no ARIA equivalent; closest is `aria-flowto`).
- **`accessibility-elements-hidden`** — equivalent to `aria-hidden="true"` on a subtree.
- **`accessibility-exclusive-focus`** — traps focus within the element (like a modal dialog's focus trap). No direct ARIA equivalent; ARIA requires `aria-modal` + JavaScript focus management.
- **`lynx.accessibilityAnnounce(message)`** — programmatically sends an announcement to the screen reader (equivalent to an `aria-live` region update).

There is no equivalent to `role`, `tabindex`, `aria-expanded`, `aria-selected`, or most other ARIA attributes.

---

## `performance.now()` is not available; use `lynx.performance` trace API instead

### What you'd expect (web)

`performance.now()` returns a high-resolution timestamp in milliseconds for fine-grained timing measurements.

### What Lynx does

`performance.now()` is **not available** in Lynx. For profiling and performance tracing, use `lynx.performance`:

- `lynx.performance.profileStart(label)` — begin a named trace span
- `lynx.performance.profileEnd(label)` — end the span
- `lynx.performance.profileMark(label)` — instant marker

These emit trace events in Perfetto format, not the Web Performance Timeline model. For simple timing, `Date.now()` is available as a lower-resolution alternative.

---

## `page` is the CSS selector for the root element, not `html` or `body`

### What you'd expect (web)

`html { ... }` or `body { ... }` styles the root/document element.

### What Lynx does

In Lynx, the root element is `<page>`. Use the **`page`** type selector or **`:root`** pseudo-class to style it:

```css
page {
  background-color: white;
}
:root {
  background-color: white;
} /* also works */
```

`html`, `body`, and `*` selectors do not apply to the Lynx root element.

---

## `require()` is synchronous and can appear anywhere; no CommonJS/ESModule boundary restriction

### What you'd expect (web/Node.js)

`import` statements must be at the top level of a module. `require()` is synchronous but node-specific.

### What Lynx does

Lynx supports both CommonJS and ESModule in the same codebase. Notably:

- **`require()`** can appear **anywhere** in the code — inside functions, conditionals, loops — and is **synchronous** with module caching.
- **`import()`** is asynchronous (returns a Promise) for dynamic imports.
- CommonJS and ESModule can be mixed freely within a bundle.
- No C++ addons or Node.js built-in modules (`fs`, `path`, etc.) are available.

This means lazy loading patterns using `require()` inside functions work, which is unusual compared to both browser ESModule environments and strict Node.js setups.

---

## App backgrounding freezes the JS thread — `setTimeout` delays become inaccurate

### What you'd expect (web)

Browser tabs that are backgrounded throttle timers but don't freeze them completely.

### What Lynx does

When the native app is **sent to background** (user presses home button), the Lynx JS thread may **freeze entirely**. Any pending `setTimeout` or `setInterval` callbacks will not fire until the app is foregrounded again — and when they do fire, the elapsed time will be longer than the requested delay. Do not rely on timer precision for time-sensitive logic, and consider using app lifecycle events to pause/resume work.

---

## `lynx.getSystemInfo()` provides platform/device data (no `navigator` equivalent)

### What you'd expect (web)

`navigator.userAgent`, `navigator.platform`, `screen.width`, `screen.height`, `window.devicePixelRatio` provide device information.

### What Lynx does

Use `lynx.getSystemInfo()` to get platform information:

- `platform` — `'Android' | 'iOS' | 'macOS' | 'windows' | 'headless'`
- `osVersion` — OS version string (iOS) or SDK_INT (Android)
- `pixelWidth`, `pixelHeight` — physical pixel dimensions
- `pixelRatio` — device pixel ratio
- `engineVersion` — Lynx engine version
- `runtimeType` — `'v8' | 'jsc' | 'quickjs'` (background thread only)

There is no `navigator` global and no `window.screen` object.

---

## CSS structural pseudo-classes and attribute selectors are not supported

### What you'd expect (web)

CSS selectors like `:nth-child(2n)`, `:first-child`, `:last-child`, `:empty`, `:only-child`, `[data-type]`, `[href^="https"]` are standard and widely used.

### What Lynx does

The only supported pseudo-classes are **`:not()`**, **`:root`**, and **`:active`**. Everything else is absent:

- `:nth-child()`, `:nth-of-type()`, `:first-child`, `:last-child`, `:nth-last-child()` — not supported
- `:empty`, `:only-child`, `:only-of-type` — not supported
- Attribute selectors (`[attr]`, `[attr=value]`, `[attr^=value]`, etc.) — not supported
- `:is()`, `:where()`, `:has()` — not supported

Standard combinators **do** work: descendant (` `), child (`>`), adjacent sibling (`+`), and general sibling (`~`). Universal selector (`*`), type selectors, class selectors, ID selectors, and multiple class selectors (`.a.b`) all work.

---

## `inherit`, `initial`, `unset`, and `revert` global CSS keywords are not supported

### What you'd expect (web)

Every CSS property accepts `inherit`, `initial`, `unset`, and `revert` as values to reset or override the cascade.

### What Lynx does

These global keywords are **not supported** in Lynx. Many individual property docs explicitly list them as unsupported values. You cannot use `color: inherit` or `display: initial` — each property must always be set to a concrete value. This compounds with the earlier documented absence of CSS inheritance: there is no way to opt in to inheriting a value from a parent.

---

## `calc()` and `env()` are supported; `min()`, `max()`, `clamp()` are not

### What you'd expect (web)

`calc()`, `min()`, `max()`, `clamp()`, and `env()` (for safe area insets) are all available for responsive sizing.

### What Lynx does

- **`calc()`** — supported with basic arithmetic (`+`, `-`, `*`, `/`, parentheses). Works with CSS variables via `var()`.
- **`min()`, `max()`, `clamp()`** — not supported. Calculate responsive bounds in JavaScript and set them via signals or inline styles.
- **`env()`** — **supported** for safe area insets: `env(safe-area-inset-top|right|bottom|left)` parses as a length, and it also works **inside `calc()`** (e.g. `padding-bottom: calc(1rem + env(safe-area-inset-bottom))`). Verified in the Lynx core CSS engine (`references/lynx/core/renderer/css/css_style_utils.cc` — `GetEnvValue`, and the `calc` parser accepts `env()` tokens).
  - **Caveat:** the insets default to `0` until the **native host app** populates them. On a host that doesn't inject inset data (some dev harnesses), `env(...)` resolves to `0`, so styles that depend on it degrade to plain padding rather than erroring — a safe no-op. For a boolean "is this a notch device?" signal that _is_ available in JS, inject `LynxSafeArea` from `@blotch/angular-lynx` (`isNotchScreen()`).
  - The `@blotch/ui` Tailwind plugin ships `*-safe` / `*-safe-<n>` padding utilities built on this (see `packages/ui/src/lib/theme/tailwind-plugin.ts`).

---

## `@supports`, `@layer`, `@container`, `@property` at-rules are not supported

### What you'd expect (web)

Modern CSS at-rules enable feature queries (`@supports`), cascade layers (`@layer`), container queries (`@container`), and custom property typing (`@property`).

### What Lynx does

None of these are supported:

- **`@supports`** — cannot conditionally apply styles based on feature support
- **`@layer`** — no cascade layer control
- **`@container`** — no container queries for responsive components
- **`@property`** — cannot define typed custom properties or animation behavior for CSS variables

Supported at-rules: `@font-face`, `@keyframes`, `@import` only.

---

## `@font-face` does not support `font-style`, `font-weight`, or `font-variant` descriptors

### What you'd expect (web)

`@font-face` declarations include `font-family`, `src`, `font-style`, `font-weight`, `font-display`, `font-variant`, `unicode-range`, etc.

### What Lynx does

Only `font-family` and `src` are supported. **`font-style`**, **`font-weight`**, and **`font-variant`** descriptors are not supported in `@font-face`. This means you cannot load multiple font faces for different weights/styles under the same family name — each variant must use a different `font-family` name, or you must load a variable font.

Supported font formats differ by platform:

- Android: TTF, OTF, TTC
- iOS: TTF, OTF, WOFF (10+), WOFF2 (10+)

---

## CSS `<time>` values require units even for zero (`0ms`, not `0`)

### What you'd expect (web)

`transition-duration: 0` is valid shorthand for `0s` in most browsers.

### What Lynx does

`<time>` values always require explicit units. `0` without a unit is **invalid** — use `0ms` or `0s`. This applies to `transition-duration`, `transition-delay`, `animation-duration`, `animation-delay`, and any other time-valued property.

---

## Gradient color stops cannot have multiple positions per stop

### What you'd expect (web)

`linear-gradient(red 10% 30%, blue 70% 90%)` assigns two positions to each color stop, creating hard color bands.

### What Lynx does

Each color stop can have at most **one** position value. Multi-position stops (e.g., `red 10% 30%`) are not supported. To create hard-edge gradients, use two adjacent stops at the same color with different positions.

---

## `contain`, `backface-visibility`, `scroll-snap-*`, `overscroll-behavior`, `caret-color`, `hyphens`, `inset`, and `appearance` are not supported

### What you'd expect (web)

These are useful CSS properties for rendering optimization, 3D transforms, scroll UX, form styling, and text layout.

### What Lynx does

None are supported:

- **`contain`** — no CSS containment for rendering optimization (Lynx manages this natively)
- **`backface-visibility`** — cannot hide the back face of 3D-transformed elements
- **`scroll-snap-type` / `scroll-snap-align`** — no CSS scroll snapping; use `<x-list item-snap>` attribute instead
- **`overscroll-behavior`** — no overscroll containment; use `bounces` attribute on `<x-scroll-view>` instead
- **`caret-color`** — cannot style the text input cursor color
- **`hyphens`** — no automatic hyphenation
- **`inset`** shorthand — use `top`, `right`, `bottom`, `left` individually
- **`appearance`** — cannot reset native form control styling (moot since Lynx has its own form elements)
- **CSS nesting** — not supported in the native CSS engine (use PostCSS/Sass at build time)

---

## Lynx has a platform gesture layer separate from the event system — with dedicated interception controls

### What you'd expect (web)

Touch/gesture events are unified. `touch-action` CSS property is the primary way to control gesture behavior. There is no concept of a "platform gesture layer" separate from the DOM event system.

### What Lynx does

Lynx separates gestures into two independent layers:

1. **Lynx touch events** (`touchstart`, `touchmove`, `touchend`, `tap`, `longpress`) — controlled by `user-interaction-enabled` and `pointer-events`
2. **Platform gestures** (native scroll, iOS back-swipe, system pan) — controlled by a completely different set of attributes

Platform gesture control attributes (no web equivalents):

| Attribute                    | Purpose                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `native-interaction-enabled` | Toggle whether the element consumes platform gestures (defaults differ per platform: `true` on iOS, `false` on Android) |
| `pan-intercept-direction`    | Block platform scroll gestures in a specific direction: `0` = horizontal, `1` = vertical, `2` = none                    |
| `pan-intercept-scope`        | Which nodes' gestures are affected: `0`=self, `1`=ancestors, `2`=descendants, through `5`=all, `6`=none                 |
| `block-native-event`         | Blocks platform-layer gestures entirely (e.g., iOS right-swipe-to-go-back)                                              |
| `block-native-event-areas`   | Limits `block-native-event` to specific rectangular regions: `[['0px','0px','50%','100%']]`                             |
| `consume-slide-event`        | Blocks platform scroll based on swipe angle (degrees): `[[-45, 45]]` blocks rightward swipes                            |

These have no CSS or DOM equivalents. On web, `touch-action` and `preventDefault()` are the only gesture controls. In Lynx, the platform gesture recognizer runs independently at the native layer and must be managed through these element attributes.

---

## `event-through`: touch passthrough to the native platform layer

### What you'd expect (web)

`pointer-events: none` makes an element transparent to all pointer events; underlying elements receive them.

### What Lynx does

`event-through` is a boolean attribute that makes Lynx **not consume** touch events, allowing them to pass through to the native platform layer below. This is distinct from `pointer-events: none`:

- `pointer-events: none` — prevents the element from receiving Lynx touch events (other Lynx elements can still receive them)
- `event-through=true` — Lynx itself stops consuming the touch event, so the **native platform** (e.g., a native Android view behind the Lynx view) receives it

`event-through` has **inheritance** — child nodes inherit the parent's value unless they set their own. Use `event-through-active-regions` (`[['0px','0px','50%','50%']]`) to limit the passthrough to specific rectangular areas.

---

## `hit-slop`: expand touch target area without affecting layout

### What you'd expect (web)

To expand a touch target, add `padding` (affects layout) or use a pseudo-element overlay (requires `::before`/`::after`, which Lynx doesn't support).

### What Lynx does

The `hit-slop` attribute expands the element's touch-responsive area without changing its visual size or layout. It accepts a string (`'10px'`) for uniform expansion or an object (`{ top: '10px', left: '20px', right: '20px', bottom: '10px' }`) for per-side control.

Limitations: `hit-slop` does not affect platform gestures — only Lynx touch events. It can also be clipped by parent `overflow: hidden`, `z-index` ordering, `translateZ`, or `position: fixed`.

---

## `flatten` (Android): forces native View creation for specific features

### What you'd expect (web)

Every DOM element always corresponds to a renderable object. There is no concept of "flattened" vs "unflattened" rendering.

### What Lynx does

On **Android only**, Lynx may "flatten" element rendering — drawing the element's content directly into its parent's canvas without creating a separate native Android `View`. This is a performance optimization but breaks certain features.

Set `flatten={false}` on elements that need:

- Text selection (`text-selection=true`)
- Screenshot capture
- `sticky` positioning inside `<x-scroll-view>`
- Element method calls via `SelectorQuery`
- **Reliable `overflow: hidden` clipping of `position: absolute` children.** A
  plain `<view style="overflow: hidden">` with absolutely-positioned children
  can clip inconsistently on Android — the clip boundary appears to shift
  depending on unrelated state changes, and some edges may not clip at all —
  because a flattened view has no dedicated native View to own the clip
  region. Observed in `UiCartesianChart`
  (`packages/ui/src/lib/components/cartesian-chart/cartesian-chart.ts`): the
  plot's inner `overflow: hidden` clipped its (also absolutely-positioned)
  series marks and gridlines correctly, because that view is already forced
  non-flatten by the gesture directive (see `LynxGestureDetector`); but adding
  `overflow: hidden` to the outer container did nothing reliable until BOTH
  `[flatten]="false"` and `z-index: 0` (see the stacking-context entry below)
  were added — they are independent causes of the same symptom, not
  alternatives.

  Caveat learned the hard way: container-level clipping is usually the WRONG
  tool for clipping axis labels or any element deliberately positioned to
  straddle an edge. `UiCartesianChart` originally clipped its out-of-window
  buffer tick labels with a `overflow: hidden` + `z-index: 0` +
  `[flatten]="false"` container, but that same clip sliced the *legitimate*
  edge labels in half (the top y-label is centered on the top gridline, so its
  box overhangs the container top by half its font height). The container clip
  was reverted in favor of hiding individual out-of-window labels with
  `visibility: hidden` (a pure paint toggle, safe from a gesture worklet).
  Reach for the flatten+z-index container clip when you must clip content that
  should genuinely be bounded (a scrolling region, a masked thumbnail); prefer
  per-element hiding when some children are supposed to overhang.

This attribute has no effect on iOS. There is no web equivalent because web always creates renderable objects for all elements.

---

## `:active` pseudo-class bubbles up the event response chain (unlike web)

### What you'd expect (web)

`:active` applies only to the element being pressed and its ancestors in the DOM tree. It does not "propagate" — ancestors independently match `:active` based on the event target being a descendant.

### What Lynx does

In Lynx, `:active` **propagates up the event response chain** by default. This means touching a deeply nested element applies `:active` styles to all its ancestors in the chain. Set `enable-touch-pseudo-propagation=false` on an element to prevent `:active` from propagating through it — making it behave more like web.

---

## `ignore-focus`: prevent keyboard focus stealing on tap

### What you'd expect (web)

Tapping a non-focusable element may blur the current focus target (implementation-dependent). There's no way to prevent this without JavaScript `preventDefault()`.

### What Lynx does

`ignore-focus=true` prevents the element from stealing keyboard focus when tapped. This is inherited — children also won't steal focus unless they override it. Use case: tapping an overlay toolbar button while keeping the keyboard open for a text input below.

---

## Angular Renderer2 ignores namespaces, listener options, and style flags

### What you'd expect (Angular web)

`Renderer2.createElement()` supports SVG namespaces. `Renderer2.listen()` supports passive, capture, and once options. `Renderer2.setStyle()` supports `RendererStyleFlags2` for sanitization.

### What Lynx does

The Lynx `Renderer2` implementation passes through element creation and style changes to Lynx native functions, but:

- **Namespace parameters** are silently ignored in `createElement()`, `setAttribute()`, and `removeAttribute()`. SVG element creation via namespace does not work through Angular's API (use the `<svg>` Lynx element directly).
- **Listener options** (`passive`, `capture`, `once`) are ignored in `listen()`. All events are registered with default behavior.
- **`RendererStyleFlags2`** flags (sanitization, important) are ignored in `setStyle()` and `removeStyle()`. No CSS sanitization is applied.
- **`setValue(node, value)`** sets `node.setAttribute('text', value)` rather than `node.textContent = value`. This works because Lynx text nodes use a `text` attribute internally.

---

## CSS style property names are NOT transformed between camelCase and kebab-case

### What you'd expect (web)

`element.style.backgroundColor = 'red'` automatically maps to `background-color` in CSS. Angular's `setStyle('backgroundColor', value)` is equivalent to `setStyle('background-color', value)`.

### What Lynx does

The AngularLynx renderer passes style property names to `__AddInlineStyle()` **without any transformation**. There is no camelCase-to-kebab-case conversion. If you use Angular's `[style.backgroundColor]="'red'"`, the property name `backgroundColor` is passed as-is to the Lynx native layer. Whether Lynx's CSS engine accepts camelCase names is implementation-dependent — use **kebab-case** (`background-color`) in all style bindings and CSS declarations to be safe.

---

## Unrecognized event name prefixes silently produce no-op listeners

### What you'd expect (web)

`element.addEventListener('click', handler)` always registers the listener. Invalid event names still register (they just never fire).

### What Lynx does

Event listener registration requires names to match specific prefixes: `bind`, `catch`, `capture-bind`, `capture-catch`, or `global-bind`. If the event name does not start with one of these prefixes, `addEventListener()` returns an **empty unsubscribe function** and the listener is never registered. No error is thrown. This means standard DOM event names like `click`, `focus`, `input` silently fail — you must use `bindtap`, `bindfocus`, `bindinput` instead.

---

## `order` does not affect rendering/paint order — only layout order

### What you'd expect (web)

`order` reorders both the **layout position** and **visual painting order** of flex/grid items. An item with higher `order` visually appears after items with lower `order`.

### What Lynx does

`order` affects layout positioning (which item appears where in the flex/grid sequence) but does **not affect rendering/paint order**. Elements are still painted in DOM source order regardless of their `order` value. Additionally, `order` is not supported on children with `position: absolute`, `position: fixed`, or `position: sticky`.

---

## `min-width`/`min-height` default to `0px` (not `auto`); `max-*` wins over `min-*` (reversed from web)

### What you'd expect (web)

- `min-width` defaults to `auto` (which resolves to the content's intrinsic minimum)
- When `min-width` and `max-width` conflict, `min-width` wins (min overrides max)

### What Lynx does

- Default `min-width`/`min-height` is **`0px`**, not `auto`. The `auto` keyword is not supported. This means flex items can shrink to zero by default (no intrinsic minimum protection).
- Keywords `max-content`, `min-content`, `fit-content` are not supported.
- **`max-width` takes precedence over `min-width`** — the opposite of web. If `max-width < min-width`, then `min-width` is ignored. This reversal is critical for responsive layouts.

---

## `flex-basis` is not affected by `box-sizing`

### What you'd expect (web)

When `box-sizing: border-box`, `flex-basis` includes padding and border in its calculation (like `width`).

### What Lynx does

`flex-basis` always measures the **content area only**, regardless of the element's `box-sizing` value. Padding and border are never included in `flex-basis` calculations. This means an element with `flex-basis: 100px; padding: 20px; box-sizing: border-box` will occupy 140px total in Lynx (100px content + 40px padding), whereas on web it would occupy 100px total.

---

## `text-transform` is not supported

### What you'd expect (web)

`text-transform: uppercase` / `lowercase` / `capitalize` transforms text casing via CSS.

### What Lynx does

The `text-transform` property **does not exist** in Lynx. Text case transformations must be done in JavaScript/TypeScript before rendering:

```ts
text = text.toUpperCase(); // must transform in JS
```

---

## `background` shorthand does not support `<attachment>`, and gradient types are limited in the shorthand

### What you'd expect (web)

The `background` shorthand accepts: `background: url(...) no-repeat center / cover fixed red` — including attachment, repeating gradients, conic gradients, etc.

### What Lynx does

- **`background-attachment`** — not supported at all (no `fixed`, `scroll`, or `local`). Backgrounds always scroll with the element.
- In the `background` shorthand, **gradient types are limited to** `linear-gradient()` and `radial-gradient()` only. `repeating-linear-gradient()`, `repeating-radial-gradient()`, and `conic-gradient()` are **not supported in the shorthand** (they may work in `background-image` longhand but not in the unified `background` shorthand).
- Color must be the **last** value in the shorthand; if placed elsewhere, the parser treats the entire declaration as invalid.

---

## `background-size: auto` with gradient backgrounds causes display errors

### What you'd expect (web)

`background-size: auto` scales the background to its intrinsic size. For gradients (which have no intrinsic size), it fills the element.

### What Lynx does

Using `background-size: auto` or specifying only one dimension (e.g., `background-size: 50%`) with a **gradient** `background-image` may cause display errors or unexpected rendering. Always specify both dimensions explicitly when using gradients: `background-size: 100% 100%` or use `cover`/`contain`.

---

## `column-gap` and `row-gap` do not support the `normal` keyword

### What you'd expect (web)

`column-gap: normal` and `row-gap: normal` use the browser's default gap (typically `0` for flex, `1em` for multi-column).

### What Lynx does

The `normal` keyword is not supported. Only explicit `<length>` and `<percentage>` values are accepted. Use `0px` when you want no gap.

---

## `display: relative` is a Lynx-proprietary layout mode with its own positioning system

### What you'd expect (web)

`display: relative` is not valid CSS. Web uses `position: relative` for relative positioning within flow layout.

### What Lynx does

`display: relative` activates a proprietary layout mode inspired by Android's `RelativeLayout`. Children are positioned relative to the parent or to each other using dedicated properties:

| Property                                                    | Purpose                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `relative-id`                                               | Integer identifier for the element (must be unique among siblings, `-1` = skip as reference)                 |
| `relative-center`                                           | Center within parent: `both`, `vertical`, `horizontal`, `none`                                               |
| `relative-align-top` / `-bottom` / `-left` / `-right`       | Align edge with parent (`parent`) or sibling (by `relative-id`)                                              |
| `relative-top-of` / `-bottom-of` / `-left-of` / `-right-of` | Position adjacent to a sibling (by `relative-id`)                                                            |
| `relative-align-inline-start` / `-inline-end`               | Logical alignment (respects RTL)                                                                             |
| `relative-inline-start-of` / `-inline-end-of`               | Logical positioning (respects RTL)                                                                           |
| `relative-layout-once`                                      | Performance: `true` (default) = fast single-pass layout; `false` = supports circular cross-axis dependencies |

This has no web equivalent. Use it for complex positioning that would require multiple nested flex containers or absolute positioning on web.

---

## iOS polyfills for `Map`, `Set`, `WeakMap`, `WeakSet` — these are only polyfilled on iOS, not Android

### What you'd expect (web)

`Map`, `Set`, `WeakMap`, `WeakSet` are universally available in all modern environments.

### What Lynx does

On **Android** (which uses PrimJS on both threads), these ES6 collections are natively available. On **iOS** (which uses JavaScriptCore for the background thread), they are **polyfilled** by the Lynx runtime. The polyfills cover correct behavior but may have subtle performance differences from native implementations. Other iOS-only polyfills include: `Array` methods (`flat`, `flatMap`, `includes`, etc.), `Object.fromEntries`, `Promise` methods, `Reflect`, `String` methods, and `Symbol`.

This is generally transparent unless you're doing feature detection or relying on specific implementation details of these collections.

---

## WebAssembly is limited: background thread only, Android 3.8+, no streaming/static APIs

### What you'd expect (web)

`WebAssembly.compile()`, `WebAssembly.instantiate()`, `WebAssembly.validate()`, streaming compilation, and all Wasm APIs are available on any thread in all modern browsers.

### What Lynx does

WebAssembly support is **severely restricted**:

- Only available on the **background thread** (not the main/rendering thread)
- Only on **Android** with Lynx SDK **3.8+** (not iOS, not older versions)
- **Static APIs not supported**: `WebAssembly.compile()`, `WebAssembly.instantiate()`, `WebAssembly.validate()` — use the object-based APIs instead (`new WebAssembly.Module()`, `new WebAssembly.Instance()`)
- **Streaming variants not supported**: `WebAssembly.compileStreaming()`, `WebAssembly.instantiateStreaming()`
- Reflection APIs only partially supported

---

## No `<canvas>`, `<video>`, `<audio>`, or `<iframe>` elements

### What you'd expect (web)

`<canvas>` for 2D/WebGL drawing, `<video>` and `<audio>` for media playback, `<iframe>` for embedded pages are fundamental HTML elements.

### What Lynx does

None of these elements exist in Lynx:

- **`<canvas>`** — not supported. There is no 2D drawing surface or Canvas API. For custom drawing, use native bridge modules or SVG (limited).
- **`<video>` / `<audio>`** — not supported as built-in elements. Media playback requires native bridge integration via `lynx.requireModule()`.
- **`<iframe>`** — replaced by the Lynx-specific `<frame>` element (which embeds another Lynx page, not arbitrary web content). There is no way to embed web URLs.

---

## No drag-and-drop, clipboard, file system, or Web Worker APIs

### What you'd expect (web)

`DataTransfer`, `navigator.clipboard`, File API, `showOpenFilePicker()`, `Worker`, `SharedWorker` are standard browser APIs.

### What Lynx does

None of these web APIs exist in Lynx:

- **Drag and drop** — no `DragEvent`, no `draggable` attribute, no `DataTransfer`. Implement custom drag via touch events.
- **Clipboard** — no `navigator.clipboard`. Copy/paste must go through native bridge modules.
- **File system** — no File API, no `<input type="file">`, no `showOpenFilePicker()`. File access requires native bridge.
- **Web Workers** — not supported. Lynx already has a dual-thread model (main + background), but you cannot spawn additional threads from JS. Use the built-in background thread instead.
- **SharedWorker / ServiceWorker** — not supported. No offline caching, no background sync.

---

## Cross-thread data serialization converts `undefined` to `null`

### What you'd expect (web)

In a single-threaded environment, `undefined` and `null` remain distinct through all operations.

### What Lynx does

When data crosses the thread boundary (background → main thread or vice versa), it is **JSON-serialized**. `JSON.stringify()` converts `undefined` values to `null` (or omits them from objects). This means:

- An attribute set to `undefined` on one thread arrives as `null` on the other
- Array slots containing `undefined` become `null` after serialization
- This can cause false-positive dirty checks when comparing old vs new values

When writing code that sets attributes or passes data cross-thread, treat `undefined` and `null` as equivalent. Avoid using `undefined` as a meaningful distinct value.

---

## `lynx.getTextInfo()` only works with built-in platform fonts, not custom `@font-face` fonts

### What you'd expect (web)

Font metrics (via `canvas.measureText()` or `FontFace` API) work with any loaded font, including custom `@font-face` declarations.

### What Lynx does

`lynx.getTextInfo(config)` measures text dimensions (width, height, line count), but the `fontFamily` parameter **only supports built-in platform fonts** — not fonts loaded via `@font-face` or `lynx.addFont()`. If you pass a custom font family name, the measurement will fall back to a default font and return inaccurate dimensions. Measure text only after confirming the font is a system font, or use the element's actual rendered dimensions (via exposure events or layout callbacks) instead.

---

## Gradient color stop: bare numbers without units are treated as percentages

### What you'd expect (web)

In gradients, color stop positions require explicit units: `linear-gradient(red 20%, blue 80%)`. A bare number like `0.5` is invalid.

### What Lynx does

In Lynx gradient definitions, a bare number without a unit is interpreted as a **percentage expressed as a decimal**: `0.5` is treated as `50%`, `1` is treated as `100%`. While this is convenient, it means `linear-gradient(red 0, blue 1)` in Lynx produces `red 0%, blue 100%` — which would be invalid on web. Always use explicit `%` suffix for portability.

---

## `__SetAttribute` vs `__SetConfig`: Lynx distinguishes between attributes and config

### What you'd expect (web)

DOM elements have a single `setAttribute()` method and properties. There is no separate "config" concept.

### What Lynx does

Lynx elements have **two** ways to set properties:

- **`__SetAttribute(element, name, value)`** — for dynamic properties that can change at any time (scroll-orientation, enable-scroll, item-key, etc.)
- **`__SetConfig(element, configObject)`** — for initial configuration set once at creation time (image mode, list recycleEnabled, list estimatedItemSize, etc.)

The distinction matters because `__SetConfig` is only effective during element creation. Setting config properties later via `__SetAttribute` may not work or may require a full element recreation. The AngularLynx renderer handles this by setting config in `LynxDocument.createElement()` and attributes via template bindings.

---

## Default `position` is `relative`, not `static`

### What you'd expect (web)

All elements default to `position: static` — they are positioned according to the normal flow, and `top`/`left`/`right`/`bottom` have no effect.

### What Lynx does

The default `position` is **`relative`**. This means `top`/`left`/`right`/`bottom` offsets are active by default on every element. While this rarely causes visible differences (offset defaults are `0`), it changes how stacking contexts and `z-index` behave: every Lynx element is already a positioned element, so `z-index` applies to every element by default (on web, `z-index` only applies to positioned elements).

---

## `Intl` API is not available — i18n libraries require polyfills

### What you'd expect (web)

`Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.PluralRules`, `Intl.Collator`, etc. are standard globals in all modern browsers and Node.js.

### What Lynx does

The `Intl` API is **not implemented** in Lynx's PrimJS runtime. This breaks any i18n or localization library that relies on it:

- **i18next v24+** requires `Intl.PluralRules` — use v23 with `compatibilityJSON: 'v3'` or polyfill `@formatjs/intl-pluralrules`.
- **Angular `@angular/common` pipes** (`DatePipe`, `DecimalPipe`, `CurrencyPipe`) use `Intl` internally — they will throw at runtime without polyfills.
- Polyfills needed: `@formatjs/intl-numberformat`, `@formatjs/intl-datetimeformat`, `@formatjs/intl-pluralrules`, etc.

---

## `border-image` is not supported

### What you'd expect (web)

`border-image` (and its longhands `border-image-source`, `border-image-slice`, `border-image-width`, `border-image-outset`, `border-image-repeat`) render a custom image as the element's border.

### What Lynx does

`border-image` is **not supported** (still in development according to Lynx docs). Use standard `border` properties with solid colors, or use a background image with `background-clip: border-area` as a workaround for decorative borders.

---

## CSS inheritance can be explicitly enabled — with a fixed list of inheritable properties

### What you'd expect (web)

Many CSS properties (color, font-_, line-height, text-_, etc.) inherit from parent to child by default without any configuration.

### What Lynx does

CSS inheritance is **off by default** (as documented earlier), but it can be **explicitly enabled** via the build config option `enableCSSInheritance: true` in the Lynx template plugin. When enabled, only these properties inherit:

`direction`, `color`, `font-family`, `font-size`, `font-style`, `font-weight`, `letter-spacing`, `line-height`, `text-align`, `text-decoration`, `text-shadow`

Individual properties can also be added to the inheritable list via `customCSSInheritanceList` in the build config.

Additionally, even with inheritance enabled, **`position: fixed` elements only inherit CSS from the `<page>` root**, not from their DOM ancestors — because Lynx treats `position: fixed` elements as direct children of the page node.

---

## `justify-items` and `justify-self` exist but with limited values

### What you'd expect (web)

`justify-items` and `justify-self` support: `normal`, `stretch`, `center`, `start`, `end`, `flex-start`, `flex-end`, `self-start`, `self-end`, `left`, `right`, `baseline`, etc.

### What Lynx does

- **`justify-items`**: Does not support `normal` (default is `stretch`), `flex-start`, `flex-end`, `self-start`, `self-end`, `left`, `right`.
- **`justify-self`**: Does not support `normal` (default is `auto`), `flex-start`, `flex-end`, `self-start`, `self-end`, `left`, `right`.

Both only work in grid layout — they have no effect in flex or linear layouts.

---

## Angular components must use `CUSTOM_ELEMENTS_SCHEMA` for Lynx elements

### What you'd expect (Angular web)

Angular validates element names against its schema of known HTML/SVG elements. Unknown elements cause template compilation errors.

### What Lynx does

Lynx elements (`x-view`, `x-text`, `x-image`, `x-scroll-view`, `x-list`, etc.) are not known to Angular's element schema. Every component that uses Lynx elements in its template must include `schemas: [CUSTOM_ELEMENTS_SCHEMA]` in its `@Component` decorator — otherwise Angular throws template errors during compilation.

---

## Zone.js is incompatible with Lynx — `provideZonelessChangeDetection()` is required

### What you'd expect (Angular web)

Angular uses Zone.js by default to automatically detect changes and trigger rendering after asynchronous operations.

### What Lynx does

Zone.js patches browser APIs (`setTimeout`, `Promise`, `addEventListener`, etc.) that either don't exist or work differently in Lynx's dual-thread runtime. Using Zone.js causes crashes or silent failures. The AngularLynx renderer requires **`provideZonelessChangeDetection()`** in the application config. This means:

- All state that drives templates must use Angular **signals** or call `ChangeDetectorRef.markForCheck()` explicitly.
- Async operations (HTTP calls, timers) do not automatically trigger change detection — you must update a signal or mark for check.

---

## Main-thread JavaScript must be a single monolithic chunk — no code splitting

### What you'd expect (web)

Webpack/Rspack can freely split any bundle into multiple async chunks for lazy loading.

### What Lynx does

The Lynx runtime expects the main-thread JavaScript to be a **single file** (`main-thread.js`). The build system explicitly prevents code splitting on main-thread chunks:

```ts
splitChunks.chunks = (chunk) => !chunk.name?.includes('__main-thread');
```

Background-thread code can still be split normally. This means main-thread bundle size must be carefully managed — all main-thread code is loaded eagerly on startup.

---

## `fetch` streaming requires an explicit `enableFetchAPIStandardStreaming` flag

### What you'd expect (web)

`response.body.getReader()` for streaming fetch responses works out of the box.

### What Lynx does

While `fetch()` is available, **streaming body reading** via `response.body.getReader()` requires the build-time flag `enableFetchAPIStandardStreaming` to be set to `true`. Without this flag, `response.body` may not support the Readable Streams API. Additionally, third-party HTTP libraries may need adjustments due to subtle differences in Lynx's fetch implementation compared to the web spec (no CORS, no FormData/Blob, no redirect support).

---

## `width` and `height` do not support `min-content`; measurements include border and padding by default

### What you'd expect (web)

`width: min-content` sizes the element to its minimum intrinsic width. Default `width`/`height` measure the content area only (when `box-sizing: content-box`).

### What Lynx does

- `min-content` keyword is **not supported** for `width` or `height` (use explicit sizes or flex/linear layout with `linear-weight` instead).
- Because `box-sizing` defaults to `border-box`, `width: 100px` means the element's **total size** (including padding and border) is 100px — not 100px of content with padding and border added on top.

---

## CSS is scoped per lazy-loaded bundle — lazy chunks have isolated CSS scope

### What you'd expect (web)

CSS loaded from lazy-loaded chunks merges into the same global stylesheet. A class defined in a lazy module can accidentally affect elements in other modules.

### What Lynx does

Lynx scopes CSS **per bundle**. When a component is lazy-loaded, its CSS lives in its own isolated scope. Styles from the main bundle do **not** affect lazy-loaded components, and vice versa. This is enforced by the Lynx template engine's CSS scoping mechanism (not CSS Modules or Shadow DOM). While this prevents accidental style leakage, it also means:

- Global utility classes defined in the main bundle are **not available** in lazy-loaded components.
- Each lazy bundle must include or import its own copy of shared styles.
- The `__SetCSSId` and `entryName` parameters on elements control which CSS scope applies.

---

## `justify-content: start` / `end` always behave like `flex-start` / `flex-end`

### What you'd expect (web)

`start` and `flex-start` can differ: `start` aligns to the writing-mode start edge, while `flex-start` aligns to the flex container's main-start edge (which can differ with `flex-direction: row-reverse`).

### What Lynx does

Since Lynx does not support `writing-mode`, `start` always behaves identically to `flex-start`, and `end` behaves identically to `flex-end`. Additionally, `left` and `right` keywords are not supported — use `flex-start`/`flex-end` or `start`/`end` instead.

---

## `text-align` default is `start`, not `left`

### What you'd expect (web)

Default `text-align` is `start` (which resolves to `left` in LTR contexts). Supports `justify`, `match-parent`, and other values.

### What Lynx does

Default `text-align` is also `start`, but because Lynx supports `direction: rtl`, `start` resolves based on the element's text direction. The key difference is what's **missing**: `justify`, `justify-all`, and `match-parent` are not supported (documented earlier). This also means you cannot create justified paragraphs in Lynx.

---

## `z-index` auto state is implicit: determined by whether the property is set at all

### What you'd expect (web)

`z-index: auto` is the explicit default. An element with `z-index: auto` participates in its parent's stacking context and does not create its own.

### What Lynx does

Lynx determines `auto` vs non-auto stacking **by whether `z-index` is set at all**, not by its value. Since the default `position` is `relative` (not `static`), every Lynx element is already positioned — but only elements that **explicitly set `z-index`** create stacking contexts. Setting `z-index: 0` explicitly creates a stacking context (useful for `<x-scroll-view>` clipping), while an element without any `z-index` declaration behaves as auto. This subtle distinction matters for scroll-view child clipping and list item rendering (see earlier `z-index: 0` on scroll-view entry).

---

## `MouseEvent.button` values use non-standard numbering

### What you'd expect (web)

W3C standard: `button` value `0` = left/primary, `1` = middle/wheel, `2` = right/secondary.

### What Lynx does

Lynx uses different button numbering (as of Lynx 3.7): `1` = left, `2` = right, `3` = middle. The Lynx docs note that `MouseEvent` behavior is **not yet fully aligned with W3C**; alignment is planned for Lynx 3.8. If you're handling mouse/pointer events, remap button values or wait for the 3.8 alignment.

---

## `animationcancel` and `transitioncancel` events do not fire if the animated element is destroyed

### What you'd expect (web)

When an element is removed from the DOM during an animation, the browser fires `animationcancel` or `transitioncancel` to allow cleanup.

### What Lynx does

If the animated element is destroyed (removed from the native tree) mid-animation, the `animationcancel` and `transitioncancel` events **will not fire**. Any cleanup logic relying on these events will be silently skipped. Use Angular lifecycle hooks (`ngOnDestroy` / `DestroyRef`) to handle cleanup instead of relying on animation cancel events.

---

## Calling `element.animate()` inside an event handler can recurse infinitely

### What you'd expect (web)

Starting a Web Animation from within an event handler (e.g. fading an `<image>` in from its `load` handler) is fine — `animate()` schedules the animation and returns; it does not synchronously re-fire the handler.

### What Lynx does

Starting (or canceling) an animation via `element.animate()` can **synchronously re-invoke event listeners**. Observed concretely: an `<image>` fading itself in from its `(bindload)` handler — `onLoad → element.animate() → … → the bindload listener runs again → onLoad → element.animate() → …` — recursing until the main thread throws `InternalError: stack overflow`. The re-entry also fires across elements: tearing down a sibling's animation (e.g. removing a pulsing `ui-skeleton`) during change detection re-dispatched a nearby image's `load`.

Consequence: never assume an event handler that calls `animate()` runs once. Make such handlers **idempotent** (a one-way latch that short-circuits re-entry), and prefer _not_ driving essential state changes through an `animate()` call made inside an event handler. This bit `ui-avatar`: it faded the image in via `fadeIn()` (which calls `element.animate()`) from `(bindload)`, and once images actually loaded the reveal recursed and crashed. The fix was to drop the `animate()` reveal (the skeleton's removal reveals the image) and guard the handler with a `loaded` latch.

---

## `__OnLowMemory` event: native memory pressure notifications (no web equivalent)

### What you'd expect (web)

Browsers have no standard API to notify JavaScript of system memory pressure (though `navigator.deviceMemory` exists for static info).

### What Lynx does

Lynx dispatches `__OnLowMemory` as a global event with three severity levels:

- `NONE` — memory pressure resolved
- `MODERATE` — system is under moderate memory pressure
- `CRITICAL` — system is critically low on memory; free resources immediately or risk being killed

Listen via `GlobalEventEmitter`:

```ts
lynx.getJSModule('GlobalEventEmitter').addListener('__OnLowMemory', (level) => {
  if (level === 'CRITICAL') {
    /* free caches, release images */
  }
});
```

Use this to proactively release caches, large images, or off-screen component state to avoid the OS killing the app.

---

## `lynx.reload()` preserves global props and JS global variables — unlike `location.reload()`

### What you'd expect (web)

`location.reload()` fully resets the page: all JavaScript state is lost, all modules re-evaluated, all network requests re-sent.

### What Lynx does

`lynx.reload()` re-initializes the Lynx page but:

- **Global props are preserved** — `lynx.__globalProps` retains its values
- **JS global variables are preserved** — anything set on `globalThis` survives
- **Does NOT trigger DataProcessor functions** — initial data processing is skipped
- **Does trigger unmount** — all component `componentWillUnmount`/`onDetach` lifecycle hooks fire

This means `lynx.reload()` is a "soft reload" rather than a full page reset. If you need a clean slate, the native host must recreate the entire LynxView.

---

## IntersectionObserver distinguishes `relativeToScreen()` vs `relativeToViewport()` — web only has viewport

### What you'd expect (web)

`IntersectionObserver` observes intersections relative to the viewport (or a specified root element). The viewport is the browser window.

### What Lynx does

Lynx has **two** distinct reference frames:

- **`relativeToViewport(margins)`** — observes relative to the LynxView container (the native view that hosts the Lynx page). This is analogous to web's viewport.
- **`relativeToScreen(margins)`** — observes relative to the **device physical screen**. The LynxView may be smaller than the screen (e.g., embedded in a native app with toolbars), so screen-relative observation captures when elements become visible on the actual device display, not just the Lynx container.

Both accept margin parameters for expanding/contracting the detection area. Web has no equivalent to `relativeToScreen()` — the viewport IS the screen in a browser.

---

## Non-zero `<length>` values always require units — unitless numbers are invalid

### What you'd expect (web)

Some CSS contexts accept unitless numbers: `line-height: 1.5`, `flex-grow: 2`, `opacity: 0.5`. In `<length>` contexts, `0` can be unitless but non-zero values require units.

### What Lynx does

Lynx is **stricter**: in any `<length>` context, only `0` is allowed without a unit. All non-zero values must have explicit units (`px`, `rpx`, `em`, `rem`, `%`, `vh`, `vw`). Writing `margin: 5` instead of `margin: 5px` is invalid and silently ignored. Similarly, `<time>` values require units even for zero (`0ms`, not `0`).

---

## Grid line numbers cannot be `0` — `grid-column-start: 0` is invalid

### What you'd expect (web)

Grid line numbers can be any integer including negative values. `0` is technically invalid per spec but browsers handle it gracefully.

### What Lynx does

Grid line number values **cannot be `0`**. Setting `grid-column-start: 0`, `grid-column-end: 0`, `grid-row-start: 0`, or `grid-row-end: 0` is explicitly invalid in Lynx. Use `1` for the first line, `-1` for the last line.

---

## `font-style` does not support `oblique <angle>` — only `normal`, `italic`, `oblique`

### What you'd expect (web)

`font-style: oblique 14deg` specifies the exact angle of oblique text.

### What Lynx does

Only keyword values are supported: `normal`, `italic`, `oblique`. The `oblique <angle>` syntax (e.g., `oblique 14deg`) is **not supported**. Lynx renders `oblique` at the platform's default slant angle.

---

## Native module bridge: Lynx can call iOS/Android/HarmonyOS native code directly from JS

### What you'd expect (web)

JavaScript in a browser cannot access native OS APIs. Communication with native requires WebView bridges or hybrid frameworks.

### What Lynx does

Lynx provides a first-class **native module bridge** with typed parameter mapping between JS and native code (Java/Kotlin, Objective-C/Swift, ArkTS). Modules are registered natively and accessed via `lynx.requireModule('ModuleName')`. A type conversion system maps JS types to native types:

- `string` ↔ `NSString` / `String`
- `number` ↔ `NSNumber` / `int`/`double`
- `object` ↔ `NSDictionary` / `Map`
- `array` ↔ `NSArray` / `List`
- Callbacks and Promises for async operations

Lynx 3.5+ adds a module auth validator that restricts which frontend code can access which native modules — a security model with no web equivalent.

---

## `setNativeProps()` for direct imperative element mutation (bypasses state management)

### What you'd expect (web)

DOM manipulation is done via `element.style.property = value` or framework abstractions. There is no special "native props" API.

### What Lynx does

`nodesRef.setNativeProps({ style: { color: 'red' }, ... })` allows **direct imperative mutation** of element properties, bypassing Angular's change detection and state management entirely. This is a performance optimization for rapid updates (e.g., scroll-driven animations) but has caveats:

- Cannot set `style` as a whole object — must set individual CSS properties within it
- Makes code harder to reason about (the docs explicitly call it "a crude method")
- State and view can get out of sync if not managed carefully

Use Angular signals and template bindings for normal updates; reserve `setNativeProps()` for performance-critical paths only.

---

## `font-optical-sizing` defaults to `none`, not `auto`

### What you'd expect (web)

`font-optical-sizing` defaults to `auto` — the browser automatically adjusts the optical size axis (`opsz`) of variable fonts based on `font-size`.

### What Lynx does

The default is **`none`** — optical sizing adjustments are not applied automatically. If you're using a variable font with an `opsz` axis and want optical sizing, you must set `font-optical-sizing: auto` explicitly or use `font-variation-settings: 'opsz' <value>`.

---

## `ppx` (physical pixel) unit — maps to actual device pixels

### What you'd expect (web)

Common length units: `px` (CSS pixel), `em`, `rem`, `%`, `vw`, `vh`. There is no unit for physical device pixels (CSS pixels are already device-independent).

### What Lynx does

Lynx adds **`ppx`** (physical pixel) in addition to `px` and `rpx`:

- **`px`** — CSS logical pixel (device-independent, like web `px`)
- **`rpx`** — responsive pixel (750rpx = screen width)
- **`ppx`** — actual physical device pixel

On a 2x display (e.g., iPhone 6): `750rpx = 375px = 750ppx`. So `1rpx = 0.5px = 1ppx`. Use `ppx` when you need pixel-perfect rendering at the hardware level (e.g., 1-pixel hairline borders that don't get scaled up on high-DPI screens).

---

## CSS combinator selectors don't react to dynamic class changes without `enableCSSInvalidation`

### What you'd expect (web)

When you dynamically change an element's class, all CSS selectors (including descendant combinators like `.parent .child`) are immediately re-evaluated and styles update.

### What Lynx does

By default, CSS combinators (descendant ` `, child `>`, sibling `+`/`~`) **only match during the initial class assignment**. If you dynamically change an element's class at runtime (e.g., toggling a `.dark-theme` class on a parent), descendant selectors like `.dark-theme .content` will **not** trigger style recalculation on child `.content` elements.

To fix this, enable `enableCSSInvalidation: true` in the build config. This tells the Lynx CSS engine to re-evaluate combinator matches when DOM classes change — matching web behavior, but with a performance cost (it must walk the subtree on every class change).

Without this flag, use inline styles or CSS variables (which are inheritable by default) for dynamic theming instead of class-based descendant selectors.

---

## Default `display` can be switched from `linear` to `flex` via `defaultDisplayLinear` config

### What you'd expect (web)

Default `display` is always `block` for block-level elements. Not configurable.

### What Lynx does

Lynx's default `display: linear` can be changed to `display: flex` globally by setting `defaultDisplayLinear: false` in the Lynx template plugin configuration. When disabled:

- All elements default to `display: flex` instead of `display: linear`
- Existing `flex-direction`, `flex-wrap`, `justify-content`, `align-items` properties work as the primary layout mechanism
- Linear-specific properties (`linear-weight`, `linear-direction`, `linear-gravity`) become opt-in via `display: linear`

This can simplify migration from web CSS (where flexbox is common) but changes the layout semantics of every element in the app.

---

## `<x-input>` does not auto-avoid the software keyboard — manual repositioning required

### What you'd expect (web/mobile)

On mobile web (iOS Safari, Android Chrome), when a text input is focused and the software keyboard appears, the browser automatically scrolls the page to keep the focused input visible above the keyboard.

### What Lynx does

`<input>` does **not** auto-avoid the keyboard. When the keyboard appears, it covers whatever is behind it — including the focused input. You must manually listen to the `keyboardstatuschanged` global event, read the keyboard height from the event payload, and reposition the input (or its scroll container) yourself:

```ts
lynx
  .getJSModule('GlobalEventEmitter')
  .addListener('keyboardstatuschanged', (e) => {
    if (e.status === 'on') {
      // manually offset the input by e.height pixels
    }
  });
```

This is a common source of bugs in Lynx apps — always implement keyboard avoidance for any form input.

---

## Nested scroll views cannot be directly composed — use `<scroll-coordinator>` instead

### What you'd expect (web)

Nested scrollable containers work naturally: an inner `overflow: scroll` div inside an outer `overflow: scroll` div handles scroll delegation automatically (inner scrolls first, then outer).

### What Lynx does

Directly nesting `<x-scroll-view>` inside another `<x-scroll-view>` (or inside `<x-list>`) **does not work** — scroll gesture delegation between nested scrollable containers is not handled automatically. You must use the Lynx-specific `<scroll-coordinator>` element to coordinate nested scrolling:

```html
<!-- WRONG — nested scroll views don't coordinate -->
<x-scroll-view>
  <x-list />
  <!-- inner scroll won't hand off to outer -->
</x-scroll-view>

<!-- CORRECT — use scroll-coordinator -->
<scroll-coordinator>
  <scroll-coordinator-header
    ><!-- collapsible header --></scroll-coordinator-header
  >
  <scroll-coordinator-slot>
    <x-list />
    <!-- inner scroll, coordinates with header -->
  </scroll-coordinator-slot>
</scroll-coordinator>
```

`<scroll-coordinator>` handles:

- Outer scrolls to bottom → automatically hands scroll to inner list
- Inner scrolls to top → automatically hands scroll back to outer header
- Smooth handoff with no gesture interruption

This pattern is common in apps with collapsible headers and tabbed list content.

---

## `<x-image>` will not load if its size is 0×0 — set `prefetch-width`/`prefetch-height` to force loading

### What you'd expect (web)

`<img>` begins loading its `src` regardless of its CSS size. Even a hidden or zero-sized image downloads the resource.

### What Lynx does

`<x-image>` skips loading entirely if its computed width or height is `0`. This is a performance optimization (don't download images the user can't see), but it means:

- Images inside collapsed containers or before layout completes won't prefetch
- Images with `display: none` on their container won't load
- Setting `prefetch-width` and/or `prefetch-height` attributes overrides this behavior and forces the image to load even at size 0

If you need to preload images for later display, set explicit `prefetch-width`/`prefetch-height` attributes.

---

## `font-optical-sizing` defaults to `none`, not `auto` (documented above) — and `cap-insets` only accepts integers

### Additional image quirk: `cap-insets` values must be concrete integers

The `cap-insets` attribute (9-patch scaling regions) only accepts concrete integer values for top, right, bottom, left. Percentage values (`%`) and decimal values (`0.5`) are **not supported**. Use whole pixel values only:

```html
<!-- CORRECT -->
<x-image cap-insets="10 10 10 10" />

<!-- WRONG — percentages and decimals invalid -->
<x-image cap-insets="10% 10% 10% 10%" />
<x-image cap-insets="5.5 5.5 5.5 5.5" />
```

---

## Main-thread Element objects (PAPI) cannot have JavaScript getters/setters — only FFI parameter passing

### What you'd expect (web)

DOM element objects have full JavaScript property access: `element.style`, `element.classList`, `element.dataset` all work as getter/setter properties.

### What Lynx does

On the main thread, element references returned by PrimJS's high-performance FFI are **opaque native objects**, not standard JavaScript objects. The PrimJS engine **cannot bind getter/setter methods** to these FFI-returned objects. You cannot do `element.style.color` or `element.textContent` — you can only pass these objects as parameters to other FFI functions (like `__SetAttribute(element, key, value)`).

This is why all element manipulation in Lynx goes through global `__*` functions rather than object methods. On the background thread, elements don't exist at all (only virtual placeholders). This fundamentally differs from web DOM where elements are rich JavaScript objects with properties, methods, and event targets.

---

## `fetch()` and network calls only work on the background thread — main thread cannot make HTTP requests

### What you'd expect (web)

`fetch()` is available in any execution context — main thread, web workers, service workers.

### What Lynx does

`fetch()` is **only available on the background thread**. The main thread runs minimal JavaScript (element creation and worklet execution) and has **no network access**. Attempting to call `fetch()` on the main thread will fail silently or throw. This means:

- Event handlers prefixed with `main-thread:` cannot make network calls
- Any HTTP logic must run on the background thread (the default for Angular code)
- The `lynx` global may also expose a `lynx.fetch` binding on the background thread as an alternative to `globalThis.fetch`

---

## `filter` CSS property only works on `<x-view>` elements — not on `<x-image>` or `<x-text>`

### What you'd expect (web)

`filter: blur(5px)` works on any element — `<div>`, `<img>`, `<span>`, etc.

### What Lynx does

The `filter` property only applies to **`<view>`** elements. It has no effect on `<text>`, `<image>`, or other element types. For image blur, use the `blur-radius` attribute directly on `<x-image>` instead of CSS `filter`. For text blur, there is no direct solution — wrap the text in a `<x-view>` and apply the filter to the view.

---

## `@keyframes` on Android require explicit `0%` and `100%` values — no computed fallbacks

### What you'd expect (web)

If `@keyframes` omit `0%` or `100%`, the browser uses the element's computed property values as implicit start/end keyframes.

### What Lynx does

On Android, missing `0%` or `100%` keyframes can cause **transform animations to malfunction** — the animation may snap, flicker, or not run at all. Always specify explicit starting and ending values for all animated properties:

```css
/* WRONG on Android — missing 0% may malfunction */
@keyframes slide {
  100% {
    transform: translateX(100px);
  }
}

/* CORRECT — explicit 0% and 100% */
@keyframes slide {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(100px);
  }
}
```

---

## `translateZ` on Android can break parent `overflow: hidden` clipping

### What you'd expect (web)

`transform: translateZ(...)` creates a new stacking context but does not affect parent `overflow: hidden` clipping.

### What Lynx does

On Android, using `translateZ` on a child element can cause the parent's `overflow: hidden` to **stop clipping**. Content that should be hidden visually overflows. Workarounds:

- Set `flatten={false}` on the parent element
- Set `transform: translateZ(0)` on sibling elements to normalize the stacking context
- Avoid using `translateZ` when the parent needs `overflow: hidden` clipping

---

## `text-shadow` with `blur-radius: 0` may fail to render on some Android devices

### What you'd expect (web)

`text-shadow: 2px 2px 0px red` renders a sharp, non-blurred shadow.

### What Lynx does

On some Android platforms, a `blur-radius` of exactly `0` causes the shadow to **not render at all**. Use a very small blur value instead (e.g., `0.1px`) to ensure the shadow appears:

```css
/* May fail on some Android devices */
text-shadow: 2px 2px 0px red;

/* Workaround — use minimal blur */
text-shadow: 2px 2px 0.1px red;
```

---

## `console.*` methods work but pipe to native logging — not a visible console panel

### What you'd expect (web)

`console.log()`, `console.warn()`, `console.error()` output to the browser's Developer Tools console.

### What Lynx does

`console.log()` and other `console.*` methods **do work** and are captured by Lynx's native logging system (alog on Android, os_log on iOS, LynxInspector for DevTool). However:

- There is **no on-device console panel** visible to the user
- Logs can be viewed via Lynx DevTool's remote debugging or native platform log viewers (adb logcat, Xcode console)
- In development, a remote dev logger can intercept `console.*` calls and forward them to the rspeedy dev server via `fetch()` (background thread only)
- For on-device error visibility, the AngularLynx renderer captures unhandled errors to `globalThis.__lynxLastError` for rendering in the UI

---

## `globalProps` changes trigger a full page re-render — not component-scoped

### What you'd expect (web)

State changes typically re-render only the affected component subtree (via Angular signals, React state, etc.).

### What Lynx does

When the native host updates `lynx.__globalProps` (e.g., for theme switching or locale changes), the `onGlobalPropsChanged` event fires and triggers a **full page re-render** of the entire Lynx page — not just components that read the changed prop. This can be expensive if `globalProps` changes frequently. For fine-grained updates, prefer CSS variables (which only re-style affected elements) or Angular signals (which only re-render subscribed components) over `globalProps`.

---

## `top` defaults to `0`, not `auto`

### What you'd expect (web)

`top` defaults to `auto` — positioned elements with `top: auto` remain in their normal flow position.

### What Lynx does

Because Lynx defaults `position` to `relative`, and `top` defaults to **`0`** (not `auto`), every element starts at offset `0` from its natural position. On web, `top: auto` means "don't apply any offset." In practice this rarely causes visual differences (since `0` offset = no visual shift), but it matters when computing layout: `top: 0` in Lynx is an explicit value, not the absence of one. If you need web-like "no offset" behavior, `top: 0` already provides it — but be aware this is a set value, not `auto`.

---

## `justify-content: space-around` and `space-evenly` behave like `start` in linear layout

### What you'd expect (web)

`space-around` distributes equal spacing around each item; `space-evenly` distributes equal spacing between all items and edges. These work identically in flexbox.

### What Lynx does

In **linear layout** (`display: linear`, the Lynx default), `space-around` and `space-evenly` are accepted but **behave identically to `start`** — items are packed to the start of the main axis with no distribution. These values only work correctly in **flex layout** (`display: flex`) and **grid layout** (`display: grid`). If you need `space-around`/`space-evenly` behavior, switch to `display: flex`.

---

## `color` property with gradient values only works on `<x-text>` elements

### What you'd expect (web)

The `color` property accepts a `<color>` value and applies to all text content. Gradient text requires workarounds (`-webkit-background-clip: text`).

### What Lynx does

Lynx extends the `color` property to accept gradient values — but this extension **only works on `<text>` elements**. On `<view>` or other elements, gradient `color` values are ignored. This means you can create gradient-colored text natively in Lynx (simpler than the web workaround), but only on `<x-text>`.

---

## Main-thread scripts are compiled to bytecode — no source-level debugging on main thread

### What you'd expect (web)

JavaScript is interpreted or JIT-compiled from source text. Debuggers can always access the original source.

### What Lynx does

Main-thread scripts are pre-compiled to **PrimJS bytecode format** at build time, not shipped as text. This provides ~4x faster loading (no runtime parsing), but means:

- Source-level debugging is not possible on the main thread
- Main-thread errors show bytecode offsets, not source line numbers
- Background-thread scripts remain as text and are debuggable

For debugging main-thread code, rely on logging, Lynx DevTool's CDP protocol, or switch logic to the background thread during development.

---

## Values captured in main-thread functions must be JSON-serializable

### What you'd expect (web)

JavaScript closures capture any value — functions, DOM elements, WeakRef, Symbol, etc.

### What Lynx does

When a background-thread function captures variables for use on the main thread (via `runOnMainThread()` or main-thread event handlers), the captured values are **serialized and sent across threads**. Only JSON-serializable values survive:

- Strings, numbers, booleans, null — work
- Plain objects and arrays — work (deep-cloned)
- Functions, DOM element refs, Symbols, WeakRef, Map/Set — silently become `undefined` or `null`

Failures happen **at sync time**, not at the call site — making them hard to debug. If you need to reference an element cross-thread, use `ref` with `__GetElementUniqueID()` to pass an ID, then look it up on the other thread.

---

## `lynx.beforePublishEvent` — intercept events before they fire

### What you'd expect (web)

Events fire and propagate through the DOM. There is no way to intercept events globally before they reach handlers (without a capture-phase listener on the root).

### What Lynx does

`lynx.beforePublishEvent.add(interceptor)` registers a global event interceptor that runs **before** any event handler fires. This allows:

- Logging/analytics on all events
- Conditionally blocking events
- Modifying event data before handlers see it

This is more powerful than a capture-phase root listener because it runs before the event even enters the propagation chain. No web equivalent exists.

---

## Instant First-Frame Rendering (IFR): synchronous first-screen rendering

### What you'd expect (web)

Page rendering is always asynchronous — the browser parses HTML, builds the DOM, loads CSS, and paints progressively. First meaningful paint depends on network and parsing speed.

### What Lynx does

Lynx supports **Instant First-Frame Rendering (IFR)**: if initial data is available at page creation time, the main thread renders the first screen **synchronously** in the same call frame as page initialization. The user sees content immediately with no white screen flash. This is fundamentally different from web SSR/SSG:

- **Web SSR**: Server renders HTML → client downloads → client hydrates → interactive
- **Lynx IFR**: Data available → main thread renders synchronously → visible on first frame → background thread hydrates for interactivity

IFR imposes constraints: main-thread code must be synchronous (no async/await), side effects must be deferred to background thread, and all captured values must be serializable.

---

## fetch() is only available on the background thread

### What you'd expect (web)

`fetch()` is a global function available everywhere — event handlers, constructors, async callbacks, etc.

### What Lynx does

`fetch` is injected by Lynx's `tt.define()` module wrapper as a **function parameter**, not a global. It is only available on the **background thread** (where the JavaScript engine runs Angular). The **main thread** (Lepus, handles native UI and event handlers) does not receive `fetch` in its module scope — `typeof fetch === 'undefined'` there.

This means:

- Angular component constructors → background thread → `fetch` available ✓
- `(bindtap)` event handlers → main thread → `fetch` unavailable ✗
- `setTimeout` callbacks set from a tap handler → still main thread → `fetch` unavailable ✗

Neither `globalThis.fetch` nor `lynx.fetch` fills the gap — all are `undefined` on the main thread.

### Cross-thread logging via IPC

To log from event handlers (main thread), use Lynx's RuntimeProxy IPC to relay to the background thread which does the actual fetch:

```typescript
// Main thread → background thread (fire and forget):
lynx
  .getJSContext()
  .dispatchEvent({ type: '__lynx_log__', data: JSON.stringify(entry) });

// Background thread: receive and fetch:
lynx.getCoreContext().addEventListener('__lynx_log__', (event) => {
  fetch(logServerUrl, { method: 'POST', body: event.data });
});
```

This is the same mechanism React Lynx uses internally for `runOnBackground()`. See `LynxLoggerService` in `packages/runtime/src/lib/lynx-logger.service.ts` for the full implementation.

### RuntimeProxy API summary

| Thread            | To send TO other thread                  | To receive FROM other thread                       |
| ----------------- | ---------------------------------------- | -------------------------------------------------- |
| Main thread       | `lynx.getJSContext().dispatchEvent(e)`   | `lynx.getJSContext().addEventListener(type, cb)`   |
| Background thread | `lynx.getCoreContext().dispatchEvent(e)` | `lynx.getCoreContext().addEventListener(type, cb)` |

## Tailwind CSS with AngularLynx

### Setup

Use `rsbuild-plugin-tailwindcss` (not a bare `postcss.config.js`). Add `pluginTailwindCSS()` after `pluginAngularLynx()` in `lynx.config.ts`. No changes to the CSS pipeline (`css.ts`) are needed — Tailwind's PostCSS step runs upstream of the CSS extractor.

**Always use `@lynx-js/tailwind-preset`** — it strips every Tailwind plugin that generates CSS Lynx cannot parse: `hover:*`, `focus:*`, `@media`, `::before`/`::after`, `pointer-events`, `calc()`, etc.

**Tailwind v3 only** — `tailwindcss@^3`. Tailwind v4 (`@tailwindcss/postcss`, `@tailwindcss/vite`) is incompatible with `@lynx-js/tailwind-preset`.

### `content:` must target `.ts` files, not `.html`

Angular templates in this project are inline TypeScript string literals — there are no `.html` template files. Use:

```ts
content: ['./src/**/*.ts'],
```

### Text color classes must go on `<text>` elements directly

Lynx CSS inheritance is **off by default**. `text-white` on a parent `<view>` does not cascade to child `<text>` elements — each element is its own isolated style scope.

**Wrong:**

```html
<view class="text-white">
  <text>This is NOT white</text>
</view>
```

**Correct:**

```html
<view>
  <text class="text-white">This is white</text>
</view>
```

### CSS variables require `enableCSSInheritance: true`

If `tailwind.config.ts` extends colors via `var(--color-*)`, the cascade must be enabled for the variables to reach child elements:

```ts
// lynx.config.ts
pluginAngularLynx({ enableCSSInheritance: true });
```

For runtime theme switching via Angular style bindings (`[style]="themeVars()"`), also add `enableCSSInlineVariables: true`.

## `__AddClass` takes a single class name, not a space-separated list

`__AddClass(element, className)` adds one CSS class. Passing a space-separated string like `'foo bar baz'` does NOT add three classes — Lynx treats the entire string as one class name literal, so no CSS rule will ever match.

**Always use `__SetClasses(element, classString)` when replacing the entire `class` attribute**, as it correctly parses space-separated class lists. `__AddClass` should only be called with a single class name at a time.

This is why the Angular renderer's `setAttribute('class', value)` must call `__SetClasses`, not `__AddClass`. React Lynx does the same: it calls `__SetClasses(element, className)` when applying the `className` prop.

---

## Angular's template `i18n` attribute does not work — use `$localize` in code instead

### What you'd expect (web)

Angular's `i18n` attribute on template elements (e.g. `<span i18n>Hello</span>`) is the standard way to mark translatable content. The AOT compiler extracts the text and generates `ɵɵi18n` instructions in the compiled template.

### What Lynx does

The `ɵɵi18n` instruction creates i18n DOM nodes (text nodes, comment nodes) using internal Angular APIs that bypass `Renderer2`. These operations assume a browser DOM environment. On Lynx, where elements are created via `__CreateElement`/`__CreateRawText` and there's no real DOM, the i18n instruction fails silently — the component renders blank and crashes the router.

### Workaround

Use `$localize` tagged template literals in TypeScript code and bind the result via `{{ }}` interpolation. This goes through the normal text interpolation path (`ɵɵtextInterpolate`) which correctly uses the Lynx renderer:

```typescript
// DON'T: <text i18n>Hello</text>
// DO:
get greeting() { return $localize`Hello`; }
// Template: <text>{{ greeting }}</text>
```

---

## HSL space-separated syntax is not supported

### What you'd expect (web)

Modern CSS Color Module Level 4 syntax: `hsl(240 5.9% 10%)` (space-separated, no commas). Both `hsl()` and `hsla()` accept this form. This is what shadcn/ui uses for CSS variable composition: `--primary: 240 5.9% 10%` paired with `hsl(var(--primary))`.

### What Lynx does

The Lynx CSS parser (`css_string_parser.cc`) only supports **comma-separated** HSL syntax:

- `hsl(240, 5.9%, 10%)` — works
- `hsla(240, 5.9%, 10%, 0.5)` — works
- `hsl(240 5.9% 10%)` — **silently fails**, no background renders

The parser uses hardcoded `Consume(TokenType::COMMA)` calls in the HSL path. RGB, by contrast, has dual-path parsing that handles both legacy commas and modern spaces.

### Impact on the theme system

The shadcn-style `hsl(var(--primary))` composition pattern cannot work on Lynx because:

1. The CSS variable stores raw HSL channels: `--primary: 240 5.9% 10%`
2. `hsl(var(--primary))` expands to `hsl(240 5.9% 10%)` — space-separated — which Lynx rejects

### Resolution (adopted)

The `@blotch/ui` theme stores each color as a complete `rgba()` value and the tailwind plugin references it directly — no `hsl()` wrapper, no color-function parsing on device:

```css
/* packages/ui/src/lib/theme/default.css */
page {
  --primary: rgba(24, 24, 27, 1);
}
```

```ts
/* packages/ui/src/lib/theme/tailwind-plugin.ts */
primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' }
```

`bg-primary` then emits `background-color: var(--primary)`, which resolves to the rgba value Lynx accepts. This matches the official React Lynx Tailwind example.

Tradeoff: Tailwind opacity modifiers on semantic colors (`bg-primary/50`) no longer work — the value is opaque with no separable channels. For a translucent semantic color, add a dedicated variable (e.g. `--destructive-subtle: rgba(239, 68, 68, 0.1)` → `bg-destructive-subtle`) or use `opacity-*` on the element. See the "CSS Colors in Lynx" section of the root `CLAUDE.md`.

**Status:** implemented across `packages/ui` + all examples; validate the paint on device via the `css-var-validation` screen in kitchen-sink-app.

---

## `<input>` and `<textarea>` `value` attribute is write-once — programmatic resets require `setValue` UIMethod

### What you'd expect (web)

Setting `element.value = ''` or `element.setAttribute('value', '')` clears the input's displayed text at any time, even after user interaction.

### What Lynx does

The native `<input>` and `<textarea>` elements (`LynxUIBaseInput` on both Android and iOS) have **no `@LynxProp` handler for the `value` attribute**. This means `__SetAttribute(element, 'value', '')` is effectively a **no-op** once the user has interacted with the field — it updates the attribute metadata but does not clear the displayed text.

To programmatically set the displayed text, use the `setValue` UIMethod:

```ts
// Wrong — __SetAttribute("value") is ignored after user interaction
__SetAttribute(element, 'value', '');

// Correct — routes through __InvokeUIMethod("setValue", {value: ''})
element.invoke('setValue', { value: '' });
```

### Impact on Angular forms

When using Angular Signal Forms with `[formField]` on a component that implements `FormValueControl`, the form field reset resets the component's `model()` signal, which triggers a template binding update via `[attr.value]="value()"`. But since this calls `renderer.setAttribute(el, 'value', '')` → `__SetAttribute` → no-op, the native input is NOT cleared visually.

### The fix in AngularLynx

The `LynxInput` and `LynxTextarea` directives override `ngOnChanges` to call `this.#el.invoke?.('setValue', {value})` when the `value` input changes, bypassing `__SetAttribute`. UI components should use `[value]="value()"` (an Angular input binding that routes through `ngOnChanges`) rather than `[attr.value]="value()"` (an attribute binding that calls `renderer.setAttribute` directly and bypasses the override).

---

## Event objects have no `stopPropagation()` / `preventDefault()` on the background thread

### What you'd expect (web)

Every handler receives a DOM `Event` with `stopPropagation()`, `stopImmediatePropagation()`, and `preventDefault()`. Angular templates call them directly — e.g. `(catchtap)="$event.stopPropagation()"`. Angular's own listener wrapper (`wrapListenerIn_markDirtyAndPreventDefault`) also calls `event.preventDefault()` whenever a handler returns `false`.

### What Lynx does

Lynx's **background-thread** event objects — the ones Angular handlers receive — do **not** implement these methods at runtime. From the Lynx docs:

> "For commonly used Web methods such as `e.stopPropagation()` and `e.preventDefault()`, Lynx only supports `e.stopPropagation()` in Main Thread Scripts."

The trap: Lynx's own type definitions (`@lynx-js/types`) declare these methods on every event, so TypeScript never flags the call. It fails only at runtime — `main-thread.js exception: not a function`.

Propagation is controlled **statically** by the event prefix, not at runtime:

- `bindtap` — listen, allow bubbling
- `catchtap` — listen **and** stop bubbling (the native equivalent of `stopPropagation()`)
- `capture-bind` / `capture-catch` — capture-phase variants

There is also no default action to prevent, so `preventDefault()` has no meaning either.

### The fix in AngularLynx

`LynxElement.addEventListener` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) wraps every handler. Before calling it, the wrapper adds no-op `stopPropagation`/`preventDefault`/`stopImmediatePropagation` shims to the event — but only when absent, so it never clobbers the real methods available in main-thread scripts. This gives Angular DOM parity: `$event.stopPropagation()` and return-`false` handlers no longer crash.

To actually stop propagation, use the `catch` prefix (`(catchtap)="..."`), not a runtime `stopPropagation()` call. Overlay components (`dialog`, `sheet`, `nav-drawer`, `alert-dialog`, `action-sheet`, `select`) use an empty `onPanelTap()` handler on a `catchtap` panel for exactly this reason — the `catch` prefix stops the tap from reaching the backdrop.

---

## No label/`for` control association; `[for]` on a component is a compile error

### What you'd expect (Angular web)

`<label for="email">` links the label to the control with `id="email"` — tapping the label focuses or toggles that control. Angular special-cases `[for]`, binding it to the DOM `htmlFor` property.

### What Lynx does

Lynx has no label/control association. There is no `htmlFor` property and no `id`-based linking, so `for=`, `[for]`, and the paired `id=` are all dead — tapping a label never activates a sibling control.

Worse, `[for]` on a custom component fails to compile. Angular maps `[for]` to the `htmlFor` DOM property, which a component like `ui-label` does not declare:

```
Can't bind to 'htmlFor' since it isn't a known property of 'ui-label'. (ngtsc -998002)
```

A static `for="x"` attribute does not error — Angular treats it as a plain attribute — but it is equally dead.

### The fix

Nest the label inside the control's own content slot when it has one. `ui-radio-group-item` projects `<ng-content/>` and makes its whole row tappable, so nesting the label makes tapping it select the item:

```html
<!-- WRONG — [for] is a compile error, and the association does nothing -->
<ui-radio-group-item [value]="opt.value" [id]="opt.value" />
<ui-label [for]="opt.value">{{ opt.label }}</ui-label>

<!-- CORRECT — label inside the item, whole row tappable -->
<ui-radio-group-item [value]="opt.value">{{ opt.label }}</ui-radio-group-item>
```

When the control has no content slot (e.g. `ui-checkbox`), or the label is a multi-line block that can't live inside the item's `<text>` slot, drop the dead `id`/`for` attributes and keep the label as a sibling. Only the control itself stays tappable.

---

## Children stretch to fill the parent's cross axis by default (no width = full-bleed)

### What you'd expect (web)

A `<div style="display:flex">` is block-level, so it fills its container's width — but its _flex children_ are content-sized on the main axis. To make a pill/badge shrink to its content you reach for `display: inline-flex` (this is exactly what shadcn's `Badge` does).

### What Lynx does

Views default to **`linear`** layout (`display: linear`, `linear-direction: column` — see the `defaultDisplayLinear: true` plugin option). In linear layout a child with **no explicit `width`** and no `align-self` override **expands to fill the parent's cross axis** — so a badge/pill/chip in a column container renders full-bleed, not hugging its text.

There is no `inline`/`inline-flex` display in Lynx to opt out. The lever is **`align-self: flex-start`** (Tailwind `self-start`) on the child, which overrides the container's `align-items` and lets the child size to its content on the cross axis. This is supported in both linear and flex layouts.

```ts
// A badge that hugs its content regardless of parent layout:
cva('flex items-center self-start rounded-full px-2.5 py-0.5', {
  /* … */
});
```

Note the parent trap that makes this bite: `class="flex-row"` alone does **not** create a row. `flex-row` only emits `flex-direction: row`, which linear layout ignores (it uses `linear-direction`). Without a `flex` class the view stays a linear column, so its children stack _and_ stretch full-width. Use `flex flex-row` for an actual horizontal row.

---

## A component's host element is an UNstyled fallback `view` — style the host, not an inner view, for zero-content components

### What you'd expect (web)

You write a component `<ui-separator>` with `template: '<view [class]="...">`, and the inner view's classes (`w-px h-full`, `w-full`, etc.) fully determine how it renders. The host element is transparent — it just wraps the template.

### What Lynx does

An Angular component whose selector is **not** a native Lynx element (`ui-separator`, `ui-badge`, …) has a host element that falls back to a plain, **unstyled** `view` (the renderer maps unknown tags to `view` — see `packages/runtime` CLAUDE.md). That host `view` is a real element in the layout tree: it sits between the parent and your template's inner view as an **extra flex/linear item with no classes of its own**.

For most components this is invisible, because the host gets a size _either_ from its content (a badge/button has text) _or_ from the parent stretching it (Lynx's default `align-items: stretch`). But a **zero-content** component that relies entirely on stretch/fill has nothing to give the host an intrinsic size — so if the parent doesn't stretch the host, the host collapses to 0 and everything inside it disappears.

This is what made the vertical `ui-separator` invisible while the horizontal one worked:

- **Horizontal**, parent `flex flex-col`: Lynx's default `align-items: stretch` stretched the unstyled host to full width, so the inner view's `w-full` had a full-width host to resolve against. Visible.
- **Vertical**, parent `flex flex-row items-center`: `items-center` overrode the default stretch, so the unstyled host collapsed to 0 height (no content, not stretched), and the inner view had nothing to fill. Invisible — no amount of inner-view CSS (`h-full`, `self-stretch`) could fix it, because the _host_ was the collapsed element.

### The fix

For a zero-content component, put the sizing/styling on the **host element** so it _is_ the rendered element (one element, like shadcn's separator on the web) — don't nest a styled view inside an unstyled host:

```ts
@Component({
  selector: 'ui-separator',
  host: { '[class]': 'separatorClass()' }, // classes land on the actual flex item
  template: '', // no inner view to collapse into
})
export class UiSeparator {
  readonly userClass = input<string>('', { alias: 'class' }); // class input alias + host [class] coexist fine
  protected readonly separatorClass = computed(() =>
    cn(
      'bg-border',
      this.orientation() === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
    ),
  );
}
```

Use **`align-self: stretch`** (Tailwind `self-stretch`) for the vertical fill rather than `h-full`: a percentage height is less reliable on a flex item, whereas `align-self` stretches to the parent's cross axis directly and re-enables stretch even under `align-items: center`. (`align-self` is the same cross-axis lever as the "children stretch to fill" note above — `self-start` to hug, `self-stretch` to fill.)

---

## `<textarea>` placeholder does not hide under a programmatically-set value (iOS)

### What you'd expect (web)

A `<textarea>` (or `<input>`) hides its `placeholder` the moment it has a value — whether the value came from typing or was set programmatically. The two never render at once.

### What Lynx does

On **iOS**, the native textarea renders the placeholder as a **separate overlay `UITextView`**, not the field's own placeholder. That overlay's visibility is only recomputed inside `textViewDidChange:` (i.e. on user edits). Setting the initial value through the `setValue` UIMethod — which is the only way to set a Lynx textarea/input value (`__SetAttribute("value")` is a no-op; see `LynxTextarea`/`LynxInput` in `packages/runtime/src/lib/lynx-elements/input.ts`) — does not reliably hide that overlay, so the placeholder and the value render stacked on top of each other.

Android (native `EditText` `hint`) and web (native `<textarea>`) hide the placeholder automatically, so the bug is iOS-only. The root cause is in the vendored on-device runtime (`references/lynx/.../input/LynxUITextArea.m`), so it can't be fixed from the Angular side.

### The fix

Don't emit the `placeholder` attribute while a value is present — this matches web semantics and sidesteps the overlay on every platform:

```html
<textarea
  [attr.placeholder]="value() ? null : placeholder()"
  [value]="value()"
/>
```

(Applied in `packages/ui/src/lib/components/textarea/textarea.ts`. `UiInput` shares the same `setValue` mechanism, so apply the same guard there if a placeholder+value overlap shows up on a single-line field.)

---

## Keying a `Map`/`Set`/`WeakSet` on a native element ref crashes the main-thread engine (both the `<list>` callback AND the diff)

### What you'd expect (web)

`Map`, `Set`, and `WeakSet` methods (`.has()`, `.add()`, `.delete()`) are ordinary JavaScript and safe to call with any object key, from anywhere.

### What Lynx does

On the **main-thread "Lepus" QuickJS context**, element references returned by `__CreateElement` are **opaque native-backed objects**, not plain JS objects (see the FFI note above). Using one as a `Map`/`Set`/`WeakSet` **key** forces the engine to hash/compare it, and that **aborts the whole process (`SIGABRT`)**. Two abort signatures show up depending on the ref's state — both are the same root cause (a native ref used as a collection key):

- `js_map_has` → `LepusConvertToObjectCallBack` → `LEPUSValueHelper::ToJsValue` → `LEPUS_DupValue` → `CheckObjectCtx` — a cross-context / stale-ref abort.
- `js_map_has` → `map_find_record` → `js_strict_eq2` → `__JS_FreeValueRT` — a refcount assertion when the comparison frees a ref whose count is already bad.

This bit **three** separate sites on the `<list>` path; all had to be fixed:

1. **The `componentAtIndex` / `componentAtIndexes` callback.** Native calls these synchronously and re-entrantly from deep inside its own layout pass (`LinearLayoutManager::Fill` → `LayoutChunk` → `BindItemHolder` → `ComponentAtIndex`), via `CallLepusMethod`. Even a single `.has()` here crashes. This is **not** about stack depth or reentrancy: the same call scheduled from a fresh `setTimeout` macrotask (a shallow, top-of-message-loop stack) crashed identically.

2. **The NoneElement filter in `getUIChildren()`**, called by `_processUpdate` on **every** list update (add _and_ remove) during ordinary change detection. It did `nonElements.has(child.element)` on a `WeakSet` of element refs → `__JS_FreeValueRT` abort. Insidiously, the **initial render survived it** (the refcount abort is timing-sensitive), so the list rendered its seed items fine and only crashed on the first mutation — which looked like an add/remove bug rather than a filter bug.

3. **The diff that builds `update-list-info`** (`_processUpdate`). Building `new Set(children)` and calling `set.has(elementRef)` aborted with the `CheckObjectCtx` signature. This one only fired on **removal**: on the initial render and pure appends the diff only ever calls `.has()` against an **empty** Set, and QuickJS short-circuits an empty-set lookup without converting the key — so it hid until the first item was removed and the diff tested the just-removed, now-detached ref against a populated Set.

(Distinct from the background-thread iOS `Map`/`Set`/`WeakSet` polyfill note above — this is the main-thread Lepus engine, not JavaScriptCore. Plain property access and array indexing compile to different bytecode and are unaffected.)

### The fix

Never key a `Map`/`Set`/`WeakSet` on a native element ref anywhere on the list path. Three techniques, in `lynx-list-element.ts` / `create-list-element.ts` / `lynx-document.ts`:

- **Per-element flags** → store as a plain property on the `ElementRef`, not in a `WeakSet`:

```ts
// BAD — WeakSet.has() with an element key:
if (!this.#appended.has(child)) {
  __AppendElement(list, child);
  this.#appended.add(child);
}

// GOOD — plain property tag (ordinary field access, not a Map/Set call):
if ((child as { __appended?: boolean }).__appended !== true) {
  __AppendElement(list, child);
  (child as { __appended?: boolean }).__appended = true;
}
```

- **Classifying elements** (e.g. "is this a comment anchor?") → tag the JS wrapper, not the native ref. NoneElement anchors are marked `tagName === 'comment'` at creation and filtered on that string; the old `nonElements` WeakSet of element refs is gone entirely:

```ts
// BAD — WeakSet of element refs, queried per child on every update:
if (!this.#nonElements.has(child.element)) children.push(child.element);

// GOOD — read a string off the JS wrapper (no FFI object, no Map/Set):
if (child.tagName !== 'comment') children.push(child.element);
```

- **Identity for diffing / indexing** → use the element's **native unique ID (a plain number)**, never the element object. `componentAtIndex` indexes into a cached plain array; `_processUpdate` diffs a `Set<number>` of `__GetElementUniqueID(child)` values (and stores the previous update's IDs, so it never calls a native accessor on an already-removed element):

```ts
// BAD — Set keyed on element objects; set.has(ref) aborts on removal:
const newSet = new Set(newChildren);
if (!newSet.has(oldChildren[i])) removeAction.push(i);

// GOOD — Set of numbers; hashes directly, no conversion callback:
const newIds = newChildren.map((c) => __GetElementUniqueID(c));
const newIdSet = new Set(newIds);
if (!newIdSet.has(oldIds[i])) removeAction.push(i);
```

---

## `<list>` `componentAtIndex` must acknowledge with an `operationID`-tagged flush — `asyncFlush` loops forever

### What you'd expect (web)

The web list polyfill renders an item as soon as its element is appended; any subsequent flush is enough to make it appear.

### What Lynx does

Native `<list>` calls `componentAtIndex(list, listID, cellIndex, operationID)` and then **waits for a `__FlushElementTree` tagged with that same `operationID`** to consider the cell's binding complete:

```ts
const sign = __GetElementUniqueID(child);
__FlushElementTree(child, {
  triggerLayout: true,
  operationID,
  elementID: sign,
  listID,
});
return sign;
```

If you instead ack with `{ asyncFlush: true }` (untagged), native never matches an operation completion, leaves every cell perpetually in the "binding" state, and re-runs its layout pass forever — an **infinite `layoutComplete` loop** where `visibleItemAfterUpdate` stays `[]` and nothing is ever displayed (even though `scrollHeight` is computed correctly, so the list "knows" the items exist). `{ asyncFlush: true }` is only for the batch `componentAtIndexes` path, and only when the engine itself passes `asyncFlush: true`.

Despite running from inside the layout pass, the `operationID`-tagged flush is not dangerously re-entrant: native defers the operation's completion via the `operationID` queue rather than recursing back into `TickLayout`. This mirrors React Lynx's single-item `componentAtIndex` exactly (`references/lynx-stack-main/packages/react/runtime/src/snapshot/list/list.ts`, the `!enableBatchRender` branch).

### The fix

Ack each cell with `{ triggerLayout: true, operationID, elementID: sign, listID }`. See `create-list-element.ts`.

---

## Writing an empty `update-list-info` corrupts the native `<list>` state

### What you'd expect (web)

Resetting an attribute to empty arrays (`{ insertAction: [], removeAction: [], updateAction: [] }`) is a harmless no-op.

### What Lynx does

`<list>` items are managed by setting the `update-list-info` attribute to a computed diff and flushing. Native consumes that diff **once** during the flush (the list element is no longer dirty for the attribute afterward), so there is no need to "clear" it. Writing an **empty** `update-list-info` and flushing actively corrupts the native list's state: it leaves cells stuck in the "binding" state (the same infinite `layoutComplete` loop as the `asyncFlush` bug above) and causes intermittent crashes on subsequent updates that do carry items.

React Lynx never clears it either — `ListUpdateInfoRecording.flush()` (`.../snapshot/list/listUpdateInfo.ts`) only ever `__SetAttribute`s a computed, non-empty diff.

### The fix

Only ever set `update-list-info` to a computed, non-empty diff; skip the update entirely when the diff is empty. Never write an empty `update-list-info` "to reset it". See `lynx-list-element.ts` (`_processUpdate()`).

---

## Angular i18n (`i18n` / `$localize`) crashes with `Node is not defined` — the i18n runtime reads DOM `Node.*_NODE` constants

### What you'd expect (Angular web)

An `i18n` attribute or a `$localize` tagged string compiles to i18n op-codes that Angular's runtime applies at bootstrap. On the web these just work — the runtime creates the translated comment/text nodes through the renderer.

### What Lynx does

Angular's i18n op-code applier (`applyCreateOpCodes` / `applyMutableOpCodes` / `createNodeWithoutHydration` in `@angular/core`) does not ask the renderer what kind of node to make — it branches on the **DOM `Node` interface's node-type constants**:

```js
rNode = _locateOrCreateNode(
  lView,
  index,
  text,
  isComment ? Node.COMMENT_NODE : Node.TEXT_NODE,
);
// ...
switch (nodeType) {
  case Node.COMMENT_NODE:
    return createCommentNode(renderer, textOrName);
  case Node.TEXT_NODE:
    return createTextNode(renderer, textOrName);
  case Node.ELEMENT_NODE:
    return createElementNode(renderer, textOrName, null);
}
```

`Node` is a browser global. Lynx's PrimJS runtime has no DOM, so `Node` is undefined and the first op-code throws `ReferenceError: Node is not defined` from inside `ɵɵi18nStart`. The rejection is unhandled and aborts bootstrap **before anything paints** — the whole page is blank, not just the translated element. The crash frame (`applyCreateOpCodes` → `ɵɵi18nStart` → `ɵɵi18n`) points at i18n, but the real cause is a missing global, not anything translation-specific.

It is subtle because the constants are pure discriminators — once resolved, the op-codes call `renderer.createComment()` / `renderer.createText()`, which the Lynx renderer already implements (they back `@if`/`@for` anchors and `{{ }}` text). The only missing piece is the `Node` global itself.

### The fix

Polyfill a minimal `Node` **class** carrying the standard node-type constants, before Angular bootstraps. It ships as `preEntry` from `@blotch/rsbuild-plugin-angular-lynx` (`src/polyfills.js`) and defensively in the runtime (`packages/runtime/src/lib/runtime.ts`) for consumers not using the plugin — mirroring the existing `document` / `window` / `navigator` shims.

It **must be a class, not a plain object**: a few dev/debug paths in Angular do `x instanceof Node`, which throws if the right-hand side is not callable. As a class, `instanceof` returns `false` for Lynx elements (correct — they are not DOM nodes) while the constants resolve to their spec values. Both guards check `typeof Node === 'undefined'`, so the shim is a no-op in the web bundle where `Node` is real.

---

## `scrollIntoView` takes different param shapes on native vs web

### What you'd expect (web)

`element.scrollIntoView({ block: 'center', behavior: 'auto' })` — the DOM API takes a flat `ScrollIntoViewOptions` object. You'd assume the Lynx UI method mirrors it.

### What Lynx does

`scrollIntoView` is a base `LynxUI`/`LynxBaseUI` UI method. Invoked on **any** direct or indirect child of a scroll container, it walks up to the nearest `scroll-view` and scrolls that container. But each platform reads the invoke params from a different place:

- **Native (iOS/Android)** reads a **nested** `params.scrollIntoViewOptions.{block,inline,behavior}`. A flat `{ block }` is ignored and the view does not move.
- **Web** maps `invoke(el, 'scrollIntoView', params)` straight onto the DOM `el.scrollIntoView(params)`, so it reads the **top-level** `{ block, behavior }` and ignores a nested `scrollIntoViewOptions`.

Nothing warns when the wrong shape is sent — the element simply doesn't scroll, which reads as "the method isn't supported" rather than "the params are in the wrong place."

### The fix

Send **both** shapes in one call; each platform reads its own keys and ignores the rest:

```ts
element.invoke('scrollIntoView', {
  scrollIntoViewOptions: { block: 'center', behavior: 'auto' }, // native Lynx
  block: 'center',
  behavior: 'auto', // web (DOM ScrollIntoViewOptions)
});
```

Used by `ui-nav-drawer` to reveal the active route when the drawer opens.

Prefer `scrollIntoView` over index/offset-based `scroll-view` `scrollTo`. It targets the element itself, so it's immune to the `display:none` control-flow anchor `<view>`s Angular interleaves as `scroll-view` children for `@if`/`@for`. Those anchors shift child indices and corrupt any index-based scroll.

---

## Tailwind `ring-*` / `shadow-*` utilities render nothing — use an inline `box-shadow`

### What you'd expect (web)

`ring-2 ring-ring` paints a 2px focus ring; `shadow-md` drops an elevation shadow. Both are stock Tailwind utilities.

### What Lynx does

They render **nothing** — no ring, no shadow, no build error. Tailwind composes both through CSS variables: its `box-shadow` output is `var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)`. The Lynx tailwind preset (`packages/ui/src/lib/theme/tailwind-plugin.ts`) never defines those variables, so every reference falls back to its empty `0 0 #0000` default and the shadow is blank. The failure is silent — the web preview looks correct while the device shows a bare element.

### The fix

Write the shadow as an inline `box-shadow`, the one shadow form Lynx honors. Lynx supports the full syntax including the spread radius (`offset-x offset-y blur spread color`), so a focus ring is `0 0 0 2px <color>` — 2px spread, no offset or blur — and it follows the element's `border-radius`.

```html
<!-- one-shot focus ring (element's only inline style → per-key binding) -->
<view [style.box-shadow]="focused() ? '0 0 0 2px var(--ring)' : null" />

<!-- elevation shadow (static) -->
<view style="box-shadow: 0 2px 16px rgba(0, 0, 0, 0.15);" />
```

Color it with `var(--ring)` / `var(--destructive)`: `var()` resolves in inline styles on Lynx and tracks dark mode. Exemplars: `action-sheet`/`toast` (elevation), `input`/`textarea` (focus ring — see the faded pattern below).

### Fading a focus ring: animate opacity, not the shadow

`box-shadow` is `animatable: no` on Lynx, so `transition: box-shadow` is silently ignored and the ring snaps. The docs mark it non-animatable, and the core confirms it: `kBoxShadow` is left out of the transition validator (`IsValueValid()` in `core/animation/css_transition_manager.cc`), so the engine rejects it. `opacity` **is** animatable — so put the shadow on its own overlay layer and transition *that layer's* opacity:

```html
<view [class]="wrapperClass()">
  <!-- ring layer: FIRST child, fades via opacity -->
  <view
    class="absolute top-0 right-0 bottom-0 left-0 rounded-xl opacity-0"
    [style.transition]="'opacity 150ms ease'"
    [style.box-shadow]="ringShadow()"
    [style.opacity]="ringVisible() ? 1 : 0"
  ></view>
  <input ... />
</view>
```

Three Lynx-specific requirements make this render on-device:

- **A dedicated overlay layer.** Opacity on the wrapper would fade the input too. The shadow rides a separate sibling whose opacity is independent. Keep `ringShadow()` always set (never null) so the shadow stays painted while the layer fades out — drive visibility with opacity alone.
- **First child = painted behind.** Lynx paints in **source order**; positioned elements do *not* jump above in-flow siblings as on web. So the ring layer placed first stays behind the input, which keeps receiving taps — no `pointer-events` (it **errors the Lynx build**; see that entry). The overlay's outset shadow still shows because it spreads *outside* the wrapper.
- **Outset shadow only.** Lynx doesn't render `inset` box-shadows (see the inset entry), so the crisp "border" is an outset `0 0 0 1px` ring hugging the edge, layered under a softer `0 0 0 3px` ring — not a real inset border.

### Don't mix binding paths on one element

`[style.box-shadow]` routes through `__AddInlineStyle` (per-key); a whole-string `[style]="..."` routes through `__SetInlineStyles` (replaces all inline styles), so on one element a later whole-string set clobbers the per-key one. The overlay above keeps them apart: the ring layer carries only per-key `[style.*]` bindings, while `textarea`'s wrapper keeps its whole-string `[style]="wrapperStyle()"` (min/max-height). Because the ring is a separate child, the two never share an element.

---

## `setTimeout` invokes its callback with an empty object, not `undefined` — which crashes Angular's `@defer (on idle)`

### What you'd expect (web)

`setTimeout(cb)` calls `cb()` with no arguments (`arguments.length === 0`, first arg `undefined`). And `requestIdleCallback(cb)` exists and calls `cb(deadline)` with a real `IdleDeadline` (`{ didTimeout, timeRemaining() }`).

### What Lynx does

Two differences compound:

1. **No `requestIdleCallback`/`cancelIdleCallback`.** Neither exists as a global on any thread — a whole-tree search of the Lynx core returns nothing. Only `setTimeout`/`clearTimeout` are registered (as *global* functions on the main-thread Lepus context via `RegisterGlobalFunction`, and on the `lynx` object on the background thread).

2. **`setTimeout` passes an empty object to the callback.** The Lepus timed-task dispatcher invokes the stored callback with `Dictionary::Create()` — an empty `{}` — as its single argument (`core/runtime/lepus/tasks/lepus_callback_manager.cc`, `SetTimeTask`: `func->Execute({lepus::Value(lepus::Dictionary::Create())})`). So on Lynx `setTimeout(cb)` effectively calls `cb({})`, not `cb()`.

Together these crash Angular's `@defer (on idle)`. With no `requestIdleCallback`, Angular's `RequestIdleCallbackService` falls back to `cb => setTimeout(cb)`, then its `IdleScheduler` does:

```js
const callback = deadline => {
  for (const cb of bucket.queue) {
    cb(); this.applicationRef._tick(); /* … */
    if (deadline && deadline.timeRemaining() === 0 && !deadline.didTimeout) break;
  }
};
```

The `deadline` it receives is Lynx's empty `{}` — truthy, but with no `timeRemaining`. `deadline.timeRemaining()` is therefore a call on `undefined` → **`TypeError: not a function`**, crashing the main-thread frame the instant an `@defer (on idle)` block renders. It is **main-thread-only**: the web build has a genuine `requestIdleCallback` and never reaches the fallback, so the same demo runs in the browser preview but dies on-device.

### The fix

`runtime.ts` polyfills a matched `requestIdleCallback`/`cancelIdleCallback` pair (mapped to `setTimeout`/`clearTimeout`) that invokes the callback with a correctly-shaped `IdleDeadline` (`{ didTimeout: false, timeRemaining: () => 50 }`). This keeps Angular off the broken fallback entirely. **Both** must be defined, never just one: Angular reuses a single `typeof requestIdleCallback !== 'undefined'` guard to also select `cancelIdleCallback`, so a lone `requestIdleCallback` would make it bind an `undefined` cancel and crash the same way. Sits right after the existing `setTimeout`/`clearTimeout`/`requestAnimationFrame` polyfills so both are resolvable on either thread. React Lynx never hit this because it has no equivalent of Angular's `@defer (on idle)`.

## `@font-face` fonts fail to load with "unsupported URL" — CSS `url()` assets get an unfetchable `webpack://` scheme

### What you'd expect (web)

A custom font registered in a stylesheet loads and renders:

```css
@font-face {
  font-family: 'Roboto';
  src: url('./assets/fonts/Roboto-Light.ttf') format('truetype');
}
```

The bundler emits the `.ttf` as a static asset and rewrites the `url()` to a real, fetchable path (e.g. `/static/font/Roboto-Light.<hash>.ttf`), resolved against the page origin.

### What Lynx does

On-device the font never loads and the runtime logs:

```
Load font with genericResourceFetcher Failed: Error Domain=NSURLErrorDomain
Code=-1002 "unsupported URL" …
NSErrorFailingURLStringKey=webpack:///static/font/Roboto-Light.<hash>.ttf
```

`NSURLErrorDomain -1002` is **"unsupported URL"**, not a network failure — iOS rejected the URL scheme outright and never made a request. (So this is *not* a firewall/connectivity problem; a blocked network yields a timeout, `-1001`/`-1004`/`-1009`.)

The culprit is the scheme: `webpack:///static/font/…`. Assets referenced from CSS `url()` are resolved by `@lynx-js/css-extract-webpack-plugin`'s child compilation, which hardcodes `const BASE_URI = 'webpack://'` (`lib/loader.js`) and does **not** inherit the runtime `publicPath`. Every `url()` gets joined against that base, so the extracted CSS bakes in an absolute `webpack:///static/font/<name>.<hash>.ttf`.

That URL is absolute — it carries the `webpack://` scheme — so Lynx never re-resolves it against the bundle origin.

**Images work precisely because they stay relative.** A JS-imported `<image src>` resolves through the *main* compilation as `__webpack_require__.p + "static/image/…"`, producing a root-relative `/static/image/…`. Lynx resolves that against the bundle's loading origin, so it fetches. Fonts never take this path.

`output.dataUriLimit` does **not** help. The css-loader `url()` request matches the font rule's `?__inline=false` `asset/resource` branch before the size threshold is ever consulted, so raising the limit changes nothing.

### The fix

Force `@font-face` fonts to inline as Base64 data URIs on the Lynx target (`packages/rsbuild-plugin-angular-lynx/src/css.ts`, in `applyCSS`):

```ts
if (environment.name === 'lynx' && chain.module.rules.has(CHAIN_ID.RULE.FONT)) {
  const fontRule = chain.module.rule(CHAIN_ID.RULE.FONT);
  fontRule.oneOfs.clear();        // drop the asset/resource + ?url/?inline/?raw branches
  fontRule.type('asset/inline');  // inline every matched font, ignoring any css-loader query
}
```

A data URI is absolute, so it survives the `webpack://` base-URI join untouched. It needs no `publicPath`, no network fetch, and no host font loader — exactly what the [Lynx `@font-face` docs](https://lynxjs.org/api/css/at-rule/font-face) recommend ("Base64-encoded fonts").

The `environment.name === 'lynx'` guard keeps the change Lynx-only. The **web preview bundle keeps the same broken `webpack:///` font URLs**; its ideal fix is a correct `publicPath` serving fonts over HTTP, not inlining, which would bloat the browser bundle. React Lynx never hit this — it has no equivalent global-stylesheet `@font-face` build path.

## Indented template text renders with a leading space — Angular collapses whitespace but never trims it, and Lynx has no line-box trimming

### What you'd expect (web)

Prose written across indented lines renders flush, with no leading or trailing space:

```html
<text>
  Hello world
</text>
```

renders as `Hello world`.

### What Lynx does

On-device the text renders with a stray leading space — a visible indent: ` Hello world`.

Angular's template compiler (`preserveWhitespaces: false`, the default) collapses each run of whitespace to a single space. But it does **not** trim the single leading/trailing space left against the element boundary, so the snippet above reaches the renderer as `" Hello world "`. On the web that edge space is invisible — the CSS white-space model strips whitespace at the start and end of a line box. Lynx's `raw-text` has no such layout-time collapsing and renders the string verbatim, so the leading space shows up.

React Lynx never hits this. Its JSX transform strips newline-adjacent whitespace at compile time — more aggressively than Angular's collapse-only pass — so the runtime never sees the edge space. That's why clean multi-line JSX works there but the identical Angular template did not.

### The fix

Two layers, because the correct trim depends on a run's POSITION and the renderer only sees one text node at a time.

First, the renderer only **collapses** whitespace runs to a single space, without trimming — `collapseWhitespace` in `packages/runtime/src/lib/renderer/renderer.ts`, applied in `createText` (static text) and `setValue` (interpolations). ASCII whitespace only, so a deliberate non-breaking space (U+00A0) survives as an escape hatch.

Then a flush-time pass trims positionally over the assembled tree: `processPendingTextNormalization` in `packages/runtime/src/lib/lynx-element/lynx-element.ts`, drained from `LynxRendererFactory2.end()` right after removals and before `__FlushElementTree()` (and from `scheduleSettleFlush` for out-of-cycle content). For each text touched this cycle it resolves to the outermost `<text>` — a nested `<text>` is inline, sharing one inline-formatting-context with the surrounding raw-text like an HTML `<span>`. It then collects the raw-text leaves in document order and:

- strips the leading space of the FIRST leaf and the trailing space of the LAST;
- collapses a space shared across a run boundary to one;
- preserves the spaces BETWEEN runs.

A single-run text (ordinary prose) reduces to trim-both. Multiple runs — `<text>One </text><text>two</text><text> three</text>`, and the same shape assembled at runtime through `<ng-content>` projection — keep their inter-run spaces, so "One two three" no longer collapses to "Onetwothree". Deferring to flush is what makes the projection case work at all: the runs come from separate templates and only form one context once assembled, so no compile-time pass can see it.

Each raw-text stashes its collapsed-but-untrimmed value (`#rawText`) so the pass can RESTORE an edge space when a run's position changes (e.g. it stops being the last run) — the displayed `#text` alone has already dropped it.

Remaining gaps, both rare: an inline **non-text** element (`<image>` / inline `<view>`) at a context edge can leave an adjacent space untrimmed, and `white-space: pre` is not honored (native Lynx does not support it anyway).

Because AngularLynx trims, templates can be written naturally (`<text>\n  Hello\n</text>`) instead of the dangling-`>` workaround that hugs text to kill the whitespace (`<text\n  >Hello</text\n>`).

---

## Adding/removing elements inside a gesture worklet callback risks a native crash — keep the element count fixed during a live gesture

### What you'd expect (web)

A `pointermove`/drag handler can freely mutate the DOM — add rows, remove nodes, re-render a list — and the browser just repaints. There's no penalty for changing the *number* of elements mid-gesture.

### What Lynx does

Gesture callbacks (`PanGesture`/`PinchGesture` `onUpdate`, etc.) run on the **main thread inside a Lynx worklet**. Mutating the element *tree* from that context — inserting or removing native elements — is the same dangerous path that crashes when navigating from a native event callback (see `App.navigateTo()` in `kitchen-sink-app`, which defers router navigation with `setTimeout(…, 0)` for exactly this reason). Changing an element's *style* is fine; changing which elements *exist* is not.

This bites charts specifically. `UiCartesianChart` draws gridlines and axis labels with `@for (tick of ticks())`. If a pinch/pan recomputed the tick *values* live and the count changed (e.g. a "nice numbers in the visible window" algorithm yields 5 ticks at one zoom and 6 at the next), the `@for` would add/remove `<view>`/`<text>` nodes on a gesture frame — a tree mutation inside the worklet.

### The fix

When zoom is enabled, generate a **fixed** number of ticks (`generateTicks(visibleDomain, tickCount)` returns exactly `tickCount` values) so the gridline/label `@for` length never changes during a gesture — every zoom frame only restyles the existing nodes (new `top`/`left`/label text), never adds or removes them. The trade-off is that a zoomable chart's ticks are evenly spaced rather than "nice round" numbers; a non-zoomable chart keeps the original nice-tick behavior. See `#resolvedXTicks`/`#resolvedYTicks` in `packages/ui/src/lib/components/cartesian-chart/cartesian-chart.ts`.

The same principle applies to the pan/zoom transform itself: it only ever writes the visible-window signals, which drive the scales and thus restyle existing gridlines, labels, and series marks — the marks re-project (and bars/candles stretch, since their width comes from projected pixel spacing) without any node being created or destroyed.

---

## A continuous gesture's `onStart`/`onEnd` silently never fire unless `onBegin` is ALSO registered — breaking any handler that snapshots state at gesture-start

### What you'd expect (web / react-native-gesture-handler)

Registering `onStart`, `onUpdate`, and `onEnd` on a pan is enough — `onStart` fires once when the gesture is recognized, `onUpdate` fires every frame, `onEnd` fires on release. `onBegin` (finger-down, before the gesture is recognized) is a separate, optional lifecycle hook you only add if you need it.

### What Lynx does

**Both iOS and Android gate `onStart` (and `onEnd`) behind `onBegin` having already fired** — and `onBegin` itself is a no-op unless a JS `onBegin` callback was registered:

- iOS `LynxPanGestureHandler.m`: `onStart:` returns early if `!_isInvokedBegin`; `onEnd:` returns early on the same flag. `_isInvokedBegin` is set **only** inside `onBegin:`, which itself returns early unless `[self onBeginEnabled]` — an enable flag that defaults `NO` and is flipped on only when `onBegin` is in the JS callback list (`handleEnableGestureCallback:`).
- Android `PanGestureHandler.java` mirrors this exactly: `onStart()` checks `!mIsInvokedBegin` (line 187), `mIsInvokedBegin` is set only in `onBegin()` (line 172), gated by `isOnBeginEnable()`.

So: register `onStart`/`onUpdate`/`onEnd` but not `onBegin`, and on-device **`onStart` and `onEnd` never fire — with no error, no warning, no log.** `onUpdate` fires normally (it has no such gate), so the gesture *looks* alive — it just never announces its start or end.

**Concrete symptom:** a pan handler that snapshots state in `onStart` (e.g. "remember the value at gesture-start, then apply cumulative `event.translationX` against it in `onUpdate`") never takes that snapshot. If `onUpdate` then falls back to reading *current* state instead of the missing snapshot, the transform is applied against a value that already moved last frame — the effect compounds every frame instead of tracking the finger 1:1. On a chart, this reads as "the pan doesn't move the same distance as the finger, like it's anchored to the middle and applying translation relative to a fixed origin" — a diagnosis that first looks like a coordinate-system bug (page vs. client vs. element-relative), but is actually a dropped lifecycle callback. See `UiCartesianChart`'s `#pan` gesture in `cartesian-chart.ts`.

### The fix

Always register `onBegin` on a continuous gesture (`PanGesture`/`PinchGesture`/`RotationGesture`/`FlingGesture`) if you register `onStart` or `onEnd` — even an empty callback is enough to flip the native enable flag:

```ts
new PanGesture()
  .onBegin(() => { /* snapshot start-of-gesture state HERE, not onStart */ })
  .onStart(() => { /* fallback anchor: ??= so it's a no-op if onBegin already ran */ })
  .onUpdate((event) => { /* apply cumulative event.translationX/Y against the snapshot */ })
  .onEnd(() => { /* clear the snapshot */ });
```

Belt-and-suspenders: also anchor defensively on the first `onUpdate` (`snapshot ??= currentValue`) so a platform that somehow skips both `onBegin` and `onStart` still can't compound — it just anchors one frame later.

### Related: `PinchGesture` and `RotationGesture` have no native handler on ANY platform — they never fire

A search of the Lynx native source (`convertToGestureHandler` in `LynxBaseGestureHandler.m` / the Android equivalent) shows handlers registered for `pan`, `default`, `fling`, `tap`, `longpress`, and `native` — but **no pinch and no rotation handler exists on iOS, Android, or Harmony**. `Gesture.Simultaneous(pan, pinch)` is safe to compose (the native engine just never recognizes the pinch half), but don't rely on pinch-to-zoom actually firing on-device today; drive zoom from 1-finger pan plus on-screen controls instead, and treat `PinchGesture`/`RotationGesture` as forward-compatible API surface, not a currently-working feature.

---

## Injected BOM globals shadow the `globalThis` polyfills, so Angular's `ImagePerformanceWarning` crashes web-only bootstrap

The web preview crashes at bootstrap with `NG0210: The document object is not available in this context` (from `ImagePerformanceWarning.start` → `getDocument`), while iOS/Android run fine. Two facts combine.

### What you'd expect (web / native parity)

The renderer polyfills `globalThis.document` / `globalThis.window` at startup (see the browser-globals entries above), so any Angular code that reaches for `document` gets the stub on every platform. A dev-only diagnostic like Angular's `ImagePerformanceWarning` (it scans the page for oversized `<img>`) should be a harmless no-op on Lynx.

### What Lynx does

**(1) The background bundle's BOM globals are injected as function parameters, which shadow `globalThis`.** `RuntimeWrapperWebpackPlugin` wraps the background-thread script in an AMD module whose signature injects the BOM as *parameters* (`defaultInjectVars`):

```js
tt.define("main.js", function(require, module, exports, /* … */ window, document, location, navigator, history, /* … */) {
  // ← the entire app-service.js (polyfills + Angular) runs in here
});
```

So inside the bundle a bare `document` resolves to that **parameter**, not `globalThis.document`. On the web background thread (a real Web Worker) the Lynx web runtime passes `undefined` for `document`/`window` — a worker has no DOM. The startup polyfills (`packages/rsbuild-plugin-angular-lynx/src/polyfills.js`, plus the defensive copy in `runtime.ts`) run `globalThis.document = { … }` under a `typeof document === 'undefined'` guard. The guard reads the undefined *parameter* (true), so the assignment fires — but it sets a *global property* and never rebinds the shadowing local param. Net result: `globalThis.document` is a stub, while the bare `document` that bundle code sees stays `undefined`.

Angular's **internal** `getDocument()` (`_debug_node-chunk.mjs`) reads the module-level `DOCUMENT` var (unset), then the bare `document` identifier (the undefined param), then throws `NG0210`. This is why the `globalThis.document` shim looks like it should help but can't: most Angular DOM access goes through the DI `DOCUMENT` token (`provideRenderer` supplies `{}`), so it never touches the shadowed global — but a few Angular internals call the raw `getDocument()` instead. (The polyfills' own `catch` comment, "Read-only in Web Worker — document already exists", is doubly wrong: a worker has no `document` at all, and even when the assignment succeeds it targets the wrong binding.)

**(2) `ImagePerformanceWarning.start()` runs on web but early-returns on native.** It's an app-bootstrap listener gated on `typeof PerformanceObserver === 'undefined'`. The native background-thread engine (PrimJS) has no `PerformanceObserver`, so `start()` returns *before* calling `getDocument()` — iOS never crashes. A Web Worker *does* have `PerformanceObserver`, so on web `start()` proceeds into `getDocument()`, hits the undefined `document` param → NG0210 → the bootstrap promise rejects → nothing renders.

Because iOS and web run the **same** bundle with the **same** undefined `document` param, and iOS works, the only real divergence is that one `PerformanceObserver` gate — nothing on the normal render path reads the bare `document`.

### The fix

Disable `ImagePerformanceWarning` in `provideRenderer()` (`packages/runtime/src/lib/renderer/providers.ts`) by providing `IMAGE_CONFIG` with **both** warnings off — `start()` only early-returns when both flags are set, so both are required:

```ts
{ provide: IMAGE_CONFIG, useValue: { disableImageSizeWarning: true, disableImageLazyLoadWarning: true } }
```

This makes web's document-access path identical to iOS's (which already never reached `getDocument()`), so it is zero-risk on native — and it's semantically correct: Lynx renders native `<image>`, not HTML `<img>`, and has no LCP, so the diagnostic can never apply. Covered by `providers.spec.ts`.

Still-latent hazard: any *other* Angular internal that reads the bare `document`/`window` (instead of the DI `DOCUMENT` token) on the normal path would hit the same shadowed-undefined param on both platforms. None do today. A more general fix would be `ɵsetDocument(stub)` — it sets the module-level `DOCUMENT` var `getDocument()` checks first, bypassing the shadowed global — deliberately avoided for now because it mutates Angular global state on every platform, changing native behavior for no current benefit.

---

## web-core does NOT implicitly flush after `renderPage`, so the first render must be flushed explicitly — otherwise every web app is blank

After the `ImagePerformanceWarning` crash above is fixed, Angular bootstraps cleanly on both threads on web (you see two "Angular is running in development mode" logs, no errors) — yet the screen stays blank. `<lynx-view>` is `display:none` and the page is never attached to the DOM.

### What you'd expect (web / native parity)

Whatever the framework renders during bootstrap appears on screen once bootstrap finishes, on every platform.

### What Lynx does

The renderer **skips the first `__FlushElementTree()`** on purpose. `LynxRendererFactory2.end()` gates it: `if (!isFirstRenderPending()) __FlushElementTree()`. The reasoning (see `lynx-render-lifecycle.ts`) is that every change-detection cycle during bootstrap is still nested inside the native engine's `renderPage()` call, and driving a layout-triggering flush there re-enters a `<list>`'s `componentAtIndex`. Skipping is safe **on native** because *"the native engine performs its own implicit flush once `renderPage()` returns."*

`@lynx-js/web-core` has **no such implicit flush**. Worse, web-core's first-paint side effects live *inside* `__FlushElementTree` — its main-thread `createElementAPI` does, on the first flush where `page && !page.parentNode`:

```js
rootDom.appendChild(page);          // attach the page to the DOM
rootDom.host.style.display = 'flex'; // reveal <lynx-view> (its base CSS is display:none)
```

So with the first flush skipped and no implicit web-core flush, the page is never attached and `<lynx-view>` stays `display:none`. Every app renders blank — until some *later* CD cycle (a tap, a signal change) happens to flush and reveal it. Static screens never get that, so they stay blank forever. `<lynx-view>`'s base rule really is `display:none` (revealed only by `[ssr]` in CSS, or by that `style.display='flex'` line at runtime), which is why the whole view — not just its contents — is invisible.

### The fix

Force one explicit flush after bootstrap, **web-only**. In `bootstrapApplication` (`runtime.ts`), after `markFirstRenderComplete()`:

```ts
if (__WEB__ && __MAIN_THREAD__ && !wasHydrating) {
  setTimeout(() => __FlushElementTree(), 0);
}
```

- **`__WEB__`** is a compile-time define (`environment.name === 'web'`, injected by the rsbuild plugin's `DefinePlugin`). It's `false` on native, so the whole block is **dead-code-eliminated from native bundles** — native's implicit-flush timing is untouched (verified: the `setTimeout(()=>__FlushElementTree(),0)` appears in the web main-thread chunk and is absent from `main.lynx.bundle`).
- **`setTimeout` (macrotask)** defers the flush until after web-core's `renderPage` frame unwinds — the same safe context `runAfterFirstRender` uses for a `<list>`'s first update, so it can't re-enter `componentAtIndex` mid-`renderPage`.
- **`!wasHydrating`** skips it during SSR hydration, where the snapshot tree already exists and web-core shows the view via its `[ssr]` CSS attribute.

This was masked until now: the `ImagePerformanceWarning` crash aborted bootstrap before anything could render, so the missing first flush only became visible once that crash was fixed. Covered by the `__WEB__` define tests in `angular-webpack-plugin.spec.ts`.

> **Accessing the web preview:** web-core uses `SharedArrayBuffer` + `Atomics.wait` for synchronous native-module calls, which needs `crossOriginIsolated` — i.e. COOP + COEP headers (the dev server sends both) **and** a trustworthy origin. Load the preview over `http://localhost:<port>` or HTTPS, **not** a LAN IP; on a plain-HTTP LAN IP the browser ignores COOP ("origin untrustworthy"), `SharedArrayBuffer` is `undefined`, and the first synchronous native call throws. This is an access-time requirement, not a code fix.

## `crypto.randomUUID is not a function` on web — the preview is on an insecure origin, not a code bug

Once the app actually starts rendering on web (after the first-flush fix above), web-core throws during startup:

```
Uncaught TypeError: crypto.randomUUID is not a function
    at lX.init (kwift.CHROME.js:1:416864)
    at ps._orderHandlerRegistration (kwift.CHROME.js:149:8798)
    ...
    at vendors.js:1:95
```

### What you'd expect (web / native parity)

`crypto` is a standard global; `crypto.randomUUID()` should be callable anywhere `crypto` exists.

### What Lynx does

`kwift.CHROME.js` is Lynx's **prebuilt web engine** — it is *not* in our dependency tree (nothing under `node_modules/@lynx-js/**` references `kwift` or `randomUUID`); web-core fetches it at runtime and evaluates it **inside the background Web Worker** it spawns:

```js
// @lynx-js/web-core/dist/client/mainthread/Background.js
new Worker(new URL('../background/index.js', import.meta.url), { type: 'module', name: 'lynx-bg' })
```

During handler registration the engine calls `crypto.randomUUID()`. The catch: **`crypto.randomUUID()` is a secure-context-only Web API.** On an insecure origin the `crypto` object still exists (so `crypto.getRandomValues` works) but `crypto.randomUUID` is simply `undefined` — hence "is not a function", not "crypto is undefined". A Web Worker is a secure context **only if the page that created it is** (the worker URL is same-origin here), so opening the "Network" `http://<LAN-IP>:<port>` URL the dev server prints makes the engine crash the moment it inits.

This is the **same root cause** as the `SharedArrayBuffer`/`crossOriginIsolated` note above — an insecure origin — just a different symptom that trips first (engine init happens before any synchronous native call).

### The fix

**Open the preview from a secure context.** `http://localhost:<port>` and `http://127.0.0.1:<port>` always qualify; any HTTPS origin does too. Do **not** use the LAN IP URL for the *browser* preview (the QR / on-device flow is unaffected — LynxExplorer loads the native `.lynx.bundle`, not the browser page).

There is **no code polyfill** for this: the engine is Lynx's own code, it runs before ours in web-core's worker, and we don't control that worker's entry — so nothing we ship can define `crypto.randomUUID` in time. What we *can* do is fail loudly instead of cryptically. `runtime.ts` emits an actionable, **web-only** (`__WEB__`-gated, DCE'd from native) console error when `globalThis.isSecureContext === false`, pointing the developer at the localhost URL rather than leaving them with a stack trace inside `kwift.CHROME.js`.

---

## Paint order is source order on Lynx, but CSS stacking on web — a `position: absolute` sibling paints above a static one regardless of source order

### What you'd expect (Lynx)

Lynx paints sibling elements in **strict source order**: a later child always paints on top of (and hit-tests before) an earlier child, no matter their `position`. This gives a simple way to layer a decorative overlay *behind* an interactive element. Put the overlay **first** in source order and the interactive element **after** it. The interactive element then sits on top and stays tappable — no `z-index`, and no `pointer-events` (which errors the Lynx build anyway; see above).

### What web does

On web this is governed by **CSS stacking rules**, not source order. Within a stacking context the paint groups are, low to high: non-positioned in-flow content → positioned elements with `z-index: auto`/`0` → positive `z-index`. A `position: absolute` sibling (even with no `z-index`) is a *positioned* element, so it paints **above** a *static* (non-positioned) sibling **regardless of source order**.

So the "overlay first, interactive element after" layout inverts on web. A transparent `position: absolute` overlay placed before a static `<input>` paints **on top of** the input and **swallows every pointer event** — the input never focuses, and you can't type. The symptom: a field that renders and looks fine but is dead to clicks on web, while working perfectly on iOS/Android.

This bit the Dolan `ui-input` and `ui-textarea` focus ring: the ring is a transparent `position: absolute` overlay layer (its own layer so its opacity can animate — `box-shadow` isn't animatable on Lynx), deliberately placed as the **first** child so Lynx paints the input over it. On web that same overlay covered the input.

### The fix

Give the interactive element an explicit stacking elevation so it sits above the overlay on **both** platforms:

```html
<view>                                             <!-- wrapper -->
  <view class="absolute inset-0" .../>             <!-- decorative overlay, first child -->
  <input style="position: relative; z-index: 1;" ... />  <!-- interactive, elevated -->
</view>
```

`position: relative; z-index: 1` is **redundant on Lynx** (source order already keeps the input on top) but **required on web** (it moves the input into the positive-`z-index` paint group, above the `z-index: auto` overlay). Both properties are needed: `z-index` only applies to a *positioned* element, so `position: relative` is what makes the `z-index` take effect. Lynx's CSS encoder accepts both (unlike `pointer-events`), so the one declaration is safe cross-platform.

Do **not** try to fix this by moving the overlay *after* the input in source order — that would put the overlay on top on Lynx (breaking the platform where it currently works) to fix web. Elevate the input instead; it satisfies both painting models at once.

---

## `position: sticky` works in a `scroll-view`, but the pinned header hides behind later rows without a `z-index`

### What you'd expect (web)

A `position: sticky; top: 0` header pins to the top of a scroll container and stays visible above the rows scrolling under it. You rarely need a `z-index` — the rows are normal-flow (static) content, which always paints below a positioned element.

### What Lynx does

Sticky positioning itself works: the header pins to the top of the `<scroll-view>` and hands off to the next group's header. But the pinned header paints **behind** the rows scrolling past it, so its label disappears under the content — it looks like sticky is broken.

Lynx web sets `position: relative` on **every** `<view>` (its `linear.css` base rule). That makes the rows *positioned* siblings. Among positioned siblings with `z-index: auto`, paint order is source order, so each row — which follows the header in the DOM — paints over it. This is the same painting-model difference as the section above; every view being `position: relative` is what makes it bite sticky headers specifically.

Native is unaffected: the compositor layers the sticky child correctly, and `flatten="false"` (already required for sticky on Android) gives it its own layer.

The bug also stays hidden until the list overflows. With little content the `<scroll-view>` never scrolls and nothing pins, so headers can look fine on a tall desktop window yet fail on a short or mobile viewport.

### The fix

Elevate the sticky header with a `z-index` **on web only**, gating it on the `__WEB__` compile-time define:

```html
<view class="bg-zinc-100 px-4 py-1.5 sticky top-0" [class.z-10]="isWeb" [flatten]="false">
  <text>{{ group.letter }}</text>
</view>
```

```ts
// __WEB__ is a compile-time define: true on web, false on native.
readonly isWeb = __WEB__;
```

The `z-index` must **not** apply on native. There, a `z-index` on a sticky scroll-view child promotes it out of the scroll content and freezes it like `position: fixed` — the header stops scrolling entirely. So the elevation is web-only: it fixes the web paint order without touching native, where sticky already works. Elevate the header rather than reordering source — Lynx makes every view positioned, so source order alone won't keep it on top (exemplar: `examples/contact-list`).
