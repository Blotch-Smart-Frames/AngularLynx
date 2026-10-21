import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * E2E fixture with a separate `.html` template, the kind `ng generate
 * component` writes. Its Tailwind class is an arbitrary value that appears
 * nowhere else in the app, so the render tests only see its color if
 * Tailwind read the template itself. The build once handed Tailwind the
 * bundle's modules instead of `content`, and a template isn't a module.
 */
@Component({
  selector: 'app-tailwind-card',
  imports: [LYNX_ELEMENTS],
  templateUrl: './tailwind-card.html',
})
export class TailwindCard {}
