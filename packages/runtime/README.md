# @blotch/angular-lynx

Angular renderer for [Lynx](https://lynxjs.org/). Write Angular components, render to native iOS, Android, and Web via the Lynx engine.

## Quick Start

```bash
npm create angular-lynx my-app
```

Or add to an existing Angular project:

```bash
ng add @blotch/angular-lynx
```

## Features

- Standalone components with signals, `@if`/`@for`/`@switch`, DI, and pipes
- Zoneless change detection — signals as the primary reactivity model
- Full Angular Router with in-memory navigation for Lynx
- Gestures — tap, pan, long-press, fling, pinch, rotation with composition
- Animations — CSS transitions, keyframes, and programmatic `animate()` API
- Content projection, portals, `@defer`, and lazy-loaded routes
- Tailwind CSS via `@lynx-js/tailwind-preset`

## Documentation

Full docs and guides at [angularlynx.dev](https://angularlynx.dev).

---

## Animation API

Three animation approaches are available, all running natively on the Lynx engine.

### CSS Transitions

Apply `transition` in your stylesheet. Lynx interpolates property changes automatically.

```css
.box {
  background-color: #6200ee;
  transition: background-color 0.5s ease-in-out;
}

.box-active {
  background-color: #03dac6;
}
```

```html
<view class="box" [class.box-active]="isActive()" (bindtap)="toggle()">
  <text>Tap me</text>
</view>
```

### CSS Keyframe Animations

Define `@keyframes` in your stylesheet and apply via class toggle.

```css
@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.spinning {
  animation: rotate 2s linear infinite;
}
```

```html
<view class="box" [class.spinning]="spin()">
  <text>Rotating</text>
</view>
```

### JavaScript Animate API

Use `element.animate()` on a native element reference for programmatic control. Calls the Lynx `__ElementAnimate` PAPI under the hood.

```typescript
import { Component, viewChild, type ElementRef } from '@angular/core';
import { type LynxAnimation } from '@blotch/angular-lynx';

@Component({
  selector: 'app-example',
  template: `
    <view #box class="box" (bindtap)="runAnimation()">
      <text>Tap to animate</text>
    </view>
  `,
})
export class ExampleComponent {
  boxRef = viewChild<ElementRef>('box');
  #animation: LynxAnimation | null = null;

  runAnimation(): void {
    setTimeout(() => {
      const el = this.boxRef();
      if (!el) return;

      // Cancel previous animation before starting a new one.
      this.#animation?.cancel();

      this.#animation = el.nativeElement.animate(
        [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(1.3)', opacity: 0.7 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        {
          duration: 600,
          easing: 'ease-in-out',
        },
      );
    }, 0);
  }
}
```

#### `animate()` API

```typescript
element.nativeElement.animate(
  keyframes: Record<string, string | number>[],
  options?: number | LynxAnimationOptions,
): LynxAnimation
```

**Parameters:**

| Parameter   | Type                                 | Description                                                               |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `keyframes` | `Record<string, string \| number>[]` | Array of keyframe objects. Each object maps CSS property names to values. |
| `options`   | `number \| LynxAnimationOptions`     | Duration in ms (shorthand) or full options object.                        |

**`LynxAnimationOptions`:**

| Option                          | Type               | Description                                                                            |
| ------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `duration`                      | `number \| string` | Animation duration in milliseconds.                                                    |
| `delay`                         | `number \| string` | Delay before animation starts.                                                         |
| `iterations` / `iterationCount` | `number \| string` | Number of repetitions. Use `Infinity` for infinite.                                    |
| `easing` / `timingFunction`     | `string`           | Easing function (`linear`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(...)`). |
| `fill` / `fillMode`             | `string`           | How styles persist after animation (`none`, `forwards`, `backwards`, `both`).          |
| `direction`                     | `string`           | Play direction (`normal`, `reverse`, `alternate`, `alternate-reverse`).                |
| `name`                          | `string`           | Optional animation name (auto-generated if omitted).                                   |

**Returns:** `LynxAnimation` with control methods:

| Method     | Description                        |
| ---------- | ---------------------------------- |
| `play()`   | Resume a paused animation.         |
| `pause()`  | Pause the animation.               |
| `cancel()` | Cancel and clean up the animation. |

#### Animation Events

Lynx fires standard animation events on elements. Listen in templates using bind-prefixed event names:

```html
<view
  class="animated-box"
  (bindanimationend)="onAnimationEnd($event)"
  (bindtransitionend)="onTransitionEnd($event)"
>
  <text>Animated</text>
</view>
```

Available events: `animationstart`, `animationend`, `animationcancel`, `animationiteration`, `transitionstart`, `transitionend`, `transitioncancel`.

#### Important Notes

- The `animate()` API is **main-thread only**. Calling it on the background thread throws an error.
- Wrap `animate()` calls inside `setTimeout(() => { ... }, 0)` when triggered from Lynx event callbacks to avoid mutating the element tree inside a worklet.
