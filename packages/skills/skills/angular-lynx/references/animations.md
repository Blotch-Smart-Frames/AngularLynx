# Animations

Three animation approaches are available in AngularLynx, each with different tradeoffs.

## 1. CSS Transitions

Smooth property changes triggered by class toggling or style binding.

```typescript
@Component({
  template: `
    <view class="box" [class.box-active]="isActive()" (bindtap)="toggle()">
      <text>Tap me</text>
    </view>
  `,
  styles: [
    `
      .box {
        background-color: #6200ee;
        transition: background-color 0.5s ease-in-out;
      }
      .box-active {
        background-color: #03dac6;
      }
    `,
  ],
  imports: [LYNX_ELEMENTS],
})
export class TransitionDemo {
  isActive = signal(false);
  toggle(): void {
    setTimeout(() => this.isActive.update((v) => !v), 0);
  }
}
```

## 2. CSS Keyframe Animations

For continuous or complex multi-step animations.

```css
@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.spinning {
  animation: rotate 2s linear infinite;
}

.pulsing {
  animation: pulse 1.5s ease-in-out infinite;
}
```

Toggle via class binding:

```html
<view [class.spinning]="isSpinning()">
  <text>Rotating</text>
</view>
```

## 3. JavaScript Animate API

Programmatic animations using `element.animate()`. **Main-thread only.**

```typescript
import { type ElementRef, viewChild } from '@angular/core';
import { type LynxAnimation } from '@blotch/angular-lynx';

export class AnimateDemo {
  boxRef = viewChild<ElementRef>('box');
  #currentAnimation: LynxAnimation | null = null;

  runAnimation(): void {
    setTimeout(() => {
      const el = this.boxRef();
      if (!el) return;

      this.#currentAnimation?.cancel();

      this.#currentAnimation = el.nativeElement.animate(
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

### LynxAnimationOptions

```typescript
{
  duration: number;            // milliseconds
  delay?: number;              // milliseconds
  iterations?: number;         // use Infinity for infinite
  easing?: string;             // 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(...)'
  fill?: string;               // 'none', 'forwards', 'backwards', 'both'
  direction?: string;          // 'normal', 'reverse', 'alternate', 'alternate-reverse'
}
```

### Animation Control

```typescript
animation.play(); // resume
animation.pause(); // pause
animation.cancel(); // cancel and cleanup
```

## Animatable Properties

Both `transition` and `@keyframes` are restricted to this whitelist:

`left`, `right`, `top`, `bottom`, `width`, `height`, `opacity`, `background-color`, `color`, `transform`, `transform-origin`, `max-width`, `min-width`, `max-height`, `min-height`, `padding-*`, `margin-*`, `border-*-width`, `border-*-color`, `flex-basis`, `flex-grow`, `filter`

Properties like `border-radius`, `font-size`, `letter-spacing` **cannot be animated**.

## Animation Events

```html
<view
  (bindanimationend)="onAnimEnd($event)"
  (bindanimationstart)="onAnimStart($event)"
  (bindtransitionend)="onTransEnd($event)"
></view>
```

## Important Notes

- **`element.animate()` is main-thread only** — it works because Lynx renders the animation natively
- **Always wrap in `setTimeout`** when triggered from event handlers
- **`animation-iteration-count: 0`** still fires lifecycle events (unlike web where it's a no-op)
- **Lynx-specific `frames(n)` easing** is available (like `steps()` with different semantics)
- **Performance tip:** Set `overflow: hidden` on animated elements to reduce redraw region
