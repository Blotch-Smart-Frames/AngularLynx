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
 * (`bg-primary/10`), which becomes `rgba(var(--primary-rgb), 0.1)` (issue
 * #115): through the theme's plugin on Tailwind 3, and on Tailwind 4 through
 * the build, which rewrites Tailwind's color-mix() (issue #116), so it also
 * shows Tailwind 4's CSS reached the app. It shares the element so the
 * page gets no taller: CI's small Android emulator has no room to spare.
 *
 * Its `dark:` color applies while the app is drawn dark. Tailwind writes the
 * variant as a `prefers-color-scheme` query, which Lynx drops, and the build
 * turns it into a rule under `page.dark` (issue #460).
 *
 * Its `group-ui-open:` variant is Lynx's, from @lynx-js/tailwind-preset on
 * Tailwind 3 and @blotch/angular-lynx/tailwind.css on Tailwind 4, which the
 * app imports from the installed package (issue #461). Tailwind 4 writes it
 * with `:where(.group)`, which the build inlines for Lynx.
 */
@Component({
  selector: 'app-tailwind-card',
  imports: [LYNX_ELEMENTS],
  templateUrl: './tailwind-card.html',
})
export class TailwindCard {}
