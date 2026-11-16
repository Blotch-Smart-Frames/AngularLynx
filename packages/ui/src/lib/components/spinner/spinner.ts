import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { injectIconColor } from '../icon/icon-theme';

const LOADER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg>`;

const SIZE_MAP = { xs: 16, sm: 20, md: 24, lg: 32 } as const;

@Component({
  selector: 'ui-spinner',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // The host is the box, sized and styled through `host`, with the drawing
  // inside. Angular gives a component's host every static attribute the app
  // writes on it, so a class on <ui-spinner> lands on the host whatever the
  // component does: with a styled box inside as well, a margin applied twice.
  //
  // SVG markup is passed via [attr.content] rather than as child elements.
  // Lynx's native <svg> element can't contain child nodes in the flat element
  // model — the renderer doesn't support nested SVG elements. Passing the full
  // SVG markup string as the `content` attribute is the Lynx-native way to
  // embed vector graphics.
  //
  // The view around the drawing turns, by a CSS animation the platform runs,
  // not `animate()`: Lynx's own animator ticks on the thread Angular runs on,
  // so a spinner froze for as long as Angular was busy building a screen,
  // which is when it's shown. `enable-new-animator` false hands the view's
  // `@keyframes` to Core Animation on iOS, which runs them in the render
  // server, and to Android's animators on the UI thread. Lynx picks the
  // animator as the animation is set, so the attribute is static, there from
  // the moment the view is made. Android rotates only a view of its own
  // (`flatten` false). The web preview ignores the attribute, and the browser
  // runs the animation.
  //
  // Not the host: `animate()` does nothing on an element the platform
  // animates, and an app may animate the spinner it shows (a fade in or out),
  // so the host stays on Lynx's animator. The view fills the host.
  host: {
    '[class]': 'containerClass()',
    '[style]': 'sizeStyle()',
  },
  // In the component, not the theme, so an app that copies the spinner gets
  // them with it. Lynx's iOS animator turns a rotation of half a turn or more
  // by `transform.rotation.z`, so 0deg to 360deg turns there, as it does on
  // Android (`View.setRotation`) and the web.
  styles: `
    @keyframes ui-spinner-turn {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  `,
  template: `
    <view
      enable-new-animator="false"
      flatten="false"
      style="width: 100%; height: 100%; animation: ui-spinner-turn 1600ms linear infinite;"
    >
      <svg [attr.content]="svgContent()" style="width: 100%; height: 100%;" />
    </view>
  `,
})
export class UiSpinner {
  readonly size = input<'xs' | 'sm' | 'md' | 'lg'>('md');
  /**
   * A literal color or a theme token (`var(--primary)`). Without one, the
   * spinner takes the color its container sets (see `UI_ICON_COLOR`), then the
   * theme's foreground.
   */
  readonly color = input<string | undefined>(undefined);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #resolveColor = injectIconColor();

  // Lynx SVG elements don't inherit the CSS `color` property into their stroke
  // attributes, so we substitute the literal `currentColor` in the SVG string
  // rather than relying on `currentColor` propagation via CSS. The color is
  // resolved first: the SVG parser can't read `var(--x)` either (see
  // icon-theme.ts).
  //
  // Uses split().join() instead of String.prototype.replaceAll(). replaceAll is
  // ES2021, but Lynx's main thread runs on PrimJS at an ES2019 target; because
  // it's a runtime method (not syntax) the build's down-leveling does not
  // polyfill it, so it simply doesn't exist there. Calling it throws
  // "main-thread.js exception: not a function" from inside Angular change
  // detection, which aborts the whole tick before Lynx flushes the element tree
  // — so the spinner never paints, and the error count climbs on every render
  // as each tick re-runs and re-throws. split/join is ES2019-safe and is
  // preferred over `replace(/.../g)` here because the search term is a plain
  // literal and needs no regex escaping.
  protected readonly svgContent = computed(() =>
    LOADER_SVG.split('currentColor').join(this.#resolveColor(this.color())),
  );

  protected readonly containerClass = computed(() => cn(this.userClass()));

  protected readonly sizeStyle = computed(() => {
    const px = SIZE_MAP[this.size()];
    return `width: ${px}px; height: ${px}px;`;
  });
}
