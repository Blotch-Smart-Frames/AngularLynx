import { Directive } from '@angular/core';

/**
 * Applied via `hostDirectives` to every routed screen (and the shared
 * `demo-screen` frame) so the screen fills the router-outlet's available height.
 *
 * Why this is needed: in Lynx an Angular component host is a real native element
 * and is the actual flex child of the router-outlet's container in `app.ts`
 * (`<view class="flex-1 flex-col flex">`). Angular inserts each routed component
 * as a sibling of `<router-outlet>`, and that host arrives unstyled — no
 * flex-grow, no height — so it collapses to its content. Any `scroll-view`
 * inside the screen then resolves its `h-full` against a content-sized ancestor,
 * and per Lynx's rule (see investigations/lynx-vs-web-differences.md,
 * "scroll-view requires an explicit height constraint to scroll") the
 * scroll-view expands to fit its content instead of scrolling.
 *
 * `flex-1` claims the routed area's height so the host has a definite height;
 * `flex flex-col` makes the host lay its root out vertically and stretch it to
 * full width (Lynx `align-items: stretch`). This is the same host-sizing lesson
 * already applied to `ui-nav-drawer-content` and `ui-tabs-content` — the flex
 * sizing must live on the host, not an inner wrapper.
 */
@Directive({
  host: {
    class: 'flex-1 flex-col flex',
  },
})
export class ScreenHost {}
