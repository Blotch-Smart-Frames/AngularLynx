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

By default Lynx doesn't hand animations to Core Animation or a compositor. It works out every frame of `animate()` and of CSS transitions itself, on the main thread, where Angular runs too (in Lynx Explorer that's also the UI thread; the apps `ng build --platform` makes give it a thread of its own). A frame the thread spends on something else is dropped, so:

- **Animate `transform` and `opacity`.** Lynx skips layout for them, with a translate in `px` or `%`. `height`, `width`, colors, `filter`, and a translate in `rem`, `em`, `vw` or `vh` lay the page out again on every frame.
- **Keep the main thread free while something moves:** build the next screen before its transition starts, not during it.
- **Or hand the element's transitions to the platform** (below), so they keep moving while the thread is busy. `<lynx-stack-outlet>` moves its screens that way, and `ui-bottom-sheet` its sheet; `ui-spinner`, `ui-skeleton` and an indeterminate `ui-progress` run their loops there.
- **Judge it on a phone.** The iOS Simulator and the Android emulator run on the Mac's CPU and hold 60 fps where a phone drops frames.

On a ProMotion iPhone, apps that `ng build --platform ios` builds animate at up to 120 fps: the app's Info.plist has `CADisableMinimumFrameDurationOnPhone`, the build asks Lynx's animator for 120 (`preferredFps`, `'high'` by default), which the app asks for again from the UI thread while that animator runs (iOS doesn't raise the display's rate for Lynx's own display link, which lives on the engine thread), and the app asks Core Animation for 80 to 120 on each transition it runs (below). `pluginAngularLynx({ preferredFps: 'auto' })` in `lynx.config.ts` leaves Lynx's animator to the system, which holds an iPhone to 60; it doesn't change Core Animation's. A host app that embeds a LynxView needs the Info.plist key itself. Android draws at the screen's rate either way.

### Transitions that keep moving while Angular works

`enable-new-animator="false"` on an element hands its CSS transitions and `@keyframes` to the platform: Core Animation on iOS, which runs them in the render server, and Android's animators. A transition there keeps moving while the main thread is busy, as UIKit's own do. Set it, with `flatten="false"` (Android animates a `transform` only on a view of its own), on the element itself, as it's made:

```html
<view
  enable-new-animator="false"
  flatten="false"
  class="panel"
  [style.transform]="open() ? 'translateY(0px)' : 'translateY(100%)'"
  style="transition: transform 350ms cubic-bezier(0.32, 0.72, 0, 1)"
></view>
```

- **`animate()` does nothing on such an element.** Move it with `transition` and `@keyframes` only. Don't turn Lynx's animator off for the whole app (the page config `enableNewAnimator`): every `animate()` in it stops.
- **On iOS, `transform`, `opacity`, `background-color`, `visibility`, and the frame (`left`, `right`, `top`, `bottom`, `width`, `height`)** transition. But the element's background and its children take a new size at once, so move it by `transform`: `ui-bottom-sheet` moves between detents laid out at the taller one, and translated.
- **On iOS, start one with `afterFrame(callback)`** (from `@blotch/angular-lynx`), which runs it on the turn after a frame, once nothing else is waiting. Core Animation begins a transition at the time of the last frame the thread saw, so one started straight after a busy turn (building a screen) is partway through by the time it's drawn. `<lynx-stack-outlet>` and `ui-bottom-sheet` start their moves from it.
- **One that ends while Angular is busy draws the page as Angular has left it so far, on iOS:** with a tab built for 800 ms, a slide that ended 350 ms in showed the tab left already hidden and the next not yet there, so nothing at all. Hide or remove what's being replaced last, once what replaces it is in place, as `<lynx-tab-outlet>` does.
- **A new `transform` mid-transition jumps on iOS:** the running one ends at its end first. Opacity and the frame carry on from where they are. Taking the `transition` away ends a running one where it was going, on iOS and Android.
- **A loop (`animation: … infinite`) keeps going there too,** which is what a loading indicator needs: it shows while Angular builds a screen. `ui-spinner`, `ui-skeleton` and an indeterminate `ui-progress` run theirs so, with the `@keyframes` in the component's `styles`. `ui-skeleton`'s runs on its host, so `animate()` on a `<ui-skeleton>` does nothing on iOS or Android: wrap it in a `<view>` to fade or move it. (`<ui-spinner>` turns a view inside it, so its host still takes `animate()`.) A `rotate(0deg)` to `rotate(360deg)` turns a full turn on iOS as well (Lynx animates `transform.rotation.z` for half a turn or more, rather than two equal matrices). Show a loop with `@if` and let it go the same way: when Angular destroys an element with `enable-new-animator="false"`, the runtime ends its animation first, because on iOS Lynx's animator otherwise puts a loop whose view has gone back on its layer every frame for the life of the app. The runtime doesn't end the loop of one Angular keeps (hidden, or in a view detached to put back later).
- **On a ProMotion iPhone they run at up to 120 fps** in apps that `ng build --platform ios` builds: Lynx asks Core Animation for no rate, which iOS runs at 60, so the app asks for 80 to 120 on each animation it adds. One that repeats forever (`infinite`) keeps the system's rate, 60, which saves battery on a spinner. A host app that embeds a LynxView runs them at 60.
- **Lynx for Web ignores the attribute;** the browser runs the transition.

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
