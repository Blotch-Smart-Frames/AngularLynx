# Routing

## Setup

Routing is configured via `provideRouter(routes)` in app config:

```typescript
import { provideRouter } from '@blotch/angular-lynx';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    // ...
  ],
};
```

This provides:

- `LynxLocationStrategy` — in-memory routing (Lynx has no browser History API or URL bar)
- `withRouterConfig({ resolveNavigationPromiseOnError: true })` — prevents background thread crashes from unhandled navigation errors

## Route Definitions

```typescript
import type { Routes } from '@angular/router';

export const routes: Routes = [
  // Always define a default redirect — empty path causes NavigationError which crashes the background thread
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomeComponent },
  // Lazy loading works
  {
    path: 'detail',
    loadComponent: () =>
      import('./detail/detail.component').then((m) => m.DetailComponent),
  },
];
```

## Navigation

Use Angular's own `routerLink` and `routerLinkActive` from `@angular/router`, on any element:

```typescript
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  imports: [LYNX_ELEMENTS, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <view routerLink="/detail" routerLinkActive="bg-accent">
      <text>View Detail</text>
    </view>
    <router-outlet />
  `,
})
export class NavComponent {}
```

- `RouterLink` listens for `click`. The renderer delivers a Lynx tap to `click` listeners (as Lynx for Web maps them), so a tap navigates. A `(bindtap)` on the same element runs too: the renderer registers one native handler per event that runs every listener.
- `routerLinkActive` adds its classes as on the web, and `LYNX_ELEMENTS` (through `LynxRouterLinkActive`) adds `selected` to the element's `accessibility-traits` while the route is active, keeping the element's own traits (`button` becomes `button,selected`). Android reads a single trait and has no selected trait, so its traits are left alone there. Read the state with `#link="routerLinkActive"` and `link.isActive`.
- On a component's host, use `hostDirectives: [RouterLink, RouterLinkActive, LynxRouterLinkActive]`: host directives don't match selectors, so `LYNX_ELEMENTS` can't add `LynxRouterLinkActive` there.
- `LynxRouterLinkActive` finds `RouterLinkActive` through a token that `provideRouter()` from `@blotch/angular-lynx` provides, so `LYNX_ELEMENTS` doesn't pull the router into apps without routes.
- For tabs along the bottom of the screen, don't build them by hand: `npx @blotch/dolan add tab-bar` adds `<ui-tab-bar>` with `<ui-tab-bar-item route="/inbox" icon="inbox" label="Inbox" [badge]="unread()" />` items, built on these directives (`routerLinkActiveOptions` and `RouterLink`'s inputs pass through). It pads for the bottom safe area and marks the active tab `selected`. For the Liquid Glass form, `npx @blotch/dolan add dock` adds `<ui-dock>` with `<ui-dock-item>`s (the same inputs), a `<ui-dock-action>` button and a `ui-dock-accessory` slot; `ui-dock-scroll` on a screen's `<scroll-view>` minimizes it as content scrolls down. With a `<ui-search-field>` in the dock too (`npx @blotch/dolan add search-field`), the action opens a search field across the bottom of the screen, as iOS 26 searches: a search tab with a `route`, or a field over the current screen without one (`UiDockState.searching`), rising above the keyboard.
- For a screen's top bar, `npx @blotch/dolan add navigation-bar` adds `<ui-navigation-bar title="Notes" largeTitle>` with `<ui-toolbar-item>`s and `<ui-toolbar-group>`s at its trailing end (or after the Back button with `leading`). Its Back button shows while `LynxLocationStrategy.canGoBack()` is true and calls `Location.back()`, so guards run; `backRoute="/notes"` covers a screen the app opened on, and `backButtonHidden` a tab's first screen. Put `ui-bar-scroll` on the screen's `<scroll-view>`: the content starts below the bar, the large title scrolls with it, and content fades under glass bars. `npx @blotch/dolan add toolbar` adds `<ui-toolbar>` for actions along the bottom.

Navigate from code with `Router` directly, also inside an event handler:

```typescript
goToDetail(): void {
  this.#router.navigateByUrl('/detail');
}
```

Angular's router builds the next screen after the handler returns. Changing the element tree inside a handler is safe anyway: measured on Lynx 4.1 (iOS, Android, web), handlers that create, remove and flush elements don't crash. Don't wrap navigation in `setTimeout`.

## Route Reuse

Leaving a route destroys its component, as on the web: `provideRouter` keeps Angular's own `RouteReuseStrategy`. To keep every visited route's component and state alive instead (no `ngOnDestroy`, nothing evicted), opt in:

```typescript
providers: [
  provideRouter(routes),
  { provide: RouteReuseStrategy, useClass: LynxRouteReuseStrategy },
];
```

It doesn't save native elements: a reattached route rebuilds them. Lynx 4.1 has no ~256-slot element pool limit (measured on iOS and Android).

## Router Outlet

`<router-outlet>` works as normal. Place it inside a sized container:

```html
<view style="height: 300px; overflow: hidden;">
  <router-outlet />
</view>
```

## Key Differences from Web Routing

- **No URL bar** — users can't type URLs. All navigation goes through `routerLink` or the `Router`.
- **No browser back button** — use `Location.back()`. In the Android app `ng build --platform android` makes, the system back button goes back a screen through the router (and leaves the app from the first one).
- **In-memory only** — the URL state exists only in `LynxLocationStrategy`'s internal signal. There's no `window.location` or `history.pushState`.
