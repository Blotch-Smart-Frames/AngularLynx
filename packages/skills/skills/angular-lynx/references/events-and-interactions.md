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

## Critical: Defer DOM Mutations

Lynx event handlers run inside a worklet context. DOM mutations (`__CreateElement`, `__RemoveElement`, `__AppendElement`) during a worklet **crash the app**. Wrap any operation that changes the element tree in `setTimeout`:

```typescript
// WRONG — navigation mutates the tree synchronously inside the worklet
onTap() {
  this.router.navigateByUrl('/detail');
}

// CORRECT — defers mutations to the next macrotask
onTap() {
  setTimeout(() => this.router.navigateByUrl('/detail'), 0);
}
```

This applies to:

- Router navigation
- Signal updates that add/remove elements (e.g., toggling `@if` blocks)
- Any operation that causes Angular to create or destroy components

Signal updates that only change text/attributes (no structural changes) are safe without `setTimeout`.

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
