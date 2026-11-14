import {
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
} from '@angular/core';
import { registerHostElement } from '@blotch/angular-lynx';

import { cn } from '@blotch/dolan/utils/cn';
import { type IconSize, UI_ICON_SIZE, injectIconColor } from './icon-theme';
import { type IconName, iconMarkup, paintIcon } from './icons';

const SIZE_MAP: Readonly<Record<IconSize, number>> = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
};

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
 *
 * It draws an icon from the set (`name`) or the app's own markup (`svg`),
 * such as a sign-in provider's mark, which the set can't hold.
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
  /** An icon from the set (see `ICONS`). Give this or `svg`. */
  readonly name = input<IconName | undefined>(undefined);
  /**
   * SVG markup to draw instead of an icon from the set. `currentColor` in it
   * takes the icon's color, as in the set's icons, so a one-color mark
   * follows the theme; colors written out stay, so a multi-color one keeps
   * them. Give this or `name`.
   */
  readonly svg = input<string | undefined>(undefined);
  /**
   * 16, 20, 24 or 32px. Without one, the icon takes the size its container
   * sets (see `UI_ICON_SIZE`), such as a button's for its size, then 24px.
   */
  readonly size = input<IconSize | undefined>(undefined);
  /**
   * A literal color or a theme token (`var(--primary)`). Without one, the icon
   * takes the color its container sets (see `UI_ICON_COLOR`), then the theme's
   * foreground.
   */
  readonly color = input<string | undefined>(undefined);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #resolveColor = injectIconColor();
  readonly #inheritedSize = inject(UI_ICON_SIZE, { optional: true });

  /**
   * The markup, in its color. `currentColor` in it is written over with the
   * color, resolved first: Lynx's SVG engines don't take `color` from the
   * element, and can't read `var(--x)` either (see icon-theme.ts).
   */
  protected svgContent(): string {
    return paintIcon(
      iconMarkup(
        this.name(),
        this.svg(),
        '<ui-icon> needs a name or an svg, not both.',
      ),
      this.#resolveColor(this.color()),
    );
  }

  protected readonly sizePx = computed(
    () => SIZE_MAP[this.size() ?? this.#inheritedSize?.() ?? 'md'],
  );

  protected readonly svgClass = computed(() => cn(this.userClass()));
}

registerHostElement(UiIcon, 'svg');
