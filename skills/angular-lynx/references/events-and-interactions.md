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

| Event          | Prefix + Name       | When It Fires                               |
| -------------- | ------------------- | ------------------------------------------- |
| Tap            | `bindtap`           | Touch up after touch down on same element   |
| Long press     | `bindlongpress`     | Touch held for 500ms+                       |
| Input          | `bindinput`         | Text input value changes                    |
| Scroll         | `bindscroll`        | Scroll position changes (on `scroll-view`)  |
| Load           | `bindload`          | Image/frame finished loading                |
| Animation end  | `bindanimationend`  | CSS animation completed                     |
| Transition end | `bindtransitionend` | CSS transition completed                    |
| Focus          | `bindfocus`         | Input element gained focus                  |
| Blur           | `bindblur`          | Input element lost focus                    |
| Confirm        | `bindconfirm`       | Keyboard action button pressed (on `input`) |

## `(click)` and several handlers per element

- `(click)` runs on a tap, as `(bindtap)` does: the renderer maps it like Lynx for Web (`click` → `tap`, bubbling). Angular's `RouterLink` depends on this. Other DOM event names, such as `(mouseover)`, are silently ignored.
- Native Lynx keeps **one** handler per event name on an element (its event map is keyed by name, whatever the bind/catch type). The renderer registers one native handler per event that runs every Angular listener in order, so `routerLink` plus `(bindtap)` on one element both run. If any listener uses `catch`, the event stops at the element after all of them run.
- A main-thread script (`[mainThreadBindtap]`) registers its own native handler, so it still replaces a `(bindtap)` on the same element.

## Handlers can change the element tree

Event handlers run on the main thread, inside the native event. They can do anything they would on the web: set signals, navigate, open overlays, start `animate()`, add and remove elements. Measured on Lynx 4.1 (iOS, Android, web): a handler that creates and removes 50 elements and flushes them with `ApplicationRef.tick()` doesn't crash, and neither do gesture callbacks doing the same. Don't wrap these calls in `setTimeout`.

## Event Payload

Tap events provide touch coordinates:

```typescript
import type { TouchEvent } from '@lynx-js/types';

onTap(event: TouchEvent) {
  // event contains touch position data
}
```

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
