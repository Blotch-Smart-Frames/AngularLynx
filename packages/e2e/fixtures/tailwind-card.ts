import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * E2E fixture with a separate `.html` template, the kind `ng generate
 * component` writes. Its Tailwind class is an arbitrary value that appears
 * nowhere else in the app, so the render tests only see its color if
 * Tailwind read the template itself. The build once handed Tailwind the
 * bundle's modules instead of `content`, and a template isn't a module.
 *
 * Its background is a UI theme color with an opacity modifier
 * (`bg-primary/10`), which the theme's plugin turns into
 * `rgba(var(--primary-rgb), 0.1)` (issue #115). It shares the element so the
 * page gets no taller: CI's small Android emulator has no room to spare.
 */
@Component({
  selector: 'app-tailwind-card',
  imports: [LYNX_ELEMENTS],
  templateUrl: './tailwind-card.html',
})
export class TailwindCard {}
