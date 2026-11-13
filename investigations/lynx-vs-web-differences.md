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

It has to be set **before Android first draws the element**: turning `flatten` off afterwards doesn't give an already-flattened element a View of its own. The directive used to set it in `ngOnChanges`, together with the gesture, and on the Android emulator that was too late in two cases, where the gesture then never fired, with no error:

- a gesture bound after the first render (`[lynxGesture]="on() ? pan : []"`): the element's `onUpdate` never ran, and the same element with a static `flatten="false"` worked;
- every gesture in a routed component (a lazy route's page), while the same component rendered directly in the root worked.

The directive now sets it in its constructor, when the element is created (issue #56).

**(3) The event payload is a nested envelope, and Lynx gives position — never translation.** Once callbacks fire, the object handed to them is `{ type, timestamp, target, currentTarget, params: {...}, detail: {...} }` (built by `GetCustomEventParam`), where the data lives under `params`. Critically, the iOS handlers (`LynxPanGestureHandler` / `LynxBaseGestureHandler`) populate `params` with the finger's **position** — `x`/`y` (element-relative), `pageX`/`pageY` (page-relative), `clientX`/`clientY` — plus `scrollX`/`scrollY`, which are the gesture member's **scroll offset** (0 for a non-scrolling `<view>`), NOT the drag distance. There is **no** native `translationX`/`translationY`. So a react-native-gesture-handler-style handler reading `event.translationX` gets `undefined` → `NaN`; and naively aliasing it to `scrollX` gives `0` forever (a static view never scrolls). Accumulated translation has to be computed by the framework.

### The fix

1. `@blotch/rsbuild-plugin-angular-lynx` defaults `enableNewGesture` to **`true`** (unlike React Lynx, which defaults it `false` to keep its legacy gesture system — AngularLynx has no legacy gesture path, so nothing to preserve). Override only to explicitly disable: `pluginAngularLynx({ enableNewGesture: false })`.
2. `LynxGestureDetector` wraps each callback as `{ _fn: (event) => … }` so it lands in `lepus_object_`, and `runtime.ts`'s `runWorklet` unwraps `_fn` and calls it. (Events registered via `__AddEvent` are a _different_ native path that does accept raw functions — which is why events worked but gestures didn't, obscuring the asymmetry.)
3. `mapGestureEvent` (`gesture/event.ts`) adapts the native envelope into AngularLynx's flat event: it spreads `params` (so every native field stays reachable, incl. `x`/`y`, pinch `scale`, rotation `rotation`, `isAtStart`/`isAtEnd`), keeps raw `params` as an escape hatch, maps `pageX`/`pageY`→`absoluteX`/`absoluteY`, and **derives** `translationX`/`translationY` by anchoring a per-gesture origin (`createGestureOrigin`, held by the directive) where the touch began and subtracting. The anchor is `onBegin`, which the directive registers on every continuous gesture (see the `onBegin` entry below), so a pan's translation at `onStart` includes the distance moved before it activated; other gestures anchor on their first event and reset on `onEnd`. This reproduces react-native-gesture-handler's translation semantics on top of Lynx's position-only events.

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

1. **Always send a full default config.** `TapGesture` / `LongPressGesture` / `PanGesture` seed the complete default set into `_config` on construction (`gesture/const.ts`), so a partial config can never zero a native key. This mirrors Lynx's own gesture-runtime, which seeds defaults for the same reason. Every other gesture starts from `BaseGesture`'s `{ enabled: true }`, as in the gesture-runtime. Fling, pinch and rotation have nothing to zero today: Lynx 4.1's fling handlers ignore their config (iOS `handleConfigMap` is a TODO, Android's is empty), and pinch and rotation have no handler (see the next entry).
2. **`onEnd` normalized for discrete gestures.** `LynxGestureDetector` (`gesture/gesture-detector.ts`) observes `onStart` — registering its own observer when you didn't — to learn whether a tap/long-press was recognized, then drops the failed-gesture `onEnd`. `onEnd` now means "the gesture happened", matching react-native-gesture-handler. Continuous gestures (pan/fling/rotation/pinch) pass through unchanged.
3. **`numberOfTaps` documented as a no-op.** Kept on `TapGesture` for API parity, with a JSDoc warning. For a double-tap, time taps in your own callback.

---

## Lynx's native gesture handlers read only five config keys, ignore `enabled`, and report no velocity

### What you'd expect (web / react-native-gesture-handler)

Every option on a gesture class does something: `enabled(false)` turns the gesture off, `activeOffsetX` and `failOffsetY` shape when a pan activates or fails, `direction` limits a fling, and pan and fling events carry `velocityX`/`velocityY`.

### What Lynx does

Lynx passes the config object from `__SetGestureDetector` straight to the platform handlers (`renderer_functions.cc InnerCreateGestureDetector`), and as of Lynx 4.1 they read only these keys (`objectForKey:` in `platform/darwin/ios/lynx/gesture/*.m`, `config.get*` in Android's `gesture/handler/*.java`):

| Gesture    | Keys read                    |
| ---------- | ---------------------------- |
| Tap        | `maxDuration`, `maxDistance` |
| Long press | `minDuration`, `maxDistance` |
| Pan        | `minDistance`                |
| Fling      | none                         |

Nothing reads `enabled`, so a gesture set to `enabled(false)` still fires: verified on the iOS Simulator and the Android emulator in Lynx Explorer 4.1, where a disabled pan's `onUpdate` ran on every move. A pan's `activeOffsetX/Y`, `failOffsetX/Y`, `minPointers` and `maxPointers`, a fling's `direction` and `numberOfPointers`, and a tap's `numberOfTaps` (see above) are all sent and ignored. React Lynx's gesture-runtime declares the same options and has the same gap.

The events carry no velocity. A pan's params are `clientX`, `clientY`, `pageX`, `pageY`, `x`, `y`, `scrollX`, `scrollY`, `isAtStart`, `isAtEnd` and `type`; a fling's are `deltaX`, `deltaY`, `scrollX`, `scrollY`, `isAtStart` and `isAtEnd` (both read from the events on both platforms). So `PanGestureEvent.velocityX` and `FlingGestureEvent.velocityX` are `undefined`.

### The fix

None in the runtime yet: the options are kept for API parity, with TSDoc warnings, and the gesture types docs list which ones work (`/api/gestures/gesture-types#options-lynx-doesnt-read-yet`). To turn a gesture off, unbind it from `[lynxGesture]`; to cede a drag to a scroll view, call `fail()` from `onUpdate`.

---

## A fling is the momentum after a drag: it needs a pan on the same element, and never fires `onStart`

### What you'd expect (web / react-native-gesture-handler)

A fling gesture recognizes a quick swipe on its own, fires `onStart` when it's recognized and `onEnd` when it's done.

### What Lynx does

Lynx's fling is the scroll-style momentum that follows a drag (`LynxFlingGestureHandler.m`, `FlingGestureHandler.java`, driven by `LynxGestureHandlerTrigger`'s fling trigger):

- **While the finger is down, a fling ignores the touch.** On touch-up the trigger measures the velocity and flings only the arena's winner (`if (_winner && [_flinger startWithVelocity:velocity])`). A fling alone never wins the touch, so on a plain `<view>` it fires only when some earlier gesture left a winner behind: in Lynx Explorer it fired on one run and not on others. With a pan on the same element (`Gesture.Simultaneous(pan, fling)`) the element wins the touch and flings every time.
- **`onStart` never fires after a touch.** On touch-up the handler calls `begin` and `onBegin`, which moves it to BEGAN. Each fling frame then reaches `onHandle` with the handler already BEGAN, and only the INIT or UNDETERMINED state leads to `activate` and `onStart`, so every frame goes to `onUpdate`. When the momentum runs out (or the release was too slow to fling) the handler calls `fail` and `onEnd`.
- **`onUpdate` carries `deltaX`/`deltaY`**, the distance since the last frame, not positions. Verified on both platforms: a quick swipe gave 240 updates on iOS and 36 on Android, then one `onEnd`.

### The fix

The gesture docs describe a fling this way, tell you to pair it with a pan, and say `onStart` doesn't fire. The `onBegin` gate on its `onEnd` is covered by the `onBegin` entry below.

---

## Lynx for Web recognizes no gestures: web-core's gesture PAPIs do nothing, or don't exist

### What you'd expect (web)

A gesture works wherever pointer events do, so the web preview, and the docs' live previews built on it, run the same `[lynxGesture]` gestures as a phone.

### What Lynx does

`@lynx-js/web-core` (0.26.2, and still 0.26.6) defines `__SetGestureDetector` and `__RemoveGestureDetector` as no-ops, "so ReactLynx bundles using `main-thread:gesture` can still render" (`createElementAPI.js`), and has no `__SetGestureState` or `__ConsumeGesture` at all. So every gesture silently did nothing on the web, and a callback calling the state manager's `fail()` would have thrown a ReferenceError there, had one ever run.

### The fix

The runtime recognizes gestures itself on the web. `gesture/web/` is a port of Lynx's own gesture arena, from its iOS sources in lynx-family/lynx (`LynxGestureArenaManager.m`, `LynxGestureHandlerTrigger.m`, `LynxGestureDetectorManager.m`, `LynxGestureFlingTrigger.m` and the pan, tap, long-press and fling handlers), fed with pointer events instead of UITouches. On the web, a main-thread element is the DOM element itself (the main thread runs in an iframe, the elements live in the page), so the arena listens on it. `gesture/gesture-papi.ts` sends `LynxGestureDetector`'s and `GestureStateManager`'s calls to the arena when `__WEB__`, and to Lynx's PAPIs otherwise. Android's trigger (`GestureHandlerTrigger.java`) has the same logic as iOS's, including the quirks below.

What it keeps from Lynx, which surprises on first read:

- **Same-element gestures race.** `waitFor` only reorders _elements_: a member waiting for an ancestor's gesture goes after that ancestor in the compete chain (`convertResponseChainToCompeteChain`). Gestures on one element all see the touch, and the first to activate fails the others it isn't simultaneous with. So in `Gesture.Exclusive(pan, tap)` on one element, the tap doesn't wait for the pan to fail; the two race, which gives the same result because each fails once the finger moves 10px.
- **`activate()` from the state manager does nothing.** Both triggers' `handleGestureDetectorState` ignore the ACTIVE state; only `fail()` and `end()` change a gesture.
- **A failed winner takes the touch back.** When the winner fails and no other member of the chain can take the touch, the next move finds no winner, and the move after hands it back to the failed member with its gestures reset (`reCompeteByGestures`'s `needReCompeteLastWinner`). A pan that calls `fail()` from `onUpdate` with no scroll view or other gesture around it therefore begins again two moves later.
- **Handlers run in a fixed order:** pan, fling, tap, long press. So on a tap in `Gesture.Exclusive(pan, tap)`, the pan's `onEnd` (it fails when the finger lifts) runs before the tap's.

What differs from a straight port, and why:

- **Positions are in the page's CSS pixels**: the pointer minus the `<lynx-view>`'s box, divided by the scale it's drawn at. The docs' previews are drawn scaled down, so screen pixels would make `minDistance` too short and a pan's translation outrun the pointer.
- **The browser is kept out of a pan.** While a pan of the touch is still in play, the arena cancels `touchmove` (else the browser scrolls the page or a scroll view under the finger), `selectstart` and `dragstart`. `<image>` is a plain `<img>` inside `x-image`, which a mouse drags out, and the browser then cancels the pointer.
- **`pointercancel` fails a tap and starts no fling.** Lynx treats a canceled touch like a lifted one, so a tap would succeed; but a browser cancels the pointer when it takes the touch to scroll or zoom.
- **A long press another gesture failed doesn't activate later.** iOS's timer activates unless the state is Fail or Active, but every failure sets Cancel.
- **One pointer at a time**, followed on the document so a drag continues off its element. A second finger is ignored, as Lynx follows `touches.anyObject`. A new touch stops a running fling (Lynx stops it only when the new touch is on the flinging element).
- **The fling decelerates by the clock**, not a fixed step per display frame, since a browser's frame rate varies.
- **`consumeGesture()` and `interceptGesture()` do nothing:** they share the touch with native scroll views, and web-core's scroll views aren't arena members.
- **`enableNewGesture` doesn't matter on the web:** the arena runs whatever the build flag says.

The arena is imported dynamically inside `if (__WEB__ && __MAIN_THREAD__)`, as the web glass is (`create-blur-view-element.ts`): imported statically, the minifier couldn't prove its classes side-effect free once compiled for the main thread, and kept them in native bundles. `packages/e2e/playwright/render.test.ts` swipes the gestures fixture in Chromium and checks the pan's translation and the fling's `onEnd`, as `native/gestures.yaml` does on devices.

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

An `@if` directly inside the overlay does the same, even with a full-size view in it: Angular inserts a hidden `<view>` to anchor the block and puts the block's content before it, and the overlay still didn't size that content. The alert dialog had its two panels in an `@if` straight under `<overlay>`, and on the iOS 27 Simulator its glass panel drew in the top-left corner. Wrapping the `@if` in an `h-full w-full` view fixed it.

Caveats for **non-modal** overlays (e.g. toast): a full-screen first child captures touches for the app behind it, and on iOS this held true no matter what was tried — `pointer-events` errors the build (see above), `events-pass-through`/`custom-layout` are web-platform-only overlay attributes (the native overlay API exposes only `ios-enable-swipe-back`, `level`, `mode`, `visible`), and even the general-purpose `event-through` attribute did not help in practice, despite checking out against the native source on paper:

- **Harmony**: `UIOverlay::OnNodeEvent` (`platform/harmony/lynx_xelement/overlay/ui_overlay.cc`) hit-tests its own subtree, and if the deepest hit element has `EventThrough` set, redispatches the touch to the page root instead of handling it.
- **iOS**: `LynxOverlayContainer.hitTest:withEvent:` (`platform/darwin/ios/lynx_xelement/overlay/LynxOverlayContainer.m`) does a real hit test and returns `nil` when the hit element has `eventThrough` set, so standard UIKit hit-testing _should_ give the touch to whatever's behind it.
- **Android**: `LynxOverlayDialog` is a genuine separate `Dialog`/window, so passthrough is coarser — `LynxOverlayView.needHandleEvent()` (`LynxOverlayView.kt`) checks the overlay's own `event-through` plus its _direct_ children's bounding boxes, not a deep per-descendant hit test. A single full-screen direct-child backdrop may make this always resolve to "handled," swallowing touches meant for nested interactive content. Not yet verified on-device.

**Both `event-through` and `mode="page"` were tried on-device for `packages/ui/src/lib/components/toast/toast.ts` and neither fixed it — this is a documented dead end, not a suggestion.** `<overlay>`'s `mode` prop (`LynxUIOverlay.m`) defaults to `LynxOverlayModeWindow` (`LynxOverlayContainer.h`) when left unset — a genuinely separate native `UIWindow`, not a layered sibling view — which was one plausible reason `event-through`'s same-window hit-test redispatch wouldn't reach the app. Setting `mode="page"` (attaching the overlay inside the same view controller/window as the page) was tried on top of `event-through` and _also_ made no observable difference: confirmed with an on-screen tap counter (there's no attachable console on-device) showing zero taps registering anywhere in the app — including a header button nowhere near the toast — for as long as any toast was visible, identical before and after both attempted fixes. Why iOS's own hit-test source didn't produce the expected behavior remains unexplained.

### The actual fix

Don't use `<overlay>` for non-modal content at all. `<overlay>`'s bespoke hit-testing is fundamentally a modal-window primitive — correct for `bottom-sheet`/`dialog`/`action-sheet`, wrong for anything that must leave the rest of the app interactive. `packages/ui/src/lib/components/toast/toast.ts` instead uses a plain `<view style="position: fixed; ...">`, relying on the "position:fixed reparents to page root" behavior (see below) for the same "renders on top, positioned against the full screen" effect, but going through the SAME ordinary hit-testing every other element in the app uses — no special attribute needed. The one adjustment this requires: give that view a small, explicit, non-zero height (not full-screen) instead of `h-full w-full`, so it only occupies real screen space near the toast and doesn't shadow the rest of the screen; `overflow: visible` (already needed for the stack's peek-through effect) means content taller than that floor still paints and stays fully hit-testable, so the height doesn't need to precisely match real content.

---

## On Android an `<overlay>`'s window stops above the navigation bar, though its content runs to the screen's bottom

### What you'd expect (web)

A `position: fixed; inset: 0` layer covers the whole viewport, as the page does. In an edge-to-edge page (`viewport-fit=cover`) that includes the area under the home indicator.

### What Lynx does

On iOS an overlay covers the screen. On Android, XElement's overlay is a `Dialog` with its own window (`LynxOverlayDialog`), and that window ends above the navigation bar even when the activity draws edge to edge. Its content doesn't: `LynxUIOverlayShadowNode` sizes the first child to the real screen's full height. So the window cuts the content off at the navigation bar, and the page shows undimmed in the strip beneath it. A bottom sheet docked with `bottom: 0` loses its bottom padding, and the dock under it shows through (issue #328).

- **Why:** `LynxOverlayView` lets the window under the status bar (`translucentStatusBar`: `FLAG_LAYOUT_IN_SCREEN` and `SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN`), but nothing removes the navigation bar from the insets the window fits. Its one switch, the `android-adapt-edge-to-edge` attribute, calls `WindowCompat.setDecorFitsSystemWindows(window, !adapt)` only on Android 15 (API 35) and later, and the view's `init` calls it with `false`, which opts the window out of edge to edge there. Below 15 nothing changes it. (Lynx 4.1.0, `lynx_xelement_overlay`.)
- **What AngularLynx does:** in an edge-to-edge app the Android shell registers its own `overlay` behavior after XElement's (`EdgeToEdgeOverlay.kt`; the last behavior added for a tag wins, and logcat says `Duplicated Behavior For Name: overlay`). It subclasses XElement's overlay UI and calls `WindowCompat.setDecorFitsSystemWindows(window, false)` on the dialog's window on every version, with the cutout mode `enableEdgeToEdge()` gives the activity, and keeps XElement's shadow node. The overlay then covers the screen as on iOS, and its content pads itself with `env(safe-area-inset-*)`, which reads the page's variables there too (dolan's bottom sheet pads with `pb-safe`). The navigation bar stays transparent over it: XElement copies the activity's navigation bar color into the dialog's window when it opens.
- **To build against it:** the `xelement` umbrella declares its modules with `runtime` scope, so the shell adds `org.lynxsdk.lynx:xelement-overlay` itself to compile a subclass.
- **Your own Android host** that draws edge to edge has the same gap. Set `android-adapt-edge-to-edge` on the overlay for Android 15 and later, or register a subclass as the shell does.
- The keyboard behaves the same with and without the fix: a focused `<input>` near the bottom of a sheet ends up partly under the keyboard on Android either way.

Probe (2026-11-07): a `ui-bottom-sheet` over a page with a blue bar at the bottom, on the Android emulator (Pixel 6, API 34, gesture navigation). Before, the sheet's last row ended the navigation bar's height above the bottom, over the undimmed blue bar. With `EdgeToEdgeOverlay` the sheet runs to the screen's bottom edge, with its `pb-safe` padding (24dp) under the gesture handle. Android 15 and later weren't run (no image installed).

---

## A move is remove-then-reinsert — it must not "park" the element's children

### What you'd expect (web)

Reordering `@for` items — or any `ViewContainerRef.move()` — relocates an element with its whole subtree intact. In the DOM the children come along automatically.

### What Lynx does

Angular implements a move as **detach-then-reinsert in the same change-detection tick**: `renderer.removeChild(el)` immediately followed by `renderer.insertBefore(el, …)`. The renderer's `remove()` used to run its full teardown on that detach — including "parking" the element's children (see the parking-crash entry below). So every moved item was gutted: its `<text>` label and buttons were re-homed away, and the re-inserted item arrived empty.

This broke `examples/transitions`. Deleting a non-last item reorders every following item (each a `move()`), so their content vanished. Deleting the last item triggers no moves, so it stayed intact — the tell-tale signature.

For a same-tick move this is completely safe: the element is removed and re-inserted in **one** flush (`is_move=true`), so both its fiber node and its native painting node survive. `RemoveNodeInternal` ([`lynx/core/renderer/dom/fiber/fiber_element.cc`](https://github.com/lynx-family/lynx/blob/develop/core/renderer/dom/fiber/fiber_element.cc)) only unlinks the node and clears its parent pointer; `InsertNodeBeforeInternal` auto-reparents it on re-insert, exactly as React Lynx moves reused nodes via `__RemoveElement` then `__InsertElementBefore` on the same element (`snapshot.ts`). (A removal that is **not** re-inserted in the same flush is different — its painting node dies and re-inserting the stale ref renders empty; see the recreate-on-remount entry below.)

### The fix

`remove()` defers its native teardown by one microtask (`#pendingRemovals` in `packages/runtime/src/lib/lynx-element/lynx-element.ts`). A re-insert in the same tick — `appendChild`/`insertBefore` — cancels the queued removal, so a move relocates the element with its subtree intact. Only a genuine destroy (never re-inserted) reaches `#doRemove()`. Covered by the reorder test in `packages/runtime/src/lib/renderer/teardown.test.ts`.

---

## An orphaned `<overlay>` is a live native window — destroying its `@if` must tear it down with the whole subtree

### What you'd expect (web)

Removing a subtree from the DOM removes everything in it, including any overlay/portal element. A detached DOM node is inert and garbage-collected; there is no lingering "window."

### What Lynx does

An `<overlay>` is a standalone **native window**, not an in-flow element. When the `@if` containing one is destroyed (e.g. a `ui-select`/`dialog`/`sheet` inside a step that toggles off), the overlay's native window must be torn down with the rest of the subtree. An overlay left detached-but-alive with no owning Angular view is a live window that corrupts the native window hierarchy and **crashes to the home screen** (observed on `examples/checkout-form`: pressing Continue destroys the step-1 `@if`, which contains the Country `ui-select`).

This once crashed for a subtler reason: the renderer's old child-"parking" mechanism (see the parking-crash entry below) re-homed a destroyed element's children onto the page root to rescue projected content — which left the overlay orphaned there. That mechanism has since been removed.

### The fix

`#doRemove()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) removes each subtree **as a single unit**, so an overlay is torn down together with its ancestor and no window is orphaned. No overlay-specific exception is needed any more, and the old page-root re-home **leak** (non-overlay subtrees stranded on the page root) is gone with it. Covered by `packages/runtime/src/lib/renderer/teardown.test.ts` (a TestBed harness over a fake native tree, asserting overlay teardown as a unit, bare-`<ng-content>` re-projection, and `@for` reorder-as-move).

---

## Projected content in a toggled `@if` needs recreate-on-remount — the fiber survives a removal, but its painting node does not

### What you'd expect (web)

Toggle an `@if` off and on and the projected content comes back exactly as it was — the browser preserves the whole detached subtree and re-attaches it wherever Angular re-projects it.

### What Lynx does

Lynx has **two element layers**, and a removal treats them differently:

- **Fiber layer** — `__RemoveElement` (`FiberElement::RemoveNodeInternal`, [`lynx/core/renderer/dom/fiber/fiber_element.cc`](https://github.com/lynx-family/lynx/blob/develop/core/renderer/dom/fiber/fiber_element.cc)) is a pure detach: it erases the node from its parent's `scoped_children_` and calls `set_parent(nullptr)`. The node and its whole subtree stay valid JS objects, re-insertable via `__AppendElement`/`__InsertElementBefore`.
- **Painting layer** — the rendered native view. At flush (`ElementContainer::RemoveSelf` → `PaintingContext::RemovePaintingNode`), a node that was removed and **not** re-inserted in that _same_ flush has `is_move=false` and its painting node is **destroyed**. There is **no** API to re-create a painting node on a later re-insert (`CreateElementContainer` runs once, under `kDirtyCreated`). Re-attaching such a node in a later flush renders an **empty** element.

A same-tick MOVE stays `is_move=true` (removed and re-inserted in one flush), so it keeps its painting node — that's why `@for` reorders work (see the move entry above). But an `@if` toggle spans **two change-detection cycles**: the content is removed on collapse (painting node dies at that flush) and re-inserted on expand (a later flush).

This bites projected content specifically. The projected nodes are owned by the **surviving consumer**, so Angular **reuses** the same element across the toggle instead of recreating it — and that reused element's painting node is already dead. On-device symptom: an accordion/collapsible panel shows on the first expand, then an **empty wrapper** on every expand after (`@if(open){ <view.slot><ng-content/></view> }`). The bare-`<ng-content>` shape (`LynxTransition`, `@if(show){ <ng-content/> }`) has the same failure — its projected root is likewise reused across the toggle.

React Lynx (the production reference) never hits this: on unmount it drops the native refs, and on remount it **creates fresh** native elements (`reconstructInstanceTree` → `ensureElements` → `__CreateElement`), never re-inserting a dead painting node.

### The fix

**Recreate on remount**, mirroring React Lynx. `LynxElement` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) caches each element's state as it is set (tag, attributes, id, dataset, classes, inline styles, event listeners, text, ordered children). `#doRemove()` marks the removed subtree painting-dead; the next `appendChild`/`insertBefore` of a painting-dead element rebuilds a fresh native ref for it and its whole subtree from cache (`#recreateSubtree`), then attaches that. A same-tick move is canceled before it becomes a removal, so it is never painting-dead and never recreated — the reorder fast-path is untouched.

Covered by `packages/runtime/src/lib/renderer/teardown.test.ts`, whose fake native tree models **both** layers (a removed node's painting node dies at flush unless reinserted in the same flush). The accordion-cycle, bare-`<ng-content>`, event-rebind, attribute-replay and raw-text tests fail without recreation and pass with it.

**Known limitation:** native-only state not tracked by Angular (uncontrolled input text, scroll position, focus) resets on remount — the same semantics as Angular's web `@if`, which also destroys and rebuilds the DOM subtree on toggle.

**Open bug (issue #380):** on the iOS 27 Simulator, a `<text>` projected into `ui-select-item`, whose template was `@if (shown()) { <ng-content /> <text>…</text> }`, wasn't drawn again when the block remounted, while the label beside it was. That item sat several projections deep, in a `<scroll-view>` inside an `<overlay>`. The jsdom specs and this harness pass, so don't rely on recreate-on-remount for projected content on a device until it's fixed: hide such content with `display: none; overflow: hidden` instead (see "A `display: none` element still draws its content on iOS").

---

## Attaching an element into its own subtree silently builds a cycle and hangs layout forever (no `HierarchyRequestError`)

### What you'd expect (web)

`parent.insertBefore(node, ref)` where `node` is an ancestor of `parent` throws `HierarchyRequestError` — the DOM refuses to create a cycle. Reparenting is always safe: the worst case is an exception, never a corrupt tree.

### What Lynx does

`FiberElement::InsertNode`/`InsertNodeBeforeInternal` auto-reparents a node that still has a parent, but **never checks whether the new parent lives inside the node's own subtree**. Ask it to attach an element under one of its own descendants and it happily writes a self-referential `parent`/`child` link. Nothing throws — the corruption would only bite at the next layout pass (a naive cycle-walk with no visited set would recurse forever).

How the renderer could in principle hand Lynx a cyclic attach: an Angular reorder or re-projection can ask to re-insert an element underneath one of its own former descendants (e.g. two siblings swap places and one lands inside the other). The raw `__AppendElement`/`__InsertElementBefore` would then close the loop. This is a real, structurally-possible hazard, but **it turned out not to be what caused the observed `LynxTransition` panel freeze** — see the parking-crash entry below for the actual mechanism and why the crash signature (a shallow, ~7-frame recursion plus a watchdog timeout, not a near-instant stack overflow) doesn't match a true cyclic tree walk in the first place.

### The fix

`wouldFormCycle(parent, candidate)` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) walks `parent`→root via `__GetParent`, comparing `__GetElementUniqueID`s (native refs can't be used as keys or reliably `===`-compared). `appendChild` and `insertBefore` skip the attach when it would form a cycle — the DOM's ancestor check, minus the throw. The walk is bounded by tree depth, two cheap native reads per step. Kept as defensive coding for a real hazard even though it wasn't the cause below. Covered by `packages/runtime/src/lib/lynx-element/lynx-element-cycle.test.ts`.

---

## Two watchdog crashes traced to the renderer's child-"parking" machinery (now removed)

### What you'd expect (web)

Detach a node to a scratch location and move it back later, and the browser lays it out wherever it ends up. There is no location that is toxic to detach to, and an offscreen scratch area doesn't accumulate cost over time.

### What Lynx does

To keep projected content **rendering** across an `@if` toggle, earlier renderer revisions **"parked"** a removed element's children somewhere live on a genuine destroy, then moved them back on re-insert. Parking was genuinely **load-bearing**: keeping the child attached to a live parent meant it was never left removed across a flush, so its painting node stayed alive (`is_move` never went false) — the real problem the pure-detach fiber layer does NOT solve on its own (see the recreate-on-remount entry above). But parking produced two main-thread **watchdog SIGKILLs** (`0x8BADF00D`, "failed to terminate gracefully after 5.0s"):

1. **Page-root parking → layout livelock on re-show.** Parking onto the live, laid-out page root laid each child out as a direct in-flow child of `<page>`; moving it back out of that position into a deep descendant on re-show drove a _single_ layout pass into a non-terminating state. Stack: `setTimeout` → `FiberFlushElementTree` → `LayoutContext::Layout` → stuck in `RemoveAlgorithmRecursive`. Not a cycle: `RemoveAlgorithmRecursive` is a per-relayout cache clear that recurses only to tree depth (~7 frames), and `Layout` calls `CalculateLayout` exactly once with no C++ loop — one pass failing to terminate on a pathological (lattice-shaped) tree, not a stack overflow (a real cycle overflows near-instantly as `EXC_BAD_ACCESS`).
2. **`display:none`-holder parking → teardown hang.** Moving parking into a `display:none` holder (which layout skips wholesale) fixed the re-show livelock, but children of a _permanently_ destroyed element leaked into the holder forever — nothing ever cleaned it. Eventually destroying that ever-growing tree at shell teardown (`LynxShell::Destroy` → `~LayoutContext` → destroying the `unordered_map<int, LayoutNode>`) blew the 5s watchdog on the next reload/startup.

Also **disproven** along the way, recorded so they aren't re-attempted: a genuine tree cycle (ruled out by the crash signature above); and a "defer the restore to a macrotask" timing fix (the re-show crash was byte-identical after it shipped, proving the restore _timing_ was irrelevant).

### The fix

Parking was **removed entirely** and replaced by **recreate-on-remount** (see the recreate-on-remount entry above). `#doRemove()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) now removes each subtree as one unit and marks it painting-dead; a later re-insert rebuilds it from cache. So nothing is stranded on the page root, nothing accumulates in a holder, and the projected content still renders on re-show. Why parking couldn't just be fixed in place: content parked outside its component's own subtree can no longer be cleaned up by Angular on destroy (Angular removes only its own subtree, and `destroyNode` isn't called on the relocated nodes), so the holder leaks unrecoverably — proven by the leak test in `teardown.test.ts`. Recreate-on-remount never relocates content, so it has no such leak. The move/destroy split (`#pendingRemovals`) and the `wouldFormCycle` guards are kept.

**Confirmed on-device:** both watchdog crashes are gone — `examples/transitions` shows/hides/re-shows without freezing, and reloads without the teardown hang. Removing parking then surfaced a separate, pre-existing bug (removed elements leaving a layout gap / stale panels) that had been masked by the crashes — see the flush-timing entry below.

---

## Deferred element removals must be committed inside the CD flush, not a later microtask

### What you'd expect (web)

Remove a node during a framework's render pass and it's gone from layout by the time that pass paints. There's no gap where a removed node still occupies space.

### What Lynx does

Element mutations only reach the main thread (and layout) on `__FlushElementTree()`, which the renderer calls once per change-detection cycle in `LynxRendererFactory2.end()`. `remove()` **queues** a genuine removal rather than applying it immediately, so a same-tick re-insert can cancel it (an Angular move — see the postmortem above). The bug: that queue was drained in a `queueMicrotask`, which fires **after** `end()` has already flushed. So the `__RemoveElement` ran too late — the node was gone from the JS element tree but not committed to native until some _later_ cycle happened to flush. Until then it kept occupying layout space, often invisibly: a `LynxTransition` panel whose leave animation faded it to `opacity: 0` "hid" but left a gap; an accordion panel collapsed with leftover padding.

### The fix

Drain the queue from `end()`, **before** `__FlushElementTree()`, via `processPendingRemovals()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`), so a genuine removal lands in the same flush as the cycle's other mutations. A move still cancels its queued removal during the render traversal, before `end()` runs, so moves are unaffected. Covered by `packages/runtime/src/lib/renderer/teardown.test.ts`.

---

## Removing a `position: fixed` element's holder from a parent that is itself removed before the flush crashes iOS

### What you'd expect (web)

Remove a node, then remove one of its ancestors, in any order before the next paint. Both go, and so does everything inside them, `position: fixed` or not.

### What Lynx does

Lynx 4.1 (Fiber, without `enableFixedNew`) draws a `position: fixed` element from the page, not from its parent (see "`position: fixed` is absolute-relative-to-root" above). When an element holding one is removed from a parent on the page, Lynx queues the fixed element's own removal from the page on that parent, to run when the parent flushes (`TreeResolver::NotifyNodeRemoved`, `FiberElement::RemovedFrom`, `PrepareAndGenerateChildrenActions`). Two things lose it:

- A parent that has left the page queues nothing: `NotifyNodeRemoved` returns at once for a detached parent.
- A parent removed after the removal was queued on it never flushes again, so the queued removal never runs. Radon passes such removals up to the parent's parent in `RemovedFrom`; Fiber doesn't.

The page then goes on drawing the fixed element. It's freed once its last JavaScript wrapper is collected, and the next layout walks the page's render children into it: `EXC_BAD_ACCESS` in `ElementContainer::UpdateLayoutWithoutChange()` at `0x0`, or in `ElementContainer::UpdateLayout(float, float, bool)` once the memory is reused. The log shows `DestroyLayoutNodeBeforeRemoveFromParent tag:overlay` as each one is freed: its layout node is still under the page's.

Angular asks for exactly that order within one change detection, the inner removal first: a row's `@if` drops a `ui-menu` (whose `<overlay>` is styled `position: fixed` for the web), and an effect that runs in the same pass starts a load that empties the list, so the `@if` around the list drops the card the rows are in in a second pass. Issue #345 crashed the iOS app this way, replacing a list of 12 rows by choosing another frame.

### The fix

`LynxElement.commitPendingRemovals()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) removes an element before anything inside it, whatever order Angular asked for. With the outer element removed first, Lynx queues the fixed elements' removals on its parent, which is still on the page and flushes; the inner removal afterwards queues nothing. Covered by `lynx-element-fixed.test.ts` against a fake of Lynx's behavior, and on device by the E2E `native/overlays.yaml`.

---

## Native mutations made outside a change-detection cycle need their own flush

Content created outside a `begin()`/`end()` bracket paints only after a later, unrelated change-detection cycle. Arm a settle flush so it paints immediately.

### What you'd expect (web)

Create elements at any time — from a router navigation, a dynamic `createComponent()`, a timer — and they show up on the next frame. There is no "commit" step you have to trigger.

### What Lynx does

`__FlushElementTree()` is what commits (lays out and paints) element mutations, and the renderer calls it once per CD cycle from `LynxRendererFactory2.end()`. Work done _outside_ a CD cycle never hits that call. Angular's `RouterOutlet` builds a lazy route component **during navigation** — before any `begin()`/`end()` bracket — so its freshly created native elements land in the fiber tree but sit unflushed. The core's `OnPatchFinishForFiber` lays out only when a flush actually runs ([`lynx/core/renderer/dom/element_manager.cc`](https://github.com/lynx-family/lynx/blob/develop/core/renderer/dom/element_manager.cc)), so the content stays invisible until something else triggers a cycle.

The `<list>` path already guarded this exact case (`LynxListElement.#scheduleUpdate`'s `queueMicrotask` safety net, whose comment names "lazy-loaded route components on first navigation"); nothing covered non-list content.

**Scope:** this is about content _created_ out of cycle. A different bug made `@if`/`@for` content vanish specifically on route **re-entry** — that was a canonical-wrapper mismatch, not a missed flush; see the next entry.

### The fix

`scheduleSettleFlush()` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`) schedules ONE coalesced `queueMicrotask` flush whenever native work happens outside a CD cycle. These call sites arm it:

- `LynxDocument`'s element creators — for content _created_ out of cycle (first navigation to a lazy route, a dynamic `createComponent()`).
- `LynxElement.#recreateIfDead()` — recreate-on-remount builds fresh refs via `createNativeRefByTag` directly (bypassing `LynxDocument.createElement`), and a route re-attach runs out of cycle, so the rebuilt subtree needs its own flush.
- `LynxElement`'s style, class and attribute setters, and `animate()` with its animation's `cancel()`, `pause()` and `play()`. A transition's last frame, set from a `setTimeout` (Lynx tells a script nothing when an animation ends), stayed unflushed on iOS and Android until something else ran change detection: `<lynx-stack-outlet>`'s covered page stayed at its animated offset and in the accessibility tree, with its glass Back button over the page above. The web preview hid it, because web-core applies a style to the DOM at once. Found in November 2026 while building the stack outlet, on the iOS 27 Simulator.

`LynxRendererFactory2.begin()`/`end()` maintain the in-cycle flag (`setInsideChangeDetection`, `packages/runtime/src/lib/lynx-render-lifecycle.ts`), so in-cycle rendering stays a no-op — its `end()` already flushes. It uses `queueMicrotask`, never `setTimeout` (a macrotask flush crashes the native engine), stands down if a real CD cycle starts first, and is skipped while the first render is pending (native flushes after `renderPage`). Covered by `packages/runtime/src/lib/lynx-element/settle-flush.test.ts`.

---

## `element.animate()` on an element native hasn't been flushed yet does nothing

### What you'd expect (web)

`element.animate()` on an element you just created and inserted plays from its first keyframe: the browser has the element as soon as it's in the DOM.

### What Lynx does

Native Lynx drops the animation: the element is in the fiber tree but not yet in the UI tree, which only a flush builds. On the iOS 27 Simulator, a page `<lynx-stack-outlet>` created and animated in the same turn appeared at its end position at once, with no slide. web-core animates it, so the web preview hides the problem.

### What to do

Give the element its starting look as an inline style in the turn that creates it, and start the animation on a later turn (a `setTimeout(…, 0)`), after the flush: `<lynx-stack-outlet>` does this for every transition, and `ui-bottom-sheet` waits a turn before it slides its panel in for the same reason.

---

## Lynx Explorer takes swipes from the left edge for its own Back

### What you'd expect (web)

A drag that starts at the left edge of a page reaches the page, which can use it to go back.

### What Lynx does

In Lynx Explorer on iOS, a drag from the left edge never reached the app's touch listeners (a drag from x = 6pt did nothing, while the same drag from x = 60pt did): Explorer's navigation controller has an edge pan of its own for leaving the page. The apps `ng build --platform ios` makes have no such gesture, and the same drag from x = 4pt reached the app there. Measured on the iOS 27 Simulator, November 2026.

### What to do

Swipe from inside a page when trying a swipe back in Explorer. `<lynx-stack-outlet>` takes a swipe from anywhere on a page, as iOS 26 does, so this only matters for the edge.

---

## `@if`/`@for` content vanishes after leaving and returning to a route

Nested `@if`/`@for` content renders on first visit, then comes back **blank** after you navigate away and return — while static template content survives. The cause: embedded-view content was adopted into a throwaway parent wrapper, so recreate-on-remount could not rebuild it.

### What you'd expect (web)

Navigate away from a route and back, and the whole view returns exactly as it was — `@if` blocks, `@for` rows, interpolated text, images, all of it.

### What Lynx does

`LynxRouteReuseStrategy` (opt-in since issue #68; `provideRouter()` used to install it) **detaches** a route on navigate-away and re-**inserts** the same view on return. Any `ViewContainerRef.detach()` + `insert()` takes the same path. Angular re-attaches a detached view by re-inserting only its **top-level** native node; nested `@if`/`@for` containers ride that node's subtree (`applyNodes` in `@angular/core` walks children only for `ng-container`/projection, not plain elements). On Lynx that subtree's painting nodes were destroyed on detach, so the renderer must rebuild the whole subtree from cache via `#recreateSubtree()`.

That rebuild walks each wrapper's **canonical** `#children` — the wrapper list Angular stores in its LView. The break: `parentNode()`/`nextSibling()/querySelector()` used to mint a **throwaway** `LynxElement` for a native ref (there is no native-ref → wrapper lookup). Angular finds an embedded view's insertion parent via `renderer.parentNode(anchorComment)`, so `@if`/`@for` content was inserted through that throwaway and adopted into _its_ `#children`, not the canonical parent's. It rendered fine on first paint (the throwaway drives the same native ref), but was invisible to `#recreateSubtree` — so on route re-entry the containers rebuilt and the embedded content did not.

Static template content survives because its wrappers are adopted canonically at creation; only embedded-view content routed through `parentNode()` hit the throwaway.

### The fix

A native-id → canonical-wrapper registry, `LynxElement.#byNativeId` (`packages/runtime/src/lib/lynx-element/lynx-element.ts`), keyed by `__GetElementUniqueID` (a number — hashing a native ref crashes the Lepus engine). The constructor registers each wrapper, which the registry holds weakly (see the next section); `parentNode()`/`nextSibling()`/`querySelector()` return the registered canonical wrapper instead of a throwaway, so every adoption lands in the canonical tree. `#recreateSubtree` moves the entry from the stale ref's id to the fresh one on remount, and an element Angular destroys leaves the registry with everything under it (see the next section). Covered by the route-reuse test in `packages/runtime/src/lib/renderer/teardown.test.ts`, which drives `ViewContainerRef.detach()` + `insert()` with an intervening settle-flush — the detach/reattach path every prior remount test missed (they all toggled a signal, which creates a _fresh_ embedded view).

---

## A destroyed view's elements stay alive unless the renderer releases every one of them, and Angular names only the top-level ones

Every screen left behind kept its native UI: in an app switching between two screens, each round left about 90 elements and 68 `LynxUIView`s alive on the iOS Simulator (`heap <pid>`), and a screen with a `<canvas>` cost 20 to 25 MB a visit (issue #237).

### What you'd expect (web)

When Angular destroys a view, its DOM nodes become garbage once nothing references them. Angular's DOM renderer doesn't even implement `destroyNode`.

### What Lynx does

The runtime keeps a registry from native id to `LynxElement` (see the section above), and until #279 a registered wrapper kept its native element, and so its UI, alive (the registry holds wrappers weakly now; see the end of this section). Angular calls `destroyNode` only for a destroyed view's **top-level** nodes: `destroyLView` walks them with `applyView`, which never descends into an element's children, and the views nested in it (child components' views, `@if`/`@for` blocks) are cleaned up by `destroyViewTree` without the renderer. So `destroyNode` deregistering just its node left every element under it registered, and each registered child's `#jsParent` kept the deregistered parent too.

### The fix

`LynxRenderer.destroyNode` calls `LynxElement.markDestroyed()`. When the element's removal commits (`processPendingRemovals`, at the end of the cycle), it releases its whole subtree, `#children` and a `<list>`'s items alike: each element leaves the registry, its native event handlers come off its native element (they hold the wrapper), and it's marked painting-dead. Waiting for the commit sees the tree as the cycle leaves it, so an element handed back out of the subtree in the meantime (CDK's `DomPortal` does it on destroy) stays registered, and an element still in the tree (a leave animation holding Angular's removal back) is released when its removal commits.

A destroyed view's subtree can hold content that a surviving view projected into it (a component's `@if (open) { <view><ng-content /></view> }`, or a `@boundary` that failed). Releasing it is safe: shown again, a painting-dead element is rebuilt and registered again, with its handlers (recreate-on-remount). A detached view (route reuse, `ViewContainerRef.detach()`) isn't destroyed, so it stays registered until Angular destroys it.

A `<canvas>`'s GL context is the one thing that can't be rebuilt, so it isn't freed with the subtree: a canvas at the top of a destroyed view frees it at once, and any other canvas's goes when the canvas is garbage-collected (a `FinalizationRegistry`, which the main thread has), as a browser frees a canvas's context.

This alone changed nothing on device, because of the next section. Covered by `packages/runtime/src/lib/renderer/teardown.test.ts` ("releasing a destroyed view").

The handlers didn't really come off until #261: the release passed `undefined` to `__AddEvent`, which native Lynx ignores for the handlers `LynxElement` registers, so a screen with any listener, or with a `<scroll-view>` on iOS, was still never freed. See "`__AddEvent(element, type, name, undefined)` doesn't remove a main-thread handler on native Lynx".

### Elements another renderer keeps out of the tree

The release reaches only the elements in the destroyed subtree, and a renderer that wraps AngularLynx's can keep some of the elements it makes with it out of that tree (issues #279 and #280). angular-three makes an element with AngularLynx's renderer for every `ngt-*` tag, every component host inside a scene and every anchor comment there, then attaches the three.js objects to its scene instead. Angular's `destroyNode` and the release never reach those elements, and the registry held each one, strongly, for the app's life. After a screen with `<ngt-mesh><ngt-box-geometry /><ngt-mesh-basic-material /></ngt-mesh>` was left, the registry still held its `app-scene` host and its three `ngt-*` elements, none of them in the tree. What they hold decides what leaks:

- **An `*args`** (`NgtArgs`, and so every `ngt-primitive`) hangs its directive's injector on its anchor comment. The injector leads to the view, so the whole screen stayed: its component, every element and every native UI (#279).
- **A scene component's host** holds angular-three's canvas store, which holds the WebGL renderer and so the `<canvas>`. Without an `*args`, the screen's component and its other elements went, but every `<canvas>` stayed, with its native UI, view and Metal layer on iOS (#280).

So the registry holds each wrapper weakly (a `WeakRef`, as a browser holds a node's JavaScript wrapper), and a `FinalizationRegistry` deletes a collected wrapper's entry. It finds wrappers; it doesn't keep them. A wrapper in the tree is still held by its parent's `#children`, up to the page, which the document holds; one Angular keeps out of the tree (a detached route view) is held by its view; and one with listeners is held by the handlers on its native element. One that nothing else holds can't be found or used again. The main thread has `WeakRef` and `FinalizationRegistry` (see "The main thread lacks newer built-ins").

Measured on the iOS Simulator (Lynx 4.1) with `heap <pid>` and a `WeakRef` on each screen's component and canvas, in a router app (`ng build --platform ios`) whose Home screen has an `ngt-canvas`, after 18 Home ↔ Other round trips, on Other:

| Home's scene                             | Homes alive, before → after | `<canvas>` wrappers alive | `AngularLynxCanvas` / `CAMetalLayer` | `LynxUIView` |
| ---------------------------------------- | --------------------------- | ------------------------- | ------------------------------------ | ------------ |
| `<ngt-box-geometry *args="[1, 1, 1]" />` | 19 of 19 → 1 of 19          | not counted               | 19 → 1                               | 39 → 3       |
| `<ngt-box-geometry />`, no `*args`       | 1 of 19 → 1 of 19           | 19 of 19 → 0 of 19        | 19 → 0                               | 39 → 1       |

(One Home is still alive on Other either way.) Covered by `packages/runtime/src/lib/renderer/teardown.test.ts` ("lets a screen go when another renderer kept some of its elements out of the tree"), which collects garbage in Node: V8 kept the screens too while the registry held them strongly.

---

## PrimJS never collects objects in a cycle through `#private` fields when a native element is in the cycle

### What you'd expect (web)

A JavaScript engine collects a cycle of objects that nothing else reaches, whatever the objects hold.

### What Lynx does

The main thread compiles to ES2019, so SWC lowers a class's `#private` fields to one `WeakMap` per field, keyed by the instance. PrimJS keeps any object that's in a cycle through those WeakMaps while something in the cycle holds a native element (an `ElementRef` from `__CreateView` and friends). Measured on the iOS Simulator (Lynx 4.1), each case created on the main thread, dropped, then checked with a `WeakRef` after allocating enough to make PrimJS collect:

| Case                                                                                                                    | Collected? |
| ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| Two objects pointing at each other through `#private` fields, each holding a native element in another `#private` field | **No**     |
| The same, with one native element appended to the other                                                                 | **No**     |
| An object whose `#private` field points at itself, holding a native element                                             | **No**     |
| A `#private`-field object and a plain object holding a native element, pointing at each other                           | **No**     |
| The two-object cycle through ordinary properties, each holding a native element                                         | Yes        |
| The two-object cycle through `#private` fields, with no native element                                                  | Yes        |
| A `#private` field holding a native element, no cycle                                                                   | Yes        |
| Plain `WeakMap`s whose values lead back to their keys, no native element                                                | Yes        |

Every `LynxElement` is in such a cycle with its parent (`#children` and `#jsParent`), so no element was ever freed, nor the native element and UI it holds: with the registry fixed, the screens' wrappers were out of the registry and still never collected.

`WeakRef` can't target a native element (`TypeError: WeakRef target must be an object`), so a test has to watch an object holding one.

### The fix

The build compiles the app's own code and AngularLynx's packages with SWC's `privateFieldsAsProperties` assumption (`packages/rsbuild-plugin-angular-lynx/src/layers.ts`), on both threads: a `#private` field becomes a non-enumerable property with a generated key, which PrimJS collects. Other packages keep the standard compile. With both fixes, the probe app's counts stopped climbing: 137 `LynxUIView`s after 20, 40 and 60 rounds, where they had grown 1395, 2755, 4115.

Two things change for the code compiled this way:

- **`#field in object` throws.** SWC's properties mode compiles it to a call on the field's key, a string (`_field.has(object)`). Check with `instanceof`, or a public property, instead. (Other packages keep the standard compile so this can't break them.)
- **A private field is an own property**, non-enumerable, named `__private_<n>_<name>`: `Object.getOwnPropertyNames()` lists it, `Object.keys()`, `JSON.stringify()` and spreading don't.

---

## PrimJS never lets go of a `WeakMap` entry whose value leads back to its key through a native element (issue #390)

### What you'd expect (web)

A `WeakMap` holds its keys weakly, and a value only while its key lives: once nothing else reaches the key, the engine collects the entry, even when the value leads back to the key (the entry is an ephemeron). So a long-lived `WeakMap` keyed by short-lived objects keeps nothing alive.

### What Lynx does

What the section above found for the `WeakMap`s SWC makes of `#private` fields goes for any `WeakMap`. On the main thread, PrimJS keeps an entry whose value leads back to its key while a native element is on the way, so the key, the value and everything they reach live as long as the map. A map in a module or in a root service lives as long as the app.

`<lynx-stack-outlet>` hit it. The app's `LynxStackChrome` kept the outlet each page is in, in a `WeakMap` keyed by the page's `LynxStackPage`, and a module-level `WeakMap` kept each page's own chrome. The value led back to the page both times: an outlet holds its pages in its stack, and a page's chrome holds the page it follows. The outlet holds its own element and its pages' frames, so native elements were on the way. Every tab the router left that held a stack stayed, with its screens, their native UI, and any `<canvas>` GL surface or `<webview>` page in them. A copy of `examples/ui-dock` that switches tabs on a timer (Home, Browse, the Library stack, Search), on the iOS 27 Simulator:

| After round | `LynxUIView`, before | `LynxUIView`, after | Library tabs still alive, before | after   |
| ----------- | -------------------- | ------------------- | -------------------------------- | ------- |
| 2           | 255                  | 192                 | 2 of 2                           | 1 of 2  |
| 9           | 709                  | 293                 | 9 of 9                           | 1 of 9  |
| 16          | 1,251                | 293                 | 16 of 16                         | 1 of 16 |

With only the module-level map put back, a page that injects `LynxStackChrome` (as a bar on the page does) kept every stack again: 25 of 25 after 25 rounds, 2,298 `LynxUIView`s.

`@blotch/ui`'s bars keep their state per page in a module-level `WeakMap` too, and that one is collected: when the bars and the scroll view on a page are destroyed, they take themselves out of the state, so what the map holds no longer leads back to the page.

### The fix

The stack keeps what it knows about a page on the page itself (`linksOf` in `router/stack/stack-page.ts`), as plain properties, which PrimJS collects with the page. Keep per-object state on the object (a property, or a `#private` field, which the build compiles to one), or take an entry out of the map, or what its value holds, once the object goes. `packages/runtime/src/lib/router/stack/stack-release.test.ts` runs the stack under a `WeakMap` that holds its values for as long as it lives, as PrimJS does here, and checks that a tab's stack is collected after the app leaves it.

---

## PrimJS's routine collections leave behind what a screen leaves, and only a full one the host asks for frees it

### What you'd expect (web)

Once nothing reaches a screen the app has left, the engine collects it, and the memory it took comes back: an app that keeps going between the same screens stays about the same size.

### What Lynx does

PrimJS, which runs the main thread, collects as the app runs, mostly concurrently, and those collections leave behind much of what a screen leaves when it goes, though the screens themselves are collected. So the app grows with every screen it shows. On iOS it shows as the footprint's "Untagged" memory, PrimJS's heap; on Android, as the native heap. Lynx runs a full collection, which frees it and hands the freed pages back to the system, when the host app reports memory pressure with `LynxEnv.trimMemory` (`TriggerVmGC` → `LEPUS_TrigGC`), and leaves reporting it to the host. Lynx Explorer doesn't, and neither did the apps `ng build --platform` makes.

Measured with a copy of `examples/ui-dock` that switches tabs every 1.2 s (Home, Browse, the Library stack, Search: a round is four navigations), in optimized `--platform` builds, sampled after each round (`footprint` on the iOS 27 Simulator, `dumpsys meminfo` on an Android 14 emulator):

| After round | iOS footprint, before | after  | iOS "Untagged", before | after | Android native heap, before | after | Android PSS, before | after  |
| ----------- | --------------------- | ------ | ---------------------- | ----- | --------------------------- | ----- | ------------------- | ------ |
| 10          | 101 MB                | 101 MB | 46 MB                  | 39 MB | 45 MB                       | 45 MB | 147 MB              | 136 MB |
| 30          | 145 MB                | 131 MB | 75 MB                  | 61 MB | 52 MB                       | 48 MB | 166 MB              | 155 MB |
| 60          | 178 MB                | 134 MB | 104 MB                 | 64 MB | 59 MB                       | 49 MB | 182 MB              | 157 MB |
| 100         | 219 MB                | 133 MB | 146 MB                 | 66 MB | 66 MB                       | 53 MB | 181 MB              | 153 MB |
| 150         | 264 MB                | 137 MB | 177 MB                 | 66 MB | 72 MB                       | 50 MB | 230 MB              | 159 MB |

Android's PSS swings by tens of megabytes between rounds with the screens PrimJS hasn't collected yet, before and after. The full collections didn't add pauses: the longest wait between two frames in a round (the probe counts them with `requestAnimationFrame`, and sampling the memory stalls it too) went over 100 ms in 3% of rounds with them against 13% without on iOS, 8% against 32% on Android, and the longest was 0.4 s against 2.5 s on iOS and 3 s on Android, where PrimJS's own full collections, on a heap that had grown, ran instead.

It isn't the amount of garbage: a mode that makes about 16 MB of plain objects a round and keeps none levels off at once (iOS's "Untagged" at 56 to 69 MB for 100 rounds, Android's native heap flat). Nor the `WeakRef` the runtime keeps for each element (`#byNativeId`): holding them strongly instead grew as fast. Nor what the app keeps: the screens were collected throughout, and the registry stayed at about 190 elements. PrimJS 4.1.1's settings flag, which would turn concurrent collection off, is a stub in the open-source build.

### The fix

The shells register `AngularLynxShell.collectGarbage()` (`ShellModule.swift`, and `ShellModule.kt` beside the back button's method), which reports moderate pressure. The runtime counts the elements it releases (`collect-garbage.ts`) and, once about a screen's worth (100) have gone, asks for a collection when the app has gone a second without releasing more, at most every 10 seconds and no later than 10 seconds after it started waiting. The shells also report the system's memory warnings (critical, which also empties Lynx's text layout cache) and the app leaving the screen. A host without the module rejects the first request, and the runtime never asks again; an app embedding AngularLynx can add the module (see the website's embedding guide).

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
- Covered by `packages/runtime/src/lib/renderer/teardown.test.ts`.

`<if>` and `<for>` are still created via the generic `__CreateElement` path and share the same theoretical "unregistered native UI" risk as `<block>` did — but neither is exercised anywhere in the codebase today, so this is a known latent gap, not a confirmed bug.

---

## Enter/leave animations need a single `@keyframes` class, not a two-phase CSS `transition`

### What you'd expect (web)

Vue-style transitions mount an element in a `-enter-from` state, then swap to `-enter-to` one frame later (via `requestAnimationFrame`) so a CSS `transition` interpolates. The one-frame gap lets the browser paint the initial state first.

### What Lynx does

The two-phase approach is unreliable in AngularLynx, for two reasons:

- **No frame boundary.** `requestAnimationFrame` is microtask-mapped or absent (React Lynx maps it to a microtask; AngularLynx only polyfills it when `lynx.requestAnimationFrame` exists). Microtasks drain within the same native call frame, so they never separate two paints.
- **No flush.** Class changes made from an rAF/`setTimeout` callback skip change detection, so they never reliably flush to the main thread. The element tree is committed once per CD cycle in `LynxRendererFactory2.end()`, and calling `__FlushElementTree` from `setTimeout` crashes the engine.

Native `element.animate()` can't drive them either: an element can be removed before its animation finishes, and `animate()` has no way to hold the removal back.

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
<view class="flex flex-col" style="height: 100vh">
  <view><!-- header --></view>
  <view class="flex flex-1 flex-col">
    <!-- column, claims remaining height -->
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
Angular's `<router-outlet>` inserts each routed component as a _real Lynx
element_ (`<app-home>`, `<app-motion-demo>`, …) — a sibling of `<router-outlet>`
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

Lynx does not have flow layout. **Default display is `linear`** (Lynx's own layout model, inspired by Android LinearLayout). Supported values: `linear`, `flex`, `grid`, `relative`, `none`. `inline`, `inline-block`, `inline-flex`, `inline-grid` and `flow-root` are dropped, so the element keeps the default.

`block` is worse than dropped: Lynx's CSS parser takes it, but its layout engine has no block layout, so it logs "Unexpected display type" and lays the element out as `flex`, a row (`LayoutComputedStyle::GetDisplay` in `core/renderer/starlight/style/layout_computed_style.cc`; only the legacy W3C mode, `cssAlignWithLegacyW3C`, maps it to `linear`). A child that doesn't set its width shrinks to its content, and `align-items: stretch` gives it the full height. `:host { display: block }`, which most Angular components that size themselves carry (and `ng generate component --display-block` writes), took a wrapped component's width away: `three-d-frame` inside a `display: block` host laid out 0 × 374 on the iOS Simulator, so the canvas inside it never drew (issue #260). Lynx for Web passes `block` to the browser, which lays it out as a block, so the web preview didn't show it.

`scroll-view` is always forced to `linear`, regardless of what CSS you set.

### The fix

Each value Lynx lacks becomes the Lynx value that lays the element's children out the same way: `block`, `flow-root`, `inline` and `inline-block` become `linear` (a vertical stack whose children stretch across it, as a block's do), `inline-flex` becomes `flex` and `inline-grid` becomes `grid`. A PostCSS plugin the build plugin adds to every environment (`displayForLynx` in `packages/rsbuild-plugin-angular-lynx/src/display.ts`) rewrites stylesheets: component styles, a library's as well as the app's, and global ones. It runs as a `Declaration` visitor, so it sees what Tailwind writes and rewrites Tailwind 4's `inline-flex` before its lowering would drop it. The runtime rewrites inline styles, `[style.display]` bindings and `style="..."` alike (`packages/runtime/src/lib/lynx-element/display.ts`). A test keeps the two maps the same.

What can't carry over is the outside of an inline value: Lynx can't flow elements along a line, so an `inline-block` or `inline-flex` element still stretches across its parent, where on the web it hugs its content. Add `align-self: flex-start` for that (see "Children stretch to fill the parent's cross axis by default"). A `display` value from a `var()` reaches Lynx unchanged.

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

AngularLynx draws such text in an anonymous `<text>` of its own (`LynxElement`'s `#putInTextWrapper`), which Angular never sees, so `<view>Hello</view>` and `<div>Hello</div>` show "Hello" (measured on the iOS 27 Simulator and Android API 34 emulator with Lynx Explorer 4.1, and in the web preview, including `@if` toggles and `@for` reorders of the text). In a parent that lays out as a block, a run of loose text and HTML inline tags (`span`, `a`, `b`…) shares one anonymous `<text>`, so `<div>Hi <b>there</b></div>` is one line; in a flex or grid container each is an item of its own, as on the web (`LynxElement.#regroup`, settled at the end of each change detection). The anonymous `<text>` and the HTML text tags read the text styles their ancestors set through CSS variables the build copies each inheritable declaration to (see "Text styles reach HTML text tags through CSS variables" below).

A `<text>` holding an empty raw-text takes a line of height, where a `<text>` with no children takes none and a browser gives empty or whitespace-only text no box (measured the same way, on iOS and Android). So the anonymous `<text>` is hidden (`display: none; overflow: hidden`) while its text is blank, as an empty `{{ name() }}` is, and an empty interpolation in a `<view>` takes no room, as it didn't before it was wrapped.

```html
<!-- WRONG — raw text in x-view doesn't render (AngularLynx wraps it) -->
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

The parent has to be the `<text>` directly around it. A `<view>` in between stops it, and the inner `<text>` draws in the default black. This catches components that wrap projected content in a `<text>`: `<ui-button>` puts what an app writes inside it in its label's `<text>`, so `<ui-button><view><ui-spinner /><text>Uploading...</text></view></ui-button>` drew "Uploading..." black on the dark primary button, while a plain `<text>` there took the label's white (measured on the iOS 27 Simulator with Lynx Explorer and in the web preview, where it computed to `rgb(0, 0, 0)`, 2026-11-09). The button's `loading` input now draws the spinner beside the label instead.

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

## SVG files can't be images

### What you'd expect (web)

SVG is a first-class format — rendered via `<svg>` elements or loaded as `<img src="icon.svg">`.

### What Lynx does

The `<image>` element does not support SVG files. Supported image formats are: `png`, `jpg`, `jpeg`, `bmp`, `gif`, `webp`. Inline SVG works through Lynx's own `<svg>` element (an XElement, with `content` or `src`); see "Inline `<svg>` elements are partially supported" below. An earlier version of this entry said Lynx had no `<svg>` element at all, which is why the first chart components drew lines from rotated `<view>`s.

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

## `cancelAnimationFrame()` throws for a handle that isn't a number

### What you'd expect (web)

`cancelAnimationFrame(handle)` does nothing for a handle it doesn't know, `null` and `undefined` included. Code leans on that: three.js stops a renderer's animation loop with `cancelAnimationFrame(requestId)` whether or not the loop ever started, so with `null` when it didn't.

### What Lynx does

Lynx's native `cancelAnimationFrame` throws for anything but a number: `error code: 111101 error message: CancelAnimationFrame param 0 should be Number`. `renderer.dispose()` ends that way, so every angular-three canvas logged `[NGT] Errors while destroying Canvas Root` as it went, and a component disposing its own renderer threw from `ngOnDestroy`.

### The fix

`packages/runtime/src/lib/polyfills.ts` wraps whichever `cancelAnimationFrame` is installed, so only a number reaches it.

---

## No browser navigation/location APIs (`window.location`, `history`, `URL`)

### What you'd expect (web)

`window.location`, `window.history`, the `URL` constructor, and `window.addEventListener` / `window.removeEventListener` are all standard globals.

### What Lynx does

None of these exist in Lynx. `window` itself is not a global (though we shim it to `globalThis`). Attempting to use `new URL(string)` or `location.pathname` throws at runtime. `addEventListener` / `removeEventListener` as globals are also absent.

### The fix

- Shim `window = globalThis` and a `document` at startup (see `polyfills.ts`). On the main thread, `document` and `window`'s `addEventListener` / `removeEventListener` are real ones that hear the screen's events (see "Lynx elements have no `ownerDocument`" below); the background thread keeps no-ops.
- Implement a custom `LynxPlatformLocation` that stores the current path in a signal and provides manual URL string parsing, bypassing the `URL` constructor entirely (see `packages/runtime/src/lib/lynx-platform-location.ts`).
- Polyfill `URL` and `URLSearchParams` (see `packages/runtime/src/lib/url/`), because Angular itself calls them. Since 22.2, `DefaultUrlSerializer.serialize()` runs every URL through `new URL(url, 'http://fake')` to reject protocol-relative URLs, and treats the `ReferenceError` as such a URL. Every URL then serialized to `/`, so every navigation on the main thread looked like a navigation to the current URL and was skipped (`NavigationSkipped`, no error). No route could be opened on device, lazy or not, while the web build (which has a real `URL`) worked. HttpClient and `NgOptimizedImage`'s loaders call `URL` too. The polyfill follows the WHATWG URL Standard and is checked against Node's `URL` in its tests.

---

## There is no ~256-slot native element pool — removed elements don't run the app out of anything

### What you'd expect (web)

DOM elements are garbage-collected when removed from the tree and no longer referenced. There is no practical upper limit on elements.

### What Lynx does

The same, as far as an app can tell. A May 2026 crash investigation (`investigations/navigation-crash.md`) concluded that Lynx had a fixed pool of about 256 native element slots that `__RemoveElement` never freed, crashing on about the 9th navigation, and `provideRouter()` installed `LynxRouteReuseStrategy` to keep route views alive.

Re-measured for issue #68 (2026-10-26, Lynx Explorer 4.1, iOS 27 Simulator and Android API 34 emulator): a probe app alternated 400 times between two routes of 100 rows each (about 300 native elements per page, more than 256 live at once), counting every `__Create*` call on the main thread. Both platforms created **121,527** native elements with no crash, and the count was **identical** with `LynxRouteReuseStrategy` and with Angular's default strategy. The strategy saved nothing: a detached view's painting nodes die at the next flush, so re-inserting it rebuilds its elements from cache (recreate-on-remount, above), the same number a fresh route creates.

### What changed

`provideRouter()` no longer installs a `RouteReuseStrategy`, so leaving a route destroys it, as on the web. `LynxRouteReuseStrategy` stays exported as an opt-in for apps that want route state to survive navigation. The original crash was probably one of the other causes in `navigation-crash.md`, such as the `x-list` use-after-free. Mutating the tree inside a tap handler, the other suspect, doesn't crash (see the next entry).

---

## Changing the element tree inside an event handler is safe (the old `setTimeout` rule was wrong)

### What you'd expect (web)

DOM mutations (`createElement`, `appendChild`, `removeChild`) are safe to perform inside any event handler synchronously.

### What Lynx does

The same. This entry used to say the opposite: that creating or removing elements inside a `bindtap` callback crashed the app or blanked the screen, so navigation, `LynxPortal.open()`, `element.animate()` and structural signal changes had to be deferred with `setTimeout`. The docs called it "the `setTimeout` rule". It came from a May 2026 hypothesis (`navigation-crash.md`, "Fix 2") that shipped alongside two real fixes and was never checked on its own.

Measured for issue #113 (2026-10-27, Lynx Explorer 4.1 on the iOS 27 Simulator and an Android API 34 emulator, and Lynx for Web 0.26.2), with a probe app whose tap handlers did everything synchronously:

- **Navigation:** 75 taps made 61 `router.navigateByUrl()` and `Location.back()` navigations between an eager route with a 60-row `<scroll-view>` and one with a 40-item `<list>`, including handlers on elements that the navigation itself destroyed. No crash, no blank screen, on either platform.
- **Navigation doesn't even change the tree inside the handler.** A counter in the next route's constructor stayed at 0 when read straight after `navigateByUrl()` returned: Angular 22's router builds the next view after the handler returns.
- **A flush inside the handler:** a tap toggled an `@if` over 50 elements and called `ApplicationRef.tick()`, which runs change detection and `__FlushElementTree()` inside the native callback. Fine on both platforms and the web.
- **Gesture callbacks:** a `TapGesture.onEnd` and a `PanGesture.onUpdate` doing the same (about 60 add/remove-and-flush cycles during pans), fine on iOS and Android.
- **`element.animate()`** from a tap handler, 8 times in a row, fine.

So handlers call these directly now: `RouterLink` navigates inside its `click` listener, `LynxBackButton` calls `Location.back()` from its event, and the docs, skill and examples dropped the rule.

`LynxPortal` did misbehave in that probe, but not because of the handler: `PortalRef.destroy()` left the overlay's content on screen (iOS also showed "LynxCreateUIException: page ui not found"), on master too, and just the same with `open()` and `destroy()` both deferred with `setTimeout`. That's a separate bug.

---

## Lynx elements fire `tap`, not `click`; the renderer hands a tap to `click` listeners

### What you'd expect (web)

A tap on a touch screen fires `click`, so `(click)` handlers and Angular directives that listen for `click`, such as `RouterLink`, work on phones.

### What Lynx does

Lynx elements never fire `click`; a tap is the `tap` event. Lynx for Web maps the two itself: web-core's `W3cEventNameToLynx` turns a DOM `click` into `tap`. The renderer does the same in the other direction (`DOM_EVENT_ALIASES` in `packages/runtime/src/lib/lynx-element/types.ts`): a listener for `click` is registered as `bindtap`. That's what lets `<view routerLink="/settings">` navigate on a tap with Angular's own `RouterLink` (issue #113), whose host listener is `(click)`. `RouterLink` also writes `tabindex="0"` on a non-anchor host, which Lynx ignores, and reads `$event.button` and the modifier keys only for `<a>` hosts, which Lynx doesn't have.

---

## Lynx keeps one handler per event on an element

### What you'd expect (web)

`addEventListener('click', a)` then `addEventListener('click', b)` runs both.

### What Lynx does

A second `__AddEvent()` for the same event name **replaces** the first. `AttributeHolder::SetStaticEvent()` (`core/renderer/dom/attribute_holder.h`) does `insert_or_assign(name, …)` into a map keyed by the event name only, whatever its `bindEvent`/`catchEvent`/`capture-*` type; `global-bindEvent` handlers have a map of their own. So a directive's host listener and a template's `(bindtap)` on the same element, such as `routerLink` next to `(bindtap)="track()"`, used to leave only the last one registered.

### The fix

`LynxElement.addEventListener()` keeps every listener and registers **one** native handler per event name that runs them all, in the order Angular added them (`#syncNativeHandler`). The handler's type is combined: `catch` if any listener catches (every listener still runs, then the event stops there), and capture only if every listener captures. A listener removed by an earlier one during the same event doesn't run, as in the DOM. Main-thread scripts (`[mainThreadBindtap]`) still register their own native handler, so one still replaces a `(bindtap)` on the same element.

---

## `accessibility-traits` takes a comma list on iOS, and a single trait on Android

### What you'd expect (web)

ARIA states combine freely: a `role="button"` element can also be `aria-selected="true"` or `aria-current="page"`.

### What Lynx does

iOS splits `accessibility-traits` on `,` and ORs the traits together (`LynxConverter toAccessibilityTraits:`). It compares each part exactly, so `button,selected` works and `button, selected` loses `selected`. Android reads one trait, matching the whole value against `none`, `image` and `button` (`LynxAccessibilityHelper.LynxAccessibilityTraits.fromValue`), so any list reads as `none` there, and it has no selected trait at all.

### The fix

`LynxRouterLinkActive` (part of `LYNX_ELEMENTS`) adds `selected` to an active `routerLinkActive` element through `LynxElement.setAccessibilityTrait()`, which merges it into the app's own traits with no spaces, keeps it when the app sets its traits again, and leaves the app's traits untouched on Android.

Apps add traits from their own state the same way, with `[lynxAccessibilityTraits]="{ selected: chosen() }"` (`LynxAccessibilityTraits`, also part of `LYNX_ELEMENTS`), or by calling `setAccessibilityTrait()` on an `ElementRef<BaseLynxElement>` where a template can't bind it, such as a component's own host.

---

## ECMAScript support is limited: ES2019 on main thread, ES2015 on background thread

### What you'd expect (web)

Modern browsers support ES2023+ (optional chaining `?.`, nullish coalescing `??`, `Array.at()`, `structuredClone()`, etc.).

### What Lynx does

- **Main thread (PrimJS):** ES2019 (ES10) — supports `Array.flat()`, `Object.fromEntries()`, optional catch binding; no optional chaining or nullish coalescing.
- **Background thread:** ES2015 (ES6) — `let`/`const`, arrow functions, classes, template literals, `Promise`, destructuring; nothing newer.

Transpilation via the Rsbuild/RSpeedy build pipeline handles the syntax, and the build's preEntry adds the newer built-in methods up to ES2026 (see "The main thread lacks newer built-ins" below). What only the engine can provide, such as the RegExp `d` and `v` flags, is still missing, and so is `structuredClone`.

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

The build's preEntry now adds `replaceAll`, with the other ES2021–ES2026 methods (see "The main thread lacks newer built-ins" below), so the call works. Before it did, the fix was an ES2019-safe equivalent:

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

## A `0n` in the main thread's script stops the bundle loading

### What you'd expect (web)

BigInt literals (`0n`, `1000000000n`) are ES2020 and work in every modern browser. A library that only uses BigInt on a path the app never takes costs nothing.

### What Lynx does

The build compiles the main thread's script to PrimJS bytecode, and PrimJS can't read a zero BigInt constant back. `JS_WriteBigInt` (`quickjs.cc` in [lynx-family/primjs](https://github.com/lynx-family/primjs)) writes zero as a length of 0 bytes, and `JS_ReadBigInt` computes its limb count as `(len - 1) / 8 + 1` in unsigned arithmetic, so it asks for half a billion limbs. Loading the bundle fails before any of it runs, and the screen stays blank:

```
QuickContext deserialize error main-thread.js exception: RangeError: BigInt is too large to allocate backtrace:
LynxError occurs error_code:10204 error_message:Decode error: Context construct failed
```

Measured on 2026-11-03 with Lynx Explorer 4.1.0, on the iOS 27 simulator and an Android 14 emulator, which fail alike, each probe a production build of an app whose main thread evaluates the literal:

| Literal in the main thread's script              | Result                         |
| ------------------------------------------------ | ------------------------------ |
| `0n` (and `0x0n`, which the minifier makes `0n`) | Decode error, blank screen     |
| `1n`, `1000000000n`, `-5n * 0xFFn`, `10n ** 20n` | Loads, right values            |
| `1n - 1n`, `BigInt(0)`                           | Loads: zero made at run time   |
| `0n` in the background thread only               | Loads: it isn't compiled ahead |

Firebase Firestore 12 has one (`e >= 0n` in `Timestamp._fromEpochNanoseconds`), so importing Firestore anywhere in the app left it blank (issue #204). Lynx for Web runs the main thread's script as plain JavaScript and isn't affected.

### The fix

The build rewrites every zero BigInt literal in the native bundle's main-thread scripts into `BigInt(0)`, packages included, since it works on the emitted files (`ZeroBigIntLiteralsPlugin` in `packages/rsbuild-plugin-angular-lynx/src/zero-bigint-literals.ts`). It leaves the other BigInt literals alone, since they load, and a `0n` used as a property name, which stores no BigInt. The E2E fixture starts its count from a `0n`, so every native check fails if one gets through again.

---

## Event attribute naming uses `bind`/`catch` prefixes, not `on*`

### What you'd expect (web)

Events are registered with `on*` attributes or `addEventListener`: `onclick`, `ontouchstart`, `onscroll`, etc.

### What Lynx does

Lynx has its own event binding syntax. Event attributes use explicit phase/propagation prefixes:

| Prefix             | Web equivalent                        | Behavior                                          |
| ------------------ | ------------------------------------- | ------------------------------------------------- |
| `bindtap`          | `onclick` (`(click)` maps to it)      | Bubble phase, propagates                          |
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
  (bindtouchstart)="onPressStart()"
  (bindmousedown)="onPressStart()"
  (bindtouchend)="onPressEnd()"
  (bindmouseup)="onPressEnd()"
  (bindtouchcancel)="onPressCancel()"
  (bindmouseleave)="onPressCancel()"
></view>
```

`mouseleave` is the `touchcancel` analogue — it restores the scale if the cursor leaves while pressed. Mouse events never fire on touch-only devices, so this is inert on native and touch continues to drive the animation there; the two platforms end up with identical feedback. Lynx has a documented Mouse Event API (`mousedown`/`mouseup`/`mouseenter`/`mouseleave`; see the Lynx docs — note its `button` numbering is non-standard, below), and the renderer's `EVENT_PREFIXES` accepts `bind` + any event name, so no renderer change is needed. Applied to `button`, `toggle`, `card`, `action-sheet`, `nav-drawer`, and `button-group`; the shared rationale lives in the `pressDown`/`pressRelease` JSDoc in `packages/ui/src/lib/utils/animate.ts`.

---

## A drag driven by `touchmove` needs mouse events on web, bound wider than the handle

### What you'd expect (web)

Binding `touchstart`/`touchmove`/`touchend` on a drag handle covers a mouse as well, as press feedback seems to suggest.

### What Lynx does

Like the press events above, the touch events never fire from a mouse on web, so a `touchmove` drag (the bottom sheet's handle) does nothing on a desktop browser. Swapping in mouse events on the handle alone isn't enough, because the two input types target differently:

- **A touch keeps its target.** Every `touchmove` goes to the element the touch started on, however far the finger travels.
- **A mouse event targets whatever is under the cursor.** A fast drag leaves a thin handle strip within a frame or two, and its `mousemove`s stop reaching it.
- **A moved mouse drag still ends in a click.** The browser fires `click` on the nearest element under both the `mousedown` and the `mouseup`, which web-core maps to `tap`. Release the drag over the backdrop and the backdrop's tap fires. A moved touch fires no tap.
- **A release outside the Lynx view is lost.** The `mouseup` targets the page around the view (past the edge of a docs preview, or outside the browser window), and web-core only listens inside the view. Only `keydown`/`keyup` are document-level in web-core.
- **An `<image>` under the cursor starts the browser's own drag.** A `mousedown` and a move on web-elements' `<img>` begin a drag of the image as a file, after which the page gets no more `mousemove`s and no `mouseup`: the furniture shop's swiper, dragged by its photo, moved one step and froze (2026-11-06). The docs' `applyNativeParity` cancels every `dragstart` in a `<lynx-view>` and sets `-webkit-user-drag: none` on `x-image::part(img)`; a page that embeds a `<lynx-view>` itself needs the same.
- **`mouseleave` doesn't arrive in Chrome.** web-core listens with capture listeners on the `<lynx-view>`'s shadow root. Chrome skips `mouseenter`/`mouseleave` dispatch unless some element in the document has a listener for them, and a shadow-root listener doesn't count. So `bindmouseleave` only fires if something else on the page happens to listen for `mouseleave`. Checked on Chromium with a bare page: a capture listener on a shadow root got nothing, and adding a listener on an element in that root made both fire. The press-feedback `(bindmouseleave)` above is affected the same way.

### The fix

`UiBottomSheet` (`packages/ui/src/lib/components/bottom-sheet/bottom-sheet.ts`) does all of this:

- `catchmousedown` on the handle starts the drag.
- `bindmousemove` and `bindmouseup` on the full-screen backdrop move and end it. Mouse events bubble there from anywhere in the sheet.
- After a moved mouse drag, it ignores the next backdrop tap. A `mousedown` on the backdrop clears that, in case the click never came.
- A `mousemove` with `buttons === 0` during a drag counts as the release. That covers a release outside the view, and stands in for `mouseleave`.
- It reads the event's `y`, not `clientY`. Lynx PC gives `clientY` relative to the element under the cursor, while `y` is relative to the Lynx view everywhere.

One gap is left: the `mousedown` on the handle still starts the browser's text selection, because web-elements makes only `x-text` unselectable. Dragged inside the view, the panel stays under the cursor and nothing gets selected. Dragged out of a docs preview, it selects the page's text. Lynx's listeners are passive and its events have no `preventDefault()`, so only CSS could stop it.

The runtime types these events as Lynx's `MouseEvent` in `HTMLElementEventMap` (`packages/runtime/src/lib/types/runtime-types.ts`), so `$event.y` type-checks in a template.

---

## web-core can't cancel an `element.animate()` that has finished

### What you'd expect (native Lynx)

`cancel()` on an animation started with `fill: 'forwards'` removes its effect, whether it's still running or has finished. Inline styles set afterwards show again.

### What Lynx does

On web, `cancel()` does nothing once the animation has finished. web-core's `__ElementAnimate` (`web-core/ts/client/mainthread/elementAPIs/createElementAPI.ts`) keeps a map from animation name to DOM `Animation`, and its `onfinish` deletes the entry. `ANIMATION_CANCEL` then finds nothing. The finished `fill: 'forwards'` frame keeps winning over the element's inline style for good.

The bottom sheet showed it. Its open slide holds the panel at `translateY(0%)`, and a drag cancels that slide, then moves the panel through its inline `transform`. On iOS the panel followed the finger. On web the slide had finished by the time anyone grabbed the handle, so the cancel did nothing and the panel stayed put. The drag offset was still tracked, so releasing past the threshold closed it. Upstream `main` still has the same code.

### The fix

`LynxAnimation` (`packages/runtime/src/lib/animation/animation.ts`) keeps the DOM `Animation` on web. Right after `ANIMATION_START` it takes the last entry of `element.getAnimations()`, which lists script animations in creation order, so that's the one just started. `cancel()` then cancels it directly as well as through `__ElementAnimate`. Canceling twice is harmless. The branch is behind `__WEB__`, so native bundles drop it.

---

## Native Lynx and web-core find a named `element.animate()` by different keys

### What you'd expect (web)

`pause()`, `play()` and `cancel()` reach an animation whatever `name` it was given. A name only labels the animation, so two elements can use the same one.

### What Lynx does

`__ElementAnimate(element, [operation, key, …])` finds the animation by `key`, and the two renderers need different keys for a named animation.

**Native** (`Element::AnimateV2` in `core/renderer/dom/element.cc`, Lynx 4.1):

- `START` registers the keyframes under `options.name` when there is one, and under `key` otherwise. That's the name the element's `animationstart` and `animationend` events report, in `params.animation_name`.
- `PAUSE` and `PLAY` write their `key` into the element's `animation-name`. So a named animation has to be paused and resumed by its name. On the iOS Simulator and an Android emulator, a named animation paused by its generated id ran on and ended on schedule, while an unnamed one paused.
- `CANCEL` resets every animation property, whatever `key` it gets.
- Animations belong to their element, so two elements can share a name.

**web-core** (`web-core/ts/client/mainthread/elementAPIs/createElementAPI.ts`):

- It ignores `options.name`. One map from `key` to DOM `Animation` serves every element on the page.
- `START` cancels whatever is already under its `key`, so an element that starts an animation under another element's name cancels that element's animation.
- It fires no `animationstart` or `animationend` for these animations.

React Lynx's `Animation` always passes its generated id, so on native its named animations can't be paused or resumed.

### The fix

`LynxAnimation` (`packages/runtime/src/lib/animation/animation.ts`) passes `options.name`, or its id when there's no name, on native, and always its id on web (issue #57). It passes the same key to all four operations. When an element is removed, `LynxElement` cancels each of its animations through the animation's own `cancel()`, so the cleanup uses the same key.

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

**Update, 2026-11-13: the `@blotch/ui` theme now sets it.** `default.css` has `page { font-size: 16px; --rem-unit: 16px; }`. Measured in Lynx Explorer 4.1 on iOS 27 (simulator) and Android (API 34 emulator): with it, `h-10` is 40pt and `p-4` 16pt, and a `<text>` with no font size of its own draws at 16px too, so the root font size is also the default text size. `--rem-unit` is for a web page that embeds the app with web-core's `transformREM` (see "`rem` is 14px on native Lynx, but Lynx for Web resolves it against the host page"): `page` is inside the `<lynx-view>`, so its value wins over the host's for everything in the app. An app without the theme is still at 14px on native.

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

The default is `scaleToFill` on iOS, Android and the web alike, the same as the web's `object-fit: fill`. AngularLynx leaves it there, as React Lynx does.

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

A z-indexed element is stacked against its nearest stacking-context ancestor, and Lynx only makes an element a stacking context when it sets `z-index` itself. If that ancestor is outside the scroll-view, the element **does not scroll at all**: it stays fixed on screen while its siblings scroll away. Seen on iOS with `<input>`/`<textarea>` carrying `position: relative; z-index: 1` (needed on web to sit above an absolutely positioned focus-ring overlay). The field's background box scrolled, but the transparent native text field didn't, so its placeholder appeared to float over the wrong field. This happens on both old and new Lynx bundles, so it isn't tied to a toolchain version.

### The fix

Make the nearest ancestor _inside_ the scrolling content a stacking context: give it `z-index: 0` (Tailwind `z-0`). The `z-index: 1` then stays local to that wrapper and scrolls with it. Do this in the component that introduces the `z-index` (see the wrappers in `packages/ui`'s `input.ts`/`textarea.ts`) rather than relying on every consumer's scroll-view to set `z-index: 0`.

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

## Network APIs: only `fetch`, and only on the background thread

### What you'd expect (web)

`fetch()`, `XMLHttpRequest`, and `WebSocket` are universally available browser globals.

### What Lynx does

Measured for issue #68 (2026-10-26, Lynx Explorer 4.1, iOS 27 Simulator and Android API 34 emulator), with `typeof` in app code on each thread:

| Thread                    | `fetch`     | `lynx.fetch` | `XMLHttpRequest` | `WebSocket` |
| ------------------------- | ----------- | ------------ | ---------------- | ----------- |
| Main (where Angular runs) | `undefined` | —            | `undefined`      | `undefined` |
| Background                | `function`  | `function`   | `undefined`      | `undefined` |

- **`fetch` exists only on the background thread.** Lynx's docs tag it `BTS`. Background code is wrapped in a function whose parameters include `fetch`, `XMLHttpRequest` and `WebSocket` (`core/runtime/js/js_bundle.cc`), and rspeedy's runtime wrapper adds `fetch = fetch || lynx.fetch`. The wrapper's `XMLHttpRequest` and `WebSocket` parameters are `undefined` in Lynx Explorer.
- **The main thread has none of them**, and since issue #81 every component, service, interceptor and `(bindtap)` handler runs there. Angular's `HttpClient` needs `fetch` for its default backend and `XMLHttpRequest` for `withXhr()`, so the runtime installs both on the main thread, relayed to the background thread's `fetch` (issue #85). See "The main thread's `fetch` is AngularLynx's relay" below.
- **Lynx for Web** uses the browser's own `fetch`, with the web's rules (Lynx's `fetch` docs).

How Lynx's `fetch` differs from the web's is in "`fetch` is available but without CORS, FormData, Blob, or redirect support" and "`fetch` streaming requires an explicit `enableFetchAPIStandardStreaming` flag" below.

---

## `localStorage` and `sessionStorage` use a different API

### What you'd expect (web)

`localStorage.setItem('key', value)` / `localStorage.getItem('key')` — synchronous, string-based storage.

### What Lynx does

The standard `localStorage` / `sessionStorage` globals **do not exist**, and Lynx has nothing that outlives the app. Its own store, `lynx.setSessionStorageItem` / `getSessionStorageItem` / `subscribeSessionStorage` (`LynxSessionStorage`), is shared by every LynxView in the host app but empties when the app quits.

For data kept after that, `LynxLocalStorage` and `LynxSecureStorage` (issue #178) call native modules that the shells `ng build --platform` makes register: `UserDefaults` and the Keychain on iOS, `SharedPreferences` (the secure one encrypted by an Android Keystore key) on Android. Lynx Explorer has neither, so the services keep values in memory there. Lynx for Web runs the main thread in an iframe that web-core sandboxes with `allow-same-origin` (`createIFrameRealm.js`), so the page's `localStorage` is reachable from Angular there, and the services use it.

---

## There's no `<input type="file">`: a photo comes from a native picker, and reaches the main thread as base64

Found while building `LynxImagePicker` (issue #305), on the iOS 27 Simulator, the Android 14 emulator and Chromium, with a 12-megapixel photo (4032×3024, 4.2 MB as a JPEG, 5.9 MB as HEIC).

### What you'd expect (web)

`<input type="file" accept="image/*">` opens the system's picker, and its `File` is a `Blob` that `fetch`, `XMLHttpRequest` and upload libraries send as it is. `URL.createObjectURL(file)` gives a URL an `<img>` shows.

### What Lynx does

- **No file input, and no picker module.** Lynx's `<input>` is a text field. The shells' `AngularLynxImagePicker` module opens `PHPickerViewController` on iOS and the Photo Picker (`PickVisualMedia`) on Android; neither needs a permission. Lynx Explorer has neither, so `pick()` rejects with `unavailable` there.
- **No `Blob` on the background thread** (`typeof Blob`, `FormData` and `File` are all `undefined` there, on both platforms), and none of Lynx's own on the main thread. The runtime's `LynxBlob` is the main thread's `Blob`, which is where the picked photo is made, and where Angular, and so Firebase Storage, runs.
- **The bytes cross two hops that carry only JSON**: the module's callback to the background thread, and the runtime's relay to the main thread. The module sends base64. Measured in the Simulator, for the 4.2 MB JPEG picked as it is: 16 ms to encode natively, 75 ms for the 5.6 MB string to reach the main thread, 215 ms to decode it there (411 ms on the Android emulator). The decoder was a `Map` lookup per character pushed onto an array, several times slower on PrimJS; it's now a table lookup by `charCodeAt` (`network/base64.ts`, about 8× faster in V8). Re-encoding the HEIC as a full-size JPEG took 349 ms natively. With `maxDimension: 1024` the test photo was 60 to 80 KB (a real one is a few hundred) and arrived at once. ImageIO's thumbnail API on iOS, and `BitmapFactory`'s `inSampleSize` on Android, decode it straight to about that size, so the full photo is never in memory.
- **Uploading it back crosses the same hops the other way.** The main thread's `XMLHttpRequest` sends the `Blob` through the relayed `fetch` (`Content-Type` from the `Blob`'s type), which base64s it for the background thread's `fetch`. The 4.2 MB JPEG uploaded in 0.9 s in the Simulator and 2.5 s on the Android emulator, to a server on the Mac. The upload's `progress` event reported 0 bytes for a `Blob` until `bodySize()` in `xhr.ts` counted them.
- **`<image>` can't load a `blob:` URL.** Lynx's image loader fetches URLs itself and knows nothing of the main thread's object URLs. `LynxElement` hands an `<image>`'s `src` or `placeholder` that names a live object URL the `Blob`'s bytes as a `data:` URL, which `<image>` shows on both platforms (a 5.6 MB one too).
- **Orientation and HEIC are the shell's job.** A photo stored sideways with an EXIF orientation tag looks right in the picker, but `BitmapFactory` ignores the tag, and Android and most browsers can't show HEIC. The modules re-encode as an upright JPEG when the app asks for a size or a quality, or when the photo isn't a JPEG, PNG, GIF or WebP.
- **Android's Photo Picker doesn't share the file's name.** Its URI's `DISPLAY_NAME` is the media ID, such as `1000000020.jpg`.

### Lynx for Web

Web-core runs the main thread in a hidden iframe (`sandbox="allow-same-origin allow-scripts"`), while the elements, and the person's taps, are in the page. A browser opens a file dialog only with a recent user activation in that document, so the runtime puts the `<input>` in the iframe's `frameElement.ownerDocument`. Its `File` then belongs to the page's realm, and `instanceof Blob` in Angular's realm is false (Firebase Storage checks it), so the runtime copies it into a `Blob` of the iframe's realm. Chromium fires `cancel` when the dialog closes without a file.

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

## Unknown element tags silently fall back to `<x-view>`

### What you'd expect (web)

Unknown HTML tags are rendered as `HTMLUnknownElement` and still appear in the DOM.

### What Lynx does

If you use an unrecognized element tag in a Lynx template, the renderer **silently creates an `<x-view>` in its place**. A tag without a hyphen also logs a console warning, since it's most likely a misspelled element (`<veiw>` instead of `<view>`). A tag with a hyphen doesn't: Angular creates every component's host (`<app-card>`) and every element directive's (`<router-outlet>`) this way, and a view is the right element for them, so a warning for each flooded the console (#352). Since there is no device console, the warning is invisible on-device anyway, and a misspelled hyphenated element (`<scroll-veiw>`) gets no warning at all: both fail silently and produce an unexpectedly-styled `<x-view>`.

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

## `<x-list>` item gaps are CSS properties, not attributes

### What you'd expect

`list-main-axis-gap="8px"` on a `<list>` to space its items, like its other options (`span-count`, `list-type`), which are attributes.

### What Lynx does

`list-main-axis-gap` and `list-cross-axis-gap` are CSS properties. The C++ list (`ListElement::ResolveListAxisGapStyle` in `core/renderer/dom/fiber/list_element.cc`) reads them from its computed style, and the web's `x-list` from the `--list-main-axis-gap` variable its CSS sets. As attributes they do nothing. Set them in `style`: `style="list-main-axis-gap: 8px"` or `[style.list-main-axis-gap]`. `LYNX_ELEMENTS` declared them as inputs until 22.2.3, and `UiList` bound them as attributes.

---

## Exposure areas and margins are strings with units

### What you'd expect

`[exposure-area]="50"` or `[exposure-screen-margin-top]="20"`, numbers as in most layout APIs.

### What Lynx does

iOS and Android take `exposure-area` as a string (their setters are `NSString` and `String`), which `@lynx-js/types` documents as a percentage such as `'50%'`. The margins are lengths, `'20px'` or `'20rpx'`. `exposure-ui-margin-*` also needs `enable-exposure-ui-margin` on iOS and Android; the web and Harmony apply them without it.

---

## `<x-scroll-view>` bounces defaults to `true`

### What you'd expect

Scrolling without bounce.

### What Lynx does

The native `bounces` property (iOS over-scroll bounce) defaults to `true` in the Lynx API.

---

## `__SetConfig` doesn't set attributes

### What you'd expect

`__SetConfig(element, { mode: 'aspectFit' })` to give an element those properties, as its name suggests.

### What Lynx does

`Element::SetConfig` (`core/renderer/dom/element.cc`) only stores the table, which `__GetConfig` and `__GetElementConfig` read back. Nothing passes it to the native UI, and web-core keeps it in its own store, so `x-image` never sees it. Set element properties with `__SetAttribute`.

AngularLynx used to create every `<image>` with `__SetConfig(element, { mode: 'aspectFit', fadeIn: true, loadingPlaceholder: '' })`, so images were documented as defaulting to `aspectFit` while they rendered with Lynx's `scaleToFill`. The renderer no longer sets anything on a new image.

---

## The renderer's inline styles beat the app's classes

### What you'd expect

A class such as `h-[120px]` or `border-zinc-200` on an element to apply, as it does on the web unless the element has an inline style for the same property.

### What Lynx does

Inline styles win over class selectors, as on the web. So any default the renderer sets with `__AddInlineStyle` overrides the app's classes. AngularLynx used to give every `<input>` `height: 40px; border: 1px solid` (80px for `<textarea>`): the element-textarea example's `h-[120px]` rendered 80px tall, and a `border-zinc-200` input drew a black border, because the `border` shorthand also reset the color.

Native fields don't need the defaults: iOS and Android measure an `<input>` or `<textarea>` from its font (`LynxUIBaseInputShadowNode`), so it's one line of text tall. They have no border. The renderer now sets no inline styles on them, as React Lynx doesn't. Never give an element default styles inline: the app can only override them with inline styles of its own.

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

Mouse, wheel and key events are the exception, on the platforms that send them. Lynx's desktop engine dispatches them with `TouchEventHandler::HandleBubbleEvent` (`core/renderer/events/touch_event_handler.cc`), which bubbles all but `mouseenter` and `mouseleave`, and Lynx for Web's `common_event_handler` bubbles whatever the DOM event does. iOS and Android don't send them. The bottom sheet's mouse drag relies on this: its backdrop hears `mousemove` from anywhere in the sheet.

The testing library's `fireEvent` follows the same split (`packages/testing-library/src/fire-event.ts`).

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
- **`onWindowResize`** — fires when the Lynx view container is resized. Payload: `{ width, height }`. On the main thread, the page element gets a `resize` event at the same time, whose `detail` is the emitter's arguments, `['onWindowResize', [width, height]]` (see "Lynx elements have no `ownerDocument`" below).

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

On the background thread (the only one that has it; see "Network APIs" above), Lynx's `fetch()` differs from the web's (Lynx's `fetch` docs):

- **No CORS** — Lynx runs as a native client, not a browser origin. All requests are allowed regardless of `Access-Control-Allow-Origin` headers.
- **No `FormData`** — cannot send multipart form data.
- **No `Blob`** — binary data handling is limited.
- **No redirect or `keepalive` options** — redirect behavior may differ from web.
- **Streaming needs a page config flag** — `response.body.getReader()` is experimental and needs `enableFetchAPIStandardStreaming` (next entry).
- **Server-Sent Events** use `lynx.EventSource`, not a global `EventSource`.

---

## `TextEncoder` and `TextDecoder` are missing; the runtime adds them to the main thread

### What you'd expect (web)

`TextEncoder` and `TextDecoder` are standard globals for encoding/decoding UTF-8 strings to/from `Uint8Array`.

### What Lynx does

PrimJS provides neither, on either thread. The background thread has Lynx's `TextCodecHelper` global instead, a plain global rather than a native module, which converts UTF-8 between strings and `ArrayBuffer`s (Lynx's networking guide):

```ts
const str = TextCodecHelper.decode(arrayBuffer);
const buffer = TextCodecHelper.encode(str); // an ArrayBuffer
```

The main thread has no `TextCodecHelper` either (issue #85, Lynx Explorer 4.1 on the iOS Simulator).

### AngularLynx

The runtime installs UTF-8-only `TextEncoder` and `TextDecoder` on the main thread (`packages/runtime/src/lib/network/text-codec.ts`, issue #85), because Angular's `FetchBackend` decodes every `json` and `text` response with `new TextDecoder()`. Any other encoding label throws a `RangeError`, as in browsers.

---

## The main thread's `fetch` is AngularLynx's relay; Lynx's HTTP services report failures as status 499

Found while relaying the main thread's requests (issue #85), in Lynx Explorer 4.1 on the iOS Simulator and an Android emulator, and in Lynx's sources.

### What you'd expect (web)

`fetch()` rejects with a `TypeError` when a request never reaches a server, resolves relative URLs against the page, and is a property of `globalThis`.

### What Lynx does

- **A failed request resolves, with status 499.** `LynxHttpService` (iOS: `SDK_ERROR_STATUS_CODE`; Android: `CODE_FAILED_INTERNALLY`) answers a refused connection, a bad host, a relative URL ("unsupported URL") or Android's cleartext block with status 499, the error's description as `statusText`, no headers and no body. The runtime treats a 499 with no headers as a network failure and rejects, so `HttpClient` reports status 0 as on the web.
- **There's no page URL**, so relative URLs fail ("unsupported URL"). The runtime rejects them with a clear `TypeError` before sending, except a GET of a file the app bundles (below). A `Request` holds a relative URL as written (`new Request('/static/model.glb').url` is `/static/model.glb`, where a browser resolves it against the page), since three.js's `FileLoader` wraps every URL in a `Request` before it fetches: `fetch()` rejects it when it isn't such a GET.
- **On iOS, `statusText` is `OK` for every status**, 404 included (`LynxHttpService.m` hard-codes it). Android uses the HTTP reason phrase, which is empty over HTTP/2.
- **Requests get default headers:** Lynx's `Request` sets `Content-Type: text/plain;charset=UTF-8` when there's no body or a non-`ArrayBuffer` body without a type, so GETs carry it; on iOS, `NSURLSession` adds `application/x-www-form-urlencoded` to a POST of bytes without a type.
- **`fetch` isn't on the background thread's `globalThis`.** The background bundle's wrapper (`RuntimeWrapperWebpackPlugin`'s `tt.define(..., function(..., fetch, XMLHttpRequest, ...)`) takes it as a parameter and falls back to `lynx.fetch`, so `globalThis.fetch` is `undefined` while the bare name `fetch` works. `Headers`, `Request`, `Response`, `AbortController`, `URL` and `TextCodecHelper` are real globals there. The main thread has none of them.
- **No `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `Blob` or `FormData` on either thread.** The background thread has `TextCodecHelper` (a global, not a module) and `__lynxArrayBufferToBase64`/`__lynxBase64ToArrayBuffer`.
- **`response.redirected` and `response.type` are missing** (`undefined`). Redirects are followed; on Android, `response.url` is the request's URL.
- **Aborting a request only rejects its promise.** The native request carries on.

### AngularLynx

The runtime installs `fetch`, `XMLHttpRequest`, `Headers`, `Request`, `Response`, `ReadableStream`, `TextEncoder` and `TextDecoder` on the main thread where they're missing (`packages/runtime/src/lib/network/`, issues #85 and #205), and `atob`, `btoa` and `DOMException` on both threads (issue #206). The background bundle's wrapper takes no parameter by those three names, so unlike `fetch`, a missing one really is missing from `globalThis` there. Its `fetch` relays each request to the background thread's `fetch` through `callOnBackground()`, so `HttpClient` (both backends), `httpResource` and fetch-based libraries work in components. The web preview's main thread is a browser frame and keeps the browser's own.

---

## Without a `ReadableStream` global, Firebase Firestore's queries never return

Found while fixing issue #205 (Firestore 12 against the Firestore emulator, in Lynx Explorer 4.1 on the iOS 27 Simulator, and in Node with the main thread's globals).

### What you'd expect (web)

Every browser has `ReadableStream` and `atob`, and a `Response`'s `body` is a `ReadableStream`. Libraries check for the global before they read `body` as a stream, and fall back to `text()` where it's missing.

### What Lynx does

Neither thread has `ReadableStream`, `atob` or `btoa`. Firestore's browser build sets `useFetchStreams: true` by default, so its WebChannel transport (Closure's `FetchXmlHttp`) makes its requests with `fetch`, not `XMLHttpRequest`: patching `XMLHttpRequest.prototype` logs nothing. With no `ReadableStream`, `FetchXmlHttp` reads each response with `text()` and sets the string as `response`. For the long poll's GET, WebChannel asked for binary chunks and decodes `response` as an array of `Uint8Array`s, which throws inside a `try`/`catch` that drops the response. No error shows: the handshake and one GET go out, the GET answers 200, and nothing follows. Firestore's next step, decoding the resume token, calls `atob`, which threw a `ReferenceError` once the first problem was fixed.

### AngularLynx

The runtime installs `ReadableStream` (`network/readable-stream.ts`) on the main thread and `atob` and `btoa` on both threads, and a relayed response's `body` is that `ReadableStream`. It yields the whole body as one chunk once the response has ended, since the relay carries one message per call. That's enough for Firestore: with `experimentalForceLongPolling: true`, or with its default settings, whose detection sees no bytes arrive while the streaming GET is open and switches to long polling, `getDocs()` and `onSnapshot()` return and live updates arrive. A response that never ends, such as server-sent events, never arrives.

---

## The background thread's `Headers` matches names by exact spelling, so a lowercase `content-type` gets a second, `text/plain` one

Found while fixing issue #176 (a Firebase Auth sign-in posted JSON from the main thread and the emulator rejected it as `text/plain;charset=utf-8`), in Lynx Explorer 4.1 on the iOS 27 Simulator and an API 34 Android emulator, and in Lynx's sources.

### What you'd expect (web)

Header names are case-insensitive. `new Headers({ 'content-type': 'application/json' }).get('Content-Type')` returns `application/json`, iterating a `Headers` lists the names in lowercase, and a request carries one `Content-Type`, the one the app set.

### What Lynx does

- **Through Lynx 4.2, the background thread's `Headers` is a `Map` keyed by the name as given** (`js_libraries/lynx-core/src/modules/fetch/Headers.ts`). `get`, `has`, `set` and `delete` match by exact spelling, and iteration keeps the given case. Lynx's `develop` branch lowercases names since 2026-08-25 (5914e2a871), but 4.2.0 doesn't have it yet.
- **`Request` looks for `Content-Type` by that spelling.** When it misses, it adds `Content-Type: text/plain;charset=UTF-8` (for a string body, or no body) beside the request's own `content-type`, and native receives both.
- **iOS sends one of the two, depending on the other headers.** `LynxHttpService.m` copies the headers into an `NSURLRequest` with `setValue:forHTTPHeaderField:`, which matches names case-insensitively, so whichever comes last in the `NSDictionary`'s order wins. On the Simulator, a JSON POST relayed with `content-type` and `x-api-key` arrived as `application/json`; the same POST from `HttpClient`, which adds `accept`, arrived as `text/plain;charset=UTF-8`.
- **Android sends both.** `LynxHttpService.kt` builds OkHttp `Headers` from the map, which keeps every entry, so the server gets two `Content-Type` headers in `HashMap` order. Node keeps the first; other servers and proxies may take the other or reject the request.
- **Response header names differ by platform, and `get()` is case-sensitive.** iOS gives them capitalized (`Content-Type`), so `response.headers.get('content-type')` is `null` there. Android lowercases them (OkHttp's `toMultimap()`), so `get('Content-Type')` is `null` there.
- **Other names go through as spelled.** Lynx's own code looks up only `Content-Type`; a host app's custom `LynxHttpService` could look up others by their usual spelling.
- **Lynx for Web is unaffected.** Its background thread runs in a Web Worker, so the bundle gets the worker's own `fetch`, whose `Headers` is the standard one.

### AngularLynx

The main thread's `Headers` lowercases names, as the standard's does, so the relay (`packages/runtime/src/lib/network/background-fetch.ts`) sends every name in canonical case (`content-type` → `Content-Type`, `x-api-key` → `X-Api-Key`), and reads the response's type by comparing names case-insensitively rather than with `get()`. A request from `fetch`, `XMLHttpRequest` or `HttpClient` in a component now arrives with the one `Content-Type` it set, on both platforms. Code that calls Lynx's `fetch` itself on the background thread (in a `backgroundFn`) has to spell `Content-Type` exactly and look response headers up in both cases.

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

On native, `text-maxline` alone only limits the lines used for layout: the text box ends after that many lines on both platforms. What happens to the rest depends on the platform. iOS cuts the text off at the last line, with no ellipsis. Android draws the remaining lines anyway, below the box and over whatever follows it. `text-overflow: ellipsis` (Tailwind's `text-ellipsis`) makes both platforms stop at the last line with "…", so always pair the two. Passing the line count as a number or a string makes no difference (seen on Lynx 4.1, Android API 34 and iOS 27, 2026-10-20).

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
- **`accessibility-traits`** — element type hint such as `'button'`, `'image'`, `'header'` or `'link'` (simpler than ARIA roles). The name is plural: iOS (`LynxUI.m`), Android (`PropsConstants.ACCESSIBILITY_TRAITS`) and Harmony ignore `accessibility-trait`. `LYNX_ELEMENTS` declared the singular until 22.2.3.
  - **Only iOS reads a list** (see "`accessibility-traits` takes a comma list on iOS, and a single trait on Android" above). Harmony, like Android, reads one trait, and maps only `text`, `image` and `button` (`UIBase::GetAccessibilityType`). The `selected` trait is the closest thing to `aria-selected`, and it's iOS-only.
  - **`tabbar` goes on a container.** VoiceOver reads the tab bar trait from a view that isn't an accessibility element itself, so the tabs inside it stay reachable (the `@blotch/ui` tab bar does this).
  - **Defaults:** `<text>` has the static-text trait and `<image>` the image trait (`accessibilityTraitsByDefault` in `LynxUIText.m`, `LynxUIImage.mm`); setting `accessibility-traits` replaces the default.
- **The accessible name** — iOS sets an element's `accessibilityLabel` from `accessibility-label` (with `accessibility-status` prepended as `"status, label"`), and a `<text>` without a label uses its own text. A `<view>` never takes a name from the text inside it: once it's an accessibility element, VoiceOver reads its label and skips its children. Give an `accessibility-element` view an `accessibility-label`.
- **Testing:** `@blotch/angular-lynx-testing-library`'s `*ByRole` reads these (traits → ARIA roles, reachability, `accessibility-label` names, the `selected` trait, `accessibility-value`), and `*ByAccessibilityLabel` finds elements by label, since Testing Library's own queries read only ARIA and `<label>`.
- **`accessibility-elements`** — comma-separated `id`s (iOS looks each up with `uiWithIdSelector`) controlling focus order and limiting which children are accessible (no ARIA equivalent; closest is `aria-flowto`).
- **`accessibility-elements-hidden`** — equivalent to `aria-hidden="true"` on a subtree.
- **`accessibility-exclusive-focus`** — traps focus within the element (like a modal dialog's focus trap). No direct ARIA equivalent; ARIA requires `aria-modal` + JavaScript focus management.
- **`lynx.accessibilityAnnounce(message)`** — programmatically sends an announcement to the screen reader (equivalent to an `aria-live` region update).

There is no equivalent to `role`, `tabindex`, `aria-expanded`, or most other ARIA attributes, and only iOS has one for `aria-selected` (the `selected` trait).

---

## `performance.now()` is not available; use `lynx.performance` trace API instead

### What you'd expect (web)

`performance.now()` returns a high-resolution timestamp in milliseconds for fine-grained timing measurements.

### What Lynx does

`performance.now()` is **not available** in native Lynx: there's no `performance` global on the main thread or the background thread (checked in Lynx Explorer 4.1 on iOS). The web preview has one on both, since it runs in the browser. For simple timing, `Date.now()` is available everywhere, in whole milliseconds; `LynxDevTools`' `lastCdDurationMs` falls back to it.

For profiling and performance tracing, use `lynx.performance` (wrapped by `LynxPerformance`), which exists on both threads:

- `lynx.performance.profileStart(name, option?)` — begin a named trace span
- `lynx.performance.profileEnd()` — end the most recent span
- `lynx.performance.profileMark(name, option?)` — instant marker
- `lynx.performance.profileFlowId()` — a new ID to link spans and marks
- `lynx.performance.isProfileRecording()` — whether a trace is recording

`option` is `{ flowId?, flowIds?, args? }` for spans and marks alike. Native Lynx keeps only the string values of `args` and silently drops the rest (`HandleProfileNameAndOption` in `core/runtime/lepus/bindings/renderer_functions.cc` and `core/runtime/js/bindings/js_app.cc`). Release builds of the engine compile tracing out, so the calls cost almost nothing there.

On a device, these emit trace events in Perfetto format, for Lynx DevTool's trace recording. Web-core maps them to the Web Performance Timeline instead: a span becomes a User Timing measure, and a mark a mark, with `option` as its `detail`. `isProfileRecording()` there is `true` whenever `performance` exists.

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

- **`calc()`** — supported with basic arithmetic (`+`, `-`, `*`, `/`, parentheses). Works with CSS variables via `var()` in a stylesheet, but not in an inline style (see "`var()` inside `calc()` in an inline style is never substituted" below). A `calc()` inside another `calc()` isn't: the whole value is dropped (see "A `calc()` inside another `calc()` drops the value" below).
- **`min()`, `max()`, `clamp()`** — not supported. Calculate responsive bounds in JavaScript and set them via signals or inline styles.
- **`env()`** — **supported** for safe area insets: `env(safe-area-inset-top|right|bottom|left)` parses as a length, and it also works **inside `calc()`** (e.g. `padding-bottom: calc(1rem + env(safe-area-inset-bottom))`). Verified in the Lynx core CSS engine ([`lynx/core/renderer/css/css_style_utils.cc`](https://github.com/lynx-family/lynx/blob/develop/core/renderer/css/css_style_utils.cc) — `GetEnvValue`, and the `calc` parser accepts `env()` tokens).
  - **A fallback isn't read:** `GetEnvValue` looks the whole text between the parentheses up as the name, so `env(safe-area-inset-bottom, 0px)` isn't a length at all and the declaration is dropped. The build and runtime rewrite below drop the fallback, so it works in an app.
  - **Caveat:** the four values are process-wide statics in Lynx's C++ core (`ComputedCSSStyle::SAFE_AREA_INSET_*`), not per view, and they're `0` until something sets them. Styles that depend on them then degrade to plain padding rather than erroring.
    - On iOS, `LynxEnv`'s `setKeyWindowAndStatusBar` copies the key window's `safeAreaInsets` into them each time a LynxView is created (`initLayoutConfig`, called from `LynxTemplateRender`; it's public, but reads only a scene that's already foreground-active, `LynxUIKitAPIAdapter.getKeyWindow`). A LynxView created before its window is key reads 0.
    - On Android nothing sets them, so `env()` is always 0. `liblynx.so` doesn't export them either, so a host can't set them through JNI.
    - **Nothing on screen follows a change.** An element resolves `env()` when its style is set; `DynamicCSSStylesManager::GetValueFlags` gives the `ENV` pattern no update flag (`// TODO:`), so a rotation, or setting the statics again, leaves every element with the value it read.
    - **The generated apps (issue #281) don't use Lynx's `env()`.** They draw the page edge to edge and send `edgeToEdge` with the insets as global props. The build plugin (`safe-area.ts`) writes each `env(safe-area-inset-*)` in a stylesheet as `var(--angular-lynx-safe-area-inset-*, env(safe-area-inset-*))`, and the page sets the variables, which restyle every element that reads them when they change. Inline styles can't use a variable inside `calc()` (below), so the runtime writes the inset into them in px and writes them again when it changes (`lynx-element/safe-area-insets.ts`). Elsewhere, as in Lynx Explorer, nothing sets the variables and the `var()` falls back to Lynx's `env()`. A custom property defined in a stylesheet keeps Lynx's `env()`, as a `var()` inside a function in one never resolves.
    - Measured on the iOS 27 simulator (iPhone 18 Pro, 62/34pt) and the Android emulator (Pixel 6 API 34, 48.76/24dp), November 2026: stylesheet `env()` and `calc(10px + env())`, Tailwind 4's `calc(calc(var(--spacing) * 2) + env())` (only where a production build's minifier had flattened it: a development build dropped it until issue #327, see "A `calc()` inside another `calc()` drops the value"), inline strings and `[style.height]` bindings all gave the insets, followed rotation, and on Android dropped the bottom inset to 0 while the keyboard was open. In Lynx Explorer the same bundle gave Explorer's own insets through the fallback; the web preview gave 0.
    - Lynx Explorer creates its views later and gets the real insets (top 62, bottom 34 on the iPhone 18 Pro simulator), though its page already sits below the status bar.
    - Except when a `lynx://open` link starts Explorer: a bundle opened while Explorer isn't running yet reads 0 for every inset, even with `?fullscreen=true` (seen on the iOS 27 simulator, October 2026). To check a layout that pads for the insets, such as a tab bar above the home indicator, launch Explorer first, then open the link.
    - For JavaScript, the generated apps and Lynx Explorer send the insets (`safeAreaTop` and so on) and `isNotchScreen` as global props (issue #58). Inject `LynxSafeArea` for `isNotchScreen()`.
  - The `@blotch/ui` Tailwind plugin ships `*-safe` / `*-safe-<n>` padding utilities built on this (see `packages/ui/src/lib/theme/tailwind-plugin.ts`).

---

## A `calc()` inside another `calc()` drops the value

### What you'd expect (web)

`padding-top: calc(calc(var(--spacing) * 3) + env(safe-area-inset-top))` is the same as `calc(var(--spacing) * 3 + env(safe-area-inset-top))`: a nested `calc()` is just a group.

### What Lynx does

The whole declaration is dropped, as if the property weren't set: the element gets no padding at all, not even the spacing. It doesn't matter what's inside: `calc(calc(4px * 3) + 100px)` fails as `calc(calc(var(--x) * 3) + var(--y))` does, in a stylesheet and in an inline style, on either side of the operator. Plain parentheses work: `calc((4px * 3) + 100px)`.

- **Why:** `TryMakeCalcNLength` (core/renderer/css/css_style_utils.cc) skips the leading `calc` and reads the rest character by character, treating `(` and `)` as grouping operators and everything between operators as a length. An inner `calc` is read as a length named `calc`, which `LengthHandler::Process` rejects, so the evaluator gives up on the whole value.
- **Where it comes from:** Tailwind 4 writes `--spacing(3)` as `calc(var(--spacing) * 3)`, so any utility that adds to a spacing value nests one, such as the `@blotch/ui` theme's `pt-safe-3` (`calc(--spacing(3) + env(safe-area-inset-top))`). A production build hides it, because the CSS minifier flattens nested `calc()`s; a development build (`-c development`, `ng serve`) keeps them, which is how issue #327 looked like an Android-only safe-area bug: its Android app was a development build and its iOS app a production one.
- **What AngularLynx does:** the build plugin writes each `calc()` nested in another as parentheses in every stylesheet, at `OnceExit` so it sees what Tailwind 4's lowering writes too (`packages/rsbuild-plugin-angular-lynx/src/nested-calc.ts`), and the runtime does the same to inline styles (`lynx-element/nested-calc.ts`). A `calc()` that only nests once Lynx substitutes a variable, such as `width: calc(var(--a) * 2)` with `--a: calc(1px + 2px)`, is still dropped: nothing sees it nested before Lynx does. Keep `calc()` out of a variable that a `calc()` reads, or put the arithmetic in the property.

Probe (2026-11-07): stripes in a development build on the Android emulator (Pixel 6 API 34), each padded by a nested or flat `calc()`, in a stylesheet and inline. Every nested one got no padding; the flat and parenthesized ones did, and after the fix every nested one did too, except `padding-top: calc(var(--sixty) + 40px)` with `--sixty: calc(50px + 10px)`, which still got none. The evaluator is in Lynx's shared core; iOS wasn't run.

---

## `var()` inside `calc()` in an inline style is never substituted

### What you'd expect (web)

`style="height: calc(10px + var(--h))"` substitutes the variable, then computes the length, as the same declaration in a stylesheet does.

### What Lynx does

The declaration is dropped: the element gets no height. Only a stylesheet gets it right.

- A bare `var()` inline works (`style="height: var(--h)"`, or `[style.height]="'var(--h, 34px)'"`), and so does `var()` inside `rgba()` (see "`var()` inside `rgba()` is substituted as text").
- `calc()` with a `var()` fails both ways in, `style="..."` and a `[style.height]` binding, whichever side of the `+` the `var()` is on.
- **Why:** `Element::MergeInlineStyles` (core/renderer/dom/fiber/fiber_element.cc) first hands each inline value to `UnitHandler::Process`, and looks for `var()` (`CSSStringParser::ParseVariable`) only if that fails. The length handler takes any `calc(...)` as a `CALC` value without reading inside it, so it succeeds, and the `var()` is never substituted; `calc()` can't evaluate it later. A stylesheet's declaration doesn't go that way: the CSS serializer marks any declaration holding a `var()` as a variable one at build time.
- **Workaround:** compute the value in TypeScript, or put the `calc()` in a stylesheet. The runtime does the first for `env(safe-area-inset-*)` in inline styles (issue #281).

Probe (2026-11-05): inline stripes on the iOS 27 simulator in a generated app, each meant to be 44pt.

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

| Attribute                    | Purpose                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `native-interaction-enabled` | Toggle whether the element consumes platform gestures (defaults differ per platform: `true` on iOS, `false` on Android)   |
| `pan-intercept-direction`    | Block platform scroll gestures in a specific direction: `0` = horizontal, `1` = vertical                                  |
| `pan-intercept-scope`        | Which nodes' gestures are affected: `0`=self, `1`=ancestors, `2`=descendants, through `5`=all. Android ignores `6` and up |
| `block-native-event`         | Blocks platform-layer gestures entirely (e.g., iOS right-swipe-to-go-back)                                                |
| `block-native-event-areas`   | Limits `block-native-event` to specific rectangular regions: `[['0px','0px','50%','100%']]`                               |
| `consume-slide-event`        | Blocks platform scroll based on swipe angle (degrees): `[[-45, 45]]` blocks rightward swipes                              |

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
- **An `element.animate()` animation to show.** On the Android emulator, a `transform` animation on a plain `<view>` ran (its `animationstart` and `animationend` events fired on time) but the view never moved. Its only listeners were animation events. With `[flatten]="false"` it moved. Found while checking issue #57.
- **Reliable `overflow: hidden` clipping of `position: absolute` children.** A
  plain `<view style="overflow: hidden">` with absolutely-positioned children
  can clip inconsistently on Android — the clip boundary appears to shift
  depending on unrelated state changes, and some edges may not clip at all —
  because a flattened view has no dedicated native View to own the clip
  region. Observed in `UiCartesianChart` (the view-based chart base, since
  replaced by `<ui-chart>`, which clips inside its `<svg>`): the
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
  `[flatten]="false"` container, but that same clip sliced the _legitimate_
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

## Angular Renderer2 ignores namespaces and listener options

### What you'd expect (Angular web)

`Renderer2.createElement()` supports SVG namespaces. `Renderer2.listen()` supports passive, capture, and once options. `Renderer2.setStyle()` supports `RendererStyleFlags2`.

### What Lynx does

The Lynx `Renderer2` implementation passes through element creation and style changes to Lynx native functions, but:

- **Namespace parameters** are silently ignored in `createElement()`, `setAttribute()`, and `removeAttribute()`. SVG element creation via namespace does not work through Angular's API (use the `<svg>` Lynx element directly).
- **Listener options** (`passive`, `capture`, `once`) are ignored in `listen()`. All events are registered with default behavior.
- **`RendererStyleFlags2`**: `Important` appends `!important` to the value, and `DashCase` keeps the name as written (see the style-name entry). No CSS sanitization is applied.
- **`setValue(node, value)`** sets `node.setAttribute('text', value)` rather than `node.textContent = value`. This works because Lynx text nodes use a `text` attribute internally.

---

## CSS style property names: the renderer converts camelCase to kebab-case

### What you'd expect (web)

`element.style.backgroundColor = 'red'` automatically maps to `background-color` in CSS. Angular's `setStyle('backgroundColor', value)` is equivalent to `setStyle('background-color', value)`.

### What Lynx does

`__AddInlineStyle()` takes CSS property names as CSS writes them (`background-color`), and doesn't convert camelCase. So the renderer does: `setStyle()` and `removeStyle()` in `packages/runtime/src/lib/renderer/renderer.ts` turn `backgroundColor` into `background-color`, unless Angular passes `RendererStyleFlags2.DashCase`, which it does for any name that already has a dash (including custom properties such as `--myColor`, which keep their case). `[style.backgroundColor]` and `[style.background-color]` both work.

---

## Unrecognized event name prefixes silently produce no-op listeners

### What you'd expect (web)

`element.addEventListener('click', handler)` always registers the listener. Invalid event names still register (they just never fire).

### What Lynx does

Event listener registration requires names to match specific prefixes: `bind`, `catch`, `capture-bind`, `capture-catch`, or `global-bind`. If the event name does not start with one of these prefixes, `addEventListener()` returns an **empty unsubscribe function** and the listener is never registered. No error is thrown. This means standard DOM event names like `focus` and `input` silently fail — you must use `bindfocus` and `bindinput` instead. `click` is the exception: it's registered as `bindtap` (see "Lynx elements fire `tap`, not `click`" above).

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

- **`<canvas>`** — Lynx has none. AngularLynx adds one with a WebGL2 context, but no 2D context (see the next section).
- **`<video>` / `<audio>`** — not supported as built-in elements. Media playback requires native bridge integration via `lynx.requireModule()`.
- **`<iframe>`** — replaced by the Lynx-specific `<frame>` element (which embeds another Lynx page, not arbitrary web content). There is no way to embed web URLs.

---

## `<canvas>` with WebGL2 is AngularLynx's own, drawn through a main-thread module

### What you'd expect (web)

`<canvas>` with `getContext('webgl2')`, whose calls run on the GPU as they're made, and whose answers (a shader's compile status, a uniform's location) come back at once. three.js, angular-three and every WebGL library rely on that.

### What Lynx does

Open-source Lynx has no canvas on iOS or Android (lynx-family/lynx has no WebGL; `@lynx-js/web-elements` has an `x-canvas`, marked deprecated because "this proposals cannot be implemented on other platforms"). AngularLynx adds it (issue #211):

- **The element.** The shells register a `canvas` UI (`AngularLynxCanvas` on iOS, a `CAMetalLayer` view; `CanvasUI` on Android, a `TextureView`), paired with its context by a `canvas-id` attribute the runtime sets. On Lynx for Web, `__CreateElement('canvas')` gives a real HTML `<canvas>` (web-core creates a tag it has no element for as it is), so the browser's WebGL2 draws. A host without the shell's module (Lynx Explorer) gets a view, because on Android an element nothing is registered for stops the elements after it rendering.
- **Synchronous native calls from the main thread.** Angular runs on the main thread, where `NativeModules` doesn't exist, and the relay to the background thread is asynchronous. Lynx 4.1 has main-thread modules: with `enableMTSModule` on the LynxView builder (iOS `builder.enableMTSModule`, Android `setEnableMTSModule(true)`), the modules registered on the builder's config are callable from main-thread JavaScript as `lynx.module(name).invoke(method, ...args)`, synchronously, on the UI thread (`LynxLepusModule::InvokeMethod`, `renderer_ng.cc`'s `module` function). The WebGL context uses the `AngularLynxWebGL` module, and `fetch` the `AngularLynxAssets` module (below).
- **A call's cost.** Measured on Lynx 4.1: about 80 µs a call on the iOS Simulator, nearly all of it Lynx logging each module call at INFO level (2 µs with the minimum log level at warning), and about 7 µs on the Android emulator. So the context doesn't make one per GL call: it records the calls into an array and sends them in one `run` at the end of the task (a microtask), or when a call needs an answer. A three.js frame is one call. A program's link status, log, active uniforms and attributes and their locations come back together after each link, and the limits, precisions and extensions when the context is made.
- **What crosses the bridge.** Numbers, strings, arrays and plain objects. An `ArrayBuffer` or typed array arrives as an empty map; returning an `NSData` crashes the main thread's PrimJS (`js_object_toString` on the result); a string ends at its first NUL (Android too). So bytes cross as an array of 32-bit words with the byte count last: `Array.from(new Uint32Array(buffer))` builds it at C speed, about 0.1–0.2 µs a word to convert natively. Base64 in JavaScript was 5 ms per 64 KB on iOS.
- **Arrays coming back on iOS** are array-likes that `.map()` and destructuring read, but `new Int32Array(value)` reads as empty. The runtime turns them into plain arrays (`numbersFrom` in `network/words.ts`) before making typed arrays; three.js reads `VIEWPORT` and `SCISSOR_BOX` that way.
- **OpenGL ES 3.0.** Its shading language, GLSL ES 3.00, is WebGL2's, so three.js's shaders compile as they are. On Android it's the phone's. On iOS it's [ANGLE](https://chromium.googlesource.com/angle/angle)'s, on Metal (issue #238), as Safari's WebGL is: iOS's own OpenGL ES is deprecated (since iOS 12, though still in the iOS 27.2 SDK), and the Simulator runs it on the CPU (below). ANGLE's EGL window surface draws into the canvas view's `CAMetalLayer`, sizing its drawables from the layer's bounds and scale. The context asks for robust resource initialization, so textures and buffers made without data read as zeros, as WebGL requires. The default framebuffer is an offscreen one the shell makes at the canvas's `width` and `height` (multisampled when `antialias`), copied to the view after each frame that drew to it, and cleared, as WebGL's is, unless `preserveDrawingBuffer`. GLES can't read a multisampled framebuffer (`readPixels()` and `copyTexImage2D()` on one are `INVALID_OPERATION`, and read nothing), so a read of the default framebuffer resolves its samples first, as showing a frame does.
- **The iOS Simulator runs iOS's OpenGL ES on the CPU** ("Apple Software Renderer"), which is why the shell draws with ANGLE. With OpenGL ES, a lit, shadowed three.js scene at three times the screen's resolution took about 850 ms a frame, a smaller one ran at about 7 fps, and the Simulator dropped one triangle of a floor plane whose corners reached far outside the view, which the Android emulator and Chrome drew from the same commands. Measured for issue #238 (iOS 27 Simulator on an M5 Pro Mac), `examples/element-canvas`'s scene (a 716 × 640 drawing buffer, antialiased, with soft shadows from a 2048 px shadow map) ran at 3.6 fps on OpenGL ES, about 280 ms a frame, and at 60 fps on ANGLE's Metal ("ANGLE Metal Renderer: Apple iOS simulator GPU"), each frame's `run` taking about 0.3 ms of the UI thread. A 400 × 400 plane around it drew whole.
- **ANGLE's first launch compiles shaders.** ANGLE blits, clears and converts formats with Metal shaders of its own, and compiles them from source when its display starts unless they're prebuilt: 5.7 s of the UI thread on a fresh install in the Simulator (Metal caches compiled shaders per app, so the next launch took 20 ms). `build-angle-ios-frameworks.sh` prebuilds them, which takes Xcode's separately downloaded Metal toolchain and a Simulator target of their own (ANGLE's `-mios-version-min` targets devices whatever the SDK); with them, making the context took 44 ms on a fresh install. An app's own shaders still compile when a program links, as on the web: on a fresh install, three.js's first program took about 1.9 s (Metal's compiler starting up) and the next ones 0.2–0.3 s; from Metal's cache on later launches, about 20 ms.

### What to do

Use `<canvas>` with `getContext('webgl2')` in an app built with `ng build --platform ios|android`, or in the web preview. three.js and angular-three need the DOM globals the runtime adds on the main thread (`canvas/dom-globals.ts`): `performance.now()`, `crypto.randomUUID()` (from `Math.random()`, so not for secrets), `self`, `ProgressEvent`, an `HTMLElement` class a template's elements are instances of (angular-three takes its pointer listeners off the element its events connect to only if it's an `HTMLElement`, so without one they stayed on every canvas's host after the canvas had gone), an `HTMLCanvasElement` class nothing is an instance of, `Image`, `ImageBitmap`, `createImageBitmap()`, `Blob`, object URLs, `devicePixelRatio`, `getComputedStyle()` and `ResizeObserver`.

---

## PrimJS keeps what an array held after it shrinks (issue #299)

### What you'd expect (web)

Taking a value out of an array lets it go: once `pop()`, `shift()`, `splice()` or a shorter `length` has removed it, the array no longer keeps it alive.

### What Lynx does

PrimJS, which runs the main thread (and Android's background thread), keeps a fast array's elements in a buffer, and its garbage collector marks every slot of the buffer, not just the ones below `length`. Shrinking an array only lowers its length, and leaves what it removed in its slot, alive for as long as the array is, until a later push writes over it. In PrimJS's source, `js_array_pop()` and `set_array_length_gc()` lower the count without clearing the slot, as does deleting an array's last element, and `Visitor::VisitJSValueArray()` marks the buffer by its allocated size. Measured on the iOS Simulator (Lynx 4.1), with a `WeakRef` to an object taken out of a kept array, after allocating enough to make PrimJS collect:

| Taken out with                      | Collected? |
| ----------------------------------- | ---------- |
| `pop()`                             | **No**     |
| `splice()`                          | **No**     |
| `length = 1`                        | **No**     |
| Assigning another value to its slot | Yes        |

An array that lives as long as its owner, used as a stack or a list, so keeps the last things it held. That kept whole screens. three.js's renderer pushes each frame's render list and render state onto stacks and pops them when the frame ends; the popped render list still points at the meshes it drew, and through angular-three at their scene, its store, the screen's components and every native view on the screen. three.js keeps every renderer that drew a material that's still in use (it hangs a `dispose` listener on the material), so a module-level material, or a model or texture from angular-three's loader cache, kept every screen its canvas was ever shown on. On the web the same renderer keeps only itself, its canvas and its GL state. In the Blotch app, after 4 round trips to a screen whose canvas drew one module-level material (the one screen left is the one showing):

|        | Screens alive | angular-three stores | Scenes | Renderers | `LynxUI*` |
| ------ | ------------- | -------------------- | ------ | --------- | --------- |
| Before | 5 of 5        | 5 of 5               | 5 of 5 | 5 of 5    | 1,395     |
| After  | 1 of 5        | 1 of 5               | 1 of 5 | 5 of 5    | 324       |

Its real 3D frame, which drew the loader's cached glTF materials and texture, went the same way.

It showed up as a closure because nothing a walk of properties from the renderer reached led to the screen: the stacks hold their render lists only in slots past their length, which no property, `Map` or `Set` walk visits.

### The fix

The build plugin's first preEntry (`packages/rsbuild-plugin-angular-lynx/src/vacated-slots.js`, imported by `polyfills.js`) replaces `pop()`, `shift()` and `splice()` in native builds with versions that call the engine's own, then write `undefined` into the slots the array gave up and put the length back. Each write appends, so the array stays a fast one. The web build keeps the browser's methods.

JavaScript can't hook a shorter `length` or `delete array[array.length - 1]`, so those still keep what they cut off: empty a long-lived array that holds objects with `array.splice(0)` rather than `array.length = 0`. Only PrimJS can fix those: reported as [lynx-family/primjs#484](https://github.com/lynx-family/primjs/issues/484). Once a Lynx release has its fix, `vacated-slots.js` can go.

A material that outlives its canvas still keeps the renderer, with its canvas, native view and GL state, as in a browser: give each canvas copies (`material.clone()`, and `texture.clone()`, which shares the decoded image).

Covered by `packages/rsbuild-plugin-angular-lynx/src/vacated-slots.test.ts` (the methods' writes and results, in Node, whose engine collects what an array gave up either way) and Layer 6's `native/array-slots.yaml` (on a device, where it matters).

---

## A file the app bundles has no URL `fetch` can reach on a phone

### What you'd expect (web)

`fetch('/static/image/x.png')` resolves against the page's URL and loads the file the build emitted.

### What Lynx does

There's no page URL on the main thread, and in an app built with `ng build --platform`, the app's `dist/` is inside the app, not on a server: Lynx's own `<image>` reads `/static/...` through the shell's resource fetcher. (`ng serve` gives assets absolute URLs on the dev server, so they load in Lynx Explorer.) A texture or glTF model an app imports would fail to load.

### What to do

Nothing: the main thread's `fetch` (and so `Image`, three.js's loaders and HttpClient) answers a GET of a relative URL, given as a string or a `Request`, from the shell's `AngularLynxAssets` module, which reads the file the way the resource fetchers do (`BundleResourceFetcher.localFile` on iOS, `BundleAssets` on Android). A host without the module still rejects relative URLs.

---

## No drag-and-drop, clipboard, file system, or Web Worker APIs

### What you'd expect (web)

`DataTransfer`, `navigator.clipboard`, File API, `showOpenFilePicker()`, `Worker`, `SharedWorker` are standard browser APIs.

### What Lynx does

None of these web APIs exist in Lynx:

- **Drag and drop** — no `DragEvent`, no `draggable` attribute, no `DataTransfer`. Implement custom drag via touch events.
- **Clipboard** — no `navigator.clipboard`. Copy/paste must go through native bridge modules: `LynxClipboard` (issue #303) calls the shells' `AngularLynxClipboard` module. See [the web preview's clipboard needs the page's window](#the-web-previews-clipboard-needs-the-pages-window) for the web side.
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

## `Intl` is missing where Angular runs, and `localeCompare` and `toLocaleString` ignore the locale

### What you'd expect (web)

`Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.PluralRules`, `Intl.Collator`, `Intl.DisplayNames` and the rest are standard globals in all modern browsers and Node.js, and the locale-sensitive methods use them: `'é'.localeCompare('z')` is `-1`, `(1234.5).toLocaleString('de')` is `"1.234,5"`, and `String.prototype.normalize` exists.

### What Lynx does

Measured for issue #306 (2026-11-06, Lynx 4.1) on the iOS Simulator (iOS 27.0) and an Android emulator (API 34), in Lynx Explorer and in the apps `ng build --platform` makes, on both threads:

| Thread                            | Explorer, iOS | Explorer, Android | Generated app, iOS                          | Generated app, Android |
| --------------------------------- | ------------- | ----------------- | ------------------------------------------- | ---------------------- |
| Main (PrimJS, where Angular runs) | no `Intl`     | no `Intl`         | no `Intl`                                   | no `Intl`              |
| Background                        | no `Intl`     | no `Intl`         | JavaScriptCore, with `Intl` and `normalize` | no `Intl`              |

`SystemInfo.runtimeType` says which engine the background thread got: `quickjs` (PrimJS) in Explorer on both platforms, `jsc` in the generated iOS app. (Issue #68 saw JavaScriptCore in Explorer on iOS too, so it can change with how the host creates the LynxView.) Where `Intl` is missing, PrimJS also:

- **compares UTF-16 code units in `localeCompare`**, ignoring `locales` and `options`, and returns their difference rather than -1, 0 or 1: `'é'.localeCompare('z')` is `111`, `'a'.localeCompare('A')` is `32`, and `['Zoë', 'apple', 'Émile'].sort((a, b) => a.localeCompare(b))` puts `Zoë` first and `Émile` last;
- **has no `String.prototype.normalize`** at all (`'é'.normalize('NFD')` throws "not a function");
- **formats dates one fixed way** in `Date.prototype.toLocaleString()` and its siblings, whatever the locale: `01/15/2026, 01:05:09 PM`;
- **ignores the locale in `toLocaleUpperCase`/`toLocaleLowerCase`** (`'i'.toLocaleUpperCase('tr')` is `I`, not `İ`).

Its `Date` does apply the device's time zone, daylight saving time included (`getTimezoneOffset()` and `getHours()`), and its regular expressions take Unicode property escapes from `new RegExp()`, `\p{Script=Hebrew}` included (but see the next section for regex literals).

So any code that runs in a component, service or template handler has no `Intl`, on either platform, and passes in specs, which run in Node. Lynx's `enableICU` page config binds ICU into the JS context, but only through a host-provided service (`LynxServiceI18nProtocol` on iOS, `ICURegister` on Android) that Lynx Explorer and our shells don't have.

- **i18next v24+** requires `Intl.PluralRules`.
- **Angular's own pipes don't need it.** `DatePipe`, `DecimalPipe`, `CurrencyPipe`, `PercentPipe` and `I18nPluralPipe` format from the locale data registered with `registerLocaleData()` (`en-US` is built in). `@angular/common` 22 never calls `Intl`.

### The fix

The build option `intl` (`"intl": ["DisplayNames", "NumberFormat", "Collator"]` in angular.json, or `pluginAngularLynx({ intl })`) adds the APIs it lists to the Lynx bundle, on both threads, before the app's modules: FormatJS's polyfills (`@formatjs/intl-*`, which the app installs) with the data of `i18n.sourceLocale` and `i18n.locales`, and our own `Intl.Collator`, since FormatJS has none (`packages/rsbuild-plugin-angular-lynx/src/intl/`). The web bundle gets nothing: the browser has `Intl`. On an engine with its own `Intl` (the generated iOS app's background thread) the polyfills install nothing and the setup leaves it alone.

Three things FormatJS leaves to the host are filled in:

- **The default locale** (`new Intl.NumberFormat()`, `n.toLocaleString()`) is the phone's language (`appLocale`) when the app has data for it, else the source locale, as `provideLocale()` picks `LOCALE_ID`. FormatJS would use the first locale whose data loaded.
- **The default time zone** is the device's: FormatJS's default is UTC and it knows no zone without its 800 kB of zone data. The setup reads the offsets from 1900 to 2100 from the engine's `Date` (weekly samples, each change found to the second; 1 to 4 ms) and adds them as a zone under the IANA name the generated apps send as `appTimeZone` (Explorer sends none, so it's `Etc/Unknown`).
- **`Intl.Collator` and `localeCompare`**: the build asks Node's ICU how each locale orders the characters of the scripts most apps show and writes the answer down as three weights per character, plus two-letter contractions and letters that sort as two (`intl/collation-data.ts`). The runtime compares with them as the Unicode Collation Algorithm does. On 120 words in 10 locales and 8 option sets, it orders every pair as ICU does.

FormatJS's polyfills ran without a fix on PrimJS: an app compared 58 cases (each API, compact and currency numbers, date styles and ranges, plural categories, region names, sorting) on both threads with FormatJS's own output in Node, and all matched on iOS and Android. They differ from Node's ICU only where FormatJS's CLDR data does (`"… 2026, 1:05 PM"` against ICU's `"… 2026 at 1:05 PM"`, and which spaces they use). The bundle grows by about 1.07 MB per thread for all seven APIs with one locale, and about 0.43 MB per thread for each locale after that; the website's Internationalization guide has the numbers per API. FormatJS's `intl-getcanonicallocales/polyfill.js` is a bundle with its own copy of CLDR's likely subtags, which `intl-locale` imports again from the package's index, so the build installs `Intl.getCanonicalLocales` from the index itself and saves 120 kB per thread.

---

## The build's main-thread bytecode compiler rejects `\p{…}` in a regex literal

### What you'd expect (web)

`/^\p{Script=Hebrew}/u` is valid JavaScript since ES2018, and any engine that runs it compiles it.

### What Lynx does

The Lynx bundle's main-thread script is compiled to bytecode at build time. That compiler fails the build on any Unicode property escape in a regex literal, General_Category ones (`/^\p{L}$/u`, `/^\p{P}$/u`, `/^[\p{P}\p{Z}]$/u`) as much as Script ones (`/\p{Script=Latin}/u`): `Compile error: main-thread.js exception: SyntaxError: invalid escape sequence in regular expression`. A code point escape with the same flag (`/\u{1F600}/u`) compiles. PrimJS on the device runs the same patterns from `new RegExp('^\\p{Script=Hebrew}', 'u')` on both threads (iOS and Android, 2026-11-06), so it's only the build's compiler. FormatJS's ListFormat polyfill has one, for Hebrew's "and", and the build plugin's own `Intl.Collator` has `/^[\p{P}\p{Z}]$/u`, for `ignorePunctuation`.

Most code never meets it. rspeedy's own SWC rule runs `transform-unicode-property-regex`, which writes each escape out as the characters it matches, so an app's own code compiles. That rule skips JavaScript in `node_modules`, and the main thread's ES2019 target leaves the escapes alone, so a package's regex literal reaches the compiler as it is. It hides in this repository: a workspace package's files aren't in `node_modules` once their symlink is resolved, so the examples build what an installed app can't (issue #316: an earlier version of this note, measured that way, said the compiler took General_Category escapes). Build from a real copy of the package in `node_modules`, as the E2E tests' app does, to see what an app sees.

### The fix

The `intl` option runs FormatJS's polyfills and its own runtime (`dist/intl-runtime.js`) through SWC's `transform-unicode-property-regex` first, in the lynx environment (`applyIntl` in `intl/apply-intl.ts`). A package with a `\p{…}` literal on the main thread fails the same way; build the pattern with `new RegExp()` instead.

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

**Streaming body reading** via `response.body.getReader()` is experimental, and Lynx's networking guide says it needs the page config `enableFetchAPIStandardStreaming: true`. Without it, Lynx keeps a non-standard streaming fallback (`lynx_config.yml`), so `response.body` may not support the Readable Streams API. `pluginAngularLynx()` has no option for this flag yet. Additionally, third-party HTTP libraries may need adjustments due to subtle differences in Lynx's fetch implementation compared to the web spec (no CORS, no FormData/Blob, no redirect support).

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

## `globalProps` changes re-render the whole page in React Lynx — AngularLynx updates a signal

### What you'd expect (web)

State changes typically re-render only the affected component subtree (via Angular signals, React state, etc.).

### What Lynx does

When the native host updates `lynx.__globalProps` (e.g., for theme switching or locale changes), **React Lynx** re-renders the entire page — not just components that read the changed prop. Lynx itself emits no `onGlobalPropsChanged` event: React Lynx emits it from its `updateGlobalProps` hook. AngularLynx defines the same hooks (`packages/runtime/src/lib/global-callbacks.ts`), merges the update into `LynxGlobalData.globalData()`, and emits `onGlobalPropsChanged` on the background thread for app code. Only views that read the signal re-render. Even so, prefer CSS variables for theme colors: one class change re-styles the page without re-running templates.

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

## Tailwind CSS with AngularLynx

### Setup

The rsbuild plugin finds `tailwind.config.*` and adds Tailwind as a PostCSS plugin (`src/tailwind.ts`), the setup in Lynx's own Tailwind guide and in Angular CLI. Apps need no `postcss.config.js`; one that already runs Tailwind is left as it is. Tailwind's PostCSS step runs upstream of the CSS extractor, so `css.ts` needs no changes.

Don't go back to `rsbuild-plugin-tailwindcss`. It replaces Tailwind's `content` with the modules each entry bundles, and an Angular `.html` template is never a module: the compiler reads it and compiles it into the component's `.ts` module. Classes used only in `.html` templates got no CSS (issue #52). The plugin has no option to add files to the list.

**Always use `@lynx-js/tailwind-preset`** — it strips every Tailwind plugin that generates CSS Lynx cannot parse: `hover:*`, `focus:*`, `@media`, `::before`/`::after`, `pointer-events`, `calc()`, etc.

**Tailwind v3 only** — `tailwindcss@^3`. Tailwind v4 (`@tailwindcss/postcss`, `@tailwindcss/vite`) is incompatible with `@lynx-js/tailwind-preset`.

### `content:` must take in `.html` and `.ts` files

Tailwind generates CSS only for classes in the files `content` matches. Components can use inline templates (in `.ts`) or `.html` templates, so use:

```ts
content: ['./src/**/*.{html,ts}'],
```

Tailwind reports the folders it scans to rspack (PostCSS `dir-dependency` messages), so editing an `.html` template under `ng serve` regenerates the CSS.

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

### CSS variables inherit without `enableCSSInheritance`

Unlike `color` or `font-size`, CSS custom properties reach descendants with the default `enableCSSInheritance: false`, as Lynx's docs say. Measured for issue #68 (2026-10-26, Lynx Explorer 4.1, iOS and Android): a variable set by a class two levels up, and one set in an ancestor's inline `style="--x: …"`, both reached a grandchild's `background-color: var(--x)`. This is how the `@blotch/ui` theme's `var(--primary)` colors work with no build flags. Nothing extra is needed for runtime theme switching with `[style]` bindings either.

## `__AddClass` takes a single class name, not a space-separated list

`__AddClass(element, className)` adds one CSS class. Passing a space-separated string like `'foo bar baz'` does NOT add three classes — Lynx treats the entire string as one class name literal, so no CSS rule will ever match.

**Always use `__SetClasses(element, classString)` when replacing the entire `class` attribute**, as it correctly parses space-separated class lists. `__AddClass` should only be called with a single class name at a time.

This is why the Angular renderer's `setAttribute('class', value)` must call `__SetClasses`, not `__AddClass`. React Lynx does the same: it calls `__SetClasses(element, className)` when applying the `className` prop.

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

This first cost Tailwind's opacity modifiers on semantic colors (`bg-primary/50`): the value was opaque, with no separable channels. Issue #115 brought them back with a second variable per color holding its channels, comma-separated, which Lynx can substitute into `rgba()` (next entry). See the "CSS Colors in Lynx" section of the root `CLAUDE.md`.

**Status:** implemented across `packages/ui` + all examples; validate the paint on device via the `css-var-validation` screen in kitchen-sink-app.

---

## `var()` inside `rgba()` is substituted as text, so one variable can fill three arguments

### What you'd expect (web)

A browser substitutes `var()` before it parses the value, so `--primary-rgb: 24, 24, 27` with `rgba(var(--primary-rgb), 0.5)` gives `rgba(24, 24, 27, 0.5)`. Tailwind themes built on `<alpha-value>` rely on this.

### What Lynx does

The same, though nothing in Lynx's docs says so, and the HSL entry above shows composed colors can fail silently. Measured for issue #115 and confirmed in the source:

- **Build.** `@lynx-js/css-serializer` (`parse.js`, `transformDeclaration`) turns any declaration containing `var()` into a `css_var` declaration and rewrites each `var(--x)` to `{{--x}}`: `rgba( {{--primary-rgb}} , 0.5)`. The template encoder stores it as a `CSSValue` of type `VARIABLE` (`css_parser_token.cc` in lynx-family/lynx). Custom property definitions are kept as raw text (`transformVariables`).
- **Runtime.** `CSSValue::Substitution` / `SubstitutionResolved` (`core/renderer/css/css_value.cc`), or `CSSVariableHandler::GetCSSVariableByRule` on the older path, pastes each variable's text in place of its `{{--x}}`. Only then does `UnitHandler::Process` hand the string to `ColorHandler`, whose `CSSStringParser::ParseRGBLikeColor` reads `rgb()`/`rgba()` with commas or with spaces and a `/` alpha. `HSLColor()` takes commas only.
- **Inline styles** go through `CSSStringParser::ParseVariable` and substitute the same way.
- **An undefined variable** substitutes nothing, the value doesn't parse (`rgba( , 0.5)`) and the declaration is dropped: the element draws transparent. A browser drops it too (invalid at computed-value time).
- **A `var()` in another `var()`'s fallback** is a build error from the serializer: "nested var() is not allowed in Lynx". A `var()` inside a custom property's _definition_ is fine.

Probe (2026-10-27): 20 swatches over white in Lynx Explorer 4.1.0 on the iOS 27 simulator (iPhone 18 Pro) and the Android emulator (API 34), and in Lynx for Web (web-core 0.26.2, Chromium), with each swatch's color sampled from a screenshot. Expected values are the swatch blended over white.

| Swatch                                                                  | Expected                      | iOS                           | Android                       | Web                           |
| ----------------------------------------------------------------------- | ----------------------------- | ----------------------------- | ----------------------------- | ----------------------------- |
| `rgba(var(--p-rgb), 0.5)`, `--p-rgb: 255, 0, 0` on `page`               | 255, 128, 128                 | 255, 128, 128                 | 255, 128, 128                 | 255, 127, 127                 |
| `rgba(var(--p-rgb), var(--a))`, `--a: 0.25`                             | 255, 191, 191                 | 255, 192, 192                 | 255, 192, 192                 | 255, 191, 191                 |
| The same rule under a view that redefines `--p-rgb: 0, 128, 0`          | 128, 192, 128                 | 128, 192, 128                 | 128, 192, 128                 | 127, 191, 127                 |
| Inline `style="background-color: rgba(var(--p-rgb), 0.5)"`              | 255, 128, 128                 | 255, 128, 128                 | 255, 128, 128                 | 255, 127, 127                 |
| `rgba(var(--undefined-rgb), 0.5)`                                       | dropped                       | dropped (white)               | dropped (white)               | dropped (white)               |
| `var(--n)` with `--n: rgba(var(--p-rgb), 0.5)`                          | 255, 128, 128                 | 255, 128, 128                 | 255, 128, 128                 | 255, 127, 127                 |
| `rgb(var(--s) / 0.5)`, `--s: 255 0 0`                                   | 255, 128, 128                 | 255, 128, 128                 | 255, 128, 128                 | 255, 127, 127                 |
| `bg-primary/50` (theme plugin)                                          | 140, 140, 141                 | 140, 140, 141                 | 140, 140, 141                 | 139, 139, 141                 |
| `text-foreground/70`                                                    | 83, 83, 85                    | 83, 83, 85                    | 83, 83, 85                    | 82, 82, 84                    |
| `border-border/60`                                                      | 239, 239, 241                 | 239, 239, 241                 | 239, 239, 241                 | 239, 239, 241                 |
| `bg-destructive/50` under a `.dark` view, toggled off and on at runtime | 247, 162, 162 / 191, 142, 142 | 247, 162, 162 / 191, 142, 142 | 247, 162, 162 / 191, 142, 142 | 247, 161, 161 / 191, 142, 142 |

`bg-destructive/10` and `bg-destructive-subtle` drew the same color everywhere, and `bg-primary/50` bound with `[class]` next to a static `class` drew like the static class. Android matched iOS on every swatch.

A build detail that looks related but isn't: the production build's CSS minifier rewrites colors in custom property values, so the bundle holds `--primary: #18181b` and `--ring-subtle: hsla(240, 5%, 84%, .4)` rather than the `rgba()` the theme wrote. Both forms parse on Lynx; the channel lists (`24,24,27`) only lose their spaces.

### The fix

The `@blotch/ui` theme gives each opaque color a `-rgb` twin (`--primary-rgb: 24, 24, 27`), and the Tailwind plugin's `themeColor()` maps an opacity modifier to `rgba(var(--primary-rgb), 0.5)` while plain classes stay on `var(--primary)`. Keep the channels comma-separated: that's the `rgba()` form both of Lynx's color parsers accept.

---

## `<input>` and `<textarea>` have no `value` attribute: their text is set with `setValue`, or as `default-value` before their UI exists

### What you'd expect (web)

Setting a field's `value` property changes the text it shows, at any time, from its first render: `[value]="name"` on a field that renders with `name` already set shows it straight away.

### What Lynx does

On iOS and Android, XElement's `LynxUIBaseInput` registers **no prop for `value`** (Lynx 4.1: `platform/darwin/ios/lynx_xelement/input/LynxUIBaseInput.m`, `platform/android/lynx_xelement/lynx_xelement_input/.../LynxUIBaseInput.kt`), so `__SetAttribute(element, 'value', …)` never changes the text, before or after the user types. Two things do:

- **The `setValue` UI method**, which reaches only a UI native has made. Native makes an element's UI when the element tree is next flushed, so a field created since the last flush has none: `__InvokeUIMethod` answers code 6 (`kUIMethodNoUiForNode` / `NO_UI_FOR_NODE`), synchronously on both platforms (the main thread runs on the UI thread), and drops the call. That's what left a field that rendered with a value empty on iOS and Android (#339), in any change detection that created it, not only the first screen.
- **The `default-value` attribute**, which Lynx applies as it makes the field's UI, without firing `bindinput`, and ignores from then on (`onNodeReady` marks it consumed). The iOS shadow node reads it too, so a `<textarea>` is laid out with its text, and its placeholder overlay starts hidden.

Lynx for Web is different: its `x-input`/`x-textarea` are DOM elements from the start, take `setValue` at once (code 0), observe a `value` attribute, and ignore `default-value`.

### The fix in AngularLynx

A field's `value` is a property, as on the web: `LynxElement.setProperty('value', text)` on an `input` or `textarea` sends the text both ways, with `setValue` for a field on screen and as `default-value` for one native makes later (not on web). Whichever state the field is in, one of them shows it, without the runtime having to know which. The `LynxInput`/`LynxTextarea` directives' `[value]`, the forms' value accessors (`writeValue`) and a plain `[value]` property binding all go through it.

Text the field already holds isn't set again, as a DOM field's isn't: the runtime listens to the field's `input` event and keeps what's typed, so a model bound back to the field doesn't echo each keystroke into `setValue`. A field rebuilt on remount (see `#recreateSubtree`) is made with the text it had, typed or set, as its `default-value`.

Bind `[value]`, not `[attr.value]`: an attribute binding calls `renderer.setAttribute`, which goes to `__SetAttribute` and does nothing on iOS and Android.

---

## A UI method on an element created since the last flush is dropped

### What you'd expect (web)

A DOM element's methods work as soon as the element exists: `ngAfterViewInit() { this.field().nativeElement.focus(); }` focuses a field the view just created.

### What Lynx does

`__InvokeUIMethod` runs the method on the element's native UI at once (`PaintingContextDarwin::Invoke`, `PaintingContextAndroid::Invoke`), and native makes that UI only when the element tree is flushed. The renderer flushes at the end of change detection, and on the first screen native flushes after `renderPage` returns, after Angular's bootstrap, `ngAfterViewInit()` and `afterNextRender()`. A method called on an element created since the last flush finds no UI, and iOS and Android answer code 6 (`NO_UI_FOR_NODE`) synchronously and drop it. Lynx has its own fix for this, behind the page config `enableElementInvokeUIMethodPendingTask`, but only for a main-thread script's element (`LepusElement::Invoke` queues the call until the element's flush); `__InvokeUIMethod` doesn't use it.

### The fix in AngularLynx

`LynxElement.invoke()` reads native's answer, and when it's code 6, calls the method again once, after the next flush: after `LynxRendererFactory2.end()`'s, after a settle flush (scheduled for a call outside change detection), or after the first render's (`runAfterFirstRender`). An element with no UI even then isn't on the page, and the call is dropped. `MainThreadElement.invoke()` (a main-thread script's) still rejects with code 6, as React Lynx's worklet `Element.invoke()` does.

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

`inline-flex` and `inline-block` don't opt out: the build turns them into `flex` and `linear`, which lay the element's children out as the web does, but the element itself still stretches (see "`display` values: no `block`/`inline`, default is `linear`"). The lever is **`align-self: flex-start`** (Tailwind `self-start`) on the child, which overrides the container's `align-items` and lets the child size to its content on the cross axis. This is supported in both linear and flex layouts.

```ts
// A badge that hugs its content regardless of parent layout:
cva('flex items-center self-start rounded-full px-2.5 py-0.5', {/* … */});
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

### A static `class` (or any attribute) on a component lands on its host, so an inner view styled with it applies it twice

Angular renders every static attribute written on a component element onto its host, whether or not the component also takes it as an input (`setupStaticAttributes` runs before the component exists). On the web the host is an inline custom element, so `<my-card-content class="pt-6">` putting `pt-6` on the host as well as on the component's inner `<div>` mostly goes unnoticed: vertical padding on an inline element doesn't move anything. On Lynx the host is a real `<view>`, so the padding applied twice (issue #181: double top padding in a card, two matches for `getAllByPlaceholderText` on `<ui-input placeholder="…">`).

A component can't stop it: a template's static classes outrank a host `[class]` binding in Angular's styling. So the `@blotch/ui` components bind their merged classes on the host itself (`host: { '[class]': 'cls()' }`, as Spartan's helm components do on the web) and drop the wrapper view. A text component makes its host a `<text>` with `registerHostElement(Component, 'text')`. An attribute meant for an inner element, such as an `<input>`'s `placeholder`, is removed from the host with `host: { '[attr.placeholder]': 'null' }`, and an overlay component, whose `class` styles a panel inside the `<overlay>`, removes the host's copy with `'[attr.class]': 'null'`, since its host sits in the page's layout. A bound `[class]="x"` doesn't have the problem: when the component has a `class` input, Angular hands the binding to the input only.

---

## `<textarea>` placeholder does not hide under a programmatically-set value (iOS)

### What you'd expect (web)

A `<textarea>` (or `<input>`) hides its `placeholder` the moment it has a value — whether the value came from typing or was set programmatically. The two never render at once.

### What Lynx does

On **iOS**, the native textarea renders the placeholder as a **separate overlay `UITextView`**, not the field's own placeholder. That overlay's visibility is only recomputed inside `textViewDidChange:` (i.e. on user edits). Setting the value through the `setValue` UIMethod (`__SetAttribute("value")` is a no-op; see the `value` entry above) does not reliably hide that overlay, so the placeholder and the value render stacked on top of each other. A value the field renders with now arrives as `default-value` as well, which hides it, but a value set later still goes through `setValue`.

Android (native `EditText` `hint`) and web (native `<textarea>`) hide the placeholder automatically, so the bug is iOS-only. The root cause is in the vendored on-device runtime ([`lynx/platform/darwin/ios/lynx_xelement/input/LynxUITextArea.m`](https://github.com/lynx-family/lynx/blob/develop/platform/darwin/ios/lynx_xelement/input/LynxUITextArea.m)), so it can't be fixed from the Angular side.

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

## An `<input>`'s `placeholder-color` attribute does nothing on iOS: set `-x-placeholder-color` as a style

Seen on the iOS 27 Simulator, 2026-11-09, in `@blotch/ui`'s search field.

### What you'd expect (web)

`input::placeholder { color: … }` colors the hint text.

### What Lynx does

Lynx has no `::placeholder` rule; the field takes the color as a property. On iOS, `placeholder-color` given as an attribute (a hex or an `rgba()` string) leaves the placeholder in the system's pale gray: the setter in [`LynxUIBaseInput.m`](https://github.com/lynx-family/lynx/blob/develop/platform/darwin/ios/lynx_xelement/input/LynxUIBaseInput.m) takes a `UIColor`, which a string attribute never becomes. The CSS property `-x-placeholder-color` in the element's inline style arrives parsed as a color and works. Lynx for Web is the other way round: web-elements reads the attribute, and web-core drops the `-x-placeholder-color` style.

### The fix

Set both. A `[style.-x-placeholder-color]` binding reaches iOS: Angular passes a style name with a dash through as written (`RendererStyleFlags2.DashCase`), and the runtime hands it to `__AddInlineStyle`.

```html
<input
  [attr.placeholder-color]="color()"
  [style.-x-placeholder-color]="color()"
/>
```

(Applied in `packages/ui/src/lib/components/search-field/search-field.ts`.)

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

Despite running from inside the layout pass, the `operationID`-tagged flush is not dangerously re-entrant: native defers the operation's completion via the `operationID` queue rather than recursing back into `TickLayout`. This mirrors React Lynx's single-item `componentAtIndex` exactly ([`lynx-stack/packages/react/runtime/src/snapshot/list/list.ts`](https://github.com/lynx-family/lynx-stack/blob/main/packages/react/runtime/src/snapshot/list/list.ts), the `!enableBatchRender` branch).

### The fix

Ack each cell with `{ triggerLayout: true, operationID, elementID: sign, listID }`. See `create-list-element.ts`.

---

## Writing an empty `update-list-info` corrupts the native `<list>` state

### What you'd expect (web)

Resetting an attribute to empty arrays (`{ insertAction: [], removeAction: [], updateAction: [] }`) is a harmless no-op.

### What Lynx does

`<list>` items are managed by setting the `update-list-info` attribute to a computed diff and flushing. Native consumes that diff **once** during the flush (the list element is no longer dirty for the attribute afterward), so there is no need to "clear" it. Writing an **empty** `update-list-info` and flushing actively corrupts the native list's state: it leaves cells stuck in the "binding" state (the same infinite `layoutComplete` loop as the `asyncFlush` bug above) and causes intermittent crashes on subsequent updates that do carry items.

React Lynx never clears it either — `ListUpdateInfoRecording.flush()` ([`lynx-stack/packages/react/runtime/src/snapshot/list/listUpdateInfo.ts`](https://github.com/lynx-family/lynx-stack/blob/main/packages/react/runtime/src/snapshot/list/listUpdateInfo.ts)) only ever `__SetAttribute`s a computed, non-empty diff.

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

`box-shadow` is `animatable: no` on Lynx, so `transition: box-shadow` is silently ignored and the ring snaps. The docs mark it non-animatable, and the core confirms it: `kBoxShadow` is left out of the transition validator (`IsValueValid()` in `core/animation/css_transition_manager.cc`), so the engine rejects it. `opacity` **is** animatable — so put the shadow on its own overlay layer and transition _that layer's_ opacity:

```html
<view [class]="wrapperClass()">
  <!-- ring layer: FIRST child, fades via opacity -->
  <view
    class="absolute bottom-0 left-0 right-0 top-0 rounded-xl opacity-0"
    [style.transition]="'opacity 150ms ease'"
    [style.box-shadow]="ringShadow()"
    [style.opacity]="ringVisible() ? 1 : 0"
  ></view>
  <input ... />
</view>
```

Three Lynx-specific requirements make this render on-device:

- **A dedicated overlay layer.** Opacity on the wrapper would fade the input too. The shadow rides a separate sibling whose opacity is independent. Keep `ringShadow()` always set (never null) so the shadow stays painted while the layer fades out — drive visibility with opacity alone.
- **First child = painted behind.** Lynx paints in **source order**; positioned elements do _not_ jump above in-flow siblings as on web. So the ring layer placed first stays behind the input, which keeps receiving taps — no `pointer-events` (it **errors the Lynx build**; see that entry). The overlay's outset shadow still shows because it spreads _outside_ the wrapper.
- **Outset shadow only.** Lynx doesn't render `inset` box-shadows (see the inset entry), so the crisp "border" is an outset `0 0 0 1px` ring hugging the edge, layered under a softer `0 0 0 3px` ring — not a real inset border.

### Don't mix binding paths on one element

`[style.box-shadow]` routes through `__AddInlineStyle` (per-key); a whole-string `[style]="..."` routes through `__SetInlineStyles` (replaces all inline styles), so on one element a later whole-string set clobbers the per-key one. The overlay above keeps them apart: the ring layer carries only per-key `[style.*]` bindings, while `textarea`'s wrapper keeps its whole-string `[style]="wrapperStyle()"` (min/max-height). Because the ring is a separate child, the two never share an element.

---

## `setTimeout` invokes its callback with an empty object, not `undefined` — which crashes Angular's `@defer (on idle)`

### What you'd expect (web)

`setTimeout(cb)` calls `cb()` with no arguments (`arguments.length === 0`, first arg `undefined`). And `requestIdleCallback(cb)` exists and calls `cb(deadline)` with a real `IdleDeadline` (`{ didTimeout, timeRemaining() }`).

### What Lynx does

Two differences compound:

1. **No `requestIdleCallback`/`cancelIdleCallback`.** Neither exists as a global on any thread — a whole-tree search of the Lynx core returns nothing. Only `setTimeout`/`clearTimeout` are registered (as _global_ functions on the main-thread Lepus context via `RegisterGlobalFunction`, and on the `lynx` object on the background thread).

2. **`setTimeout` passes an empty object to the callback.** The Lepus timed-task dispatcher invokes the stored callback with `Dictionary::Create()` — an empty `{}` — as its single argument (`core/runtime/lepus/tasks/lepus_callback_manager.cc`, `SetTimeTask`: `func->Execute({lepus::Value(lepus::Dictionary::Create())})`). So on Lynx `setTimeout(cb)` effectively calls `cb({})`, not `cb()`.

Together these crash Angular's `@defer (on idle)`. With no `requestIdleCallback`, Angular's `RequestIdleCallbackService` falls back to `cb => setTimeout(cb)`, then its `IdleScheduler` does:

```js
const callback = (deadline) => {
  for (const cb of bucket.queue) {
    cb();
    this.applicationRef._tick(); /* … */
    if (deadline && deadline.timeRemaining() === 0 && !deadline.didTimeout)
      break;
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

`NSURLErrorDomain -1002` is **"unsupported URL"**, not a network failure — iOS rejected the URL scheme outright and never made a request. (So this is _not_ a firewall/connectivity problem; a blocked network yields a timeout, `-1001`/`-1004`/`-1009`.)

The culprit is the scheme: `webpack:///static/font/…`. Assets referenced from CSS `url()` are resolved by `@lynx-js/css-extract-webpack-plugin`'s child compilation, which hardcodes `const BASE_URI = 'webpack://'` (`lib/loader.js`) and does **not** inherit the runtime `publicPath`. Every `url()` gets joined against that base, so the extracted CSS bakes in an absolute `webpack:///static/font/<name>.<hash>.ttf`.

That URL is absolute — it carries the `webpack://` scheme — so Lynx never re-resolves it against the bundle origin.

**Images work precisely because they stay relative.** A JS-imported `<image src>` resolves through the _main_ compilation as `__webpack_require__.p + "static/image/…"`, producing a root-relative `/static/image/…`. Lynx resolves that against the bundle's loading origin, so it fetches. Fonts never take this path.

`output.dataUriLimit` does **not** help. The css-loader `url()` request matches the font rule's `?__inline=false` `asset/resource` branch before the size threshold is ever consulted, so raising the limit changes nothing.

### The fix

Force `@font-face` fonts to inline as Base64 data URIs (`packages/rsbuild-plugin-angular-lynx/src/css.ts`, in `applyCSS`):

```ts
if (chain.module.rules.has(CHAIN_ID.RULE.FONT)) {
  const fontRule = chain.module.rule(CHAIN_ID.RULE.FONT);
  fontRule.oneOfs.clear(); // drop the asset/resource + ?url/?inline/?raw branches
  fontRule.type('asset/inline'); // inline every matched font, ignoring any css-loader query
}
```

A data URI is absolute, so it survives the `webpack://` base-URI join untouched. It needs no `publicPath`, no network fetch, and no host font loader — exactly what the [Lynx `@font-face` docs](https://lynxjs.org/api/css/at-rule/font-face) recommend ("Base64-encoded fonts").

It applies to the web bundle too. That bundle goes through the same css-extract child compilation, so it gets the same `webpack:///` URL, and Chrome refuses it ("Cross origin requests are only supported for protocol schemes: … http, https"); every custom font fell back to Times in the docs' live previews. A correct `publicPath` can't fix the web side either: the bundle's CSS is inserted into `<lynx-view>`'s shadow root, where a `url()` resolves against the host page, not the bundle. A relative or root-relative font URL only works if the bundle happens to sit at the host's root, which the docs examples (under `/examples/<name>/dist/`) don't. Inlining costs a third more bytes per font, in exchange for a font that loads wherever the bundle is served.

React Lynx never hit this — it has no equivalent global-stylesheet `@font-face` build path.

## Indented template text renders with a leading space — Angular collapses whitespace but never trims it, and Lynx has no line-box trimming

### What you'd expect (web)

Prose written across indented lines renders flush, with no leading or trailing space:

```html
<text> Hello world </text>
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

## Charts keep their element count fixed during a gesture (once thought to prevent a crash)

### What you'd expect (web)

A `pointermove`/drag handler can freely mutate the DOM — add rows, remove nodes, re-render a list — and the browser just repaints. There's no penalty for changing the _number_ of elements mid-gesture.

### What Lynx does

Gesture callbacks (`PanGesture`/`PinchGesture` `onUpdate`, etc.) run on the **main thread inside the native gesture**. This entry used to say that inserting or removing native elements there crashes, like navigating from a tap handler supposedly did. Neither does: measured for issue #113 on Lynx 4.1 (iOS and Android), a pan's `onUpdate` that added or removed 50 elements and flushed them about 60 times during pans ran fine (see "Changing the element tree inside an event handler is safe"). The fixed counts below stay because they're cheaper: a frame that only restyles existing nodes does less work than one that rebuilds them.

The case that prompted it was charts. `UiCartesianChart` draws gridlines and axis labels with `@for (tick of ticks())`. If a pinch/pan recomputed the tick _values_ live and the count changed (e.g. a "nice numbers in the visible window" algorithm yields 5 ticks at one zoom and 6 at the next), the `@for` would add/remove `<view>`/`<text>` nodes on a gesture frame — a tree mutation inside the worklet.

### The fix

When zoom is enabled, generate a **fixed** number of ticks (`generateTicks(visibleDomain, tickCount)` returns exactly `tickCount` values) so the gridline/label `@for` length never changes during a gesture — every zoom frame only restyles the existing nodes (new `top`/`left`/label text), never adds or removes them. The trade-off is that a zoomable chart's ticks are evenly spaced rather than "nice round" numbers; a non-zoomable chart keeps the original nice-tick behavior.

`<ui-chart>`, which replaced `UiCartesianChart`, keeps TanStack's nice ticks while panning instead: its labels are a pool of `<text>` slots whose length is frozen for the length of a pan (extra labels wait, spare slots hide with `display: none`), released on a timer after the gesture ends. See `labelSlots` in `packages/ui/src/lib/components/chart/chart.ts`.

The same principle applies to the pan/zoom transform itself: it only ever writes the visible-window signals, which drive the scales and thus restyle existing gridlines, labels, and series marks — the marks re-project (and bars/candles stretch, since their width comes from projected pixel spacing) without any node being created or destroyed.

---

## A fling's `onStart`/`onEnd` (and a pan's, before Lynx 3.9) silently never fire unless `onBegin` is registered

### What you'd expect (web / react-native-gesture-handler)

Registering `onStart`, `onUpdate`, and `onEnd` on a pan is enough — `onStart` fires once when the gesture is recognized, `onUpdate` fires every frame, `onEnd` fires on release. `onBegin` (finger-down, before the gesture is recognized) is a separate, optional lifecycle hook you only add if you need it.

### What Lynx does

**The fling handlers gate `onStart` and `onEnd` behind `onBegin` having fired, and `onBegin` fires only when a JS `onBegin` callback is registered:**

- iOS `LynxFlingGestureHandler.m`: `onStart:` and `onEnd:` return early if `!_isInvokedBegin`. `_isInvokedBegin` is set **only** inside `onBegin:`, which itself returns early unless `[self onBeginEnabled]`, an enable flag that is on only when `onBegin` is in the JS callback list (`handleEnableGestureCallback:`).
- Android `FlingGestureHandler.java` mirrors it: `onStart()` and `onEnd()` check `!mIsInvokedBegin`, which only `onBegin()` sets, after its `isOnBeginEnable()` check.

So register `onStart`/`onUpdate`/`onEnd` on a fling but not `onBegin`, and **`onStart` and `onEnd` never fire — with no error, no warning, no log.** `onUpdate` has no such gate, so the gesture _looks_ alive. Verified in Lynx Explorer 4.1 on the iOS Simulator and the Android emulator: a fling composed with a pan ran `onUpdate` 240 and 36 times, and `onEnd` never.

**Pans had the same gate until Lynx 3.9.** Upstream commit `301c66caa8` ("fix pan begin-phase dispatch", April 2026) makes `LynxPanGestureHandler.m` and `PanGestureHandler.java` set the flag before checking `onBeginEnabled`, so on Lynx 3.9 and later a pan's `onStart`/`onEnd` fire without `onBegin`. Hosts on older Lynx still drop them. The default (scroll) gesture handler keeps the gate, but AngularLynx doesn't expose it.

**Concrete symptom (pans on old Lynx):** a pan handler that snapshots state in `onStart` (e.g. "remember the value at gesture-start, then apply cumulative `event.translationX` against it in `onUpdate`") never takes that snapshot. If `onUpdate` then falls back to reading _current_ state instead of the missing snapshot, the transform is applied against a value that already moved last frame — the effect compounds every frame instead of tracking the finger 1:1. On a chart, this reads as "the pan doesn't move the same distance as the finger, like it's anchored to the middle and applying translation relative to a fixed origin" — a diagnosis that first looks like a coordinate-system bug (page vs. client vs. element-relative), but is actually a dropped lifecycle callback.

### The fix

`LynxGestureDetector` registers an empty `onBegin` on every continuous gesture (`PanGesture`/`FlingGesture`/`PinchGesture`/`RotationGesture`) that has none (`buildGestureCallbacks` in `gesture/gesture-detector.ts`, issue #56), so apps never need one. With it, the fling's `onEnd` fires on both platforms, and pans work on any Lynx version. The callback also anchors the gesture's translation where the touch began (see the gesture entry at the top of this file). `<ui-chart>`'s `panGesture` (`packages/ui/src/lib/components/chart/chart.ts`) still registers its own `onBegin`, because it snapshots the scene there. The E2E flow `packages/e2e/native/gestures.yaml` checks the fling's `onEnd` on both platforms.

### Related: `PinchGesture` and `RotationGesture` have no native handler on ANY platform — they never fire

A search of the Lynx native source (`convertToGestureHandler` in `LynxBaseGestureHandler.m` / the Android equivalent) shows handlers registered for `pan`, `default`, `fling`, `tap`, `longpress`, and `native` — but **no pinch and no rotation handler exists on iOS, Android, or Harmony**. `Gesture.Simultaneous(pan, pinch)` is safe to compose (the native engine just never recognizes the pinch half), but don't rely on pinch-to-zoom actually firing on-device today; drive zoom from 1-finger pan plus on-screen controls instead, and treat `PinchGesture`/`RotationGesture` as forward-compatible API surface, not a currently-working feature.

---

## Injected BOM globals shadow the `globalThis` polyfills, so Angular's `ImagePerformanceWarning` crashes web-only bootstrap

The web preview crashes at bootstrap with `NG0210: The document object is not available in this context` (from `ImagePerformanceWarning.start` → `getDocument`), while iOS/Android run fine. Two facts combine.

### What you'd expect (web / native parity)

The renderer polyfills `globalThis.document` / `globalThis.window` at startup (see the browser-globals entries above), so any Angular code that reaches for `document` gets the stub on every platform. A dev-only diagnostic like Angular's `ImagePerformanceWarning` (it scans the page for oversized `<img>`) should be a harmless no-op on Lynx.

### What Lynx does

**(1) The background bundle's BOM globals are injected as function parameters, which shadow `globalThis`.** `RuntimeWrapperWebpackPlugin` wraps the background-thread script in an AMD module whose signature injects the BOM as _parameters_ (`defaultInjectVars`):

```js
tt.define(
  'main.js',
  function (
    require,
    module,
    exports,
    /* … */ window,
    document,
    location,
    navigator,
    history /* … */,
  ) {
    // ← the entire app-service.js (polyfills + Angular) runs in here
  },
);
```

So inside the bundle a bare `document` resolves to that **parameter**, not `globalThis.document`. On the web background thread (a real Web Worker) the Lynx web runtime passes `undefined` for `document`/`window` — a worker has no DOM. The startup polyfills (`packages/rsbuild-plugin-angular-lynx/src/polyfills.js`, plus the defensive copy in `runtime.ts`) run `globalThis.document = { … }` under a `typeof document === 'undefined'` guard. The guard reads the undefined _parameter_ (true), so the assignment fires — but it sets a _global property_ and never rebinds the shadowing local param. Net result: `globalThis.document` is a stub, while the bare `document` that bundle code sees stays `undefined`.

Angular's **internal** `getDocument()` (`_debug_node-chunk.mjs`) reads the module-level `DOCUMENT` var (unset), then the bare `document` identifier (the undefined param), then throws `NG0210`. This is why the `globalThis.document` shim looks like it should help but can't: most Angular DOM access goes through the DI `DOCUMENT` token (`provideRenderer` supplies `{}`), so it never touches the shadowed global — but a few Angular internals call the raw `getDocument()` instead. (The polyfills' own `catch` comment, "Read-only in Web Worker — document already exists", is doubly wrong: a worker has no `document` at all, and even when the assignment succeeds it targets the wrong binding.)

**(2) `ImagePerformanceWarning.start()` runs on web but early-returns on native.** It's an app-bootstrap listener gated on `typeof PerformanceObserver === 'undefined'`. The native background-thread engine (PrimJS) has no `PerformanceObserver`, so `start()` returns _before_ calling `getDocument()` — iOS never crashes. A Web Worker _does_ have `PerformanceObserver`, so on web `start()` proceeds into `getDocument()`, hits the undefined `document` param → NG0210 → the bootstrap promise rejects → nothing renders.

Because iOS and web run the **same** bundle with the **same** undefined `document` param, and iOS works, the only real divergence is that one `PerformanceObserver` gate — nothing on the normal render path reads the bare `document`.

### The fix

Disable `ImagePerformanceWarning` in `provideRenderer()` (`packages/runtime/src/lib/renderer/providers.ts`) by providing `IMAGE_CONFIG` with **both** warnings off — `start()` only early-returns when both flags are set, so both are required:

```ts
{ provide: IMAGE_CONFIG, useValue: { disableImageSizeWarning: true, disableImageLazyLoadWarning: true } }
```

This makes web's document-access path identical to iOS's (which already never reached `getDocument()`), so it is zero-risk on native — and it's semantically correct: Lynx renders native `<image>`, not HTML `<img>`, and has no LCP, so the diagnostic can never apply. Covered by `providers.test.ts`.

Still-latent hazard: any _other_ Angular internal that reads the bare `document`/`window` (instead of the DI `DOCUMENT` token) on the normal path would hit the same shadowed-undefined param on both platforms. None do today. A more general fix would be `ɵsetDocument(stub)` — it sets the module-level `DOCUMENT` var `getDocument()` checks first, bypassing the shadowed global — deliberately avoided for now because it mutates Angular global state on every platform, changing native behavior for no current benefit.

---

## web-core does NOT implicitly flush after `renderPage`, so the first render must be flushed explicitly — otherwise every web app is blank

After the `ImagePerformanceWarning` crash above is fixed, Angular bootstraps cleanly on web (no errors) — yet the screen stays blank. `<lynx-view>` is `display:none` and the page is never attached to the DOM.

### What you'd expect (web / native parity)

Whatever the framework renders during bootstrap appears on screen once bootstrap finishes, on every platform.

### What Lynx does

The renderer **skips the first `__FlushElementTree()`** on purpose. `LynxRendererFactory2.end()` gates it: `if (!isFirstRenderPending()) __FlushElementTree()`. The reasoning (see `lynx-render-lifecycle.ts`) is that every change-detection cycle during bootstrap is still nested inside the native engine's `renderPage()` call, and driving a layout-triggering flush there re-enters a `<list>`'s `componentAtIndex`. Skipping is safe **on native** because _"the native engine performs its own implicit flush once `renderPage()` returns."_

`@lynx-js/web-core` has **no such implicit flush**. Worse, web-core's first-paint side effects live _inside_ `__FlushElementTree` — its main-thread `createElementAPI` does, on the first flush where `page && !page.parentNode`:

```js
rootDom.appendChild(page); // attach the page to the DOM
rootDom.host.style.display = 'flex'; // reveal <lynx-view> (its base CSS is display:none)
```

So with the first flush skipped and no implicit web-core flush, the page is never attached and `<lynx-view>` stays `display:none`. Every app renders blank — until some _later_ CD cycle (a tap, a signal change) happens to flush and reveal it. Static screens never get that, so they stay blank forever. `<lynx-view>`'s base rule really is `display:none` (revealed only by `[ssr]` in CSS, or by that `style.display='flex'` line at runtime), which is why the whole view — not just its contents — is invisible.

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

This was masked until now: the `ImagePerformanceWarning` crash aborted bootstrap before anything could render, so the missing first flush only became visible once that crash was fixed. Covered by the `__WEB__` define tests in `angular-webpack-plugin.test.ts`.

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

`kwift.CHROME.js` is Lynx's **prebuilt web engine** — it is _not_ in our dependency tree (nothing under `node_modules/@lynx-js/**` references `kwift` or `randomUUID`); web-core fetches it at runtime and evaluates it **inside the background Web Worker** it spawns:

```js
// @lynx-js/web-core/dist/client/mainthread/Background.js
new Worker(new URL('../background/index.js', import.meta.url), {
  type: 'module',
  name: 'lynx-bg',
});
```

During handler registration the engine calls `crypto.randomUUID()`. The catch: **`crypto.randomUUID()` is a secure-context-only Web API.** On an insecure origin the `crypto` object still exists (so `crypto.getRandomValues` works) but `crypto.randomUUID` is simply `undefined` — hence "is not a function", not "crypto is undefined". A Web Worker is a secure context **only if the page that created it is** (the worker URL is same-origin here), so opening the "Network" `http://<LAN-IP>:<port>` URL the dev server prints makes the engine crash the moment it inits.

This is the **same root cause** as the `SharedArrayBuffer`/`crossOriginIsolated` note above — an insecure origin — just a different symptom that trips first (engine init happens before any synchronous native call).

### The fix

**Open the preview from a secure context.** `http://localhost:<port>` and `http://127.0.0.1:<port>` always qualify; any HTTPS origin does too. Do **not** use the LAN IP URL for the _browser_ preview (the QR / on-device flow is unaffected — LynxExplorer loads the native `.lynx.bundle`, not the browser page).

There is **no code polyfill** for this: the engine is Lynx's own code, it runs before ours in web-core's worker, and we don't control that worker's entry — so nothing we ship can define `crypto.randomUUID` in time. What we _can_ do is fail loudly instead of cryptically. `runtime.ts` emits an actionable, **web-only** (`__WEB__`-gated, DCE'd from native) console error when `globalThis.isSecureContext === false`, pointing the developer at the localhost URL rather than leaving them with a stack trace inside `kwift.CHROME.js`.

---

## Paint order is source order on Lynx, but CSS stacking on web — a `position: absolute` sibling paints above a static one regardless of source order

### What you'd expect (Lynx)

Lynx paints sibling elements in **strict source order**: a later child always paints on top of (and hit-tests before) an earlier child, no matter their `position`. This gives a simple way to layer a decorative overlay _behind_ an interactive element. Put the overlay **first** in source order and the interactive element **after** it. The interactive element then sits on top and stays tappable — no `z-index`, and no `pointer-events` (which errors the Lynx build anyway; see above).

### What web does

On web this is governed by **CSS stacking rules**, not source order. Within a stacking context the paint groups are, low to high: non-positioned in-flow content → positioned elements with `z-index: auto`/`0` → positive `z-index`. A `position: absolute` sibling (even with no `z-index`) is a _positioned_ element, so it paints **above** a _static_ (non-positioned) sibling **regardless of source order**.

So the "overlay first, interactive element after" layout inverts on web. A transparent `position: absolute` overlay placed before a static `<input>` paints **on top of** the input and **swallows every pointer event** — the input never focuses, and you can't type. The symptom: a field that renders and looks fine but is dead to clicks on web, while working perfectly on iOS/Android.

This bit the Dolan `ui-input` and `ui-textarea` focus ring: the ring is a transparent `position: absolute` overlay layer (its own layer so its opacity can animate — `box-shadow` isn't animatable on Lynx), deliberately placed as the **first** child so Lynx paints the input over it. On web that same overlay covered the input.

### The fix

Give the interactive element an explicit stacking elevation so it sits above the overlay on **both** platforms:

```html
<view>
  <!-- wrapper -->
  <view class="absolute inset-0" ... />
    <!-- decorative overlay, first child -->
    <input style="position: relative; z-index: 1;" ... />
    <!-- interactive, elevated -->
  </view>
```

`position: relative; z-index: 1` is **redundant on Lynx** (source order already keeps the input on top) but **required on web** (it moves the input into the positive-`z-index` paint group, above the `z-index: auto` overlay). Both properties are needed: `z-index` only applies to a _positioned_ element, so `position: relative` is what makes the `z-index` take effect. Lynx's CSS encoder accepts both (unlike `pointer-events`), so the one declaration is safe cross-platform.

Do **not** try to fix this by moving the overlay _after_ the input in source order — that would put the overlay on top on Lynx (breaking the platform where it currently works) to fix web. Elevate the input instead; it satisfies both painting models at once.

---

## `position: sticky` works in a `scroll-view`, but the pinned header hides behind later rows without a `z-index`

### What you'd expect (web)

A `position: sticky; top: 0` header pins to the top of a scroll container and stays visible above the rows scrolling under it. You rarely need a `z-index` — the rows are normal-flow (static) content, which always paints below a positioned element.

### What Lynx does

Sticky positioning itself works: the header pins to the top of the `<scroll-view>` and hands off to the next group's header. But the pinned header paints **behind** the rows scrolling past it, so its label disappears under the content — it looks like sticky is broken.

Lynx web sets `position: relative` on **every** `<view>` (its `linear.css` base rule). That makes the rows _positioned_ siblings. Among positioned siblings with `z-index: auto`, paint order is source order, so each row — which follows the header in the DOM — paints over it. This is the same painting-model difference as the section above; every view being `position: relative` is what makes it bite sticky headers specifically.

Native is unaffected: the compositor layers the sticky child correctly, and `flatten="false"` (already required for sticky on Android) gives it its own layer.

The bug also stays hidden until the list overflows. With little content the `<scroll-view>` never scrolls and nothing pins, so headers can look fine on a tall desktop window yet fail on a short or mobile viewport.

### The fix

Elevate the sticky header with a `z-index` **on web only**, gating it on the `__WEB__` compile-time define:

```html
<view
  class="sticky top-0 bg-zinc-100 px-4 py-1.5"
  [class.z-10]="isWeb"
  [flatten]="false"
>
  <text>{{ group.letter }}</text>
</view>
```

```ts
// __WEB__ is a compile-time define: true on web, false on native.
readonly isWeb = __WEB__;
```

The `z-index` must **not** apply on native. There, a `z-index` on a sticky scroll-view child promotes it out of the scroll content and freezes it like `position: fixed` — the header stops scrolling entirely. So the elevation is web-only: it fixes the web paint order without touching native, where sticky already works. Elevate the header rather than reordering source — Lynx makes every view positioned, so source order alone won't keep it on top (exemplar: `examples/contact-list`).

---

## Hot updates have to be applied on the main thread, which can't fetch them

### What you'd expect (web)

The dev server rebuilds, and webpack's hot update client in the page loads the changed modules and runs them. If no module can take the update, it falls back to `window.location.reload()`.

### What Lynx does

The hot update client, and the dev server's connection, run on the **background thread**: Rspeedy adds them to the background half of each bundle. In an AngularLynx app the screen is drawn by the Angular app on the **main thread**, which only ever had webpack's hot update runtime with nothing to start it. Its update chunk (`main__main-thread.<hash>.hot-update.js`) was emitted and never loaded.

The main thread can't load it itself: it has no `fetch`, and webpack's Lynx chunk loading calls `lynx.requireModuleAsync()`, which only the background thread has. Some other facts that shaped the fix, checked in Lynx Explorer 4.1 (iOS):

- **The main thread can run code it receives.** In a development build, PrimJS runs `eval()` and `new Function()`. React Lynx relies on the same thing: its main thread `eval`s the snapshot code its hot updates send (`snapshotPatchApply.ts`). `__LoadLepusChunk()` only runs chunks that are in the bundle, so it can't load an update.
- **`Function.prototype.toString()` returns `[native code]`** for main-thread functions from the bundle, which is compiled to bytecode. A runtime can't compare two versions of a class by their source.
- **`lynx.getDevtool().replaceStyleSheetByIdWithBase64()` works on the main thread with Lynx DevTool off.** `getDevtool()` is in the main thread's `lynx` object in every build (`Utils::CreateLynx` in `renderer_ng.cc`). React Lynx's CSS hot updates use it.
- **`clearTimeout(undefined)` throws on the main thread**, where the web and the background thread ignore it. css-extract's stylesheet updater does it on its first call.
- **A second `__CreatePage()` gives a page Lynx never shows.** The first page stays on screen, with whatever was in it.
- **The background thread has `fetch`** in Lynx Explorer, with Lynx DevTool on or off (the background engine is PrimJS or JavaScriptCore depending on the switch).

The dev transport's reload fallback (`Page.reload` through `NativeModules.LynxDevToolSetModule.invokeCdp`) still needs Lynx DevTool: without it, the call does nothing.

### The fix

The rsbuild plugin's hot update clients (`packages/rsbuild-plugin-angular-lynx/src/client/`) apply each update on both threads:

1. The background client stands in for `@rspack/core/hot/dev-server`. It applies the update on the background thread first, then asks the main thread to apply its half.
2. The main-thread client gives the main thread a `lynx.requireModuleAsync()` that has the background thread fetch the file and runs it on the main thread with `new Function`. The hot update runtime already there then works unchanged.
3. If either thread can't apply the update, the background client reloads the page through Lynx DevTool.

Modules take their updates like this (`hot-updates.ts`, and `ɵhmrAccept` in the runtime):

- **A component whose template or styles changed** is updated in place with Angular's `ɵɵreplaceMetadata()`, which Angular's own dev server uses for the same edits. Its views are re-rendered, and its instances, with their state, are kept.
- **Any other change** (a class, an import, a service) passes the update on to the app's entry, which bootstraps the app again. The new app opens on the route the old one showed, with the same Back history (`carryOverLocation()`), and takes over the page (`LynxDocument.createRootElement()`).
- **Stylesheet edits** are applied on the main thread with `replaceStyleSheetByIdWithBase64()` (`client/css-hot-update.ts` replaces css-extract's background-thread updater).
- **On the background thread**, every update runs the changed modules again from the generated background entry, which registers their background functions again.

Lynx DevTool is only needed for the reload fallback, when an update can't be applied (for example a module that throws while it loads).

The web preview has no hot updates or reloads: web-core has neither `replaceStyleSheetByIdWithBase64()` nor a DevTool connection to reload with, and the preview page has no client of its own. Refresh the browser after a save.

### Still open

`Page.reload` from Lynx DevTool leaves an AngularLynx app blank in Lynx Explorer 4.1 on the iOS Simulator, on master too. The bundle loads, `renderPage` runs and Angular bootstraps (even with an explicit `__FlushElementTree()`), but nothing shows. So the reload fallback reloads, but to a blank page.

To check what happened on the iOS Simulator, read Explorer's logs. JS `console` output doesn't appear there, but native module calls and script loads do:

```sh
xcrun simctl spawn booted log show --last 5m --style compact \
  --predicate 'process == "LynxExplorer"' | grep -E "hot-update|invokeCdp|LoadTemplate"
```

---

## `<webview src>` shows a broken-page icon in the rspeedy web preview, but works on device

### What you'd expect (web / native parity)

`<webview src="https://…">` loads the page on every platform, as it does in a native web view on iOS and Android.

### What Lynx does

Lynx for Web implements `<webview>` as an `x-webview` custom element that wraps an `<iframe>` (`src` sets the iframe's `src`; `html` sets `srcdoc`). The rspeedy dev server's web preview (`/__web_preview`, served by `@lynx-js/web-rsbuild-server-middleware`) makes the page **cross-origin isolated** so web-core can use `SharedArrayBuffer`:

```js
res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
```

Under `require-corp`, Chrome refuses to load any cross-origin iframe whose response doesn't opt in with a `Cross-Origin-Resource-Policy` header. Almost no public site sends that, so the frame shows Chrome's broken-page icon. The DevTools Issues panel reports "Specify a Cross-Origin Resource Policy to stop a resource from being blocked." Two traps make this look like a renderer bug:

- `bindload` **still fires**, so the app reports a successful load over an empty frame.
- The site's own headers are not the cause. `lynxjs.org` sends no `X-Frame-Options` and is still blocked.

Native web views (WKWebView, `android.webkit.WebView`) are not iframes, so none of this applies on device. The docs site's `<Go>` preview doesn't send COEP either, so URLs that allow framing load there.

Separately, a URL that sends `X-Frame-Options: DENY` or a CSP `frame-ancestors` rule (MDN, for example) can never load in Lynx for Web, in any preview, because it is still an iframe.

### The fix

Nothing to fix in the renderer: the element is created correctly and `src` reaches the iframe. To check `<webview>` in the local web preview, use the `html` attribute, which loads through `srcdoc` and isn't cross-origin. Check URL loading on a device, or in the docs-site preview with a URL that allows framing (`examples/element-webview` uses `https://angular.dev`).

---

## A `<webview>` stays empty for a moment before its first page draws

### What you'd expect (web)

An `<iframe>` in a page that's already open shows its document as soon as it has loaded it, which for `srcdoc` is at once: the browser's engine is already running.

### What Lynx does

`<webview>` is the platform's web view (WKWebView, `android.webkit.WebView`), which starts processes of its own before it draws anything. On iOS, WebKit launches a `com.apple.WebKit.WebContent` process for each web view, and for the first one in an app a GPU and a Networking process too. It hides the web view's content until that process draws its first frame, so the box shows only what's behind it until then, even for an `html` page with nothing to download. Android's WebView starts its renderer process the same way.

On the iOS 27 Simulator, the first page drew 1 to 3 seconds after the web view went on screen, and 8 to 13 seconds while the Mac was busy building other apps, when WebKit logged its WebContent processes as unresponsive. Issue #338 took that wait for web views that never draw, in apps from `ng build --platform ios`. The simulator's log still had the runs it came from, and every web view in them loaded its page (`WebPageProxy::didFinishLoadForFrame`), had Lynx send `load` (`SendCustomEvent event name:load`) and drew (`hideContentUntilPendingUpdate completed`), 1.4 to 13 seconds after it went on screen. Lynx Explorer and the Android shell showed the same pages the same way.

### How to work with it

Wait for `bindload` before reading or checking a web view's page, rather than a fixed time: it fires once the page has loaded, and in the logs above the page had drawn by then or drew within a few tenths of a second. To see the timing on the iOS Simulator:

```sh
xcrun simctl spawn booted log show --last 5m --style compact \
  --predicate 'process == "<app executable>" AND (eventMessage CONTAINS "_endLiveResize" OR eventMessage CONTAINS "hideContentUntilPendingUpdate" OR eventMessage CONTAINS "event name:load")'
```

`-[WKWebView _endLiveResize]` marks the web view going on screen, and `hideContentUntilPendingUpdate completed` its first frame. The E2E tests check that a web view loads and draws in the app's own builds (`packages/e2e/native/webview.yaml`).

---

## On iOS, XElement's `<webview>` keeps its web view and WebContent process after the element is gone

### What you'd expect (web)

An `<iframe>` taken out of the page takes its document with it, and the browser frees the frame's memory once nothing refers to it. Android's `<webview>` does the same: `dumpsys meminfo`'s WebViews count drops back to 0 when the screen that had them goes.

### What Lynx does

On iOS, the web view outlived its element in any host that uses XElement's own loader, which Lynx Explorer and, before issue #397, the apps from `ng build --platform ios` do. `LynxUIWebView` gets its web view from a loader, which XElement 4.1.0 (and 4.2.0, unchanged) registers as `"default"` in `LynxWebViewService`. That loader, `LynxWebViewDefaultLoader`, holds its `WKWebView` and adds itself as the web view's script message handler:

```objc
[configuration.userContentController addScriptMessageHandler:self
                                                        name:self.delegate.nameOfScriptMessageHandler];
self.webview = [[WKWebView alloc] initWithFrame:CGRectZero configuration:configuration];
```

`WKUserContentController` keeps its handlers until `removeScriptMessageHandlerForName:`, which nothing calls, so the loader and the web view keep each other. The element lets go of its loader, and the two stay, with the `com.apple.WebKit.WebContent` process WebKit started for the web view, for as long as the app runs. Nothing in the app's JavaScript can reach the loader: only native code can change `LynxWebViewService`'s providers.

A probe app that shows seven `<webview [html]>`s with a screen's worth of other elements, removes them, and does it again, on the iOS 27 Simulator, counted with `heap <pid>` and the WebContent processes under the simulator's `launchd_sim`, 8 seconds after each change:

| After          | XElement's loader: `LynxUIWebView` / `WKWebView` / WebContent | Wrapped loader (below) |
| -------------- | ------------------------------------------------------------- | ---------------------- |
| 1st show       | 7 / 7 / 7                                                     | 7 / 7 / 7              |
| 1st removal    | 0 / 7 / 7                                                     | 0 / 0 / 0              |
| 2nd show       | 7 / 14 / 14                                                   | 7 / 7 / 7              |
| 4th removal    | 0 / 28 / 28                                                   | 0 / 0 / 0              |
| 24 s idle more | 0 / 28 / 28                                                   | 0 / 0 / 0              |

The WebContent processes' resident sizes added up to about 150 MB each (RSS, which counts the pages they share more than once). With few elements removed, the element (and its `LynxUIWebView`) waits for the main thread's JavaScript heap to be collected, as any element does, so the probe removes 150 other views with the web views to make the runtime ask for a full collection, as leaving a screen does.

### The fix

The shell registers its own `"default"` provider (`packages/native/templates/ios/App/WebViewLoader.swift`). Its loader wraps XElement's and, when the element lets it go, takes XElement's loader off the content controller's handlers, which ends the cycle; the web view and its process then go with the element. Everything else stays XElement's: the web view's settings, the `load` and `error` events, and the page's messages (`bindmessage`, checked in the probe above). The provider is registered after Lynx's start-up tasks run (`LynxLazyRegister.loadLynxInitTask()`, which runs them once), since XElement registers its own there and would replace one registered before.

A host of your own that uses XElement's `<webview>` (an ejected shell is one) needs the same: register a `"default"` provider whose loader takes the handler off, or gives `WKUserContentController` a handler that holds the loader weakly. The workaround can go once XElement's loader stops adding itself as a strong handler.

---

## Text that is exactly `false` disappears on Lynx for Web (any attribute set to `"false"` is removed)

### What you'd expect (web / native parity)

`<text>{{ enabled() }}</text>` renders `false` when the signal is `false`, as Angular does in the browser and as native Lynx does.

### What Lynx does

On native Lynx it renders `false`. On Lynx for Web the text is **blank** whenever the value is the string `false`. Every other value renders, including `true`.

AngularLynx isn't dropping it. The renderer writes it through `__SetAttribute(rawText, 'text', 'false')`, and a main-thread renderer test confirms `'false'` reaches that call. The cause is the base class every Lynx for Web custom element extends (`@lynx-js/web-elements`, `element-reactive/component.js`). It treats the string `"false"` as "attribute absent", like an HTML boolean attribute:

```js
/** handle attribute='false' */
setAttribute(qualifiedName, value) {
  if (value.toString() === 'false'
      && !_a.notToFilterFalseAttributes?.has(qualifiedName)
      && !qualifiedName.startsWith('data-')) {
    this.removeAttribute(qualifiedName);
    return;
  }
  super.setAttribute(qualifiedName, value);
}
```

`<raw-text>` stores its content in a `text` attribute and doesn't opt out through `notToFilterFalseAttributes`, so a text node whose content is exactly `false` loses its attribute and renders empty. `attributeChangedCallback` applies the same filter, so the value can't come back in through another path.

The same rule removes **any** attribute set to `"false"` on any web element, e.g. `loop="false"` or `glass-interactive="false"`. For boolean attributes that's the intended behavior.

### The fix

This is upstream in `@lynx-js/web-elements` (it would need `text` in `RawText`'s `notToFilterFalseAttributes`), and it only affects Lynx for Web. Until it's fixed there, avoid rendering a bare `false` as text in content meant for the web preview: show a label instead (`{{ on() ? 'On' : 'Off' }}`, as `examples/element-video` does).

---

## `NativeModules` is `undefined` in Angular event handlers; call native modules through `runOnBackground`

### What you'd expect (web)

Code in a click handler can call any API the page has. There is one JS thread, so every global is in reach.

### What Lynx does

Lynx gives `NativeModules` only to the **background thread**: it's a parameter of the background bundle's `tt.define` wrapper, and the main thread has no equivalent. In AngularLynx, the app on the **main thread** draws the screen, and the renderer registers every `(bind*)`/`(catch*)` handler as a main-thread worklet. So inside a handler, `typeof NativeModules === 'undefined'`, and any library that wraps it fails. Sparkling's `sparkling-navigation`, for example, answers `router.open()` with `{"code":-2,"msg":"NativeModules is not available. Ensure you are running in a lynx environment."}`.

React Lynx doesn't hit this because its component code runs on the background thread.

### The fix

Wrap the call in a `backgroundFn` at module level, and invoke it from the handler with the `runOnBackground` global:

```ts
import { backgroundFn } from '@blotch/angular-lynx';
import * as router from 'sparkling-navigation';

const openPage = backgroundFn((scheme: string) => {
  router.open({ scheme }, () => {});
});

// In the component
open() {
  (globalThis as any).runOnBackground(openPage, 'hybrid://lynxview_page?bundle=second.lynx.bundle');
}
```

Until October 2026 this didn't work either: the background thread listened for `runOnBackground` requests on `lynx.getJSContext()` instead of `lynx.getCoreContext()` (see the RuntimeProxy API summary above), so requests never arrived and the promise never settled. The fix is in `packages/runtime/src/lib/global-callbacks.ts`. It was found by running an Angular bundle in a Sparkling app on the iOS Simulator and an Android emulator.

For the host's own native modules, `LynxNativeModule` now does this for you (issue #81): `call()`, `on()`, `getNativeModule()` and `getJSModule()` send their calls through `callOnBackground()` (`packages/runtime/src/lib/background-call.ts`), and callbacks come back to the main thread. A module from `getNativeModule()` is a proxy, so its methods return promises. A library that reads `NativeModules` itself, such as `sparkling-navigation`, still needs the `backgroundFn` above.

Since issue #81, nothing of the Angular app runs on the background thread at all: before, a constructor that called `NativeModules` reached the host from the background thread's copy of the app, and the main thread's copy did nothing.

---

## `<blur-view>` Liquid Glass has no web implementation in Lynx for Web; AngularLynx draws it with WebGL

### What you'd expect (parity with iOS 26)

`blur-effect="glass"` refracts and frosts what's behind it, and glass shapes inside a `blur-effect="glass-container"` closer than `spacing` merge into one shape, as on iOS 26.

### What Lynx does

Lynx for Web turns `<blur-view>` into `<x-blur-view>` (`@lynx-js/web-elements`), which implements only `blur-radius`, as `backdrop-filter: blur()`. Every glass attribute (`blur-effect`, `glass-style`, `glass-tint-color`, `glass-interactive`, `spacing`) is ignored, so glass shows at best a frosted circle, and a glass shape without `blur-radius` shows nothing at all.

A browser can't give WebGL the page's pixels, so CSS alone can't refract. `backdrop-filter: url(#svg-filter)` can displace the backdrop, but only in Chromium.

### The fix

The runtime draws the glass itself on web (`packages/runtime/src/lib/web-glass/`). `createBlurViewElement` loads it with a dynamic `import()` behind the `__WEB__` define, so native bundles never contain it. For each visible glass container, or glass element outside one, it:

1. Captures the backdrop: the nearest ancestor that paints over everything behind it (an opaque background color or a background image), or else the page, up to the glass. The subtree is copied with inlined computed styles, shadow roots flattened and slots filled, then rasterized through an SVG `<foreignObject>` (the approach of html-to-image). What follows the glass, or any of its ancestors below the backdrop, is left out, since it paints over the glass. The backdrop used to be the glass's parent alone, which is usually a row or a wrapper that draws nothing: glass in a row on a gradient card, or a bar wrapped for positioning, refracted a blank image and drew as flat white.

   Glass that's `position: fixed`, or inside something fixed below that ancestor, refracts the page instead, and leaves out only the fixed element it's in and any fixed element stacked above it (a higher `z-index`, or the same one and later in the page). A menu's `<overlay>` and a popover's panel sit in the DOM beside the button that opened them, often in a row or a card, but they're drawn over the whole screen: by DOM order, the content after the button was left out, and the menu over the trip cards drew as a white card, while a popover bigger than its card refracted the card's clamped edge.

2. Draws every shape in one WebGL pass, into a canvas in the root's shadow root stacked under its children. Shapes are rounded-box SDFs joined by a smooth minimum, so nearby shapes merge. The lens samples outward at the rim and slightly inward in the middle, and `regular` glass mixes in a blurred copy of the backdrop. The light material darkens its outermost two device pixels, as UIKit's hairline does: everything else in it brightens, so over white the glass was white on white.
3. Captures again when the backdrop mutates, resizes or scrolls (changes inside the glass don't count), at most every 100 ms.

The shadow and the press swell depend on the group:

- **A container's canvas reaches 32px past its box**, for its shapes' shadow and the 6% a pressed shape swells. web-elements' shared element rule gives `<x-blur-view>` `overflow: clip` (`x-view` gets `visible` from web-core, `<x-blur-view>` doesn't), and a `:host` rule loses to it, so the container is unclipped with `:host{overflow:visible!important}`. A container draws only its shapes. With the canvas at the container's box, which hugs its shapes, the shadow stopped in straight lines and a held search field or dock lost its rounded ends.
- **A lone shape's canvas is its own box**, and its content (a menu panel's `overflow-hidden`) clips at the same element, so it casts a CSS `box-shadow` instead, which an element's own `overflow` doesn't clip, and it swells as a whole with the `scale` property, which composes with a `transform` of its own. The shadow grows with the shape's shorter side, from a bar button's faint one to the wide one under a menu or an action sheet, as UIKit's does.

Things that caught the copy out:

- **Every Lynx for Web element has `border-style: solid`** with `0px` widths. `0px` matches a plain div's default (because a plain div has `border-style: none`), so a copier that only inlines non-default values leaves it out, and the copy draws 3px (`medium`) black borders. Border and outline widths are always inlined.
- **The main thread runs in an iframe's realm** while its elements belong to the page, so `instanceof HTMLSlotElement` and the like are always false. The code checks `nodeType`/`localName`, and goes through `element.ownerDocument.defaultView` for every DOM API, so its observers, frames and images all belong to the page.
- **`if (__WEB__)` around a call doesn't remove the code it calls.** A static import of the glass code stayed in the native bundle (32 kB) after the branch was dropped: on the ES2019 main thread, classes with `#private` fields compile to `(x = …, class {…})` sequences, which the minifier can't prove free of side effects. A dynamic `import()` inside the branch works, because the bundler never follows an import in a dead branch.
- **GLSL ES 1.0 only lets a loop counter index a uniform array.** Indexing one with a function parameter fails to compile in WebGL 1, so the per-shape distance is written out in each loop.
- **The page's own stylesheet isn't in the image.** The copy leaves out every property that matches a plain div, and the plain div was probed in the page, where the docs site makes every element `border-box`. In the image, which has only the browser's styles, a padded card was then `content-box`, grew by its padding, and pushed what's in it down: a dimming layer under clear glass showed as a half disc low in the circle. The div is now probed in a shadow root of its own, reset with `all: initial`.
- **Safari ignores an SVG viewBox for a `<foreignObject>`'s content** in an image: it draws the HTML from the root's corner at one pixel per CSS pixel. A viewBox cropped the copy to the region and scaled it to the image in Chromium only, so in Safari glass refracted what's up and to the left of it, and drew the image's unfilled part as a dark band. The copy is now moved and scaled with a CSS transform instead, in an SVG the size of the image.
- **An empty shape draws a line.** A rounded box with no width is a line segment in the distance field, and the smooth union bulges it into the shapes beside it. iOS draws nothing for a glass view with no width, such as the search field's cancel button before it grows out of the field, so the web leaves such shapes out.

Main-thread touch handlers don't fire for a mouse on desktop web either: a drag needs `mainThreadBindmousedown` / `mainThreadBindmousemove` / `mainThreadBindmouseup` too, which the `LynxMainThreadEvent` directive supports.

---

## `rem` is 14px on native Lynx, but Lynx for Web resolves it against the host page (16px), and text inherits the page's font

### What you'd expect (web / native parity)

A Lynx bundle looks the same in `<lynx-view>` as in the iOS app: `h-11` is the same height, `text-base` the same size, in the same font.

### What Lynx does

On iOS, `rem` is relative to Lynx's 14px root font size, which is also the default size of text: `h-11` (`2.75rem`) measures 38.5pt in the simulator. Lynx for Web keeps `rem` as written, so inside `<lynx-view>` it resolves against the **host page's** root font size, usually 16px. Every Tailwind size (heights, padding, gaps, `text-*`) came out a seventh larger than on the phone. Text also inherits the host page's `font-family` and `font-size` through the shadow root: the docs site's Inter, or Times in a bare page, where iOS uses the system font.

web-core can rewrite `rem` to `calc(N * var(--rem-unit))`, but only when the `<lynx-view>` has `transformREM` (attribute `transform-rem`) set before it fetches the bundle, and nothing sets `--rem-unit` by default.

### The fix

The host page configures its `<lynx-view>`: `transformREM = true`, and on the view `--rem-unit: 14px; font-size: 14px; font-family: -apple-system, …, system-ui, …`. The docs site does this for every `<Go>` preview in `packages/website/src/components/go/native-parity.ts`. `<Go>` creates the `<lynx-view>` itself, and a browser reads a custom element's lifecycle callbacks when it's defined, so wrapping `connectedCallback` on the prototype afterwards does nothing: the site registers `<lynx-view>` as a subclass of web-core's element instead.

---

## `<blur-view>` on Lynx for Web ignores `flex-col` and has none of iOS's blur materials

### What you'd expect (parity with iOS)

A `<blur-view>` lays its children out like a `<view>`, and its `blur-effect` (`light` by default, `extra-light`, `dark`) changes how bright the blurred backdrop is.

### What Lynx does

`@lynx-js/web-elements` gives `<x-blur-view>` `display: flex`, but leaves it out of the rules in `linear.css` that turn Lynx's layout variables (the display toggle, the linear orientation, `--flex-direction`) into CSS. `.flex-col` only sets `--flex-direction: column`, so a blur view laid its children out in a row. It also implements only `blur-radius`, so every `blur-effect` looked the same: a plain blur, darker than iOS's `light`.

### The fix

The runtime's web-only `<blur-view>` code (`packages/runtime/src/lib/web-glass/`) adds both through a `<style>` in the element's shadow root. `blur-view-layout.ts` copies web-elements' `x-view` container rules as `:host` rules. `materialCss` in `glass-host-style.ts` approximates the materials, fitted to the iOS simulator's pixels: `light` is `brightness(1.35)` on the backdrop, `extra-light` a 75% white wash, `dark` a 60% black one. `:host` rules lose to anything set from outside the shadow root, so the app's classes and inline styles still win.

---

## Session storage throws on Lynx for Web

### What you'd expect (web)

`lynx.getSessionStorageItem` exists, so it works.

### What Lynx does

lynx-core is the same script on every platform, so the background `lynx` on web has `setSessionStorageItem`, `getSessionStorageItem` and the subscription methods. They forward to the NativeApp, and web-core's NativeApp implements none of them: the first read throws `this.getNativeApp(...).getSessionStorageItem is not a function`.

### The fix

`LynxSessionStorage` checks `SystemInfo.platform === 'web'` (web-core reports `'web'`, which `@lynx-js/types`' `PlatformType` leaves out; the runtime's own `PlatformType` adds it) and uses its in-memory store there, as it does in tests and SSR.

---

## A `<textarea>` on Lynx for Web draws square corners and grows by its padding

### What you'd expect (parity with `<input>` and iOS)

`<textarea class="rounded-lg px-3.5 py-3">` has rounded corners and keeps the box its classes give it, as an `<input>` with the same classes does.

### What Lynx does

`@lynx-js/web-elements` forwards the host's box to the inner `<textarea>` through `::part(form)` and `::part(textarea)` with `inherit`, but unlike `<x-input>` it doesn't forward `box-sizing` or `border-radius`. The inner textarea is `content-box` with square corners, so it was its padding and border taller than on iOS (103px for 80px). Placeholders in both are web-elements' #808080, much darker than iOS's `placeholderText` (`rgba(60, 60, 67, 0.3)`).

### The fix

Style rules in the `<lynx-view>`'s shadow root (its `injectStyleRules`): `x-textarea::part(form), x-textarea::part(textarea) { box-sizing: inherit; border-radius: inherit; }`, and `--placeholder-color` on both parts. Both parts need the rule, because `inherit` passes through the `<form>`. The docs site adds them in `native-parity.ts`.

---

## A `<textarea>` on Lynx for Web ignores `z-index`, so a positioned sibling covers it and it can't be typed in

### What you'd expect (parity with `<input>` and iOS)

`<textarea style="position: relative; z-index: 1">` stacks above an absolutely positioned sibling drawn before it, as an `<input>` with the same style does, and takes the clicks.

### What Lynx does

web-elements draws `<textarea>` as `<x-textarea>`, a `display: contents` host around a `<form>` (also `display: contents`) and the browser's `<textarea>`. A host without a box ignores `position` and `z-index`. For `<x-input>`, web-elements forwards `z-index` to both parts (`x-input::part(input), x-input::part(form) { z-index: inherit }`), and the inner field, a flex item of the element's parent, stacks by it. `<x-textarea>`'s rules leave `z-index` out (as of web-elements 0.12.16), so the inner `<textarea>` stayed at `auto` under any positioned sibling. ui-textarea's focus ring is a transparent `position: absolute` view before the textarea, so it took every click: no textarea on the Dolan docs could be focused or typed in, while ui-input, built the same way, worked.

### The fix

The runtime gives each `<textarea>` it creates on the web a `<style>` in its own shadow root, `form, textarea { z-index: inherit }` (`lynx-document/web-textarea.ts`, called from `createInputElement`), as web-glass does for `<blur-view>`'s layout. Both parts need it, because `inherit` passes through the `<form>`. It's in the runtime rather than the docs site's `native-parity.ts` because it breaks typing in any app's web preview, not just the docs' look. It only inherits, so a textarea without a `z-index` is unchanged.

---

## `<input>`, `<overlay>`, `<svg>` and `<blur-view>` render nothing unless the host app registers XElement

### What you'd expect (web)

`<input>` and `<svg>` are part of the platform: every browser renders them.

### What Lynx does

Lynx's core only has the basic elements (`view`, `text`, `image`, `scroll-view`, `list`…). `<input>`, `<textarea>`, `<overlay>`, `<svg>`, `<blur-view>`, `<viewpager>`, `<refresh>`, the `<scroll-coordinator>` family, `<webview>` and `<video>` are in a separate library, XElement, which the host app has to link and register (Android: the `org.lynxsdk.lynx:xelement` artifact and `addBehaviors(XElementBehaviors().create())`; iOS: the `XElement` pod). What happens to a tag nothing is registered for depends on the platform. iOS leaves an empty box where the element would be and renders the rest of the page. Android throws `No BehaviorController defined for class input` (LynxError 990200, only in logcat), and the elements after it in the same update go missing too: in the E2E fixture on Lynx 4.1, everything below the `<input>` disappeared and Router navigation to a lazy page stopped working. Neither shows anything on screen. Lynx Explorer registers XElement, so a bundle that works in Explorer can still break in another host. Until 2026-10-20, the apps `ng build --platform` generates didn't register it, which blanked every `@blotch/ui` form control, dialog and icon.

### The fix

Both shells in `packages/native/templates` now link and register XElement, without AnimaX and Markdown, which the runtime doesn't support. On iOS that means not using XElement's `Behavior` subspec (it depends on Markdown), so the shell registers the classes itself (`App/XElementRegistry.swift`). The E2E fixture types into an `<input>`, finds an `<svg>` and opens an `<overlay>` in the app's own build (`packages/e2e/native/xelement.yaml`).

---

## A `<blur-view>` inside another `<blur-view>` shows nothing on Android

### What you'd expect (parity with iOS)

A `<blur-view>` blurs whatever is on screen behind it, wherever it sits in the tree: a glass shape inside a `glass-container`, or a frosted button on a frosted panel.

### What Lynx does

Android's blur-view (`LynxUIBlurView` and `BlurView` in xelement-blur-view) isn't a real backdrop blur. Before each frame it redraws one view into an offscreen bitmap and blurs that, and during the redraw every blur-view with a radius skips drawing itself, so it doesn't blur its own output. Which view: the one `android-capture-target` names, or else the nearest ancestor that is `overflow: hidden` or fully contains the blur-view (`getTargetParent()`). For a blur-view inside another one, that ancestor is the outer blur-view, a native view of its own. Redrawing it draws only blur-views, which skip themselves (a `glass-container` has no radius, so it draws its children, which are the glass shapes), so the bitmap is empty and the inner blur-view is invisible. This blanked the glass row and the glass playground in `examples/element-blur-view` on Android, in Lynx Explorer too. A blur-view inside a plain view works, because a plain view is usually flattened, and the redraw then uses its drawing parent. Inside a view with `flatten="false"` it fails the same way: the redraw of a native view holds only its own background and children, not the content behind them. A ReactLynx repro shows the same, so it isn't specific to AngularLynx.

### The fix

On Android, the runtime gives the page an id (`angular-lynx-page`) and sets `android-capture-target` to it on every `<blur-view>` it creates (`packages/runtime/src/lib/lynx-document/android-blur-capture.ts`). Each blur-view then redraws the page, clipped to its own area, which is what's on screen behind it, and the glass and nested blur-views render. A blur-view in an `<overlay>` now blurs the page below the overlay too. An app's own `android-capture-target` replaces the runtime's, and `""` restores Android's choice. A fix in Lynx itself would be for `getTargetParent()` to skip ancestor blur-views.

---

## Android's `<blur-view>` has no materials or glass

### What you'd expect (parity with iOS)

`blur-effect="light"`, `"extra-light"` and `"dark"` shift what's behind the blur (iOS brightens it, washes it with white or with black), and `blur-effect="glass"` draws a tinted glass shape with a rim, as `glass-style` and `glass-tint-color` say.

### What Lynx does

On Android (Lynx 4.1), `blur-effect`, `glass-style`, `glass-tint-color`, `glass-interactive` and `spacing` do nothing: Lynx implements them on iOS only (`@iOS 4.0` in `@lynx-js/types`' `blur-view.d.ts`). Android's blur-view has `blur-radius`, `blur-sampling`, `enable-auto-blur` and `android-capture-target`, so every `<blur-view>` is a plain Gaussian blur. A glass shape over white shows nothing at all, since a blur of white is white.

### The fix

Android's `BlurView.draw` paints the blurred backdrop first and then the view's own background and children, so a translucent background approximates the materials. It mustn't replace a background the app sets, usually with a class, and the runtime can't set it inline (an inline style beats every class) or tell which classes set one. So the build plugin adds a type-selector rule to the native bundle (`packages/rsbuild-plugin-angular-lynx/src/styles/blur-view.css`), which loses to any class, id or inline style:

```css
blur-view {
  background-color: var(--angular-lynx-blur-background, transparent);
  background-image: var(--angular-lynx-blur-background-image, none);
  box-shadow: var(--angular-lynx-blur-box-shadow, none);
}
```

On Android, the runtime sets the three variables inline on every blur-view, from its attributes (`packages/runtime/src/lib/lynx-document/android-blur-material.ts`): white or black for the materials, and a white sheen with the tint over it and an inset rim for glass. Even a blur-view with no material sets them, to `transparent` and `none`, because CSS variables inherit. iOS sets none, so the fallbacks apply there and its screenshots are unchanged. Web isn't given the rule: it draws its materials in each element's shadow root, and an app-level rule would beat them.

---

## iOS's `<blur-view>` has only the blur styles from before iOS 13

### What you'd expect (parity with UIKit)

A blur view can draw UIKit's adaptive materials (iOS 13 and later): `systemUltraThinMaterial`, `systemThinMaterial`, `systemMaterial`, `systemThickMaterial` and the bars' `systemChromeMaterial`. Before Liquid Glass, Apple drew bars, menus, alerts and floating buttons on them, a weight for each role, and they follow the view's light or dark appearance.

### What Lynx does

`blur-effect` knows `light`, `dark` and `extra-light`, besides `glass` and `glass-container` (`parseBlurEffectValue` in XElement's `LynxUIBlurView.m`, Lynx 4.1). They're `UIBlurEffect`'s styles from before iOS 13: one weight each, in one appearance, so `ios-user-interface-style` doesn't change them. Anything else logs an error and draws `light`. The frosted design of the glass components, before iOS 26, could only pick `extra-light` or `dark` from the app's color scheme, the same weight for a bar as for a menu or a button.

### The fix

The iOS shell registers its own class for `blur-view`, `BlurView` (`packages/native/templates/ios/App/BlurView.swift`), a subclass of XElement's `LynxUIBlurView` with, among others, one more attribute: `blur-material="ultra-thin" | "thin" | "regular" | "thick" | "chrome"`. It's a separate attribute rather than new `blur-effect` values so that hosts without the class (Lynx Explorer, apps that embed Lynx) ignore it and draw the `blur-effect` the glass sets beside it. No check for the class is needed.

- **A Swift element declares its attributes with `propSetterLookUp`,** a class method returning `[name, selector]` pairs, as an Objective-C one does with `LYNX_PROP_SETTER` (`LynxPropsProcessor.mm`). Lynx looks for an attribute in the class's own setters first and then in its superclasses', so the subclass adds `blur-material` and keeps every other attribute of `LynxUIBlurView`. Its setters get the value as it is (an `id`, `NSNull` on reset), since the lookup reads the type of argument 0, which is `self`.
- **The material goes in through the view.** `LynxUIBlurView` keeps its style and mode private and sets the view's `effect` whenever its own attributes change. `createView()` returns a `UIVisualEffectView` subclass instead, whose `effect` setter keeps what Lynx sets aside while a material is set, and puts it back when the material is removed. The order in which Lynx sets the attributes doesn't matter.
- **`ios-user-interface-style` sets the view's `overrideUserInterfaceStyle`,** so the adaptive materials follow the app's theme rather than the phone's, as the glass does on iOS 26.

`UiGlass` sets `blur-material` only in the frosted design, from its `material` input (`regular` by default). The dock, navigation bar and toolbar use `chrome`, glass buttons and button groups `thin`, and menus, popovers and alert dialogs `regular`. Clear glass sets `ios-user-interface-style="dark"`, the dark form of its material in either theme.

---

## `__AddInlineStyle` can't set a CSS variable

### What you'd expect (web)

`element.style.setProperty('--x', 'red')` sets a custom property, and Angular's `[style.--x]` binding does the same through the renderer's `setStyle`.

### What Lynx does

`__AddInlineStyle(element, '--x', 'red')` looks the name up as a CSS property (`CSSProperty::GetPropertyID`), finds none, and the variable never reaches the element. Only `__SetInlineStyles` sets inline CSS variables: its string form parses `--x: red` declarations when the page config has `enableCSSInlineVariables`, which the build plugin turns on (Lynx 4.1, `FiberElement::ParseRawInlineStyles`). `__SetInlineStyles` replaces every inline style, including those set with `__AddInlineStyle`. Checked on the Android emulator: `style="--probe: red; background-color: var(--probe, blue)"` is red, while `__AddInlineStyle` with `--probe` leaves `var(--probe, blue)` blue.

### The fix

`LynxElement` writes the whole inline style with `__SetInlineStyles` whenever a variable changes: the runtime's own variables first (the blur-view materials above), then the app's `style` string, then the `[style.--x]` bindings, which win over the attribute as they do on the web. The `[style.x]` styles are re-added after it, since `__SetInlineStyles` drops them (`#rewriteInlineStyle` in `packages/runtime/src/lib/lynx-element/lynx-element.ts`).

An inline variable reaches the element's descendants, as on the web, and changing it restyles them. Checked on the Android emulator (Lynx 4.1) and in the web preview with Dynamic Color's `uiDynamicColor`, which sets the theme's variables on the app's root view with a host `[style]` binding, and changes them when the wallpaper or dark mode does.

---

## The native main thread has no global `SystemInfo`

### What you'd expect (web)

`@lynx-js/types` declares `SystemInfo` as a global, and on Lynx for Web it is one on both threads.

### What Lynx does

On iOS and Android (Lynx 4.1), main-thread code sees `typeof SystemInfo === 'undefined'`. The same object is reachable as `lynx.SystemInfo` there (`lynx.SystemInfo.platform` is `'Android'` or `'iOS'`). The background thread has the global.

That `lynx.SystemInfo` also lacks `osVersion`: Lynx builds it in `GenerateSystemInfo` (`core/renderer/utils/base/tasm_utils.cc`) with only `platform`, the pixel sizes and ratio, `lynxSdkVersion`, `engineVersion` and `theme`. The background thread's global, built in `core/runtime/js/bindings/global.cc`, has it. Checked in Lynx Explorer 4.1 on the iOS 27 Simulator: the main thread printed no `osVersion`, and a `backgroundFn()` returned `27.0`, about 740 ms after the bundle loaded.

### The fix

Main-thread code reads `lynx.SystemInfo` first and falls back to the global (`isAndroid()` in `packages/runtime/src/lib/lynx-document/android-blur-capture.ts`).

`LynxSystemInfo.osVersion` takes the host's `osVersion` global prop when SystemInfo has none, and the shells `ng build --platform` makes send it. Without one, it asks the background thread (`callOnBackground('osVersion')`), and keeps the answer in a signal, so a `computed()` reading the getter sees it. The glass components need the version (`blur-view` draws Liquid Glass only from iOS 26), and count an unknown iOS version as current until the answer arrives.

---

## An `<overlay>` on Lynx for Web covers the whole browser page, not its `<lynx-view>`

### What you'd expect (parity with iOS)

An `<overlay>` covers the app's screen. In a `<lynx-view>` embedded in a bigger page, like the docs' previews, that screen is the view.

### What Lynx does

`@lynx-js/web-elements` opens the overlay's `<dialog>` with `showModal()`, which lifts it into the browser's top layer. Ancestors' transforms, clipping and containment don't apply there, so a sheet, dialog or select in a docs preview covered the whole window at full size, unscaled, and the rest of the page was inert until it closed. The z-index that `@blotch/ui` sets on its `<overlay>` does nothing on web either: web-elements gives `x-overlay-ng` `display: contents`.

### The fix

The docs site replaces `HTMLDialogElement.prototype.showModal` with `show()` for dialogs inside a `<lynx-view>` (`containOverlays` in `packages/website/src/components/go/native-parity.ts`). The non-modal dialog keeps web-elements' `position: fixed`, which the view's `contain: strict` resolves against the view, so the overlay scales and clips with the preview. It then needs `x-overlay-ng::part(dialog) { z-index: 2147483647; }`: every web-elements element is `position: relative`, so the page's later elements otherwise paint over it. An app whose `<lynx-view>` fills the page doesn't need this.

---

## In a scaled `<lynx-view>`, Lynx for Web reports pointer positions and `layoutchange` boxes in screen pixels

### What you'd expect (parity with iOS)

Touch and mouse positions and `layoutchange` sizes are in the app's own pixels (points on iOS), whatever size the app is drawn at.

### What Lynx does

The docs' `<Go>` previews lay the app out at the phone's size and scale it down to fit their pane with a CSS transform (about 0.68 at the default split). web-core takes pointer positions from the browser's `clientX`/`pageX` and web-elements fills `layoutchange` from `getBoundingClientRect()`, and neither undoes the scale. So `layoutchange` gave the blur-view playground's stage 0.68 of its size, which confined its draggable glass to the stage's top-left, and the glass followed the mouse at 0.68 of its speed.

### The fix

The docs' `<lynx-view>` subclass wraps the listeners web-core adds to the view's shadow root, where it handles every event its elements bind, and hands them the event with its positions and `layoutchange` box mapped into the view's own pixels (`listenInViewSpace` in `packages/website/src/components/go/native-parity.ts`). web-elements and the rest of the page keep the browser's own event, since web-elements pairs some pointer positions with `elementFromPoint()`, which takes screen pixels. web-core's `boundingClientRect` UI method also reads `getBoundingClientRect()` and is still scaled. The slider and the menu, which ask it, divide by the ratio of its width to the laid-out one (see the slider's section below), and LynxElement's layout tracker takes its answer only until the element's first `layoutchange`. An app whose `<lynx-view>` isn't scaled doesn't need any of this.

The runtime's own web code has to allow for the scale too. The blur-view glass (`packages/runtime/src/lib/web-glass`) measured its shapes and backdrop with `getBoundingClientRect()`, but redraws the backdrop from a copy of the page laid out in CSS pixels, so in a preview it refracted what sat at 0.68 of its position. It now divides boxes by `drawnScale()` (an element's drawn width over its `offsetWidth`) and works in CSS pixels throughout, scaling only the canvas's resolution.

`<lynx-stack-outlet>` measured itself with the DOM's `getBoundingClientRect()` as well, which is what `LynxElement.getBoundingClientRect()` returns on the web: from the browser's viewport, in screen pixels. It moved its pages by that width in CSS pixels, so in a preview a pop slid the page 0.68 of the way out and then removed it, the covered page waited 0.68 as far to the left, and a push rounded only the page's top-left corner, the one corner of its box it found at a corner of the screen (`innerWidth` is in CSS pixels). It now measures itself, and a bottom bar it carries, relative to the `<lynx-view>` in the view's CSS pixels, as native Lynx measures (`boxInLynxView` in `packages/runtime/src/lib/router/stack/stack-box.ts`). It takes a web touch's position from its `x`/`y`, which web-core measures from the view as it does a mouse event's, since a web touch's `pageX`/`pageY` are the browser's. Measured in Chromium on 2026-11-09, with a `<lynx-view>` scaled to 0.68 under the docs' event mapping: the page now leaves the screen before it goes, and a mouse drag keeps it under the pointer. `LynxElement.getBoundingClientRect()` itself stays the DOM's, since an app pairs it with the browser's own pointer events, which are in the same space.

Once the glass could reach the stage's edges, it showed a dark band there: the lens clamps to the backdrop image's edge pixels, and the image's last row was transparent. Rounding the image's width and height separately made its shape differ slightly from the SVG's viewBox, which the default `preserveAspectRatio` letterboxed, and the browser painted the copy's fractional height (356.47px) only to a whole pixel. The SVG sets `preserveAspectRatio="none"`, and the copy's frame is rounded up to whole pixels.

---

## One `stroke-dasharray` ServalSVG can't parse blanks every `<svg>` in the app on iOS

### What you'd expect (web)

A browser treats `stroke-dasharray="none"` as no dashes, and ignores a value it can't parse. Either way, one odd attribute affects one shape.

### What Lynx does

ServalSVG, the engine behind `<svg>` on iOS, parses the dash array with a loop that only moves forward while it's reading a number (`SrSVGNode::ParseStrokeDashArray` in ServalSVG 0.2.4). Any other token, `none` included, or a unit like `4px`, leaves it stuck on the same character forever. The parse runs on `LynxUI`'s async display queue, which is serial and shared by every `<svg>` in the process. So that one attribute hangs the queue, and from then on **no** `<svg>` paints: icons, spinners and charts on every page are blank, with no error or log. It lasts until the app is killed; in Lynx Explorer, bundles opened afterwards in the same process are blank too.

Found when TanStack Charts' SVG output (`stroke-dasharray="none"` on every bar) went into an `<svg>`: `lldb` on the Simulator showed the `com.lynx.asyncDisplay.displayQueue` thread spinning in `ParseNumber(s="none")`. On Android the SVG with the attribute drew nothing, but the other SVGs on the page still did.

### The fix

`LynxElement.setAttribute` rewrites an `<svg>`'s `content` before it reaches native (`packages/runtime/src/lib/lynx-element/svg-content.ts`): dash arrays of plain numbers stay, `px` lengths become numbers (they're user units in SVG anyway), and anything else (`none`, `%`, `em`, `inherit`) is dropped, as attribute or inline-style declaration. The upstream bug is still worth reporting to Lynx.

---

## The main thread lacks newer built-ins: `.at()`, `toSorted()`, `Object.groupBy()`, the Set methods

### What you'd expect (web)

Every current browser has the ES2021–ES2026 built-ins: `.at()` on arrays, strings and typed arrays, `findLast`, `replaceAll`, `toSorted`/`toReversed`/`toSpliced`/`with`, `Object.groupBy`/`Map.groupBy`, `Promise.withResolvers`/`Promise.try`, the Set methods (`union`, `intersection` and the rest), iterator helpers, `RegExp.escape`, Uint8Array base64 and hex, and more. And `Intl`, so `(1234.5).toLocaleString()` is `"1,234.5"`.

### What Lynx does

A probe ran in Lynx Explorer 4.1, on the iOS Simulator and an Android emulator, from a preEntry module ahead of the build's polyfills, and checked 76 built-ins on each thread. Both platforms gave the same results.

- **The main thread** has ES2019 and some later additions: `matchAll`, `Promise.allSettled`/`Promise.any`, `AggregateError`, `WeakRef`, `FinalizationRegistry`, `BigInt`, `globalThis`, and `findLast` on typed arrays. It lacks `replaceAll`, `.at()`, `Object.hasOwn`, `findLast`/`findLastIndex` on arrays, change array by copy (arrays and typed arrays), `Object.groupBy`/`Map.groupBy`, `Promise.withResolvers`, `isWellFormed`/`toWellFormed`, `Array.fromAsync`, the Set methods, `Iterator` and its helpers, `Promise.try`, `RegExp.escape`, `Math.f16round`, `Math.sumPrecise`, `Error.isError`, Uint8Array base64 and hex, and `Map#getOrInsert`. It also lacks what only the engine can provide: Error's `cause` option, the RegExp `d` and `v` flags, resizable ArrayBuffers and `transfer()`, `Atomics.waitAsync` and `Float16Array`. Of the web APIs, there's no `structuredClone`, `atob`/`btoa`, `crypto`, `performance`, `Intl`, `EventTarget`, `Event` or `Blob`.
- **The background thread** lacks the same, plus `Promise.allSettled` and `Promise.any`.

Libraries that call them throw "not a function", often at module load, where it blanks the app before it renders, while every spec passes in Node. TanStack Charts' scene compiler uses `.at(-1)` and `replaceAll`; an app's shared constants package ran `table.at(-1)` and `Object.keys(…).toSorted(…)` at module level (issue #177). Without `Intl`, `toLocaleString()` is plain `String(n)`, so a value shown with it reads `21.232271760105846`.

### The fix

The build's preEntry (`packages/rsbuild-plugin-angular-lynx/src/polyfills.js`) imports `es-builtins.js`, which defines every built-in up to ES2026 that JavaScript can define next to the engine's own, on both threads, before any of the app's modules. Each is added only where it's missing, non-enumerable, as a method (so it has the spec's name and length and isn't a constructor). Only when `Intl` is missing, it also replaces `Number.prototype.toLocaleString` with one that formats like en-US by default (grouping, up to three decimals, `minimumFractionDigits` / `maximumFractionDigits` / `useGrouping`); apps that need real localization use the `intl` build option, whose `NumberFormat` replaces it (see the `Intl` section).

It's written out rather than taken from core-js: `core-js/es` adds about 400 kB, and also replaces `Promise`, `Set` or `RegExp#exec` wherever core-js judges the engine's own lacking. These add about 22 kB minified (7 kB gzipped) to each thread's bundle. The engine-level features above stay missing.

To check them on the devices, an app ran one case per method on both threads and compared each result with Node's own built-ins: all 51 matched on iOS and Android, once `Array.fromAsync` stopped using `for await` for sync iterables (see the next section).

### `String.prototype.normalize()` was missing too, and three.js's loaders call it

`normalize()` is ES2015, so the probe above didn't list it, but the main thread lacks it as well. three.js 0.187's `LoadingManager.resolveURL()` calls `url.normalize('NFC')` on every URL, so `TextureLoader`, `ImageLoader` and `GLTFLoader` threw "not a function" on iOS and Android while the web preview, a browser, drew the textures. Found by the solar system example (`examples/solar-system`), whose planet maps stayed black natively.

`es-builtins.js` now adds it: the form is checked as the spec says (a `RangeError` for anything but NFC, NFD, NFKC or NFKD), ASCII comes back exactly as every form leaves it, and other text comes back as given. A real normalizer needs Unicode's decomposition and composition tables, tens of kilobytes in every app, for a method whose callers here pass URLs, and text is almost always stored composed (NFC) already. So `'café'.normalize('NFD')` doesn't decompose the é on Lynx.

---

## `<svg>` content can't use CSS variables, and JS can't read their values

### What you'd expect (web)

Inline SVG inherits the page's CSS: `fill="var(--primary)"` or `currentColor` follow the theme, dark mode included. Failing that, `getComputedStyle` reads a variable's value.

### What Lynx does

`<svg content>` is a string the native engine parses on its own, with no access to the page's styles, and Lynx has no computed-style API to read a variable from JS. (`current-color` sets `currentColor` from an attribute, so it doesn't help either.)

Lynx's main branch has since made native `<svg>` fall back to the CSS `color` for `currentColor` (lynx-family/lynx f88d423d9c, 2026-09-02), but no release has it yet: 4.1.x and 4.2.0 read only `current-color`. The web preview's `<x-svg>` turns `content` into an `<img>` (a blob URL), so there `currentColor` is always black.

### The fix

`<ui-chart>` keeps CSS-shaped paints in its scene and resolves `var(--token)` against TypeScript copies of the theme (`chart-theme.ts`, checked against `default.css`/`dark.css` by a test) right before it writes the SVG. Which copy depends on the chart's color scheme, which defaults to light because the ui theme's dark mode is opt-in (`.dark` class); apps that toggle it set `'system'` or their own function. Text that must follow the theme exactly is native `<text>`, which reads the variables.

`<ui-icon>`, `<ui-spinner>` and pagination's arrows do the same with `icon-theme.ts` (`provideIconTheme()`): their `color` takes `var(--token)`, and without one they draw in the foreground. A container can set the color for icons projected into it through DI (`UI_ICON_COLOR`), standing in for the `color` inheritance an icon would get on the web; a destructive nav drawer item uses it.

---

## The main thread's `lynx` has only a few of the `lynx` APIs

### What you'd expect (web)

One global object offers the same APIs wherever your code runs.

### What Lynx does

Template event handlers run on the main thread, whose `lynx` (`Utils::CreateLynx` in Lynx core's `core/runtime/lepusng/bindings/renderer_ng.cc`) has only `getTextInfo`, timers, the thread contexts (`getJSContext`, `getCoreContext`, `getEngine`), `setSessionStorageItem`/`getSessionStorageItem`, `stopExposure`/`resumeExposure`, `reportError` and a few loaders. It has no `accessibilityAnnounce`, `addFont`, `setObserverFrameRate`, `subscribeSessionStorage`, `createSelectorQuery`, `getJSModule` or `fetch`. Web-core's main-thread `lynx` has even less: no `stopExposure`, `resumeExposure` or `getTextInfo`. A service that called these directly threw "not a function" from a tap handler. `setTimeout` doesn't help: the timer runs on the main thread too.

### The fix

`packages/runtime/src/lib/background-call.ts` relays the call to the background thread over the cross-thread event channel and resolves with its result: the main thread dispatches on `getJSContext()`, and the background thread replies on `getCoreContext()`. `LynxAccessibility.announce()`, `LynxFont.addFont()`, `LynxGlobalExposure.setObserverFrameRate()` and, on web, `stopExposure()`/`resumeExposure()` use it. A main-thread `LynxSessionStorage.subscribe()` subscribes through it and gets each change sent back. `LynxAccessibility.requestFocus()` finds the element with `__QuerySelector` on the page and calls `__InvokeUIMethod` instead, because the main thread owns the native elements.

---

## Lynx can't match attribute selectors, so emulated encapsulation scopes with classes

### What you'd expect (web)

With `ViewEncapsulation.Emulated`, Angular's compiler rewrites a component's selectors with attribute selectors (`.title` becomes `.title[_ngcontent-c1]`, `:host` becomes `[_nghost-c1]`), and the renderer puts those attributes on the component's elements, so its styles match only its own template.

### What Lynx does

Lynx's newer CSS engine parses attribute selectors (`css_selector_parser.cc` in Lynx core's `core/renderer/css/ng`) and even indexes them (`rule_set.cc`), but `SelectorMatcher::MatchSimple` (`css/ng/matcher/selector_matcher.cc`) only matches tag, class, id and pseudo-classes: anything else returns `false`. A rule scoped with an attribute never applies. Before the fix, the plugin skipped Angular's scoping entirely, so every component's CSS applied app-wide.

### The fix

The plugin lets Angular's compiler scope each component's styles as on the web, then lifts them out of the compiled component definition (`extractComponentStyles` in `packages/rsbuild-plugin-angular-lynx/src/component-styles.ts`) and turns `[_ngcontent-%COMP%]` and `[_nghost-%COMP%]` into classes (`._ngcontent-<id>`, `._nghost-<id>`). `EmulatedLynxRenderer` adds the same classes to the elements, and `LynxElement` keeps them when Angular replaces the whole class list. The compiler also marks CSS variables with a `%NS%` namespace placeholder (`var(--%NS%primary)`), which Angular's renderer fills with `CSS_VAR_NAMESPACE`, empty by default; the plugin fills it with the default at build time.

---

## A type selector naming a component's host or a web tag matches nothing, because the element is a `<view>`

### What you'd expect (web)

`app-card { height: 100%; }` styles every `<app-card>`, and `div { … }` every `<div>`. The browser creates an element of the tag the template wrote, so a type selector naming it matches, in a component's styles (scoped to `app-card[_ngcontent-c1]`) and in global ones.

### What Lynx does

Lynx only has its own elements. The renderer creates a `<view>` for any other tag (`createDefaultElement`), and for a component's host, unless `registerHostElement` names another element. Lynx's CSS matches a type selector against the element's own tag, which is `view`, and a view can't take another tag: Lynx creates an element's native UI from its tag, and has none registered for `app-card`. So `three-d-frame { height: 100%; }` never applied, the frame kept its content's height (0), and angular-three's canvas inside it, sized `height: 100%`, never got a size to render into (issue #227). The web preview is the same: `<lynx-view>` renders a view as `<x-view>`, which `app-card` doesn't match either. React Lynx doesn't meet this, as JSX has no host elements and names only Lynx elements.

### The fix

The renderer marks each element it creates for a tag that isn't a Lynx element, component hosts included, with a class made from the tag (`_ngtag-app-card`; `LynxRenderer.createElement`, with the list of Lynx tags in `packages/runtime/src/lib/lynx-document/element-tags.ts`). A PostCSS plugin the build plugin adds to every environment (`typeSelectorsForLynx` in `packages/rsbuild-plugin-angular-lynx/src/type-selectors.ts`) rewrites type selectors naming such tags to the class, in component styles (after Angular has scoped them, so `:host(app-card)`, `::ng-deep app-card` and `app-card.active > view` come out right) and global styles alike. Type selectors naming Lynx's own elements (`view`, `text`, `page`) stay as they are. The class is a scope class, so binding `class` on the element keeps it.

Two differences remain. A class is more specific than a type selector, so `app-card { color: red }` now ties with `.title { color: blue }` on the same element (the later rule wins), where on the web the class wins. And the root component's host is the page, which gets no tag class (it would show in every `render()` snapshot of the testing library, whose root is the page too), so `app-root { … }` still matches nothing: style the root with `page` or `:root`, or with `:host` in its own styles.

---

## A main-thread script can't read an element's position synchronously

### What you'd expect (web)

`element.getBoundingClientRect()` returns the element's layout box straight away, so a `touchmove` handler can measure the element it's dragging on every event.

### What Lynx does

The main thread's element functions have no layout read. `__GetComputedStyleByKey(element, 'left')` returns the computed CSS `left`, a positioning offset that's usually `0`, not where the element is: in the web preview it gave `top: 0` for an element 188px down. Lynx core has a synchronous `GetRectToLynxView()`, but only the old Lepus worklet `LepusElement` exposes it (`core/renderer/worklet/lepus_element.cc`), and nothing in the element function table reaches it (`core/runtime/lepus/bindings/renderer_functions_def.h`). The only way to get the position is the `boundingClientRect` UI method through `__InvokeUIMethod`, which answers in a callback.

### The fix

`MainThreadElement.getBoundingClientRect()` used to build its rect from the computed `width`, `height`, `left` and `top`. It now calls the `boundingClientRect` UI method and returns a promise of `{ left, top, right, bottom, width, height }`, measured from the LynxView, or from `relativeTo`. `MainThread.Element` and the `MainThread` event types declare it. A gesture measures once on `touchstart` and keeps the rect in a `MainThreadRef`, as the kitchen-sink app's "Live opacity" demo does.

---

## `__AddEvent(element, type, name, undefined)` doesn't remove a main-thread handler on native Lynx

### What you'd expect (web)

`removeEventListener()` removes a listener, whatever kind it is. On Lynx for Web, `__AddEvent` with `undefined` as the handler removes it too.

### What Lynx does

Native Lynx keeps a handler registered as a worklet (`{ type: 'worklet', value }`), which is every handler AngularLynx registers: each `[mainThreadBind*]` input, and the one handler `LynxElement` registers per event for its listeners (a template's `(bindtap)`, `renderer.listen()`, `addEventListener()`). `FiberElement::FiberAddEvent` (`core/renderer/dom/fiber/fiber_element.cc`) calls `RemoveEvent()` for an empty callback, and `AttributeHolder::RemoveEvent()` (`attribute_holder.cc`) only erases from `static_events_`, which holds background-thread handlers, and `global_bind_events_`. Worklet handlers live in `lepus_events_`, so the old one stays. Still so on Lynx's develop branch in November 2026.

Two things follow:

- **A removed handler keeps firing.** On the iOS Simulator, a `[mainThreadBindtap]` set to `null` still ran on the next tap.
- **An element with a handler is never freed** (#261). The native element holds the function registered for it. `LynxElement`'s holds the element's wrapper, which holds the native element, and with a template listener, Angular's listener holds the view's `LView` and everything in it: a loop through native code, which the garbage collector can't follow. So a screen left behind kept every element and every UI, whatever #237's release did. iOS gives each `<scroll-view>` a `scroll` handler from the start (see "On iOS, a scroll-view or list sends `scroll` only to the handlers it had when its UI was made"), so a screen with a scroll view leaked even without listeners. Counted with `heap <pid>` on the iOS Simulator (Lynx 4.1), in `examples/ui-dock` (a router app: four lazy screens under a dock) switching between two screens:

  | Rounds (two navigations each) | 0   | 20    | 40    | 60    |
  | ----------------------------- | --- | ----- | ----- | ----- |
  | `LynxUIView`s, before         | 83  | 1,203 | 2,323 | 3,443 |
  | `LynxUIView`s, after          | 83  | 83    | 83    | 83    |
  | `LynxUIScroller`s, before     | 1   | 41    | 81    | 121   |
  | `LynxUIScroller`s, after      | 1   | 1     | 1     | 1     |

  Before, every screen's component was still alive after 60 rounds (`WeakRef`s, 121 of 121); after, only the one showing. The same held without the router (an `@if` between two screens), for a `<view>` with a `(bindtap)` alone (21 of 21 screens kept, then 2), and on the Android emulator (21 of 21 screens kept, then 2; 74 Android views, then 14). Node's V8 collected them all along, as the test environment has no native code to hold the function.

### The fix

`removeNativeHandler` (`packages/runtime/src/lib/lynx-element/remove-native-handler.ts`) removes a handler by registering a worklet with no ID, `{ type: 'worklet', value: { _workletType: 'main-thread' } }`, with the type the handler was added with. Lynx keeps one handler per event name, so it replaces the old one, and `runWorklet` ignores it. The same type lets Lynx's listener refactor (`EnableEventHandleRefactor`), which matches by type, remove its copy too. React Lynx removes main-thread handlers the same way (`updateWorkletEvent` in `packages/react/runtime/src/snapshot/snapshot/workletEvent.ts`). A `global-bindEvent` handler still goes with `undefined`, which removes it from `global_bind_events_`.

`LynxMainThreadEvent` uses it when an input is unbound or the directive is destroyed, and `LynxElement` when its last listener for an event goes and when it releases a destroyed view's elements (see "A destroyed view's elements stay alive unless the renderer releases every one of them"). Layer 6's `native/main-thread.yaml` checks on device that a removed main-thread handler stops firing. `packages/runtime/src/lib/renderer/teardown.test.ts` stores handlers as Lynx does, so its release test fails if a function stays registered.

---

## The Android back button never reaches JavaScript unless the host app sends it

### What you'd expect (web)

The browser's back button fires `popstate`, and Angular's Router goes back a page. The app doesn't have to ask for it.

### What Lynx does

Lynx gives JavaScript no back event. On Android, the press goes to the activity holding the LynxView, whose default leaves the app. The one exception is XElement's `<overlay>`, a window of its own: while one shows, it takes the press and fires `requestclose`, and the activity never sees it (checked on an Android 14 emulator: the overlay stayed open and the route didn't change). Android also decides whether the activity handles back when the gesture starts, from `OnBackPressedCallback.isEnabled` (predictive back picks its animation from it), so the host can't ask JavaScript at press time. iOS has no back button.

### The fix

The Android app `ng build --platform android` generates registers an `AngularLynxShell` native module with `setBackHandlerEnabled(enabled)`, and while that's enabled sends each press as the `angularLynxBack` global event (`ShellModule.kt`, `MainActivity.kt`). `provideRouter()` starts `LynxBackButton` (`packages/runtime/src/lib/router/lynx-back-button.ts`), which keeps the handler enabled while `LynxLocationStrategy.canGoBack()` is true and calls `Location.back()` on each event, in a `setTimeout`. The router then navigates as for `popstate`, guards included, and back leaves the app from the first screen. Layer 6's `native/back-button.yaml` checks both ends on the Android shell (issue #59). An app embedding the bundle in its own Android app can register the same module and send the same event (`/guide/embedding/#connect-the-android-back-button`).

## An `Error`'s `stack` holds only the frames, not its name and message

### What you'd expect (web)

In V8, `error.stack` starts with the same line `String(error)` gives, such as `TypeError: probe failure`, then the frames. Code that prints only the stack still shows what went wrong.

### What Lynx does

On the main thread, PrimJS's `stack` is only the frames (`    at App (file:///main-thread.js:9570:187)` and so on), with no name or message (checked in Lynx Explorer 4.1 on the iOS Simulator). The web preview runs the same bundle in the browser, so it shows V8's form.

### The fix

Print the name and message yourself when the stack doesn't start with them. The dev server's log writer does this for `LynxLogger` (`formatArg` in `packages/rsbuild-plugin-angular-lynx/src/logger/dev-logger-middleware.ts`, issue #61).

---

## A container can't recolor projected text with `color`, but it can redefine a variable

### What you'd expect (web)

A component sets `color` on its wrapper (`text-destructive`), and whatever the app projects into it, text and `currentColor` icons alike, inherits it.

### What Lynx does

`color` doesn't inherit (inheritance is off by default, see above), so a class on the wrapper never reaches the app's `<text>`. CSS variables do inherit. A wrapper class that redefines a token the text already reads recolors it: `<ui-nav-drawer-item variant="destructive">` adds `[--foreground:var(--destructive)]`, and a projected `<text class="text-foreground">` turns red. Checked in Lynx Explorer 4.1 on the iOS Simulator: Tailwind's arbitrary-property class compiles (`.\[--foreground\:var\(--destructive\)\]{--foreground:var(--destructive)}`), and a variable defined as another variable resolves.

### The fix

Recolor through the token the content uses, and say which one in the docs (the nav drawer item recolors `text-foreground`). Text with another color class keeps it. SVG icons can't read variables at all, so the item hands its color to projected `<ui-icon>`s through DI (`UI_ICON_COLOR`) instead; see the `<svg>` entry above.

---

## `<refresh>` draws nothing unless it has a size

### What you'd expect (web)

A container with no width or height takes the size of its content, so a pull-to-refresh wrapper around a full-height scroll view fills the screen.

### What Lynx does

`<refresh>` doesn't size itself from its children. Without a width and height, it and everything in it draw nothing: `examples/element-refresh` was a blank screen in Lynx Explorer 4.1 on both the iOS Simulator and an Android 14 emulator, even though its `<scroll-view>` had `h-screen`. Giving `<refresh>` `h-full w-full` (and the `<scroll-view>` `h-full w-full`) fixed it on both (issue #67). The kitchen-sink refresh demo already did this.

The header also stays open after a refresh until something calls the element's `finishRefresh` UI method, and while it's open a second pull doesn't start another refresh. Call `invoke('finishRefresh')` on the element when the reload is done (`/api/elements/refresh`).

---

## On iOS, a focused `<input>` doesn't show style changes

### What you'd expect (web)

A `(focus)` handler can restyle the field it belongs to, for example to give it a colored border, and the field repaints straight away.

### What Lynx does

On the iOS Simulator (Lynx Explorer 4.1, iOS 27), a `(bindfocus)` handler that changes the focused `<input>`'s border color, through a class or an inline style, or its background color, has no visible effect while the field has focus. The change does reach the element: a `<text>` bound to the same signal updates in the same render, and the same bundle shows the new border on an Android 14 emulator and in the web preview. Found while fixing `examples/form-input`'s focus border (issue #67), which therefore shows on Android and the web only. Not investigated further: the cause is somewhere in the iOS input (`LynxUIBaseInput`), not in what AngularLynx sends.

---

## Tailwind CSS 4 writes modern CSS that Lynx drops, mostly silently, while the web preview shows it

### What you'd expect (web)

Tailwind 4 targets current browsers: its output uses cascade layers (`@layer`), registered custom properties (`@property`), CSS nesting, `oklch()` colors, `color-mix()` for opacity modifiers, logical properties (`padding-inline` for every `px-*`), the individual `translate`/`rotate`/`scale` properties, `:where()` in `space-*` and `divide-*`, and percentage opacities (`opacity: 50%`).

### What Lynx does

Checked in Lynx Explorer 4.1 on iOS and Android, and in Lynx for Web (Chromium), with hand-written probes and with real Tailwind 4.3 output:

- **`@layer` blocks are dropped**, natively and on the web: the template encoder only reads `@layer`, `@media` and `@supports` behind a compile option (`enable_css_rule_`, `css_rule_parser.cc` in lynx-family/lynx), and web-core's `encodeCSS` skips them. All of Tailwind 4's utilities are in `@layer utilities`, so nothing applies.
- **`@property` is ignored.** A variable Tailwind registers with an initial value (`--tw-border-style: solid`) stays unset. `--x: initial` is a literal value to Lynx, not "unset", so a `var(--x, fallback)` reading it breaks.
- **A selector list with an unknown pseudo-class loses the whole rule** at encode time, with a build warning: `:root, :host` (where Tailwind puts its theme), and `:where(…)`/`:is(…)`.
- **`:last-child` never matches**, so `:not(:last-child)` matches every child. `* + *` works.
- **`oklch()`, `oklab()` and `color-mix()` are dropped** (the element gets no color); the web preview shows them. `rgb()` with spaces and a slash, and 4- and 8-digit hex, work.
- **`opacity: 50%` is ignored** on native; the web applies it.
- **Logical shorthands (`padding-inline`, `margin-block`, `inset`) are removed at encode.** The longhands Lynx lists (`margin-inline-start`, `padding-inline-start`, `inset-inline-start`) parse but have no effect on either platform, even under `direction: ltr`.
- **There are no `translate`, `rotate` or `scale` properties.** `transform` with `var()` inside its functions works, and composes across classes when every element starts with the variables' values (a `*` rule).
- **A `var()` inside a function, inside a custom property's value, never resolves**: `--tw-translate-x: calc(var(--spacing) * 2)` and `--tw-blur: blur(var(--blur-sm))` leave the property unusable, even when the variable is set in the same rule or the `var()` has a fallback. A `var()` at the top of the value (`--a: var(--b)`) resolves, and so does one inside a function in an ordinary property (`width: calc(var(--spacing) * 20)`).
- **`@keyframes` without a `from` (or `to`) keyframe don't play.** Tailwind's `spin` has only `to`.
- **`calc(infinity * 1px)`** (`rounded-full`) isn't parsed, nor is the `3.40282e38px` a minifier folds it to.
- These do work: an empty fallback (`var(--x,)` becomes nothing), a `var()` fallback holding another `var()`, unitless `calc()` in `line-height`, and `*` rules setting variables.

### What we do about it

The build plugin (`packages/rsbuild-plugin-angular-lynx/src/tailwind-v4/`) rewrites every stylesheet that `@tailwindcss/postcss` compiled into CSS with the same meaning that Lynx reads, for both the native and the web bundle: it flattens nesting and layers, turns `@property` initial values into a `*` rule, converts colors to `rgb()`/`rgba()` (gamut-mapping as CSS Color 4 does), writes logical properties as physical ones (left-to-right), composes `translate`/`rotate`/`scale` into one `transform`, rewrites `space-*`/`divide-*` to `* + *`, resolves the `var()`s Lynx can't inside custom properties, completes keyframes, and drops properties and keywords Lynx doesn't have, so the web preview matches the device.

---

## Lynx has no API for the user's accessibility display settings

### What you'd expect (web)

`@media (prefers-reduced-motion: reduce)`, `(prefers-reduced-transparency: reduce)` and `(prefers-contrast: more)` follow the system's Reduce Motion, Reduce Transparency and Increase Contrast, and `matchMedia()` reports them to scripts.

### What Lynx does

Lynx has no `@media`, and neither SystemInfo nor any `lynx` API carries these settings, on iOS or Android (searched lynx-family/lynx, lynx-stack and the lynx-website docs; the only accessibility module is `LynxAccessibilityModule`, with `accessibilityAnnounce` and `registerMutationStyle`). Lynx Explorer sends none of them either, though it does pass a bundle URL's query parameters as global props, as strings: `?reduceMotion=true` arrives as `reduceMotion: 'true'`. iOS 27's Liquid Glass appearance setting (clear or tinted) has no public API at all (searched the iOS 27.1 SDK's UIKit and SwiftUI interfaces); UIKit's glass follows it, and Reduce Transparency and Increase Contrast, by itself.

### The fix

`LynxAccessibilitySettings` (`packages/runtime/src/lib/accessibility/accessibility-settings.ts`) reads `reduceMotion`, `reduceTransparency` and `increaseContrast` from the host's global props, as `true` or `'true'`, and on the web also from the page window's media queries. The shells send them: iOS from `UIAccessibility` (Increase Contrast is `isDarkerSystemColorsEnabled`), again on each `...StatusDidChangeNotification`; Android from the animator duration scale (Remove animations sets it to 0), `UiModeManager.getContrast()` (Android 14) and `AccessibilityManager.isHighContrastTextEnabled()` (Android 16), again through a settings observer and the contrast listeners. Android has no Reduce Transparency. Checked live on the iOS 27 Simulator (`simctl ui increase_contrast`, and Reduce Motion and Reduce Transparency through `com.apple.Accessibility` defaults) and the Android 14 emulator (`settings put global animator_duration_scale 0`, `settings put secure contrast_level 1.0`).

---

## On iOS, a `<blur-view>` draws no background; elsewhere it does

### What you'd expect (web)

`background-color` on any element paints behind its content.

### What Lynx does

iOS's `LynxUIBlurView` declares the background setters (`background-color`, `background-image` and the rest) as no-ops, so a blur view never paints a background there: the material is all it draws. Android's blur-view paints its background over the blurred backdrop (which is how the runtime approximates the materials, see above), and Lynx for Web's `<x-blur-view>` paints it like any element. The glass component relies on both: on Android and the web its opaque surfaces are the blur view's own `bg-secondary` or tint. iOS never needs those, except to tint the frosted material before iOS 26, which it does with a filled `<view>` behind the content.

---

## A glass container merges the glass in its own content, follows it as it moves, and doesn't animate glass coming or going

### What you'd expect (parity with SwiftUI)

A `GlassEffectContainer` merges nearby glass, and morphs it when a shape appears, disappears or changes into another (`glassEffectID`).

### What Lynx does

Checked in Lynx Explorer 4.1 on the iOS 27 Simulator:

- **Glass inside a plain wrapper view, one that draws nothing, still merged** (`glass-container` → `view` → `glass`). Wrappers that draw weren't tried. The web drawing counts only the container's direct children, so the glass component tells apps to put glass directly in the group.
- **Moving or resizing a glass shape with a CSS transition morphs the merged glass every frame**: two shapes pulled apart with `transition: margin-left` stretch their bridge thinner until it breaks, and a widening shape stays merged with its neighbor throughout.
- **A shape added or removed (`@if`) appears or disappears in one frame,** already merged. `LynxUIBlurView` sets its effect directly, outside any UIKit animation, so nothing materializes or dissolves, and there's no counterpart to `glassEffectID` for morphing one shape into another.

### What we do about it

The iOS shell's `blur-view` (`BlurView.swift`, with `GlassTransitions.swift`) animates it, in apps `ng build --platform ios` builds. Lynx Explorer and other hosts still pop.

- **It learns of each change from UIKit:** `willMove(toWindow:)` on the effect view as Lynx inserts or removes a view (or the element around it), and `isHidden` for `visibility`. LynxUI's own `willMoveToWindow:` would do, but its header marks the window non-null, and Swift can't take the nil it passes on removal.
- **It settles them at the end of the run loop pass,** in a `kCFRunLoopBeforeWaiting` observer ordered before Core Animation's commit (order 1,000,000 against 2,000,000), so the first frame drawn shows the start of the transition. Lynx doesn't flush UI operations from an observer of its own, so its whole update has been applied by then. A view that left and came back in the pass was moved, not removed: Lynx removes an element by detaching it, and Angular's moves (and the runtime's blur-view insert, which re-appends the siblings after it) detach and reattach.
- **Only glass in a container that was already on screen animates.** UIKit calls `willMove(toWindow:)` on a container before the views in it, so a container that comes or goes in the same pass (a new page, an overlay showing) takes its glass with it, drawn at once. Glass in a scroll view doesn't count, as its cells come and go while it scrolls.
- **A shape that's removed is gone by the end of the pass,** so it dissolves as a copy: a `UIVisualEffectView` with its effect and a `snapshotView(afterScreenUpdates: false)` of its content, appended to the container's content view, above the children Lynx inserts by index.
- **`glass-effect-id` pairs a shape that went with one that came.** In the same container the new one's frame and corners spring out of the old one's, and the copy of the old one flows into it as it dissolves, merged. Across containers or windows, such as a glass button in the page and the menu it opens in an `<overlay>`, the old one's frame can't be trusted: an overlay that closes in the same update lays its content out at nothing first, and the presentation layers of its ancestors have moved too. So the new shape takes over where it is, from the old corner radius (read from the presentation layer, which still has it), with the old content fading out over it; the menus, popovers and sheets place their glass at the trigger's frame themselves.

Measured on the iOS 27 Simulator: removal, insertion, `visibility`, a tint change, a same-container `@if`/`@else` morph, and the menu, popover and sheet handing a glass trigger's glass over, each way. Glass outside a container is left alone.

The dock does that. Its bar, action and accessory are absolutely positioned shapes in one group, and minimizing transitions their `left`, `right`, `bottom` and `height`: the accessory moving down between the shrinking bar and action bridges into each as it passes and splits off again, on the iOS 27 Simulator and in the web preview.

---

## `flex-1` on a `<blur-view>`'s children does nothing on Lynx for Web

### What you'd expect (parity with iOS and Android)

A child with `flex-1` inside a blur view with `flex flex-row` takes the remaining width, as inside a `<view>`.

### What Lynx does

web-elements sizes a flex item (`flex: var(--flex-grow) …`, or a linear weight) through container style queries on its parent's `--lynx-display` and `--lynx-linear-orientation`, which don't inherit. A blur view's children are slotted into its shadow root's `<slot>`, which is the parent those queries see, so they never matched: a glass capsule with `flex-1` beside a button in a glass group stayed as narrow as its content.

### The fix

The runtime's web-only blur view layout (`BLUR_VIEW_LAYOUT_CSS` in `packages/runtime/src/lib/web-glass/blur-view-layout.ts`) gives the slot the host's values: `slot { --lynx-display: inherit; --lynx-linear-orientation: inherit; --lynx-linear-weight-sum: inherit }`.

---

## `layoutchange` never fires on a `<blur-view>` on Lynx for Web

### What you'd expect (parity with iOS and Android)

`(bindlayoutchange)` on a `<blur-view>` reports its size after layout, as on any element, and does on iOS and Android.

### What Lynx does

web-elements sends `layoutchange` from a `ResizeObserver` on the element's `layoutChangeTarget`. `<x-view>` and `<x-text>` set it to themselves, but `<x-blur-view>` (`XBlurView.js` in `@lynx-js/web-elements`) leaves it unset, so enabling the event observes nothing. The dock measured its width on its glass group and never minimized in the web preview.

### What we do about it

Measure a plain view instead. The dock puts an empty full-width `<view class="h-0 w-full">` above its glass group and listens there. A fix in web-elements would be for `XBlurView` to set `[layoutChangeTarget] = this`, as `XView` does.

---

## Native Lynx 4.1 loses an element moved to a parent its flush reaches first

### What you'd expect (web)

`appendChild()` moves an element that's already in the tree: it leaves its old parent and shows up in the new one, wherever the two are.

### What Lynx does

`__AppendElement` and `__InsertElementBefore` change the element tree at once, but only queue the change for the layout and painting tree: a removal on the old parent and an insertion on the new one. `__FlushElementTree` handles each element's queue in pre-order (`Element::FlushActions` in `core/renderer/dom/fiber/fiber_element.cc`). When it reaches the new parent first, the insertion finds the element still rendered under its old parent and links it in anyway; the old parent's removal then finds the element rendered elsewhere and does nothing (`HandleRemoveChildAction` logs "remove wrong child node" and returns). The element ends up in neither: the new parent lays out as if empty, and the element measures at the top-left of the screen.

Moves the flush handles in order work: within one parent (an `@for` reorder), into a later part of the tree, or down into the old parent's own subtree. The one that broke was moving an element out of an `<overlay>` back into the page before it, which the context menu does with the element it lifts (on the iOS 27 Simulator and an Android 14 emulator, in Lynx Explorer 4.1). Lynx's develop branch fixes it: `HandleInsertChildAction` detaches the element from its old render parent first, behind `FixFiberReinsertDetachFromOldRenderParent`, which defaults to on but isn't in 4.1.

### The fix

`LynxElement.appendChild()` and `insertBefore()` check, on native Lynx, whether the flush will reach the new parent before the old one (`flushesBefore()`: an ancestor, or an earlier branch under the two's common ancestor). If it will, the element is removed for good and rebuilt in the new parent from its cached state (`#removeIfMoveWouldBeLost()`, then the recreate-on-remount path), in the same flush, so nothing depends on the order. Every other move stays a native move. Lynx for Web moves DOM nodes and doesn't need it. Covered by `packages/runtime/src/lib/lynx-element/lynx-element-move.test.ts`, whose fake flush loses the element the way Lynx does.

---

## Lynx for Web never fires `longpress`

### What you'd expect (parity with iOS and Android)

`(bindlongpress)` runs when a finger (or the mouse) stays down on the element, and the `tap` that would follow doesn't fire.

### What Lynx does

Native Lynx recognizes long presses itself. `@lynx-js/web-core` (0.26) has no recognizer: it listens for the DOM event of each Lynx event's name, maps `click` to `tap`, and the DOM has no `longpress`. So a long press in the web preview, and in the docs' previews, did nothing but fire `tap` when it ended. Its listeners are passive, so a handler can't stop the browser's own `contextmenu` either.

### The fix

On the web, an element that gets a `longpress` listener recognizes long presses from its own touch and mouse events (`WebLongPress` in `packages/runtime/src/lib/lynx-element/web-long-press.ts`): a press with the main button or a finger, held 500ms without moving more than 10px, runs its `longpress` listeners with the press's position in `detail`, as native Lynx does. The browser's `click` when the press ends, which web-core turns into `tap`, is dropped for any element, as native Lynx sends no tap after a long press.

---

## iOS glass takes only one corner radius, and can't animate it

### What you'd expect (parity with SwiftUI)

A glass shape with `border-top-left-radius: 38px; border-bottom-left-radius: 54px` has round top and rounder bottom corners, like an iOS 26 sheet, and its radius can change as it moves.

### What Lynx does

On the iOS 27 Simulator (Lynx Explorer 4.1), a `<blur-view blur-effect="glass">` with per-corner radii draws a square glass shape: the corners aren't rounded or clipped at all. Only `border-radius` with one value shapes the glass. And Lynx can't animate `border-radius` (see the whitelist above), so a glass shape keeps its corners while a transition moves or resizes it.

iOS 26's own sheets need both. Measured with a SwiftUI sheet (`presentationDetents([.medium, .large])`) on the same simulator, an iPhone 18 Pro (402×874pt, display corner radius 62pt):

- **At the medium detent** the sheet is the full-width sheet scaled by 0.96 (`UIDropShadowView`'s transform), which insets it 8pt from the sides and bottom. Its top corners are about 38pt and its bottom ones about 52pt, concentric with the display's. It's Liquid Glass, and `UIDimmingView` dims the screen with black at 20%.
- **At the large detent** it sits at the top of the safe area (62pt), full width and down to the bottom edge, with `systemBackground` behind its content, so it's opaque. Its top corners are still about 38pt. The grabber is 60×4pt at 6pt from the top, `rgb(197, 197, 199)` on white.

### What we do about it

The glass bottom sheet (`variant="glass"` on `ui-bottom-sheet`) draws the glass as one shape with one radius, concentric with the display's corners (62 − 8 = 54px), and never changes it. It animates the frame instead, which iOS's glass follows frame by frame: the inset shrinks from 8px to 0 as the sheet grows to full height, through the sheet's height and a CSS transition on `left`, `right`, `bottom` and `height`. An opaque `bg-background` layer above the glass (a plain view, so per-corner radii work there) fades in over the same progress. Once the sheet rests at full height, the layer's bottom corners square off; on an iPhone the display's rounder corners hide that change. Frames captured with the transitions slowed 8× show the glass widening into the screen's edges and clouding over to white, with no jump.

---

## iOS glass under an ancestor that becomes visible while it fades in draws nothing

### What you'd expect (web)

An element hidden with `visibility: hidden` appears as it was once its ancestor turns `visible`, whatever animation runs on the ancestor.

### What Lynx does

On the iOS 27 Simulator (Lynx Explorer 4.1), a glass `<blur-view>` whose ancestor goes from `visibility: hidden` to `visible` while an `element.animate()` fades that ancestor's opacity in draws nothing at all, even after the animation ends: its children show, the glass doesn't. Without the fade, or with the ancestor's opacity changed by style instead of animated, the glass appears. The bottom sheet hit it: it kept its backdrop `visibility: hidden` while it measured the screen, then made it visible as the backdrop's fade-in started.

### What we do about it

The bottom sheet hides itself without `visibility` while it waits for layout: the panel sits below the screen (`translateY(110%)`) and the backdrop's dim is transparent until the sheet is shown.

---

## On iOS, a glass `<blur-view>` added to the page after its first frame draws nothing

### What you'd expect (web)

An element an `@if` adds later renders like one that was there from the start.

### What Lynx does

On the iOS 27 Simulator (Lynx Explorer 4.1), a `<blur-view blur-effect="glass">` (raw, or `ui-glass`) that an `@if` adds to the page after the first frame draws nothing, its children included, though layout leaves room for it. One removed and added again does the same. A plain view, and a `blur-effect="light"` blur view, added the same way draw. Glass inside an `<overlay>` created later (a glass `ui-bottom-sheet` in an `@if`) draws, as does glass that was on the page from the first frame.

### What we do about it

It was found while building the glass sheet, whose glass is in an overlay. The cause is how iOS inserts a blur view before a sibling, which is how Angular adds an `@if` block's elements, and the renderer now appends it instead: see the next section.

---

## On iOS, a glass `<blur-view>` at the top of an `@if`, `@switch` or `@for` block draws nothing

### What you'd expect (web)

An element inside a control-flow block shows up where the block is, whatever its tag.

### What Lynx does

On the iOS 27 Simulator in Lynx Explorer 4.1, a glass `<blur-view>` (`ui-glass`, or a bare `blur-effect="glass"`) that's one of the top elements of an `@if`, `@switch` or `@for` block inside a plain `<view>` drew nothing: neither its material nor its children, though the layout kept its space. The same markup outside the block drew, as did a blur-view wrapped in a `<view>` inside the block, and one in a block inside another blur-view (a `glass-container`, as in the dock). Android and the web drew all of them, and a `light` blur view draws on iOS too (see the previous section). It happens on the first frame and on any later one.

What the failing ones share: Angular puts a block's top elements in with `__InsertElementBefore`, before the block's anchor (an invisible view), where everything else is appended. Lynx's iOS `LynxUI insertChild:atIndex:` then reorders the new child's view and layer against its neighbors' (`LynxUI.m`), which a plain view survives and a UIVisualEffectView, it seems, doesn't. `LynxUIBlurView` inserts its own children differently, into its `contentView`, which is why a blur-view inside another one draws. Two more data points, from the navigation bar's probes: a blur-view inserted the same way but given `glass` only in a later flush (created with no effect, or `light`) draws, and one that has drawn nothing doesn't recover when its effect is set again. Every glass control in a routed screen hit this, since their glass sits at the top of `@if` blocks.

### The fix

`LynxElement.insertBefore()` puts a `<blur-view>` into a parent that isn't one, on iOS, by appending it and then appending the siblings it should come before, in order (`insertHidesBlurView()` and `#appendBefore()` in `packages/runtime/src/lib/lynx-element/lynx-element.ts`). The native order is the same as an insert's, reached only by appends, in the same flush, so the siblings move as any Angular move does. Covered by `lynx-element-blur-insert.test.ts`. Found with the search field, whose `@switch` picks its glass on iOS 26 and its fill before.

---

---

## A `display: none` element still draws its content on iOS, from its corner

### What you'd expect (web)

An element with `display: none` draws nothing, and nor does anything in it.

### What Lynx does

Lynx sizes the element and everything in it to 0×0 (see "`display: none` resizes to 0×0" above), but on iOS (Lynx Explorer 4.1) what's in it still draws, spilling out of the 0×0 box from its top-left corner. A `<text>` draws its glyphs, and an `<svg>` (a `ui-icon`) draws too. Several hidden elements in one place all draw at the same corner, on top of each other.

- The tabs' hidden panels did this: their first letters overlapped the tab list.
- A searchable `ui-select` hid the items the search filtered out with Tailwind's `hidden` (`display: none`) on each item's host. On the iPhone 18 Pro Simulator (iOS 27), every hidden item's label and icon drew stacked at the top of the list, a smear of overlapping text above the first item still shown. The web preview drew nothing for them.

### The fix

Clip the hidden element: `overflow: hidden` while it's hidden draws nothing outside its 0×0.

- `ui-tabs-content` sets `overflow: hidden` on its host while it's hidden. The runtime does the same for HTML's `hidden` attribute, which gives an element `display: none; overflow: hidden` (measured on the iOS 27 Simulator, Lynx Explorer 4.1: a hidden `<p>` drew its first letter without the clip).
- `ui-select-item` and `ui-multi-select-item` take `hidden overflow-hidden` on their host while the search filters them out, and `accessibility-elements-hidden`, so a screen reader skips them. Checked on the iOS 27 Simulator: the filtered list is clean, and every icon is back once the search clears.

**Don't remove projected content with an `@if` instead.** The items first wrapped their whole template in `@if (shown())`. The filtered list was clean, but on the iOS 27 Simulator the items that came back showed their label without the icon the app projected into them, though the jsdom specs passed (issue #380; see "Projected content in a toggled `@if`" above). The label, from the item's own template, came back; the projected content didn't.

---

## Measuring a row of segments: `layoutchange` gives sizes you can rely on, not positions

### What you'd expect (web)

`getBoundingClientRect()` gives each item's position and size at any moment, so an indicator under a row of items can be placed from the item's left edge.

### What Lynx does

- **`layoutchange`'s position isn't the same on each platform**: from the page on iOS, from the parent on Android (see "`layoutchange` reports `top` and `left` from the page on iOS and from the parent on Android" below). And only an element whose layout changed reports again: when the whole row moves, say because content above it grew, an item whose own frame in its parent didn't change may not report, so a page-relative `left` goes stale. Its `width` stays right everywhere.
- **`boundingClientRect` is current, but asynchronous** (a UI method that answers in a callback, see above), so it can't place an indicator in the same frame as a tap.
- **Older Android puts the size in `params`**, iOS and the web in `detail`.

### What we do about it

The segmented control (`segmented-control.ts` in `@blotch/ui`) measures each segment's width from `layoutchange` on the segment's own flex item, which sits in a row with no gap, and adds the widths up for the left edges. Segments of different widths and a rotated or resized control both land right, as each segment reports its new width. Until every width has arrived, the indicator takes an equal share of the track (`width: 33.33%`, `left: n × 33.33%`), which is already right for equal segments, so the first frame needs no measuring. The first placement on measured widths has no transition, so the indicator doesn't slide in from the equal share.

A drag reads the pointer's `pageX`, which touch and mouse events both carry. A `touchmove` goes to the element the touch started on, so the segment that was pressed keeps receiving it as the finger crosses the others. On the web, `mousemove` goes to whichever segment is under the cursor, so every segment forwards it to the shared control. Only the distance from the press matters, never which element reports it.

---

## Lynx doesn't move a field the keyboard covers, and reports the keyboard differently on each platform

### What you'd expect (web)

A mobile browser scrolls a focused field into view above the keyboard, and `visualViewport` (or `env(keyboard-inset-height)`) says how much of the page the keyboard covers.

### What Lynx does

Measured in Lynx Explorer 4.1 (iOS 27 Simulator, Android 14 emulator), with an `<input>` at the bottom of the screen:

- **Nothing moves.** The keyboard covers the field on both platforms. Lynx Explorer neither resizes nor pans its Lynx view.
- **`avoid-keyboard="true"` on the `<input>`** (with `avoid-keyboard-spacing="8px"`; Android parses only a string with a unit there) moves the whole Lynx view up until the field clears the keyboard: iOS animates the root view's frame with the keyboard (`LynxKeyboardEventDispatcher.m`), so the top of the page goes off screen, as Android's `adjustPan` does. Fine for a form, wrong for a bar at the bottom, which should rise on its own while the content stays.
- **The input's own `keyboardheightchange` event** (`detail.height`) arrives on the main thread while it's focused: as the keyboard shows, when it changes size, and with 0 as it hides. iOS sends points measured up from the bottom of the **window**. Android sends **physical pixels** measured up from the bottom of the **Lynx view**: our bundles target SDK 3.2, which turns on the `keyboardCallbackPassRelativeHeight` page config (on from 2.2), so Android reports how far the keyboard reaches into the Lynx view, and re-reports it when the view's layout changes. Lynx Explorer's 312dp keyboard arrived as 819 at 2.625x.
- **The global `keyboardstatuschanged` event** (through `GlobalEventEmitter`, so on the background thread, relayed to Angular's main thread) carries `['on', 328]` on iOS and `['on', 312, 312]` on Android (both in points/dp), and `['off', 0]`. Both events came about 80–100 ms after `focus`; the first keyboard of a fresh simulator took 700 ms.
- **The iOS-only `keyboard` event** sends `safeAreaBottom` of the input's own view, which is 0, so it can't stand in for the window's inset.
- **`boundingClientRect` with `relativeTo: 'screen'`** is in window coordinates on iOS (`convertRect:toView:nil`), and relative to the window's root view on Android (`LynxUIHelper.convertRectFromUIToScreen`). Without `relativeTo`, both measure from the Lynx view.

So where the keyboard's top is depends on the platform: on iOS the screen's height less the keyboard's, and on Android the Lynx view's bottom less it. The iOS app `ng build --platform ios` makes insets its Lynx view above the home indicator, so the window's measure and the view's differ by 34pt there.

### What we do about it

The search field reads `keyboardheightchange` (`packages/ui/src/lib/components/search-field/keyboard.ts`): it measures its host and the page on screen, works out how far the keyboard reaches over it on each platform, and rises by that, plus an 8px gap, with a transform on an inner view, so the host it measures doesn't move. In the dock, the dock measures its own host, which stays at the bottom of the page, and pads itself above the keyboard. The forms guide's advice for other inputs stands: put long forms in a `<scroll-view>`.

---

## `layoutchange` reports `top` and `left` from the page on iOS and from the parent on Android

### What you'd expect (web)

A `ResizeObserver` entry has no position, and `getBoundingClientRect()` measures from the viewport.

### What Lynx does

In Lynx Explorer 4.1, a 42px bar at the bottom of the screen reported `{ top: 797, bottom: 839 }` with `layoutchange` on iOS, measured from the page, and `{ top: 0, bottom: 41.9 }` on Android, measured from its parent. `width` and `height` agree. Read only the size from `layoutchange` (as the dock does for its width), and measure a position with `boundingClientRect`.

---

Nothing yet: it was found while building the glass sheet, whose glass is in an overlay. A glass component on a page shown later (a routed screen, an `@if`) may be affected, and the cause, in Lynx's iOS blur view or in the renderer, isn't known.

---

## A popover that leaves the screen usable: a `position: fixed` panel and `global-bind` listeners, not an `<overlay>`

### What you'd expect (web)

A non-modal popover is an element above the page, and a `click` listener on `document` hears every click: one outside the popover closes it, and still reaches what it landed on, so one tap closes a popover and presses the button under the finger.

### What Lynx does

- **An `<overlay>` takes every touch** while it's shown (see the toast's entry above), so a popover in one blocks the screen, as the menus and the bottom action sheet do on purpose.
- **A listener on the page root hears only the touches that bubble up to it**, and a `catch` listener on the way stops them. (The runtime's `document` now hears every touch, through the `global-bind` listeners below: see "Lynx elements have no `ownerDocument`".)
- **`global-bind` listeners run for a touch on any element** (`global-bindtouchstart`), however it bubbles: Lynx queues them before the touched element's own capture and bubble listeners (`TouchEventHandler::HandleEventInternal` in `core/renderer/events/touch_event_handler.cc`), and web-core runs them in the same dispatch. On the iOS 27 Simulator in Lynx Explorer 4.1, the global listener ran first, then the touched element's.
- **`capture-bind` listeners didn't run on iOS.** A `capture-bindtouchstart` or `capture-bindtap` on a view or a blur view never ran there in Lynx Explorer 4.1, while a `bindtouchstart` on the same element did. Not traced further.

### What we do about it

`UiPopoverPanel` (`packages/ui/src/lib/components/popover/popover-panel.ts`), behind `ui-popover` and the anchored `ui-action-sheet`:

- The panel is a `position: fixed` view with `z-index: 999`. Lynx lifts it to the page root, above the page, and hit-tests it like any other view, so the rest of the screen keeps its touches. It's placed in page coordinates: two marker views of no size (the safe area's top edge, and an edge from the page's top to the safe area's bottom) are measured with `boundingClientRect` alongside the anchor, relative to the screen, and the safe area's offset in the page is added to the menu's `placeMenu()` frame.
- While it's shown, it has `global-bindtouchstart` and `global-bindmousedown` listeners (mouse for the web preview, where touch events come only from a touch screen). A touch on the panel, or on its trigger, sets a flag through ordinary `bindtouchstart` listeners; the global listener checks the flag on the next timer, which runs after every listener of that touch, and closes the panel if nothing set it. A `catchtouchstart` inside the panel would hide a touch from it, and close it.
- A touch, not a tap, closes it, so a scroll that starts outside closes it too, rather than moving its anchor away from under it.

---

## A touch's `x` is relative to the touched element on iOS and Android, but to the `<lynx-view>` on the web

### What you'd expect (parity between platforms)

A touch event's `touches[0].x` means the same thing everywhere, so a slider can read where on its track the finger is.

### What Lynx does

- **iOS and Android:** `x` and `y` are relative to the element the touch landed on, its `target` (`[touch locationInView:ui.view]` in `LynxTouchHandler.mm`, `convertToViewPoint(mActiveUI, …)` in `TouchEventDispatcher.java`). `pageX` is relative to the LynxView and `clientX` to the window. A tap's `detail.x` is the page position.
- **Lynx for Web:** web-core sets `x` to `clientX` minus the `<lynx-view>`'s left edge (`createCrossThreadEvent.js`), for touches and the mouse alike, whatever element was touched. `pageX` and `clientX` keep their web meaning: the document and the browser's viewport.

So no single field tells a control where on it the finger is on every platform.

### What we do about it

The slider (`packages/ui/src/lib/components/slider/slider.ts`) makes everything inside it ignore touches (`user-interaction-enabled="false"`), so the touched element is always the slider itself, and reads `x`: on iOS and Android that's already relative to the slider. On the web it measures its own left edge in the `<lynx-view>` when a press starts (`boundingClientRect`, which answers asynchronously) and subtracts it. In the docs' scaled previews the measurement is in screen pixels while events and `layoutchange` are in the app's, so it divides by the ratio of the measured width to the laid-out one, as the menu does. Moves that arrive before the measurement are held until it does. The switch only needs how far the finger moved, which is the same in either space.

---

## Lynx's iOS views don't implement `accessibilityIncrement`, so VoiceOver can't swipe an adjustable element

### What you'd expect (UIKit)

An element with the adjustable trait changes its value when a VoiceOver user swipes up or down: VoiceOver calls its `accessibilityIncrement` and `accessibilityDecrement`, as it does on a `UISlider`.

### What Lynx does

`accessibility-traits="adjustable"` sets `UIAccessibilityTraitAdjustable` (`LynxConverter+UI.m`), and VoiceOver announces the element as adjustable, but nothing in Lynx's iOS code implements `accessibilityIncrement` or `accessibilityDecrement` (searched `platform/darwin` on Lynx's develop branch, October 2026). The swipe calls UIView's empty defaults and nothing happens. Android ignores the trait: it reads only `none`, `image` and `button` (`LynxAccessibilityTraits`).

### What we do about it

The slider is adjustable, and it also offers `accessibility-actions` named Increase and Decrease. Lynx turns those into `UIAccessibilityCustomAction`s on iOS and custom accessibility actions on Android, and both fire `accessibilityaction` with the action's name, so VoiceOver users reach them through the Actions rotor and TalkBack users through its actions menu. `accessibility-role-description="slider"` names the role on Android. A fix in Lynx would send an `accessibilityaction` (or a new event) from `accessibilityIncrement` and `accessibilityDecrement` on adjustable elements.

---

## Lynx for Web's glass refracts only its nearest painted ancestor, cut to that ancestor's box

### What you'd expect (parity with iOS)

A glass shape bends whatever is on screen behind it, including content outside its parent's box when it overflows its parent.

### What Lynx does

The runtime's WebGL glass (`backdropOf` in `packages/runtime/src/lib/web-glass/glass-group.ts`) refracts an image of one ancestor: the nearest that paints an opaque background or an image. When that ancestor is smaller than the glass, the image ends at the ancestor's edge, and the glass beyond it samples the image's clamped edge rather than what's really behind. iOS's glass samples the screen, and Android's blur captures the page.

### What we do about it

Glass in a fixed element, such as a menu's `<overlay>` or a popover's panel, refracts the page instead (see "`<blur-view>` Liquid Glass has no web implementation in Lynx for Web" above), so a popover that hangs past the card it opened from shows the page below the card.

The switch's glass lens is bigger than its track (59 by 38pt over a 63 by 28pt track, as on iOS 26), so the track can't be the lens's parent and paint the background: the switch draws the track with a view of its own, before the lens, and the lens's backdrop is the card or page around the switch. Clear glass over white is faint in the web drawing either way: the lens shows mostly as the bend it puts in the track.

---

## A drag handled in template event handlers keeps up with the finger

### What you'd expect (React Lynx's guidance)

React Lynx runs component code on the background thread, so a drag handled there reaches the screen a thread hop later, and its docs recommend main-thread scripts for touch-driven UI.

### What Lynx does

AngularLynx runs Angular on the main thread (see `lynx-architecture`), so template handlers like `(bindtouchmove)` already run beside the native touch handling. Measured with a probe around `ui-slider` in Lynx Explorer 4.1 (a `(bindtouchmove)` on its parent that compares the event's `timestamp` with `Date.now()`, and an `afterRenderEffect` on the value), dragging with Maestro over 2 seconds:

|                     | touchmove interval     | event to handler                  | handler to render                  |
| ------------------- | ---------------------- | --------------------------------- | ---------------------------------- |
| iOS 27 Simulator    | 16.7 to 17.2ms average | 0.6ms average, 2ms at most        | 3ms average, 7ms at most           |
| Android 14 emulator | 17.1 to 20ms average   | 1.1 to 1.7ms average, 7ms at most | 3.5 to 4.8ms average, 19ms at most |

Runs while the host machine was overloaded (a load average near 40 on 18 cores) dropped to a move every 35 to 125ms on the emulator, with renders up to 270ms behind; those are the emulator starving, not the handlers.

### What we do about it

Nothing: the slider and the switch set a signal in their handlers and let change detection apply the styles, under a frame from the native event to the render. A main-thread script would save no thread hop, and the change detection it would skip costs about 3ms for these controls.

---

## On iOS, a scroll view scrolls alongside a drag that Lynx's touch events are following

### What you'd expect (UIKit)

A control dragged sideways inside a vertical scroll view keeps the drag to itself: `UISlider` and `UISwitch` stop the scroll view's pan from starting while they track a touch.

### What Lynx does

Lynx delivers touch events from its own gesture recognizer on the LynxView, and a `<scroll-view>`'s `UIScrollView` pan recognizes alongside it. A drag on a slider that drifted 40pt down over a 226pt swipe moved the slider all the way and scrolled the page 66 times (Lynx Explorer 4.1, iOS 27 Simulator). On the Android 14 emulator the same drag didn't scroll: Lynx's scroll view only takes over when the movement is mostly vertical.

### The fix

`consume-slide-event` takes swipe angle ranges, in degrees from the right (`atan2(dy, dx)`), and Lynx fails the platform's pan gestures for a swipe inside them (`dispatchPanEvent:` in `LynxEventHandler.m`). The slider and the switch set `[[-45, 45], [135, 180], [-180, -135]]`, within 45 degrees of sideways: the diagonal drag above no longer scrolled the page, and a swipe up that starts on the slider still scrolls it, on iOS and Android. It matches the controls' own rule for starting a drag, more sideways than up or down.

---

## There's no `backdrop-filter`, and `backdrop-blur-*` generates nothing

### What you'd expect (web)

`backdrop-filter: blur(4px)`, or Tailwind's `backdrop-blur-sm`, blurs whatever is behind the element: the classic frosted backdrop behind a dialog.

### What Lynx does

Lynx's CSS has no `backdrop-filter` (it isn't in `core/renderer/css`; only the desktop Clay renderer has a backdrop filter layer). On the iOS 27 Simulator and the Android 14 emulator, a view with an inline `backdrop-filter: blur(12px)` over text left the text sharp. The class doesn't get that far: the Lynx Tailwind 3 preset leaves the backdrop utilities out (its "Unsupported" table), so `examples/ui-dialog`'s bundle had no rule for the `backdrop-blur-sm` its dialog used, and with Tailwind 4 the build plugin drops properties Lynx lacks (`dropUnsupportedProperties` in `tailwind-v4/declarations.ts`), so the web preview doesn't blur either. The dialog's comment called the blur "web-only"; it blurred nowhere.

### The fix

Blur with a `<blur-view>`, which is what Lynx has for it on every platform. The dialog's no-op class is gone. The alert dialog's glass variant dims the screen with a plain layer, as iOS and Material do behind an alert.

---

## Fading a `<blur-view>` itself hides its material on iOS; fading a parent fades it

### What you'd expect (web)

`opacity` on an element fades it and everything it draws, a backdrop blur included.

### What Lynx does

On the iOS 27 Simulator, an `animate()` of a glass `<blur-view>`'s own opacity made its Liquid Glass disappear at once: its text and buttons stayed, on nothing. (UIKit warns that a `UIVisualEffectView` asked to animate its opacity looks broken until it's back at 1.) The same animation on a plain `<view>` around the blur view works: iOS draws the glass as a translucent frosted sheet that fades with it, then as glass once it's opaque. That's what UIKit draws for its own alerts as they come and go (frames of a `UIAlertController` with the window's layer slowed 20×).

### What we do about it

Fade and scale a plain view around a blur view, never the blur view. The alert dialog's glass variant animates the view its panel sits in, and keeps its dimming layer beside that view rather than around it. The menus avoid the question by growing their glass instead of fading it. A blur view that stays faded (a disabled control) is still a washed-out patch, so components dim the content inside the glass for that (see the `ui-component` skill).

---

## On Android, a shadow inside an animated flattened view draws at twice the view's offset

### What you'd expect (web)

`box-shadow` draws around its element wherever the element is, whatever its parent's transform or opacity.

### What Lynx does

On the Android 14 emulator (Lynx Explorer 4.1), the alert dialog's Material panel, a `<blur-view>` with `ui-glass`'s elevation shadow, sat in a plain view that `animate()` scaled and faded (`fill: 'forwards'`). The panel drew in place, but its shadow drew a second time with its top-left corner at twice the plain view's offset in the overlay (80dp, 712dp for a view at 40dp, 356dp), a big rounded outline running off the bottom-right of the screen. Lynx had flattened the plain view into its parent, which it does for a view with nothing of its own to draw. Each of these took the stray shadow away: no `box-shadow` on the panel, no animation on the plain view, or `flatten="false"` on it. iOS and the web drew the shadow once, in place.

### The fix

Give an animated view that holds a shadowed element a native view of its own with `[flatten]="false"`, as the alert dialog's shell does. The gesture detector already does the same for views it listens on (see the gesture entries above).

---

## Fading content under a bar: masks work on `<scroll-view>`, gradient stops must be percentages, and the web's scroll view reports no layout

### What you'd expect (web)

`mask-image: linear-gradient(to bottom, transparent 0, black 100px)` on a scrolling element fades its top 100px, whatever it scrolls, and a `ResizeObserver` (or Lynx's `layoutchange`) says how tall it is.

### What Lynx does

Checked for the navigation bar's scroll edge effect, in Lynx Explorer 4.1 on the iOS 27 Simulator and an Android 14 emulator, and in Lynx for Web (Chromium), with a probe of each way to soften content under a bar:

- **`mask-image` on a `<scroll-view>` works on iOS and the web, not on Android**, which draws the scroll view unmasked (Lynx's docs say the property applies to `view` only). On iOS the mask stays put while the content scrolls: it doesn't move with the UIScrollView's bounds. On a plain view, and on a wrapper view around the scroll view, it works on all three.
- **Gradient stops are percentages only on native Lynx**, as for backgrounds, so stops a fixed distance from an edge come from the element's measured height. The browser reads `px` and `calc(100% - 50px)` stops as usual.
- **`<x-scroll-view>` sends no `layoutchange` on Lynx for Web**: web-elements' `ScrollView` doesn't set `layoutChangeTarget`, as `XView` does (the same gap as `<blur-view>`, above). A plain view inside it still reports its size.
- **A gradient overlay** in the page's background color fades content too, but only to that color, not to an image behind. `rgba(var(--background-rgb), 0.5)` stops work in it on all three.
- **A `<blur-view>` with a gradient `mask-image`** blurs progressively, more toward the edge, on iOS and the web; Android ignores the mask and blurs a hard-edged band. Three stacked blur-views of rising radius band visibly instead.

### What we do about it

`ui-bar-scroll` puts the mask on its own scroll view: under glass bars, content fades out over the bar's space, to whatever is behind it. Its stops come from its spacers' `layoutchange` heights, which count the safe area, and on iOS from the scroll view's own height, as percentages; on the web, where there's no height to read, from each end as lengths. On Android, with the glass opt-in, the bars draw the same fade themselves as a gradient in the theme's background color (`edgeFadeOverlay()`), so content fades to that color there. The masked blur isn't used: the blur-view's material would tint the strip, Android ignores its mask, and on Android every blur-view redraws the page each frame.

---

## An attribute removed and then set again before Lynx flushes stays removed

### What you'd expect (web)

`removeAttribute('x')` followed by `setAttribute('x', 'a')` leaves the element with `x="a"`, whatever happens between them.

### What Lynx does

Lynx core queues a removal apart from the values set in the same flush, and applies it after them. `Element::SetAttribute` puts a key whose value is empty (null or undefined) in `reset_attr_vec_`, and one with a value in `updated_attr_map_`, without taking the key out of the other. At the flush, `FiberElement::ConsumeAllAttributes` sets everything in `updated_attr_map_` first, then resets everything in `reset_attr_vec_`. So an attribute set to null and then to a value before the flush reaches native as a reset, and the value is lost (the other order, a value and then null, comes out right).

Found on the iOS 27 Simulator with the shell's `glass-effect-id`: a glass button that a sheet pairs with its own glass (`uiSheetSource`) got the id from an effect that ran after the button's first, in the same first render, which had set the attribute to null. The native prop setter saw only the reset, so the button and the sheet never paired. Sending `''` instead of null for the first run made the id arrive.

### The fix

`LynxElement.setAttribute()` holds a removal back until the flush: it records the name, and `LynxRendererFactory2.end()` (and the settle flush) sends the removals that are left with `processPendingAttributeRemovals()`, after element removals and before `__FlushElementTree()`. A value set for the attribute before then takes the removal back, so it reaches Lynx as a plain update.

---

## `for await` over a sync iterable doesn't await its values on the main thread

### What you'd expect (web)

`for await (const value of [Promise.resolve(2)]) { … }` awaits each value of a sync iterable, as the spec's async-from-sync iterator does, so `value` is `2`.

### What Lynx does

On the main thread (iOS and Android, Lynx 4.1), `value` is the promise itself. The build leaves `for await` as it is there, since it's part of the main thread's ES2019 target, so this is PrimJS's own behavior. On the background thread, whose ES2015 target compiles `for await` into helpers that await each value, the same loop gives `2`. Async iterables, such as async generators, work on both threads.

Found when the device check of the polyfills above showed `Array.fromAsync([1, Promise.resolve(2)])` resolving to `[1, <promise>]` on the main thread only.

### The fix

Await each value yourself: `for (const promise of promises) { const value = await promise; … }`, or `await Promise.all(promises)`. The polyfilled `Array.fromAsync` (`es-builtins.js`) does the former for sync iterables, and `for...of` still closes the iterator when a value rejects, as the spec does.

---

## `<svg content>` without `xmlns` draws nothing in the web preview

### What you'd expect (web)

An `<svg>` written in an HTML page needs no `xmlns`: the HTML parser puts it in the SVG namespace. So SVG copied for a page often leaves it out, like the GitHub mark in issue #199 (`<svg viewBox="0 0 16 16"><path …/></svg>`).

### What Lynx does

Lynx for Web's `<x-svg>` turns `content` into an `image/svg+xml` blob and shows it in an `<img>`, and a browser parses an SVG image as XML: without `xmlns="http://www.w3.org/2000/svg"`, the root isn't an SVG element, the image fails to load, and the element is blank. Checked in Chromium and WebKit (Playwright): the same blob loads with `xmlns` and fires `error` without it.

### The fix

Write `xmlns` on the root `<svg>`. `<ui-icon [svg]>` adds it when the markup has none, so an app's own marks show in the web preview as they do on the phone.

---

## `<list>`'s `bindlayoutcomplete` doesn't send what Lynx's docs say

### What you'd expect

Lynx's `<list>` page (lynxjs.org, API → Elements → list) declares the event's detail as `{ 'layout-id'; scrollInfo; diffResult?; visibleCellsAfterUpdate?; visibleCellsBeforeUpdate? }`, with `scrollInfo` always there.

### What Lynx does

The engine (`core/list/decoupled_list_event_manager.cc`, `SendLayoutCompleteEvent`) adds `scrollInfo` only when the list has `need-layout-complete-info`, like the rest of the optional fields, so without it a handler reading `detail.scrollInfo.scrollTop` throws. The item arrays are `visibleItemBeforeUpdate` and `visibleItemAfterUpdate`: `@lynx-js/types` renamed them from `visibleCells…` (its CHANGELOG), and the engine sends the new names, but the docs page still shows the old ones.

### The fix

`ListLayoutCompleteDetail` (`packages/runtime/src/lib/types/element-events.ts`) types `scrollInfo` as optional and uses the `visibleItem…` names, so a handler has to check for `scrollInfo`.

---

## `<video>`'s `bindtimeupdate` and `binderror` have an empty `detail` in the web preview

### What you'd expect (web)

A video's `timeupdate` handler reads the position from the element (`video.currentTime`), and `error` reads `video.error`. Lynx moves both into the event: `bindtimeupdate` sends `{ current, duration }` and `binderror` sends `{ errorCode, errorMsg }`.

### What Lynx does

Lynx for Web has no Lynx video element (there's no `x-video` in `@lynx-js/web-elements`): `<video>` is the browser's HTMLVideoElement. `@lynx-js/web-core` passes its events through with `detail: domEvent.detail ?? {}` (`createCrossThreadEvent`), and a media event has no `detail`, so both arrived as `{}`. The `element-video` example's `{{ current().toFixed(1) }}` threw `Cannot read properties of undefined (reading 'toFixed')` once play was pressed.

### The fix

On web, `LynxElement` fills in the two details from the HTMLVideoElement before running the listeners (`packages/runtime/src/lib/lynx-element/web-video.ts`): `currentTime` and `duration` (0 until the metadata loads, where the browser has `NaN`), and `MediaError`'s `code` and `message`. `binderror` is typed `LynxEvent<VideoErrorDetail>`, with no `| undefined`. The web preview still has only what Lynx lists for it: `bindfirstframe`, `bindpaused` and `bindstopped` don't fire there, and `stop`/`seek` aren't methods of an HTMLVideoElement.

---

## The main thread has no `IntersectionObserver`: AngularLynx's comes from exposure, and measures for itself to honor `root`, `rootMargin` and `threshold`

### What you'd expect (web)

`new IntersectionObserver(callback, { root, rootMargin, threshold }).observe(element)` reports the element once when observing starts, in view or not, then each time the share of it inside the root (the viewport, grown by `rootMargin`) crosses a threshold. It's purely geometric: a transparent element in the viewport is intersecting.

### What Lynx does

The main thread, where Angular runs, has no `IntersectionObserver`, so browser code that creates one throws `ReferenceError` (issue #226: a 3D frame built on angular-three, which stops drawing while scrolled out of view). Lynx's own `lynx.createIntersectionObserver()` is a background-thread API that finds elements by selector, so it can't take `ElementRef.nativeElement`.

What the main thread does have is exposure: an element listening for `uiappear` or `uidisappear` gets one when it comes into view and one when it leaves. Native checks about 20 times a second (`LynxUIExposure.m`, `UIExposure.java`). It checks against every scroll container around the element (the UIs whose `isScrollContainer` is true: `scroll-view`, `list`, `viewpager`, `scroll-coordinator`), the LynxView and the screen. An element with no size, or one hidden or with opacity below 0.01, isn't visible. An element that starts out of view gets no event at all. `exposure-area` takes one ratio per element, not a list of thresholds per observer, and the events carry no boxes.

Exposure's attributes can't stand in for an observer's options (issue #236). `exposure-area` and `exposure-screen-margin-*` belong to the element, so two observers of one element can't each have their own, and setting them changes when the element's own `(binduiappear)` and `[lynxExposure]` handlers run. There's one `exposure-area`, where `threshold` can be a list. The screen margins move the screen's edges, not a scroll container's, and nothing stands for `root`.

Lynx also has an `intersection-observers` element attribute: an array of `{ thresholds, relativeToIdSelector, relativeToScreen, marginTop, … }`, each a native observer checked 20 times a second, which sends the element an `intersection` event as it crosses a threshold. It doesn't fit either:

- **On iOS it never sets the root.** `LynxUIIntersectionObserver initWithOptions:` looks the root up only `if (!relativeToIdSelector && [relativeToIdSelector hasPrefix:@"#"])`, which is never true, so every attribute observer is relative to the LynxView.
- **On Android it does nothing unless the element already listens for `intersection`** when the attribute is set (`LynxBaseUI.setIntersectionObservers` checks `mEvents.containsKey("intersection")`).
- **Its margins are lengths only** (`LynxUnitUtils toPtFromUnitValue:`), with no percentages.
- **Every observer in the array sends the same event**, whose `observerId` is the target's id selector, so the events don't say which observer crossed.

Scroll events also come at different rates: a `<list>` sends `scroll` every 200 ms unless `scroll-event-throttle` says otherwise (engine version 3.4 and up), a `<viewpager>` sends `offsetchange` and a `<scroll-coordinator>` sends `offset`.

### The fix

The runtime installs `IntersectionObserver` on the main thread (`packages/runtime/src/lib/lynx-element/intersection-observer.ts`). The web preview keeps the browser's own, wrapped to take Lynx elements (as a target and as the root).

An observer with the browser's defaults (no root, no root margin, a threshold of 0) asks only what exposure answers. It listens for the two events and, when one comes, measures the element, the page and the scroll containers around it with the `boundingClientRect` UI method, to fill in `boundingClientRect`, `intersectionRect`, `intersectionRatio` and `rootBounds`. For the first entry, it measures the same boxes once the element has been laid out and works out from them whether the element is in view, unless an exposure event has come by then.

An observer given a `root`, a `rootMargin` or a `threshold` works the crossings out from the boxes, as a browser does. It measures the element, its root (the page, for no root) and the scroll containers between them: once the element has been laid out, at each later layout, at each exposure event, and every 50 ms while one of those scroll containers (or the root, if it scrolls) is scrolling. It keeps sampling for 300 ms after the last scroll event, longer than a list's 200 ms between events, so it follows a list's scroll and catches where it stops. One timer drives every observer, so observers measuring together ask once for the page's and each shared scroll container's box. The rules are Chromium's and WebKit's (`intersection_geometry.cc`, `IntersectionObserver.cpp`):

- An entry is reported when the threshold index changes: how many thresholds the ratio has reached, or 0 when the element doesn't intersect. So `isIntersecting` is `true` only once a threshold is reached, and with `threshold: 1` a half-visible element isn't intersecting.
- Boxes that only touch intersect, so an element with no size inside the root, such as a sentinel at the end of a feed, is intersecting, with a ratio of 1.
- `rootMargin` grows the root's box: percentages are of its height for the top and bottom, and its width for the sides. `rootBounds` includes it. It doesn't grow the scroll containers between the element and the root, which still clip it.
- An element that isn't inside the root, or is the root, isn't intersecting.

What's still different on a device:

- An entry's boxes are measured after Lynx notices the change. For an observer without options, that's up to a twentieth of a second after it happened, so an element scrolling into view reports a small `intersectionRatio`. For one with options, it's up to 50 ms after a scroll event. An element moved by an animation, with no scroll or layout, is measured again only when exposure says it came or went.
- For an observer without options, exposure's visibility rules apply after the first entry, so a fully transparent element is reported out of view. An observer with options goes by the boxes, as browsers do.
- Only the scroll containers between the element and the root clip it, not every ancestor with `overflow: hidden`.
- In the testing library, where elements have no layout, an observer with options takes `uiappear` as all of the element coming into view (a ratio of 1) and `uidisappear` as all of it leaving.

Checked on the iOS Simulator and the Android emulator (Lynx Explorer 4.1), and in the web preview, with a scroll-view of 300px cards. The first entries were right: the card cut off by the scroll-view's bottom reported 0.92 on all three, and the cards below it reported out of view. Cards scrolling in and out were reported as they crossed the edge, and so was a card that observed from `afterNextRender()`.

Angular runs `afterNextRender()` callbacks after the renderer's `end()` has flushed, and an event handler reaches native only with a flush. So an observer started there, with nothing else changing afterwards, would never hear its element's events. `LynxElement` now schedules the settle flush whenever it adds or removes a native handler outside change detection. The device check doesn't show this case on its own: native flushes after the first render anyway, and the other cards' updates flushed too. (A flush wasn't enough for an element already on screen: see the next section.)

The options (issue #236) were checked on the iOS 27 Simulator and the Android API 34 emulator (Lynx Explorer 4.1), with six 200px cards in a 400px scroll-view, scrolled by `scrollTo` with `smooth: true`. Each card's observer had `threshold: [0, 0.5, 1]`. A zero-height sentinel at the end of the scroll-view had two observers with a `400px` bottom margin, one rooted at the scroll-view and one with no root. Each card also had an observer with `rootMargin: '-50% 0px'`.

- The first entries matched the browser's rules. The two cards in view reported 1, and the card touching the scroll-view's bottom edge reported intersecting with a ratio of 0. The sentinel's `rootBounds` were the scroll-view's box grown by 400px (380..1180), and the page's (0..1274 on iOS, 0..1290 on Android).
- While the cards scrolled, the entries came at each crossing (0.09, 0.60, 1.00 as a card came in).
- The observer rooted at the scroll-view reported the sentinel at a scroll of 500. The one with no root reported it only at 800, where it touched the scroll-view's bottom: the scroll-view clips it, as in a browser.
- The center line followed the card under the middle of the screen.
- A plain observer created a second after the cards were on screen saw its card come in and leave.

`boundingClientRect` answered before `__InvokeUIMethod` returned, on both platforms, and the microtasks queued before the call ran before it returned too: the callback is a native→JS call, and Lynx runs every pending microtask as one ends (see `lynx-render-lifecycle.ts`). A probe that queued a microtask, then called the method, logged `before answer qm promise after`. The first version of the observer cleared a map of measurements in a microtask, and so found it gone halfway through adding to it.

---

## A handler added to an element already on screen never reached it

### What you'd expect (web)

`element.addEventListener('scroll', …)` works whenever it's called: before the element is shown or long after.

### What Lynx does

`__AddEvent` stores the handler on the element and marks its events dirty. At the next flush, `FiberElement` puts the handlers in the element's prop bundle (`ElementManager::ResolveEvents`), but sends the bundle to an existing UI only if something it counts as a change happened: attributes, styles, dataset or gestures set `need_update`, and events don't (`fiber_element.cc`, then `PerformElementContainerCreateOrUpdate`). A UI being made gets everything. So a handler added to an element whose UI was already made, with nothing else about the element changing, never reached iOS or Android, even after `__FlushElementTree()`.

Checked on the iOS 27 Simulator and the Android API 34 emulator with a scroll-view and a `bindscroll` listener added through `addEventListener`. Added in `afterNextRender()`, before native first made the UI, it heard every scroll. Added from a `setTimeout` a second later, it heard none. It heard none either when followed by `__FlushElementTree()`, or by a signal change that ran change detection.

That's any listener added after an element first shows. An `IntersectionObserver` or `ResizeObserver` observing an element already on screen, from a tap or a timer, heard nothing. So did a scroll listener on a scroll-view already on screen.

### The fix

`LynxElement.#syncNativeHandler` sets the element's dataset to what it already is (`__SetDataset` with `LynxElement`'s own copy) whenever it registers or removes a native handler. That counts as a change, so the next flush sends the handlers along. The web preview's elements are DOM elements, whose listeners work at once, so it skips this.

Checked on both: an `IntersectionObserver` created a second after its card was laid out reported the card coming into view and leaving.

---

## On iOS, a scroll-view or list sends `scroll` only to the handlers it had when its UI was made

### What you'd expect (web)

A scroll listener added at any time hears the scrolls after it.

### What Lynx does

iOS's scroll-view (`LynxUIScroller`) and list (`LynxUIListScroll`) make their `LynxScrollEventManager` in the first `eventDidSet`, as the UI is made, and hand it the event set of that moment. `setRawEvents:andLepusRawEvents:` makes a new set each time and calls `eventDidSet` again, but the manager keeps the first. `sendScrollEvent:` asks the manager whether `scroll`, `scrolltoupper` or `scrolltolower` is bound, so a handler added later is never called, even once the handlers reach the UI (see the previous section). Android's `UIScrollView.setEvents` and `UIListContainer.setEvents` read the new set each time. iOS sends `scroll` on each frame of a scroll, with no throttle.

### The fix

`LynxDocument.createElement` gives each scroll-view and list a `bindscroll` listener that does nothing, on iOS only (`listenForScrollsFromTheStart`), so the UI is made with a `scroll` handler. Listeners added later share it. An `IntersectionObserver` with options adds its listener once it has measured its element, after the scroll-view's UI has been made.

The cost is a scroll event to the main thread for each `scrollViewDidScroll:` of every scroll-view on iOS, which the do-nothing listener drops.

Until #261, that listener also kept every screen with a scroll-view alive after it was left: Angular never removes it, the release of a destroyed view passed `undefined` to take it off, and native Lynx keeps a worklet handler that `undefined` would remove (see "`__AddEvent(element, type, name, undefined)` doesn't remove a main-thread handler on native Lynx").

---

## An element's listener replaced a main-thread directive's handler for the same event

### What you'd expect (web)

Any number of listeners for an event on one element all run.

### What Lynx does

Lynx keeps one main-thread handler per event name on an element (`AttributeHolder::SetWorkletEvent` assigns into `lepus_events_` by name, whatever the bind/catch type). `LynxElement` registers its listeners as one such handler, and so does `LynxMainThreadEvent` (`[mainThreadBindscroll]` and the rest), each with `__AddEvent`, so whichever registers last wins. The directive registers in `ngOnChanges`, after the template's own listeners, so it always won. But a listener added later, such as an `IntersectionObserver` with options listening for its scroll-view's scroll events, replaced the app's main-thread scroll handler.

### The fix

The directive holds the event on its element while it has a handler for it (`LynxElement.holdNativeEvent`, counted for `bind` and `catch`). Meanwhile, the element registers none of its own for that event, and hands it back once the directive's handler has gone (`releaseNativeEvent`), registering its own for the listeners it has. The element's listeners for a held event don't hear it, as they didn't before when the directive registered after them.

Checked on the iOS 27 Simulator and the Android API 34 emulator with a `[mainThreadBindscroll]` on a scroll-view whose cards had observers with thresholds. The main-thread handler kept running through every scroll. The observers there reported only what layout and exposure told them.

---

## Lynx elements have no `ownerDocument`, so `document:` and `window:` listeners threw

### What you'd expect (web)

A component's `host: { '(document:pointermove)': … }`, `'(window:resize)'` or `'(body:click)'` (or the same `@HostListener`) listens on the element's document, window or body. Angular finds them from the host element: `ɵɵresolveDocument` returns `element.ownerDocument`, `ɵɵresolveWindow` its `defaultView` and `ɵɵresolveBody` its `body`. The document and the window hear every event that bubbles up to them, after the elements it went through; `window.innerWidth` is the viewport's width.

### What Lynx does

- **There's no document.** A Lynx element has no `ownerDocument`, so the resolvers returned `undefined` and the renderer's `listen()` threw `TypeError: not a function` as the component was created. angular-three draws nothing of a scene with such a listener in it.
- **The way to hear every touch is a `global-bind` listener** (`TouchEventHandler::HandleEventInternal` runs every element's for an event, before the touched element's own listeners), which hears even a touch a `catch` listener stopped. A browser runs a document's bubbling listeners last, and not at all for an event an element stopped.
- **The page element gets a `resize` event** when the LynxView changes size, as when the device rotates, and after the first layout: `LayoutContext::OnLayoutAfter` compares the root's size with the last, which starts at zero, and `LayoutMediator::OnCalculatedViewportChanged` sends the new one. Its `detail` is `['onWindowResize', [width, height]]` in CSS pixels, on the iOS 27 Simulator and the Android API 34 emulator alike. In Lynx Explorer on Android, rotating recreates the page, so a page there never sees a rotation's resize.
- **`innerWidth` didn't exist.** `window` was `globalThis`, which has no size.
- **In the web preview, `window` was `undefined` in app code.** The main thread's code runs inside web-core's wrapper, `(function(){ "use strict"; const navigator=void 0,postMessage=void 0; let window=void 0; <bundle> })` (`MTS_CODE_WRAPPER_PREFIX`, `decodeWorker/decode.worker.js`), in a hidden iframe web-core puts in the `<lynx-view>`'s shadow root (`createIFrameRealm`). `globalThis.window` is that iframe's read-only getter, so the polyfill's `globalThis.window = globalThis` threw and the `let` stayed `undefined`; and the iframe's own size is zero.

### The fix

`packages/runtime/src/lib/global-events/`:

- **A `document` stand-in** (`LynxGlobalDocument`) is every LynxElement's `ownerDocument`, `DOCUMENT`'s value, and on iOS and Android the `document` global. Its `defaultView` is `globalThis`, whose `addEventListener`, `removeEventListener` and `dispatchEvent` become a real listener registry on the main thread (in a browser realm, the web preview's iframe or jsdom, only for the screen's events). Its `body` is the page element. `renderer.listen()` also takes `'window'`, `'document'` and `'body'`, as Angular's DOM renderer does, and any EventTarget. `Event` and `CustomEvent` are installed where they're missing.
- **Touches come from `global-bind` listeners on the page** (`native-source.ts`), turned into the pointer events a browser fires (`pointerover`, `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerout`), then the touch event itself; a `tap` reaches `click` listeners. The pointer events' target is the touched element's wrapper, found by its unique id.
- **A dispatch runs in two halves**, so the order is a browser's: the capturing listeners when the `global-bind` listener hears the event, and the others when the event reaches a `bind` listener on the page, which runs after the page's own listeners (`LynxElement.addTrailingEventListener`). A touch a `catch` listener stopped never reaches the page, so its second half runs on the next timer, or before the next touch begins, whichever comes first.
- **`window.innerWidth` and `innerHeight`** are the last `resize` size, and `SystemInfo`'s screen size until then. The first layout's `resize` fires `resize` only if it changed what they said: on Android, where the LynxView is shorter than the screen, it does.
- **On the web** (`web-source.ts`), the `<lynx-view>` is the screen: `frameElement` leads from the main thread's iframe to its shadow root, where a capturing and a bubbling listener hear the browser's own events, and to the `<lynx-view>`, whose size is `innerWidth` and `innerHeight` and whose ResizeObserver fires `resize`. Key events are heard on the page's document, as web-core hears them. `polyfills.ts` assigns `window = globalThis` when the first assignment throws, which sets the wrapper's `let`.
- **In tests**, the testing library's `fireEvent` runs every `global-bind` handler first, as Lynx does, and gives the event Lynx's `target` (`{ uid }`), so `document:` listeners run under `render()` too.

---

## A touch's `identifier` changes between its events when multi-touch is off

### What you'd expect (web)

`Touch.identifier` (and a pointer event's `pointerId`) stays the same from a finger's `touchstart` to its `touchend`, so code follows a drag by it.

### What Lynx does

With multi-touch on, Lynx numbers each finger from 0 and keeps its number until it lifts (`touches_map_` and `reuse_id_pool_` in iOS's `LynxTouchHandler.mm`, `MotionEvent.getPointerId()` on Android). With it off, which is a LynxView's default, there's one touch at a time, and its `identifier` is the address of the dictionary the touch is built in: `reinterpret_cast<int64_t>(&touch)` in `TouchEventHandler::GetTouchEventParam` (`core/renderer/events/touch_event_handler.cc`). On the iOS 27 Simulator, a drag's `touchmove`s had one identifier and its `touchend` another. The element pointer events made from touches (`pointer-events.ts`) followed a finger by its identifier, so on iOS a drag's `pointermove`s and `pointerup` never fired, and each new touch was a second, non-primary pointer.

### The fix

`pointerIdOf()` (`packages/runtime/src/lib/lynx-element/pointer-events.ts`) gives a touch whose identifier is above `0xffff` (an address, never a finger's number) the pointerId `0`, the number multi-touch gives the first finger. Elements and the document use it alike, so a finger has the same `pointerId` at both.

---

## `[style.--x]` bindings don't reach `var()` in the web preview

### What you'd expect (web)

A custom property set inline on an element (`style="--stone: #d9103f"`, or `el.style.setProperty('--stone', …)`) is read by every `var(--stone)` below it, and re-resolved when it changes.

### What Lynx does

On iOS and Android, `__SetInlineStyles` keeps a `--x` declaration and the descendants' `var(--x)` follow it, which is how `[style.--x]` works there. Lynx for Web doesn't (measured 2026-11-05 in the showcase example's preview, web-core bundled with Lynx 4.4): its inline-style parser (`set_inline_styles_in_str`, in web-core's WASM) writes the declaration without its dashes, so the DOM holds `stone: #d9103f`, which nothing reads. Its `__AddInlineStyle` with a raw string key keeps the dashes but namespaces the name (`--\%NS\%stone`), which a stylesheet's `var(--stone)` doesn't match either. So in the web preview a `[style.--x]` binding changes nothing visible: a `.plate { background-color: var(--stone) }` rule kept the stylesheet's default while the binding changed under it.

- **Bind the value where it's used** when the web preview must follow it: `[style.background-color]="color()"`, a chart's `[color]`, glass's `[tint]`. A class that switches, such as `[class.dark]`, does re-resolve, because its variables live in a stylesheet rule.
- The runtime can't put this right from outside: an element has one inline style, written through web-core's parser. Tried for the showcase and reverted: setting each variable again with `__AddInlineStyle` after the whole style (that's where the namespaced name came from).

---

## Hex colors that read as an exponent compile wrong

### What you'd expect (web)

`rgba(92, 94, 102, 1)` and `#5c5e66` are the same color, whichever a tool prefers.

### What Lynx does

The build minifies `rgba(92, 94, 102, 1)` to `#5c5e66` (lightningcss, correct), and the compiled stylesheet in the web preview then holds `--muted-foreground: #5c9999` (measured 2026-11-05 through `document.styleSheets` in the showcase example's preview). `rgba(62, 64, 72, 1)`, `#3e4048`, went the same way. Both hexes contain a digit, an `e` and digits (`5e66`, `3e4048`), which a CSS re-tokenizer between lightningcss and the page reads as a number in scientific notation. Neighbouring hexes without such a run (`#71717a`, `#a6a49c`, `#3f3f46`) come through whole. Not yet checked on iOS and Android, whose bundle encodes CSS differently.

- Until it's found, avoid a color whose hex has `[0-9]e[0-9]` in it. The showcase uses `rgba(92, 95, 102, 1)` and `rgba(63, 65, 73, 1)` in their place.

---

## `this.#field?.()[key]` throws where `#field` is unset

### What you'd expect (web)

`a?.()[k]` is `undefined` when `a` is nullish: the whole chain short-circuits.

### What Lynx does

Nothing; it's the build. The main thread is ES2019 (PrimJS), and the Lynx bundle's SWC pass compiles first-party `#private` fields to properties (`privateFieldsAsProperties`, see `packages/rsbuild-plugin-angular-lynx/src/layers.ts`). With that, `this.#replacedColors?.()[scheme]` came out as `(null == (r = this.#replacedColors) ? void 0 : r.call(this))[scheme]`, the index outside the conditional, so an unset field throws `Cannot read properties of undefined (reading 'light')`. Measured in the web bundle (2026-11-05); the Lynx bundle goes through the same pass. The same shape on a local constant (`replaced?.()[active]` in icon-theme.ts) compiles correctly.

`packages/ui`'s chart had the private-field form and threw in every app that didn't provide `UI_THEME_COLORS`. No example copy showed it, because none had been re-synced since dynamic color (#163) added the line; the showcase was the first to take the current chart.

- Write it in two steps: `const fn = this.#field; const value = fn ? fn()[key] : undefined;`.

---

## An element at `opacity: 0` never comes into view on a phone

### What you'd expect (web)

`IntersectionObserver` reports an element in the viewport whatever its opacity, so "hidden until it scrolls into view, then fade in" starts from `opacity: 0`.

### What Lynx does

Exposure, which `[lynxExposure]` and the runtime's `IntersectionObserver` are built on, counts only an element that "isn't fully transparent" (Lynx's own rule, alongside being on screen and having a size). A band hidden with `opacity: 0` until `visible()` is therefore never exposed, so `visible()` stays `false` and the band never shows: the showcase's market screen was empty on iOS (2026-11-05) while the web preview, whose observer is the browser's, showed it. Hide with a small opacity (`0.02`) and a transform instead.

---

## A `full-span` item at the end of a flow list opened the list scrolled to it on iOS

### What you'd expect (web)

A list opens at its top, whatever its last item spans.

### What Lynx does

Measured once (2026-11-05, iOS 27 Simulator, Lynx 4.4): a `<list list-type="flow" span-count="2">` of forty items whose last `<list-item>` had `full-span="true"` (a footnote across both columns) opened scrolled to its end, with that footnote and the last four items on screen; scrolling up reached the rest. The web preview opened the same list at the top. With the footnote moved out of the list (into the header), the list opens at the top on iOS too. Not yet narrowed down (the footnote's span, its being last, or the flow layout) and not checked on Android.

---

## A hidden view inside a `<text>` leaves a gap on iOS

### What you'd expect (web)

An element with `display: none` inside a line of text takes no room.

### What Lynx does

On iOS (Lynx Explorer 4.1, iOS 27 Simulator), a `display: none` `<view>` inside a `<text>` still takes room in the line ("A ⎵⎵⎵ and B"), and adds an empty line above the text. Android and the web preview draw "A and B". Angular's anchors for `@if`, `@for` and the like are such views (see `createCommentElement`), so `<text>Hi @if (x) {…}</text>` showed the gap.

An empty raw-text in the same place draws nothing on all three, first, last or between runs (measured the same way, with `Renderer2.createText('')`).

### The fix

`LynxElement.#anchorFor` makes an anchor going into a `<text>` an empty raw-text, and a hidden view again when it leaves. The anchor's wrapper and its place in Angular's tree stay the same; only the native element is swapped, which has no attributes, children or handlers.

---

## Text styles reach HTML text tags through CSS variables

### What you'd expect (web)

`color`, `font-size` and the other text properties inherit: a `<span>` in a `<div class="text-gray-500 text-sm">` is gray and small.

### What Lynx does

Nothing inherits (see "CSS inheritance is NOT enabled by default"). A nested `<text>` takes its parent `<text>`'s `color` and `font-family` only: measured on iOS and Android, a nested `<text>` in a 22px bold `<text>` drew at 14px, normal weight. The web preview inherits everything, through the DOM.

CSS variables do inherit, and follow class changes (`[class.x]` toggles), on iOS, Android and the web. A `var()` in an inline style reads them; one no ancestor sets leaves the property as it would be without the declaration. A variable holding `rgba(var(--rgb), 0.5)` resolves where it's read. All measured with Lynx Explorer 4.1 on the iOS 27 Simulator and the Android API 34 emulator, and in the web preview.

### How AngularLynx uses it

The build plugin's `textInheritanceForLynx` copies each inheritable declaration (Lynx's own `enableCSSInheritance` list) to `--angular-lynx-<property>`, after Tailwind 4's lowering. The elements that stand for HTML's text (HTML text tags and the anonymous `<text>`) read the variable for each property their own rules don't set, in their inline style, ahead of the app's. Which properties an element's rules set comes from the style index the plugin builds from the app's CSS and prepends to the main-thread script (`style-index.ts`). Elements written as Lynx elements read none, so they look as before. Inline styles don't set the variables, so `<div style="color: red">` passes nothing down.

---

## Lynx for Web resolves a bundle's images against the page, not the bundle

### What you'd expect (web)

A page's relative URLs resolve against the page, and a script's against the script. A bundle built with rspeedy's default (no `output.assetPrefix`) refers to its images as `static/image/<name>.<hash>.png`, and on iOS and Android Lynx resolves that against the bundle's own URL, so the bundle and its `static/` folder can live anywhere together.

### What Lynx does

Lynx for Web's `<image>` puts the `src` on an `<img>` in the page's shadow tree, so the browser resolves it against the page that shows the `<lynx-view>`. A bundle at `/examples/kitchen-sink-app/dist/main.web.bundle` shown on `/` asked for `/static/image/lynx-logo.<hash>.png`, which doesn't exist, and the docs' web previews drew no bundled image (measured on angularlynx.js.org on 2026-11-06). web-core knows the bundle's URL (`LynxViewInstance.templateUrl`) but doesn't give it to the app, so the app can't resolve the URLs itself.

### The fix

Angular's `baseHref` build option: `ng build --base-href=/examples/` sets rspeedy's `output.assetPrefix` for the `web` environment, so the web bundle asks for `/examples/static/image/…`. The website builds every example with it and merges each example's `dist/static` into `docs/public/examples/static` (the names carry a content hash, so the merge is safe). The `lynx` bundle is left without a prefix, since native Lynx resolves against the bundle. Fonts never had the problem: the build inlines `@font-face` files as data URLs (see css.ts in the build plugin).

---

## A `<lynx-view>` scaled with a CSS transform mis-measures itself

### What you'd expect (web)

A page scaled with `transform: scale()` lays out and measures in its own CSS pixels; only its picture shrinks. The docs' previews scale a `<lynx-view>` laid out at an iPhone's 402px to the pane that way.

### What Lynx does

Inside a transformed `<lynx-view>`, `getBoundingClientRect()` returns the scaled box (so does CSS `zoom`, measured in Chrome 156), while `offsetWidth` and `clientWidth` return the layout size. Two things read the rect: AngularLynx's `innerWidth`/`innerHeight` did, so an app laid out at 402px saw 330px, and a swiper that sized its photos by `innerWidth` left the next photo showing (fixed: `web-source.ts` reads `offsetWidth`/`offsetHeight`). Lynx for Web's waterfall `<list>` (`XListWaterfall.js`, `#layoutListItem`) places each item at the sum of the previous items' `getBoundingClientRect().height`, in CSS px, so under a scale of 0.82 every item starts 18% too high and the columns overlap. `list-type="flow"` and `single` lay out with CSS and aren't affected.

### The fix

Don't scale a `<lynx-view>` that holds a waterfall list. The home page's phone runs its app unscaled at the screen's own size, with insets scaled to match the chrome drawn over it; the furniture shop's docs page sets `webPreviewMode="responsive"` on its `<Go>`, which fills the pane instead of scaling. The measurement itself is web-elements' to fix (`offsetHeight` would do); upstream report pending.

---

## The web preview's clipboard needs the page's window

### What you'd expect (web)

A click handler calls `navigator.clipboard.writeText(text)` and the text is copied.

### What Lynx does

Web-core runs the main thread, where Angular's handlers run, in a hidden `<iframe sandbox="allow-same-origin allow-scripts">` of the page's origin (`createIFrameRealm` in `@lynx-js/web-core`). That iframe's document never has focus, so Chrome refuses its Clipboard API: `writeText` rejects with "NotAllowedError: Document is not focused", even from a tap (measured in Chromium 1248). The page around `<lynx-view>` has focus while someone taps in it, and its `navigator.clipboard` copies.

Headless Chromium refuses the page's `writeText` too ("Write permission denied") unless the test grants `clipboard-write`, though headed Chromium and WebKit copy from the same tap. `document.execCommand('copy')` from a selection in the page still copies in headless Chromium, and it's the only way in a page without the Clipboard API, such as one served over plain HTTP to a phone on the network.

### How AngularLynx handles it

`LynxClipboard` uses the iframe's `parent` (same origin, so reachable) in the web preview: its `navigator.clipboard`, or `execCommand('copy')` from a hidden textarea where that's missing or refuses. It calls the browser before anything waits, since Safari copies only while the tap's handler runs. A refused read resolves `''`, as a refused paste does on iOS.

On a device, the shells' `AngularLynxClipboard` module copies with `UIPasteboard` and `ClipboardManager`. Android 13 and later confirm every copy themselves, in a panel TalkBack reads ("Text copied", SystemUI's `ClipboardOverlayController`), so `LynxClipboard.confirmsCopies` tells the app not to say it again.

---

## `clearTimeout(undefined)` throws on the main thread

### What you'd expect (web)

`clearTimeout()` and `clearInterval()` ignore a handle that isn't a timer, `undefined` and `null` included, so code clears a timer it may not have started (`clearTimeout(this.#timer)`) before starting one.

### What Lynx does

The main thread's `clearTimeout` and `clearInterval` (`ClearTimeout` and `ClearTimeInterval` in Lynx core's `renderer_functions.cc`) check that their first argument is a Number, and fail with "ClearTimeout param 0 should be Number" otherwise. The statement throws, and anything after it in the same function never runs. Found on the iOS 27 Simulator in an `ng build --platform ios` app: the copy button's `clearTimeout(this.#timer)` ran before its first `setTimeout`, so the timer that puts its label back was never started, and it said "Copied" for good.

### How AngularLynx handles it

`polyfills.ts` puts a wrapper in front of whichever `clearTimeout` and `clearInterval` are installed that returns for `undefined` and `null`, as `cancelAnimationFrame`'s does for a handle that isn't a number. Other handles still reach the native one: Node's timers, which the testing library runs on, hand out objects.

---

## Links can't leave the app, and the web preview's iframe can't open a tab

### What you'd expect (web)

`<a href>`, `window.open()` and `location.assign()` open a page in the browser, and the browser hands `mailto:`, `tel:` and other apps' schemes to the system.

### What Lynx does

None of them exist on Lynx. `<a>` isn't an element, and there's no `window` or `location` on either thread. Lynx itself has no API that opens a URL outside the app: Lynx Explorer's `ExplorerModule.openSchema` opens a Lynx bundle inside Explorer, and `LynxRecorderOpenUrlModule` is part of the devtool. React Lynx has nothing either. So `LynxLinking` (issue #304) calls the shells' own `AngularLynxLinking` module, and rejects with `unavailable` in Lynx Explorer.

In the web preview, web-core runs the main thread, where Angular runs, in an iframe sandboxed with `allow-same-origin allow-scripts` and without `allow-popups`, so the iframe's own `window.open()` opens nothing. Chrome logs "Blocked opening … because the request was made in a sandboxed frame whose 'allow-popups' permission is not set" and returns `null`. The page around the iframe has the same origin, and its `window.open()`, called from a tap handler, opens the tab (checked with Playwright's Chromium).

On the phones, asking whether another app is installed is opt-in: iOS's `canOpenURL` answers `false` for any scheme the app doesn't list in Info.plist's `LSApplicationQueriesSchemes`, and Android 11 and later's `resolveActivity` finds no app the manifest's `<queries>` doesn't name. Opening one needs neither. On the iOS 27 Simulator, `SFSafariViewController` draws its own glass buttons and ignores `preferredBarTintColor` and `preferredControlTintColor`; Android's Custom Tab took the toolbar color.

### How AngularLynx uses it

`LynxLinking` opens tabs through `parent.open()` in the web preview, before anything is awaited, so the tab still counts as part of the tap. angular.json's `canOpenURLSchemes` lists the schemes `canOpenURL()` may ask about, and `ng build --platform` writes them, after `http`, `https`, `mailto`, `tel` and `sms`, into both files.

---

## Lynx for Web sets no font, so text takes the host page's (serif in a bare page)

### What you'd expect (web)

A page's text is in the font its stylesheet sets, and an unstyled page uses the browser's default font, which is a serif (Times) in most browsers.

### What Lynx does

On iOS and Android, text is in the system font unless a style says otherwise. Lynx for Web has no default font: `font-family` inherits from the page that shows the `<lynx-view>` into its shadow root and down to every `<x-text>`. rspeedy's web preview page (`@lynx-js/web-rsbuild-server-middleware`) sets none, only `margin` and `padding` on `body`, so a fresh app's text came out in Times there, and so does a ReactLynx app's: its starter sets no font either. Text does inherit on the web, unlike on the phones, so a font on `page` reaches all of it.

### How AngularLynx handles it

The build adds `styles/web-system-font.css` (a `page` rule with the system font stack, the one the docs site's live examples use) to the web bundle only, before the app's stylesheets, so an app's own `page` rule, a `font-*` class or an inline style still wins. The native bundle doesn't get it.

---

## A canvas is saved by the shell: `toBlob()` reads the drawing buffer and the shell encodes it

Found while adding `canvas.toBlob()` and `toDataURL()` for a photo editor, on the iOS 27 Simulator, the Android 14 emulator and Chromium, with a 2048×1365 canvas.

### What you'd expect (web)

`canvas.toBlob(callback, 'image/jpeg', 0.9)` encodes the canvas in the background and calls back with a `Blob`; `toDataURL()` returns a `data:` URL. For WebGL, what's read after a frame is on screen is undefined unless the context has `preserveDrawingBuffer: true`: the spec lets the drawing buffer be cleared once it's presented.

### What Lynx does

Lynx has no canvas; AngularLynx's (`canvas-element.ts`) draws through the shells' `AngularLynxWebGL` main-thread module. Its `encodeImage` method reads the default framebuffer (resolving its samples first), flips GL's bottom-up rows, and encodes with ImageIO on iOS and `Bitmap.compress` on Android. The file comes back as base64, because the bridge can't return bytes, and the pixels never cross it: 11 MB of RGBA as an array of numbers, then encoded in JavaScript on PrimJS, would take seconds. The read is synchronous, as the context's batch must be sent first, so the main thread waits for it; the `Blob` is made, from the base64, on a later task.

- **Measured, JPEG at 0.9, warm:** 13 to 22 ms for `toBlob()` itself on the iOS Simulator (110 ms the first time) and 29 to 44 ms on the Android emulator, both including the GPU finishing the frame just drawn, then 12 to 20 ms more before the callback has the `Blob`. A PNG of the same canvas took 99 ms (iOS) and 332 ms (Android), and was 1.2 to 1.7 MB.
- **ANGLE on Metal reads pixels into memory slowly.** `glReadPixels` of the 2048×1365 framebuffer straight into memory took 145 ms on the iOS Simulator; into a pixel pack buffer, then mapped, 2 to 15 ms. So `encodeImage` reads through a pack buffer. The context's own `readPixels()` into a typed array still reads straight into memory, so a large `readPixels()` on iOS is slow the same way.
- **The drawing buffer is cleared after each frame is shown**, as browsers may: `toBlob()` called on a later task without `preserveDrawingBuffer` gave a transparent PNG, which the WebGL spec allows; a browser may instead keep a copy of the frame on screen. Called in the task that drew, it has the frame.
- **Alpha.** The drawing buffer's colors are premultiplied unless the context asked otherwise; both encoders write a PNG's straight colors from premultiplied ones, and a JPEG drops alpha as browsers do, with transparent pixels black.

### A frame drawn before the canvas's view had a size was never shown on iOS

The shell shows a frame by copying it into the canvas view's layer, and waits when the view has no size yet. On iOS, nothing showed the waiting frame once Lynx laid the view out, so an app that draws once (a photo editor drawing its photo) showed an empty canvas until it drew again; three.js scenes, which draw every frame, never noticed. Android shows it when the view's surface arrives. The iOS canvas view now shows a waiting frame from `layoutSubviews`.

---

## There's no `navigator.share()`, and iOS's Save Image needs a reason in Info.plist

Found while adding `LynxShare`, on the iOS 27 Simulator, the Android 14 emulator and Chromium.

### What you'd expect (web)

`navigator.share({ files, title, text, url })` opens the system share sheet and resolves once the person shares, or rejects with an `AbortError` when they close it. It takes `File`s.

### What Lynx does

There's no `navigator`, no `File` and no share API. The shells' `AngularLynxShare` module opens the share sheet: `UIActivityViewController` on iOS and an `ACTION_SEND` chooser on Android. A file is a `{ blob, name }` pair, the shape `LynxImagePicker` returns, and crosses to the module as base64, as the picker's photos do the other way.

- **iOS gets real files.** Each file is written to a temporary file of its name, so the sheet shows its name and type and offers Save Image for an image. Handing over `Data` or a `UIImage` loses the name.
- **Save Image ends the app without `NSPhotoLibraryAddUsageDescription`.** iOS kills an app that adds to the photo library without a reason in Info.plist. `ng build --platform` always writes one (angular.json's `permissions.savePhotos`, with a default), and the module leaves Save Image out of the sheet when Info.plist has none, as in a project ejected before. With it, the first Save Image showed iOS's "Allow … to add photos" prompt with the reason, and the JPEG landed in Photos.
- **The completion handler.** From iOS 13, closing an action's own screen, such as Save to Files', calls it with that action while the sheet stays open; the module waits for the sheet to close. On iOS 27 the share sheet logs completing twice as it closes, so the module answers once.
- **Android doesn't say whether sharing finished.** The chooser reports which app the person picked, through the `IntentSender` given to `Intent.createChooser`, and nothing after. So `share()` resolves `true` on the pick, and `false` when the app comes back to the front without one. The Android 14 chooser's own Copy button reports no pick: `false`.
- **Android's files go through a `FileProvider`**, written under the cache's `angular-lynx-share/` folder and kept until the next share, since the app picked may read them after the sheet closes.

### Lynx for Web

Web-core's iframe has no `web-share` permission and no `allow-downloads`, so the runtime shares through the page around it, `parent.navigator.share()`, with `File`s made in the page's realm. Headless Chromium has no `navigator.share`, and Firefox on a computer can't share files, so there the runtime downloads each file with an `<a download>` in the page, and resolves `true`.

---

## Loading older items above a `<list>`'s visible ones: holding the place, and the web preview's list

Found while building the chat showcase (`examples/chat`), whose threads load older letters as you scroll up, on the iOS 27 Simulator, the Android 14 emulator and Chromium, 2026-11-09.

### What you'd expect (web)

A scroll container whose content grows above what's on screen keeps what's on screen where it was: browsers' scroll anchoring (`overflow-anchor: auto`) moves the scroll position by the height inserted above.

### What Lynx does

- **Nothing holds the place in the web preview.** Items inserted above the visible ones push them down: the scroll offset stays the same, so the new items slide into view (measured in Chromium). The example applies the same correction on iOS and Android; there, the place held wasn't measured with or without it. The app has to put the list back. The chat example notes where its first letter is on screen before the page lands (the rows above it have fixed heights, so its top is their sum less the scroll from `bindscroll`), then calls `scrollToPosition` with that letter's `position` and an `offset` once the list has laid the page out.
- **`scrollToPosition` takes `position`, not `index`.** It's Lynx's own name (lynxjs.org's `<list>` reference); `index` is ignored, so the call does nothing. AngularLynx's `<list>` page said `index` until this was found.
- **`initial-scroll-index` and an early `scrollToPosition` don't open a list at its end on iOS.** Both run before the native list has its items while a `<lynx-stack-outlet>` screen slides in. The chat example scrolls to its last row each frame for about 40 frames on opening, and stops as soon as the person drags (`bindscrollstatechange` state 2).

### Lynx for Web

- `scrollToPosition` scrolls to the item's top plus `offset`: it ignores `alignTo` and `itemKey`. Scrolling to the last item still lands at the bottom, since the scroll position can't go past the end.
- Until the new items are in the page, which takes a frame or two after Angular renders them, `scrollToPosition` does nothing (it looks the item up among the element's children), and no event says when they arrive: `bindlayoutcomplete` isn't sent. The chat example retries each frame for a few frames.
- `attachedCells` in `bindscroll` (with `need-visible-item-info`) lists every item the list has rendered, not only those on screen, with `top` relative to the list's visible top: it can't tell you the topmost visible item without filtering.
- There's no `scrollBy` UI method on the web preview's list.

---

## After a key press, Android draws a 12% black over the whole page

Found while chasing issue #362 (every color about 12% darker on the Android 14 emulator), 2026-11-10.

### What you'd expect (web)

A browser never outlines the document itself. Pressing a key, Tab or Enter, shows a focus ring only around the focused element, and only where `:focus-visible` matches.

### What Lynx does

The `LynxView` is a focusable Android view, and it takes focus whenever the window isn't in touch mode. Any key press leaves touch mode: a hardware keyboard, a D-pad, the soft keyboard's Enter, `adb shell input keyevent`, Maestro's `pressKey`. On Android 14 touch mode belongs to the whole display, so an app opened afterwards starts out of it too, and the next tap brings it back. Android 8 and later then draw a default focus highlight over a focused view whose background doesn't style focus: `selectableItemBackground`'s focused color, `#1F000000` (12% black) in a light theme and a 12% white in a dark one. Over a full-screen `LynxView`, every color was multiplied by 0.878, so white came out as 224. Black stayed black, and nothing showed in `dumpsys SurfaceFlinger`, since the highlight is drawn in the app's own buffer. `dumpsys activity <package>` shows the `LynxView` focused (`.F......`) and `dumpsys window` shows `mInTouchMode=false`. Chrome and Settings, opened the same way, weren't darkened.

The generated Android shell turns the highlight off on its `LynxView` (`defaultFocusHighlightEnabled = false`). The elements in the page draw their own focus. Layer 6's Android shell run checks it: after the flows, it opens the app again, presses Enter, and reads the counter's `#e0e0e0` buttons from a screenshot. Lynx Explorer wasn't checked for the same highlight.

---

## A `background-image: url()` in styles.css draws nothing on iOS; bound inline, the same file draws

### What you'd expect (web)

A rule in the app's stylesheet, `background-image: url('./assets/wood.jpg')`, paints the image, and the bundler rewrites the path to the built file.

### What Lynx does

Found by the solar system example (`examples/solar-system`), on the iOS 27 Simulator with Lynx 4.1: its case's mahogany and brushed-brass rasters, set with `url()` in `src/styles.css`, drew nothing natively, leaving the fallback `background-color`. The web preview drew them. The same files, imported in TypeScript and bound with `[style.background-image]="'url(' + file + ')'"`, draw on iOS. Not traced further: whether it's the path the CSS pipeline writes or how the native image loader resolves it. Android wasn't checked.

### The fix

Import the image and bind it on the element (`examples/solar-system/src/app/case/materials.ts`), keeping the rest of the rule (size, borders, fallback color) in the stylesheet.

---

## `:active` rules don't apply in AngularLynx builds (measured on Android)

### What you'd expect (web)

`.row:active { background: … }` styles an element while a pointer is down on it, and Tailwind's `active:` variant writes that rule.

### What Lynx does

Lynx's docs list `:active` as supported, and earlier entries here repeat that. Measured on 2026-11-13 (Lynx Explorer 4.1, Android API 34 emulator, a bundle from `ng build`): neither a plain `.press-probe:active { background-color: red }` in the global stylesheet nor Tailwind's `active:bg-primary` changed the element during a 2.5 s press (`adb shell input swipe x y x y 2500`, screenshot mid-press, the pixel stayed the resting color). The tap itself fired. Not measured on iOS.

### What to do

Drive pressed states from touch events, as the `@blotch/ui` components do: a `pressing` signal set on `bindtouchstart` and `bindmousedown` (the web preview sends no touches for a cursor) and cleared on `bindtouchend`, `bindtouchcancel`, `bindmouseup` and `bindmouseleave`, with a class bound to it. `ui-button`, `ui-select`'s field and rows, and `ui-accordion-trigger` all do this.

---

## A default text color: `view > text` works, and nested text keeps its parent's color

### What you'd expect (web)

`body { color: … }` colors every text that doesn't set its own, through inheritance.

### What Lynx does

Nothing inherits `color` (see "CSS inheritance is NOT enabled by default"), and a `<text>` with no color draws black, which vanishes on a dark background. A rule on the element's name with a child combinator reaches it: `view > text { color: var(--foreground); }`. Measured on 2026-11-13 on iOS 27, Android API 34 and the web preview (Chrome):

- A `<text>` with no class, directly in a `<view>`, takes the color.
- A class on the `<text>` (`text-muted-foreground`) still wins over it.
- A `<text>` nested in another `<text>` doesn't match (its parent isn't a `view`), so it keeps taking its parent's color, as Lynx has it: in `<text class="text-destructive">Red <text class="font-bold">bold</text></text>`, "bold" stays red. A bare `text { color }` rule would match the nested one too and override that.

The `@blotch/ui` theme's `default.css` has this rule for `view`, `scroll-view` and `list-item` parents.

---

## `hit-slop` works on a component's host, through an attribute binding

A component can widen its own touch target: `host: { '[attr.hit-slop]': "'6px'" }` (or a static `'hit-slop': '2px'`). Measured on 2026-11-13 with a 36pt-tall `ui-button`: on Android (API 34), taps 4dp above and below the button counted and taps 10dp away didn't; on iOS 27, a tap 2pt above counted and taps 9pt and 13pt away didn't. The value has to be a string: an attribute binding stringifies an object, so the per-side form (`{ top: '6px' }`) can't be given this way.

---

## Lynx Explorer on iOS sends the theme once; the generated apps and Android's Explorer follow a switch

Measured on 2026-11-13 by switching the appearance while a bundle was open (`xcrun simctl ui <udid> appearance dark`, `adb shell cmd uimode night yes`) and sampling a pixel:

- **Lynx Explorer 4.1, iOS 27:** the page stayed in the theme it opened with, so Explorer didn't send the new theme (not checked in its source). Reopen the bundle to see the other theme.
- **Lynx Explorer 4.1, Android API 34:** the page switched.
- **The app `ng build --platform ios` makes:** the page switched both ways while open (the shell sends the new theme when the phone switches).

---

## Android draws a one-sided border on a rounded element as a straight strip

### What you'd expect (web)

`border-top: 1px solid` on an element with rounded top corners follows the corners: the line curves down each side and thins out where the side has no border.

### What Lynx does

On iOS, and in the web preview, it does. On Android (API 34 emulator, Lynx Explorer 4.1, measured 2026-11-13), the border is a straight strip the full width of the element, drawn above the rounded fill: its ends stick out past the corners, where the fill has curved away. A bottom sheet with `rounded-t-2xl border-t border-border` showed a light line floating across its top.

### What to do

Give a rounded element a border on every side (`border border-border`, which follows the corners on Android too), or none. `ui-bottom-sheet`'s default panel has none: its tone against the dimmed backdrop is its edge.

