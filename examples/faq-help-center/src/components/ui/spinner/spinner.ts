import {
  type ElementRef,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

const LOADER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg>`;

const SIZE_MAP = { xs: 16, sm: 20, md: 24, lg: 32 } as const;

@Component({
  selector: 'ui-spinner',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  // SVG markup is passed via [attr.content] rather than as child elements.
  // Lynx's native <svg> element can't contain child nodes in the flat element
  // model — the renderer doesn't support nested SVG elements. Passing the full
  // SVG markup string as the `content` attribute is the Lynx-native way to
  // embed vector graphics.
  template: `
    <view #spinner [style]="sizeStyle()">
      <svg [attr.content]="svgContent()" style="width: 100%; height: 100%;" />
    </view>
  `,
})
export class UiSpinner {
  readonly size = input<'xs' | 'sm' | 'md' | 'lg'>('md');
  readonly color = input<string | undefined>(undefined);

  readonly spinnerRef = viewChild<ElementRef>('spinner');

  constructor() {
    effect(() => {
      const el = this.spinnerRef()?.nativeElement;
      if (!el) return;
      el.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        {
          duration: 1600,
          iterations: Infinity,
          easing: 'linear',
        },
      );
    });
  }

  protected readonly svgContent = computed(() => {
    const c = this.color();
    if (c) {
      // Lynx SVG elements don't inherit the CSS `color` property into their
      // stroke attributes, so we substitute the literal `currentColor` in the
      // SVG string rather than relying on `currentColor` propagation via CSS.
      //
      // Uses split().join() instead of String.prototype.replaceAll(). replaceAll
      // is ES2021, but Lynx's main thread runs on PrimJS at an ES2019 target;
      // because it's a runtime method (not syntax) the build's down-leveling does
      // not polyfill it, so it simply doesn't exist there. Calling it throws
      // "main-thread.js exception: not a function" from inside Angular change
      // detection, which aborts the whole tick before Lynx flushes the element
      // tree — so the spinner never paints, and the error count climbs on every
      // render as each tick re-runs and re-throws. split/join is ES2019-safe and
      // is preferred over `replace(/.../g)` here because the search term is a
      // plain literal and needs no regex escaping.
      return LOADER_SVG.split('currentColor').join(c);
    }
    return LOADER_SVG;
  });

  protected readonly sizeStyle = computed(() => {
    const px = SIZE_MAP[this.size()];
    return `width: ${px}px; height: ${px}px;`;
  });
}
