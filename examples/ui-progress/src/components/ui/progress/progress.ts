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

import {
  type AnimationHandle,
  DURATION,
  EASING,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';

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
  // While indeterminate, a fill of its own slides across the track, by a CSS
  // animation the platform runs, not `animate()`: Lynx's own animator ticks
  // on the thread Angular runs on, so the bar stood still for as long as
  // Angular was busy, which is when it's shown. `enable-new-animator` false
  // hands an element's `@keyframes` to Core Animation on iOS, which runs them
  // in the render server, and to Android's animators on the UI thread, and
  // Android moves only a view of its own (`flatten` false). Lynx picks the
  // animator as an animation is set, so the attributes are static, there from
  // the moment the fill is made. The web preview ignores the attribute, and
  // the browser runs the animation.
  //
  // The value's fill (`fillRef`) stays the same element throughout, hidden
  // while indeterminate: `animate()`, which grows and shrinks it as the value
  // changes, does nothing on an element the platform animates (and Core
  // Animation can't change a Lynx element's width: its background takes the
  // new size at once). It comes first, so the sliding fill takes its place
  // in the track while it's hidden.
  template: `
    <view #fill [class]="fillClass()" [style]="fillStyle()" />
    @if (indeterminate()) {
      <view
        enable-new-animator="false"
        flatten="false"
        [class]="fillClass()"
        [style]="slideStyle"
      />
    }
  `,
  // In the component, not the theme, so an app that copies the bar gets them
  // with it. The sliding fill is 40% of the track's width, and a `translateX`
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
   * Animates the value's fill as the value changes. A field rather than a
   * constructor: Angular's test build keeps a function for a constructor that
   * nothing calls, which an app's coverage report would show as uncovered.
   */
  protected readonly fillAnimation = effect(() => {
    const el = this.fillRef().nativeElement;

    // While indeterminate, the value's fill is hidden, and a fill of its own
    // slides (see the template).
    if (this.indeterminate()) {
      this.#fillAnim?.cancel();
      return;
    }

    // Determinate mode — animate width changes smoothly.
    // `#previousPercent === null` skips the very first effect run so
    // the bar doesn't animate from 0% → initial value on mount.
    // The equality guard skips the animation when the effect re-runs without
    // a percent change: leaving indeterminate mode at the same value. Left at
    // another value, the fill grows or shrinks from the last value it showed.
    const percent = this.percent();
    if (this.#previousPercent === null) {
      this.#previousPercent = percent;
      return;
    }
    if (percent === this.#previousPercent) return;

    this.#fillAnim?.cancel();
    this.#fillAnim = el.animate(
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

  // `display: none` while indeterminate, rather than leaving the template:
  // the same element comes back, which animates from the last value it
  // showed.
  protected readonly fillStyle = computed(
    () =>
      `width: ${this.percent()}%;${this.indeterminate() ? ' display: none;' : ''}`,
  );

  // The 40% width is an inline style, not a keyframe: an animator that has a
  // layout property such as `width` among an animation's keyframes, even one
  // that never changes, resolves styles and lays the page out again on every
  // frame for as long as the loop runs. A `translateX` in % alone skips both
  // (see investigations/lynx-vs-web-differences.md).
  protected readonly slideStyle = `width: 40%; animation: ui-progress-slide 1200ms ${EASING.standard} infinite;`;
}
