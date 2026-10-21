import { Component, ViewEncapsulation, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { type IconName, ICONS } from './icons';

const SIZE_MAP = { xs: 16, sm: 20, md: 24, lg: 32 } as const;

/**
 * SVG markup is passed via [attr.content] rather than as child elements.
 * Lynx's native <svg> element can't contain child nodes in the flat element
 * model. Passing the full SVG string as the `content` attribute is how Lynx
 * renders vector graphics without a DOM tree.
 */
@Component({
  selector: 'ui-icon',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <svg [attr.content]="svgContent()" [attr.style]="sizeStyle()" />
  `,
})
export class UiIcon {
  readonly name = input.required<IconName>();
  readonly size = input<'xs' | 'sm' | 'md' | 'lg'>('md');
  readonly color = input<string | undefined>(undefined);

  protected svgContent(): string {
    let svg = ICONS[this.name()];
    const c = this.color();
    if (c) {
      // Lynx SVG elements don't propagate the CSS `color` property into SVG
      // stroke attributes, so we substitute the literal `currentColor` in the
      // markup string rather than relying on `currentColor` CSS propagation.
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
      svg = svg.split('currentColor').join(c);
    }
    return svg;
  }

  protected sizeStyle(): string {
    const px = SIZE_MAP[this.size()];
    return `width: ${px}px; height: ${px}px;`;
  }
}
