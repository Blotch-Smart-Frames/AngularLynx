import { Component, ViewEncapsulation, computed, input } from '@angular/core';

import { cn } from '../../utils/cn';

/**
 * The skeleton is its host, styled through `host`. Angular gives a
 * component's host every static attribute the app writes on it, so a class on
 * <ui-skeleton> lands on the host whatever the component does: with a styled
 * view inside as well, a margin applied twice, and the placeholder's size had
 * to be set on both.
 *
 * It pulses by a CSS animation the platform runs, not `animate()`: Lynx's own
 * animator ticks on the thread Angular runs on, so a skeleton stood still for
 * as long as Angular was busy building a screen, which is when it's shown.
 * `enable-new-animator` false hands the host's `@keyframes` to Core Animation
 * on iOS, which runs them in the render server, and to Android's animators on
 * the UI thread. Lynx picks the animator as the animation is set, so the
 * attribute is static, there from the moment the host is made. Android
 * animates only a view of its own (`flatten` false). The web preview ignores
 * the attribute, and the browser runs the animation.
 */
@Component({
  selector: 'ui-skeleton',
  encapsulation: ViewEncapsulation.None,
  host: {
    'enable-new-animator': 'false',
    flatten: 'false',
    '[class]': 'skeletonClass()',
  },
  // In the component, not the theme, so an app that copies the skeleton gets
  // them with it, and with no class on the host: `ui-skeleton` matches the
  // class the runtime gives the host for its tag. The opacity goes to half
  // and back every 1.5 s, easing in and out of each half.
  styles: `
    @keyframes ui-skeleton-pulse {
      0% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
      100% {
        opacity: 1;
      }
    }
    ui-skeleton {
      animation: ui-skeleton-pulse 1500ms ease-in-out infinite;
    }
  `,
  template: '',
})
export class UiSkeleton {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly skeletonClass = computed(() =>
    cn('rounded-md bg-muted', this.userClass()),
  );
}
