import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type AnimationHandle, DURATION, EASING } from '../../utils/animate';
import { cn } from '../../utils/cn';

/**
 * The track is the host, styled through `host`, with the fill inside.
 * Angular gives a component's host every static attribute the app writes on
 * it, so a class on <ui-progress> lands on the host whatever the component
 * does: with a styled track inside as well, a margin applied twice.
 */
@Component({
  selector: 'ui-progress',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'trackClass()' },
  // While indeterminate, the fill slides by a CSS animation the platform
  // runs, not `animate()`: Lynx's own animator ticks on the thread Angular
  // runs on, so the bar stood still for as long as Angular was busy, which is
  // when it's shown. `enable-new-animator` false hands an element's
  // `@keyframes` to Core Animation on iOS, which runs them in the render
  // server, and to Android's animators on the UI thread, and Android moves
  // only a view of its own (`flatten` false). But `animate()` does nothing on
  // such an element, and the value's width change needs it (Core Animation
  // can't change a Lynx element's width: its background takes the new size
  // at once), and Lynx picks the animator as an animation is set. So each mode
  // has a fill of its own, made with its animator: the bar still holds one
  // fill, and `fillRef` is the one shown. The web preview ignores the
  // attribute, and the browser runs the animation.
  template: `
    @if (indeterminate()) {
      <view
        #fill
        enable-new-animator="false"
        flatten="false"
        [class]="fillClass()"
        [style]="fillStyle()"
      />
    } @else {
      <view #fill [class]="fillClass()" [style]="fillStyle()" />
    }
  `,
  // In the component, not the theme, so an app that copies the bar gets them
  // with it. The fill is 40% of the track's width, and a `translateX`
  // percentage is of the fill's own width, so -100% starts it just off the
  // track's left edge and 250% ends it just past the right.
  styles: `
    @keyframes ui-progress-slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(250%);
      }
    }
  `,
})
export class UiProgress {
  readonly value = input(0);
  readonly max = input(100);
  /**
   * When true, shows an indeterminate (looping) animation
   */
  readonly indeterminate = input(false, { transform: booleanAttribute });
  readonly userClass = input<string>('', { alias: 'class' });

  readonly fillRef = viewChild.required<ElementRef>('fill');
  #fillAnim?: AnimationHandle;
  #previousPercent: number | null = null;

  /**
   * Animates the fill's width as the value changes. A field rather than a
   * constructor: Angular's test build keeps a function for a constructor that
   * nothing calls, which an app's coverage report would show as uncovered.
   */
  protected readonly fillAnimation = effect(() => {
    // The indeterminate fill slides by CSS (see the template and fillStyle).
    // A width animation running as the bar went indeterminate ran on the
    // fill it left, which has gone with it. The fill that comes back is made
    // at the value's width: native Lynx drops an animation on an element it
    // hasn't drawn yet, and `fillRef` still holds the fill that left until
    // change detection is through (effects run before the queries update),
    // so the next run records the value, as on the first.
    if (this.indeterminate()) {
      this.#fillAnim = undefined;
      this.#previousPercent = null;
      return;
    }

    // Determinate mode — animate width changes smoothly.
    // `#previousPercent === null` skips the very first effect run so
    // the bar doesn't animate from 0% → initial value on mount, nor as it
    // comes back from indeterminate. After that, it only runs again when the
    // percent changes or the bar goes indeterminate: `percent` is a computed,
    // so a value and max that give the same percent don't run it.
    const percent = this.percent();
    if (this.#previousPercent === null) {
      this.#previousPercent = percent;
      return;
    }

    this.#fillAnim?.cancel();
    this.#fillAnim = this.fillRef().nativeElement.animate(
      [{ width: `${this.#previousPercent}%` }, { width: `${percent}%` }],
      { duration: DURATION.slow, easing: EASING.standard, fill: 'forwards' },
    );
    this.#previousPercent = percent;
  });

  protected readonly percent = computed(() => {
    const m = this.max();
    if (m <= 0) return 0;
    return Math.min(100, Math.max(0, (this.value() / m) * 100));
  });

  protected readonly trackClass = computed(() =>
    cn(
      // bg-muted (solid, theme-aware) instead of bg-primary/20: a modifier
      // needs the theme's --primary-rgb, and in a theme copied before it
      // existed the track would disappear.
      'h-2 w-full rounded-full bg-muted overflow-hidden',
      this.userClass(),
    ),
  );

  protected readonly fillClass = computed(() =>
    cn('h-full rounded-full bg-primary'),
  );

  // The 40% width is an inline style, not a keyframe: an animator that has a
  // layout property such as `width` among an animation's keyframes, even one
  // that never changes, resolves styles and lays the page out again on every
  // frame for as long as the loop runs. A `translateX` in % alone skips both
  // (see investigations/lynx-vs-web-differences.md). The slide is inline too,
  // so the fill's classes are the same in both modes.
  protected readonly fillStyle = computed(() =>
    this.indeterminate()
      ? `width: 40%; animation: ui-progress-slide 1200ms ${EASING.standard} infinite;`
      : `width: ${this.percent()}%;`,
  );
}
