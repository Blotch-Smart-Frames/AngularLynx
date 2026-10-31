import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { registerHostElement } from '@blotch/angular-lynx';

import { cn } from '@blotch/dolan/utils/cn';
import { injectIconColor } from './icon-theme';
import { type IconName, ICONS } from './icons';

const SIZE_MAP = { xs: 16, sm: 20, md: 24, lg: 32 } as const;

/**
 * The icon is its host, an `<svg>` (registerHostElement, below). Angular gives
 * a component's host every static attribute the app writes on it, so
 * `<ui-icon class="mb-3">` puts `mb-3` on the host whatever the component
 * does: with a styled `<svg>` inside a view host as well, the margin applied
 * twice.
 *
 * SVG markup is passed via [attr.content] rather than as child elements.
 * Lynx's native <svg> element can't contain child nodes in the flat element
 * model. Passing the full SVG string as the `content` attribute is how Lynx
 * renders vector graphics without a DOM tree.
 */
@Component({
  selector: 'ui-icon',
  encapsulation: ViewEncapsulation.None,
  host: {
    '[attr.content]': 'svgContent()',
    '[style.width.px]': 'sizePx()',
    '[style.height.px]': 'sizePx()',
    '[class]': 'svgClass()',
  },
  template: '',
})
export class UiIcon {
  readonly name = input.required<IconName>();
  readonly size = input<'xs' | 'sm' | 'md' | 'lg'>('md');
  /**
   * A literal color or a theme token (`var(--primary)`). Without one, the icon
   * takes the color its container sets (see `UI_ICON_COLOR`), then the theme's
   * foreground.
   */
  readonly color = input<string | undefined>(undefined);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #resolveColor = injectIconColor();

  protected svgContent(): string {
    // Lynx SVG elements don't propagate the CSS `color` property into SVG
    // stroke attributes, so we substitute the literal `currentColor` in the
    // markup string rather than relying on `currentColor` CSS propagation.
    // The color is resolved first: the SVG parser can't read `var(--x)` either
    // (see icon-theme.ts).
    //
    // Uses split().join() instead of String.prototype.replaceAll(). replaceAll
    // is ES2021, but Lynx's main thread runs on PrimJS at an ES2019 target;
    // because it's a runtime method (not syntax) the build's down-leveling does
    // not polyfill it, so it simply doesn't exist there. Calling it throws
    // "main-thread.js exception: not a function" from inside Angular change
    // detection, which aborts the whole tick before Lynx flushes the element
    // tree — so NO icon paints (not just a colored one), and the error count
    // climbs on every render/interaction as each tick re-runs and re-throws.
    // split/join is ES2019-safe and is preferred over `replace(/.../g)` here
    // because the search term is a plain literal and needs no regex escaping.
    return ICONS[this.name()]
      .split('currentColor')
      .join(this.#resolveColor(this.color()));
  }

  protected readonly sizePx = computed(() => SIZE_MAP[this.size()]);

  protected readonly svgClass = computed(() => cn(this.userClass()));
}

registerHostElement(UiIcon, 'svg');
