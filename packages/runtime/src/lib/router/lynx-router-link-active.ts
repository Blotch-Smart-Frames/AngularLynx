import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  InjectionToken,
  type OutputRef,
} from '@angular/core';
import type { BaseLynxElement } from '../lynx-element/types';

/**
 * Finds the `isActiveChange` output of Angular's `RouterLinkActive` on the
 * element being created, or null if it has none. Called in the injection
 * context of that element's LynxRouterLinkActive.
 *
 * `provideRouter()` provides it, rather than LynxRouterLinkActive importing
 * `RouterLinkActive` itself, because LynxRouterLinkActive is part of
 * LYNX_ELEMENTS, which every component imports: referring to the router from
 * there would put the whole router in the bundle of an app without routes.
 * Without `provideRouter()` there's no router to follow, and the token is
 * missing.
 */
export const ROUTER_LINK_ACTIVE_CHANGE = new InjectionToken<
  () => OutputRef<boolean> | null
>('router-link-active-change');

/**
 * Tells screen readers which router link is the current one: while Angular's
 * `RouterLinkActive` on the same element says its route is active, the
 * element has the `selected` accessibility trait, as the selected tab of a
 * native tab bar does. On the web, `routerLinkActive` only changes classes, or
 * `aria-current` with `ariaCurrentWhenActive`; Lynx elements have no ARIA,
 * and `accessibility-traits` is how they say this.
 *
 * It keeps the element's own traits: `accessibility-traits="button"` becomes
 * `button,selected` while the link is active. On Android, which reads one
 * trait and has no selected trait, the element keeps its own traits as they
 * are.
 *
 * It's part of LYNX_ELEMENTS, so a component that imports LYNX_ELEMENTS and
 * Angular's `RouterLinkActive` gets it on every `routerLinkActive` element.
 * To add it to a component's host instead, list it in `hostDirectives` next
 * to `RouterLinkActive`.
 *
 * @usageNotes
 * ```ts
 * @Component({
 *   imports: [LYNX_ELEMENTS, RouterLink, RouterLinkActive],
 *   template: `
 *     <view routerLink="/settings" routerLinkActive="active">
 *       <text>Settings</text>
 *     </view>
 *   `,
 * })
 * ```
 */
@Directive({ selector: '[routerLinkActive]' })
export class LynxRouterLinkActive {
  constructor() {
    const activeChange = inject(ROUTER_LINK_ACTIVE_CHANGE, {
      optional: true,
    })?.();
    if (!activeChange) return;
    const element: BaseLynxElement = inject(ElementRef).nativeElement;
    const subscription = activeChange.subscribe((active) =>
      element.setAccessibilityTrait('selected', active),
    );
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }
}
