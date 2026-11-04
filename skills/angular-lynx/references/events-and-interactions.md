# Events & Interactions

## Event Prefix System

Lynx uses prefixes instead of `on*` attributes. Each prefix controls propagation behavior:

| Prefix          | Behavior                         | Angular Template Syntax                |
| --------------- | -------------------------------- | -------------------------------------- |
| `bind`          | Bubble phase, propagates up      | `(bindtap)="handler($event)"`          |
| `catch`         | Bubble phase, stops propagation  | `(catchtap)="handler($event)"`         |
| `capture-bind`  | Capture phase, propagates down   | `(capture-bindtap)="handler($event)"`  |
| `capture-catch` | Capture phase, stops propagation | `(capture-catchtap)="handler($event)"` |

## Common Events

| Event           | Prefix + Name              | When It Fires                                                            |
| --------------- | -------------------------- | ------------------------------------------------------------------------ |
| Tap             | `bindtap`                  | Touch up after touch down on same element                                |
| Long press      | `bindlongpress`            | Touch held for 500ms+                                                    |
| Input           | `bindinput`                | Text input value changes                                                 |
| Scroll          | `bindscroll`               | Scroll position changes (on `scroll-view`)                               |
| Load            | `bindload`                 | Image/frame finished loading                                             |
| Animation end   | `bindanimationend`         | CSS animation completed                                                  |
| Transition end  | `bindtransitionend`        | CSS transition completed                                                 |
| Focus           | `bindfocus`                | Input element gained focus                                               |
| Blur            | `bindblur`                 | Input element lost focus                                                 |
| Confirm         | `bindconfirm`              | Keyboard action button pressed (on `input`)                              |
| Layout change   | `bindlayoutchange`         | Element laid out or resized (`detail.width`, `detail.height`)            |
| Keyboard height | `bindkeyboardheightchange` | Keyboard shows, resizes or hides, on a focused `input` (`detail.height`) |
| Comes into view | `binduiappear`             | Element comes into view (see [Coming into view](#coming-into-view))      |
| Leaves view     | `binduidisappear`          | Element leaves view                                                      |

## `(click)` and several handlers per element

- `(click)` runs on a tap, as `(bindtap)` does: the renderer maps it like Lynx for Web (`click` → `tap`, bubbling). Angular's `RouterLink` depends on this. Other DOM event names, such as `(mouseover)`, are silently ignored, except pointer events (below).
- Native Lynx keeps **one** handler per event name on an element (its event map is keyed by name, whatever the bind/catch type). The renderer registers one native handler per event that runs every Angular listener in order, so `routerLink` plus `(bindtap)` on one element both run. If any listener uses `catch`, the event stops at the element after all of them run.
- A main-thread script (`[mainThreadBindtap]`) registers its own native handler and keeps the event while it's bound: a `(bindtap)` on the same element doesn't run, and a listener added later (an `IntersectionObserver`'s on a `<scroll-view>`, say) waits until the script is unbound, rather than replacing it.
- A listener added after the element is on screen works, from a timer, a tap or a library's observer (`nativeElement.addEventListener('bindscroll', …)`). Lynx sends an element's handlers to its native view only along with another change, so the renderer makes one that changes nothing. On iOS, a `<scroll-view>` or `<list>` sends `scroll` only to the handlers it had when it was created, so each one gets a do-nothing `bindscroll` handler then, and later listeners share it.

## Pointer events

`(pointerdown)`, `(pointermove)`, `(pointerup)`, `(pointercancel)`, `(pointerover)`, `(pointerout)`, `(pointerenter)`, `(pointerleave)`, `(gotpointercapture)` and `(lostpointercapture)` work on every element, with no `bind` prefix, as on the web: the renderer makes each touch into the pointer events a browser fires for one, in its order. `$event` is a DOM `PointerEvent`: `pointerId` is the finger, `pointerType` is `'touch'`, `offsetX`/`offsetY` are relative to the element. A finger keeps its `pointerId` until it lifts, the same at the element and the document; with multi-touch off (a LynxView's default) there's one touch at a time, `pointerId` `0`. A touch's events stay with the element it started on, as if captured. In the web preview they're the browser's own, mouse included. Libraries written for the web, such as angular-three, use them; a `(click)` on an element with pointer listeners has `offsetX`/`offsetY` where the pointer lifted.

## `document:`, `window:` and `body:` listeners

Host listeners on the document, the window and the body work as on the web, and so do `document.addEventListener()`, `window.addEventListener()`, `fromEvent(document, …)` and `inject(DOCUMENT)` (the same object as every element's `ownerDocument`, whose `defaultView` is `window`):

```typescript
@Component({
  selector: 'app-tilt',
  host: { '(document:pointermove)': 'tilt($event)' },
  template: `…`,
})
export class Tilt {
  readonly angle = signal(0);

  tilt(event: PointerEvent): void {
    this.angle.set((event.clientX / window.innerWidth - 0.5) * 30);
  }
}
```

- **`document:` and `window:`** hear a touch anywhere on screen: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerover`, `pointerout`, `touchstart`, `touchmove`, `touchend`, `touchcancel` and `click`. **`window:resize`** fires when the LynxView changes size, as when the device rotates. **`body:`** is the page element: the events that bubble up to it.
- **They run after the touched element's listeners and the body's**, as in a browser; `{ capture: true }` runs before them.
- **They hear a touch a `catch` handler stopped**, unlike the web's `stopPropagation()`, on the next timer, after every listener of that touch.
- **A pointer event's `target`** is the element touched (its `ElementRef`'s `nativeElement`), with `offsetX`/`offsetY` relative to it. Touch events and `click` are Lynx's own event objects.
- **`window.innerWidth` / `innerHeight`** are the LynxView's size in CSS pixels; until its first layout, the screen's.
- **iOS and Android send no mouse events:** `document:mousemove` never runs there, so listen for `pointermove`.
- **In the web preview** they're the browser's own events inside the `<lynx-view>`, mouse included, and the size is the `<lynx-view>`'s.

## Handlers can change the element tree

Event handlers run on the main thread, inside the native event. They can do anything they would on the web: set signals, navigate, open overlays, start `animate()`, add and remove elements. Measured on Lynx 4.1 (iOS, Android, web): a handler that creates and removes 50 elements and flushes them with `ApplicationRef.tick()` doesn't crash, and on iOS and Android neither do gesture callbacks doing the same. Don't wrap these calls in `setTimeout`.

## Drags

Handle a drag in template listeners (`(bindtouchstart)`, `(bindtouchmove)`, `(bindtouchend)`) that set signals. Angular runs on the main thread, beside Lynx's touch handling, so a main-thread script would save nothing. Measured on Lynx 4.1 (iOS Simulator, Android emulator): a `touchmove` every 17–20ms, about 1ms from the event to the handler, and 3–5ms from the handler to the render.

A `touchmove` goes to the element the touch started on, even as the finger crosses others. On iOS, a `<scroll-view>` around a sideways drag scrolls along with it. Give the dragged element `consume-slide-event` with the swipe angles it keeps, in degrees from the right: `[consume-slide-event]="[[-45, 45], [135, 180], [-180, -135]]"` keeps drags within 45° of sideways, and a swipe up that starts on it still scrolls the page.

## Gestures

When a drag needs recognition rules (a minimum distance, a tap and a drag on one element, momentum), bind a gesture with `[lynxGesture]` instead of touch listeners:

```typescript
import { Component, computed, signal } from '@angular/core';
import {
  Gesture,
  LYNX_ELEMENTS,
  LynxGestureDetector,
  PanGesture,
  TapGesture,
} from '@blotch/angular-lynx';

@Component({
  selector: 'app-card',
  imports: [LYNX_ELEMENTS, LynxGestureDetector],
  template: `
    <view [lynxGesture]="gesture" [style.transform]="transform()">
      <text>Taps: {{ taps() }}</text>
    </view>
  `,
})
export class Card {
  readonly taps = signal(0);
  readonly #x = signal(0);
  readonly transform = computed(() => `translateX(${this.#x()}px)`);
  #restX = 0;

  readonly #pan = new PanGesture()
    .minDistance(10)
    .onUpdate((event) => this.#x.set(this.#restX + event.translationX))
    .onEnd(() => (this.#restX = this.#x()));
  readonly #tap = new TapGesture().onEnd(() => this.taps.update((n) => n + 1));

  readonly gesture = Gesture.Exclusive(this.#pan, this.#tap);
}
```

- **Create each gesture once, as a field.** Callbacks run on the main thread, like event handlers, and get the event and a state manager.
- **Gestures:** `TapGesture`, `LongPressGesture`, `PanGesture` and `FlingGesture`. A fling is the momentum after a release: put it on the element with a pan (`Gesture.Simultaneous(pan, fling)`), read `deltaX`/`deltaY` in its `onUpdate`, and expect no `onStart`. `PinchGesture` and `RotationGesture` never fire: no Lynx platform recognizes them.
- **`translationX`/`translationY`** run from where the touch began. Events carry no velocity.
- **`onEnd` of a tap or long press means it happened**: the runtime drops the `onEnd` Lynx also sends when one fails. A pan's `onEnd` runs after every touch, a tap included, so don't take it as a completed drag.
- **Gestures on one element race.** The first to activate fails the others, unless they're `simultaneousWith` it. `waitFor`, and so `Gesture.Exclusive`'s order, only takes effect between elements (a child's gesture waiting for its parent's). In the example, a drag past 10px wins and a tap is recognized when the finger lifts before that.
- **State from code:** `fail()` and `end()` on the state manager work. `activate()` does nothing on any platform.
- **Lynx reads few options:** a tap's `maxDuration` and `maxDistance`, a long press's `minDuration` and `maxDistance`, and a pan's `minDistance`. `enabled(false)`, `activeOffsetX`, a fling's `direction` and `numberOfTaps` do nothing; to turn a gesture off, bind `[lynxGesture]` to `[]`.
- **The web preview recognizes gestures too**, by the same rules, from a mouse or a finger.

## Coming into view

Lynx calls an element coming into view _exposure_. Native checks about 20 times a second whether an element is inside every scroll container around it and on screen, has a size, and isn't fully transparent, and fires `uiappear` and `uidisappear` when that changes. An element that starts out of view gets no event.

- **`[lynxExposure]`** (`LynxExposure`, `exportAs: 'lynxExposure'`) gives a template a `visible()` signal for the element. It starts `false`.
- **`IntersectionObserver`** takes Lynx elements, so browser code and libraries that watch elements work:

```typescript
constructor() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) this.onScreen.set(entry.isIntersecting);
  });
  observer.observe(inject(ElementRef).nativeElement);
  inject(DestroyRef).onDestroy(() => observer.disconnect());
}
```

On a device it reports each element once observing starts, after the element's first layout, then each time it comes into view or leaves. Entries have `isIntersecting`, `intersectionRatio`, `boundingClientRect`, `intersectionRect`, `rootBounds` and `target`. The boxes are measured just after Lynx notices the change, so an element scrolling in reports a small `intersectionRatio`. The web preview uses the browser's own observer.

`threshold`, `rootMargin` (px or %) and `root` (an element around the observed one, such as a `<scroll-view>` or `<list>`) work as in the browser. Given any of them, the observer measures the element itself: when it's laid out, when exposure says it came or went, and 20 times a second while a scroll container between it and the root scrolls. It reports each time the visible part crosses a threshold. Points that catch people out:

- `isIntersecting` is `true` only once a threshold is reached, as in Chrome and Safari: with `threshold: 1`, a half-visible element isn't intersecting. Read `intersectionRatio` for the share.
- `rootMargin` grows the root only, not the scroll containers inside it. With no root it grows the page, which a `<scroll-view>` still clips, so to load ahead in a scroll-view or list, pass it as `root`:

```typescript
new IntersectionObserver(([entry]) => entry.isIntersecting && this.loadMore(), {
  root: this.list().nativeElement,
  rootMargin: '0px 0px 400px 0px',
});
```

- Options cost a measurement per observed element each time, so leave them out to hear only when an element comes into view and leaves.
- Lynx gives an element one handler per event, and a `[mainThreadBindscroll]` or `[mainThreadCatchscroll]` keeps a scroll container's: an observer inside it doesn't hear it scroll, and measures only on layout and exposure.
- In tests, `fireEvent.uiappear()` brings all of an element into view for an observer with options (`intersectionRatio` 1), and `fireEvent.uidisappear()` takes all of it out: the test environment has no layout.

- **`LynxGlobalExposure`** reports, in batches, the elements with an `exposure-id` that came into view and left, for analytics.

In tests, `fireEvent.uiappear(element)` and `fireEvent.uidisappear(element)` bring an element into view and take it out.

## Event Payload

Touch events carry the touch's position, in `touches` (for a tap, also `detail.x` and `detail.y`, the position in the page):

```typescript
import type { TouchEvent } from '@lynx-js/types';

onTouchMove(event: TouchEvent) {
  const { x, pageX } = event.touches[0];
}
```

- **On iOS and Android,** `x` and `y` are relative to the element the touch landed on (its `target`), `pageX` and `pageY` to the Lynx view, and `clientX` and `clientY` to the window.
- **On Lynx for Web,** `x` and `y` are relative to the `<lynx-view>`, whatever was touched, and `pageX` and `clientX` keep their web meanings.

To know where on a control the finger is, give everything inside the control `[user-interaction-enabled]="false"`, so the control itself is always the target, and read `x`. On the web, measure the control's left edge (`boundingClientRect`) when the press starts and subtract it.

### Typed `$event`

Angular types `$event` from the element and the event, so a template needs no cast, and a misspelt `detail` field fails the build:

```html
<input (bindinput)="name.set($event.detail.value)" />
<image [src]="url" (bindload)="loaded($event)" />
```

```typescript
import {
  type ImageLoadDetail,
  type LynxEvent,
} from '@blotch/angular-lynx';

loaded({ detail }: LynxEvent<ImageLoadDetail>) {
  this.size.set({ width: detail.width, height: detail.height });
}
```

- **Non-touch events are `LynxEvent<Detail>`**, from `@blotch/angular-lynx`, with `type`, `timestamp`, `target`, `currentTarget` and `detail`. Each event has an exported detail type: `ImageLoadDetail`, `LayoutChangeDetail`, `ScrollDetail`, `ListScrollDetail`, `InputDetail` (for `bindinput`), `InputValueDetail` (`bindfocus`, `bindblur`, `bindconfirm`), `KeyboardHeightDetail`, `VideoTimeUpdateDetail`, `WebViewMessageDetail`, `ViewPagerChangeDetail` and so on. An event with no detail, such as `<webview>`'s `bindload`, is `LynxEvent` (`detail: unknown`).
- **Tap, long-press and touch events are `TouchEvent`**, mouse events `MouseEvent`, and animation and transition events `AnimationEvent` and `TransitionEvent`, all from `@lynx-js/types`. Import them by name: without the import, TypeScript uses the DOM's.
- **Never type a Lynx event handler's parameter as `Event` or cast to `CustomEvent`.** `$event` isn't a DOM event, so `onInput(event: Event)` fails `ng build` and `ng test`. `$any($event)` compiles but throws the checking away.
- **Every prefix gives the same type:** `(catchtap)`, `(capture-bindtap)` and `(global-bindtap)` get what `(bindtap)` gets, and so on for every other event.
- **An event the element doesn't fire stays a DOM `Event`**, such as `(bindload)` on a `<view>`: that's the sign of a typo in the event name or the wrong element.
- **`target.dataset` values are `unknown`:** a `[data-item]="item"` binding keeps the item's type, so narrow before using one.

## Tap vs Long Press

`bindtap` and `bindlongpress` are **mutually exclusive** on the same element. If both are registered, `longpress` takes priority — if a long press is detected, `tap` does NOT fire. Don't rely on both for the same element.

## Propagation Rules

- **Only touch events propagate** (`tap`, `longpress`, `touchstart`, `touchmove`, `touchend`)
- **Non-touch events** (`scroll`, `input`, `load`, `animationend`) are delivered **only to the target element** — no capture or bubble phase
- Use `catch` prefix to stop propagation (e.g., `catchtap` on a button inside a tappable card prevents the card's `bindtap` from firing)
- **`global-bind`** (`(global-bindtouchstart)`) runs for a touch on any element, before that element's own listeners and whether or not it bubbles that far: the way to hear a touch outside a panel. `document:` and `window:` listeners hear touches through it, after the elements' listeners
