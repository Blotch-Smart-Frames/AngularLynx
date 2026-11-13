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

Use Angular's own `routerLink` and `routerLinkActive` from `@angular/router`, on any element, `<a>` included (it renders as a `<text>`, which `RouterLink` doesn't take for a browser link):

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
- For a screen's top bar, `npx @blotch/dolan add navigation-bar` adds `<ui-navigation-bar title="Notes" largeTitle>` with `<ui-toolbar-item>`s and `<ui-toolbar-group>`s at its trailing end (or after the Back button with `leading`). Its Back button shows while `LynxLocationStrategy.canGoBack()` is true and calls `Location.back()`, so guards run; `backRoute="/notes"` covers a screen the app opened on, and `backButtonHidden` a tab's first screen. Put `ui-bar-scroll` on the screen's `<scroll-view>`: the content starts below the bar, the large title scrolls with it, and content fades under glass bars. `npx @blotch/dolan add toolbar` adds `<ui-toolbar>` for actions along the bottom. The bars and `ui-bar-scroll` share a `UiBarState`: the root's, each `<lynx-stack-outlet>` screen's or `<lynx-tab-outlet>` tab's own (see below), or one a component provides (`providers: [UiBarState]`, for a sheet with its own bar). A bar of your own takes it with `injectBarState()`, not `inject(UiBarState)`.

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

## Stack Navigation (slide screens in and out)

`<router-outlet>` swaps screens at once. `<lynx-stack-outlet>` (`LynxStackOutlet`, from `@blotch/angular-lynx`) is a `RouterOutlet` that moves between them as native apps do: a pushed screen slides in over the last one (iOS: from the right with the display's rounded corners, the screen under it sliding a third left and dimming; Android: Android's activity slide and fade), Back slides it away, and a finger dragging it to the right takes it back (from the left edge, or anywhere that doesn't scroll sideways itself). Use it in place of `<router-outlet>`:

```typescript
import { LYNX_ELEMENTS, LynxStackOutlet } from '@blotch/angular-lynx';

@Component({
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  template: `<view class="bg-background flex h-full flex-col"
    ><lynx-stack-outlet
  /></view>`,
})
export class App {}
```

- Same inputs, outputs and behavior as `<router-outlet>` otherwise (`name`, `routerOutletData`, child routes, guards, `withComponentInputBinding()`). Going back, by a swipe too, navigates through the router, so `canDeactivate` runs; a refused swipe slides the screen back.
- The screens under the top one stay alive (their state and scroll position too). A component on one injects `LynxStackPage` and reads `active()` to pause work while it's covered. A kept screen's `ActivatedRoute` follows the route the router activates when the app comes back to it.
- The stack follows the URL: a deeper URL (`/notes/3` from `/notes`) pushes; a URL already in the stack pops back to it (Back, Android's back button, a swipe, or a `routerLink` to it, which takes `LynxLocationStrategy`'s history back with the stack rather than adding an entry: going back from there goes to the screen under it, and back on the stack's first screen `canGoBack()` is false); a URL the top one's is under slides in from behind; a URL at the same depth (`/settings` from `/home`, a tab bar) swaps at once; `replaceUrl: true` swaps the top screen at once. Override with the navigation's `info`, typed `StackNavigationInfo`: `[info]="{ stack: 'push' }"` on a `routerLink`, or `router.navigate(cmds, { info: { stack: 'root' } })` (`'push'`, `'pop'`, `'root'`).
- `animation="ios" | "material" | "none"` (default: Material on Android, iOS elsewhere, the web preview included); `'none'` swaps at once and turns the swipe off. `[swipeBack]="false"` turns only the swipe off. Reduce Motion makes a push or a pop cross-fade.
- A moving screen rounds only the corners in a corner of the screen (the LynxView): nested under an app bar or over a tab bar, its corners there stay square. Don't round the frames yourself.
- Each screen sits in a frame drawn on `var(--background, #ffffff)`, so the screen under it doesn't show through; `pageClass="bg-card"` styles the frames instead. The outlet fills its parent (`flex: 1`).
- A screen pushed over a stack's first screen takes the app's bottom bar away (`hidesBottomBarWhenPushed`, as Material does with its navigation bar), and it comes back as the screen goes. `@blotch/ui`'s `<ui-tab-bar>` and `<ui-dock>` do this by themselves: put a `<lynx-stack-outlet>` in each tab's component (the tab's route has children: `''` for its first screen, `':id'` for one it pushes), with the bar beside the app's `<lynx-tab-outlet>` (or `<router-outlet>`). On iOS the covered screen carries the bar (it's moved into that screen, as UIKit moves its tab bar), so the pushed screen slides over it with its rounded corner and shadow; on Android it slides down; it follows a swipe-back finger, and is hidden from screen readers and taps while away. A route says otherwise with `data: { bottomBar: 'visible' }` (keep it on a pushed screen) or `'hidden'` (take it from a first screen); `hideBottomBar="never"` on the outlet keeps it on every screen whose route doesn't say.
- A bar of your own gets carried the same way with `hostDirectives: [LynxStackBottomBar]` on its component: inject the directive and move the bar with its `progress()` and `motion()` (as below), which are `0` and still while a screen carries it (`carried()`), and hide it from screen readers and taps while `hidden()`. A screen carries it absolutely along its bottom and across its width, so the stack should reach the screen's bottom (a tab bar under the stack drops out of the layout while it's carried; a comment keeps its place). Only iOS motion carries it, and a popped screen doesn't, so the bar slides away by `progress` there.
- A bar can also read `LynxStackChrome` (root-injectable) directly, and slide away on its own: `bottomBarHidden()` (should be away; flips as a push or pop starts, not mid-drag), `bottomBarProgress()` (0 shown to 1 gone; follows a drag move by move, and jumps to the end value as a push or pop starts) and `bottomBarMotion()` (`{ animation, duration, easing, coveredX }`: use `transform ${duration}ms ${easing}` as the bar's CSS `transition` while `duration > 0`). Only the stack the app shows counts (a tab the router left doesn't), the innermost of nested stacks decides, and injected on a stack's screen it follows only the stacks on that screen. A screen that pads its end for a floating bar can drop it while `inject(LynxStackPage, { optional: true })?.bottomBarHidden()` is true; unlike the chrome's, it doesn't change while the screen is covered.
- Angular still reuses a component when only the params change (`/notes/1` to `/notes/2`): that updates in place, it doesn't push.
- A rightward drag of your own on a stacked screen (a `PanGesture` on a row, say) lost to the swipe back on iOS, `consume-slide-event` or not (seen on the iOS 27 Simulator): make in-screen drags go left, as a chat's swipe to reply does, or turn the swipe off with `[swipeBack]="false"`.
- In Lynx Explorer, a drag from the left edge goes to Explorer's own Back, not the app: swipe from inside the screen there. Apps built with `ng build --platform` have no such gesture.

## Tab Navigation (keep each tab alive)

With `<router-outlet>` beside a tab bar or dock, each tab switch destroys the tab left and builds the next from scratch, native views included (a `<canvas>` sets up WebGL again, a `<webview>` reloads). `<lynx-tab-outlet>` (`LynxTabOutlet`, from `@blotch/angular-lynx`) is a `RouterOutlet` that keeps each tab once shown, as `UITabBarController` and Material's navigation bar do. Use it in place of `<router-outlet>`; each route under it is a tab:

```typescript
import { LYNX_ELEMENTS, LynxTabOutlet } from '@blotch/angular-lynx';
import { UiDock, UiDockItem } from './components/ui/dock';

@Component({
  imports: [LYNX_ELEMENTS, LynxTabOutlet, UiDock, UiDockItem],
  template: `<view class="bg-background flex h-full flex-col">
    <lynx-tab-outlet />
    <ui-dock>
      <ui-dock-item route="/home" icon="home" label="Home" />
      <ui-dock-item route="/library" icon="music" label="Library" />
    </ui-dock>
  </view>`,
})
export class App {}
```

- A tab left is hidden (`visibility: hidden` and moved out of the outlet, which clips it; not `display: none`, which resizes everything in it to 0×0 on Lynx), not destroyed: coming back shows it as it was, scroll positions, the screens of its `<lynx-stack-outlet>`, and native views included, building nothing. Its components keep running: inject `LynxTabPage` (`{ optional: true }`) and read `active()` to pause frames or polling while it's hidden. A stack's screens in a hidden tab have `LynxStackPage.active()` false too.
- A navigation to a hidden tab's own URL and nothing more (`/library`, what its tab item links to) goes where the tab was left (`/library/3`), through a guard the outlet adds to the router's copy of each tab's route (it shows in `router.config`; the app's `Routes` objects aren't changed), so `await router.navigateByUrl('/library')` resolves `true` at `/library/3`. From the tab itself, the same link pops its stack to the first screen, as re-tapping the selected tab does. Back and Forward, a deeper URL, a query, other params (`/item/3` for a tab left at `/item/2`) and `info: { stack: 'root' }` go where they say.
- A tab's stack comes back with its screens' entries put back in `LynxLocationStrategy`'s history before the current one, so Back, Android's back button and a swipe pop the stack before going to the tab before.
- Every tab shown is kept. `data: { keepAlive: false }` on a route destroys its tab when it's hidden (`true` keeps it whatever `keep` says); `[keep]="['home', 'library']"` keeps only the tabs whose route paths it lists. Leaving the outlet's route (signing out) destroys every tab.
- Only `<lynx-stack-outlet>` and `<lynx-tab-outlet>` inside a tab keep their screens: a plain `<router-outlet>` in a tab rebuilds its screen when the tab comes back, because the router leaves its route as the tab hides. A `<lynx-stack-outlet>` on a screen covered by another stack's pushed screen keeps its screens the same way.
- With a `RouteReuseStrategy` that detaches a tab route, the outlet hands the tab over as `<router-outlet>` does, and its native views go.

## Key Differences from Web Routing

- **No URL bar** — users can't type URLs. All navigation goes through `routerLink` or the `Router`.
- **No browser back button** — use `Location.back()`. In the Android app `ng build --platform android` makes, the system back button goes back a screen through the router (and leaves the app from the first one).
- **In-memory only** — the URL state exists only in `LynxLocationStrategy`'s internal signal. There's no `window.location` or `history.pushState`.
