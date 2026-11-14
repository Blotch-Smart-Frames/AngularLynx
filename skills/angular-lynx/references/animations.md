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
    this.isActive.update((v) => !v);
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
- **Call it straight from an event handler** — no `setTimeout` needed
- **Not on an element created in the same turn:** native Lynx drops an animation on an element it hasn't flushed yet (the web preview plays it). Set the element's starting look as an inline style when you create it, and start the animation on the next turn (`setTimeout(…, 0)`). For screens sliding in and out, use `<lynx-stack-outlet>` (see [routing.md](routing.md))
- **`animation-iteration-count: 0`** still fires lifecycle events (unlike web where it's a no-op)
- **Lynx-specific `frames(n)` easing** is available (like `steps()` with different semantics)
- **Performance tip:** Set `overflow: hidden` on animated elements to reduce redraw region
- **Respect Reduce Motion:** read `inject(LynxAccessibilitySettings).reduceMotion()` and swap slides and bounces for a fade or an instant change

## Frame Rate

Lynx doesn't hand animations to Core Animation or a compositor. It works out every frame of `animate()` and of CSS transitions itself, on the main thread, where Angular runs too (on iOS that's the UI thread). A frame the thread spends on something else is dropped, so:

- **Animate `transform` and `opacity`.** Lynx skips layout for them, with a translate in `px` or `%`. `height`, `width`, colors, `filter`, and a translate in `rem`, `em`, `vw` or `vh` lay the page out again on every frame.
- **Keep the main thread free while something moves:** build the next screen before its transition starts, not during it.
- **Judge it on a phone.** The iOS Simulator and the Android emulator run on the Mac's CPU and hold 60 fps where a phone drops frames.

On a ProMotion iPhone, apps that `ng build --platform ios` builds animate at up to 120 fps: the app's Info.plist has `CADisableMinimumFrameDurationOnPhone`, and the build asks Lynx for 120 (`preferredFps`, `'high'` by default). `pluginAngularLynx({ preferredFps: 'auto' })` in `lynx.config.ts` leaves it to the system, which holds an iPhone to 60. A host app that embeds a LynxView needs the Info.plist key itself. Android draws at the screen's rate either way.

### Drags

A drag sends a move for every frame the finger moves. A template listener has Angular run change detection after each one, and so does a signal the template reads. Listen for the moves in code, move the element from the handler, and set signals once the finger lets go:

```typescript
import {
  Component,
  ElementRef,
  Renderer2,
  effect,
  inject,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

type Touch = { touches: { clientY: number }[] };

@Component({
  selector: 'app-drawer',
  imports: [LYNX_ELEMENTS],
  template: `
    <view
      #panel
      (catchtouchstart)="start($event)"
      (catchtouchend)="end()"
      (catchtouchcancel)="end()"
    >
      <ng-content />
    </view>
  `,
})
export class Drawer {
  readonly panel = viewChild.required<ElementRef>('panel');
  readonly dismissed = output<void>();
  readonly #renderer = inject(Renderer2);
  #startY: number | null = null;
  #offset = 0;

  // In code, not `(catchtouchmove)`: Angular doesn't check the component after each move.
  protected readonly listen = effect((onCleanup) => {
    onCleanup(
      this.#renderer.listen(
        this.panel().nativeElement,
        'catchtouchmove',
        (event: Touch) => {
          if (this.#startY === null) return;
          this.#offset = Math.max(0, event.touches[0].clientY - this.#startY);
          this.#moveTo(this.#offset);
        },
      ),
    );
  });

  protected start(event: Touch): void {
    this.#startY = event.touches[0].clientY;
  }

  protected end(): void {
    this.#startY = null;
    if (this.#offset > 100) this.dismissed.emit();
    else this.#moveTo(0);
    this.#offset = 0;
  }

  // The one place that sets the transform.
  #moveTo(offset: number): void {
    this.#renderer.setStyle(
      this.panel().nativeElement,
      'transform',
      `translateY(${offset}px)`,
    );
  }
}
```

Don't also bind a property the drag sets (`[style.transform]`): Angular only knows the values its own binding set, so a release that puts the bound value back where it was before the drag (a snap back) looks like no change to it, and the element stays where the finger last had it. `ui-bottom-sheet` sets its whole frame from code for this reason.
