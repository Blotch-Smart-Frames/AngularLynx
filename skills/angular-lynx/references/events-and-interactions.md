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

## `(click)` and several handlers per element

- `(click)` runs on a tap, as `(bindtap)` does: the renderer maps it like Lynx for Web (`click` → `tap`, bubbling). Angular's `RouterLink` depends on this. Other DOM event names, such as `(mouseover)`, are silently ignored.
- Native Lynx keeps **one** handler per event name on an element (its event map is keyed by name, whatever the bind/catch type). The renderer registers one native handler per event that runs every Angular listener in order, so `routerLink` plus `(bindtap)` on one element both run. If any listener uses `catch`, the event stops at the element after all of them run.
- A main-thread script (`[mainThreadBindtap]`) registers its own native handler, so it still replaces a `(bindtap)` on the same element.

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

Input events provide the current value:

```typescript
onInput(event: { detail: { value: string } }) {
  this.inputValue.set(event.detail.value);
}
```

## Tap vs Long Press

`bindtap` and `bindlongpress` are **mutually exclusive** on the same element. If both are registered, `longpress` takes priority — if a long press is detected, `tap` does NOT fire. Don't rely on both for the same element.

## Propagation Rules

- **Only touch events propagate** (`tap`, `longpress`, `touchstart`, `touchmove`, `touchend`)
- **Non-touch events** (`scroll`, `input`, `load`, `animationend`) are delivered **only to the target element** — no capture or bubble phase
- Use `catch` prefix to stop propagation (e.g., `catchtap` on a button inside a tappable card prevents the card's `bindtap` from firing)
- **`global-bind`** (`(global-bindtouchstart)`) runs for a touch on any element, before that element's own listeners and whether or not it bubbles that far: the way to hear a touch outside a panel, since there's no `document` to listen on
