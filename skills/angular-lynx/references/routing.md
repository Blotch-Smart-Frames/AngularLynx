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

**All navigation must be deferred out of event handlers** using `setTimeout`:

```typescript
@Component({
  template: `
    <view (bindtap)="goToDetail()">
      <text>View Detail</text>
    </view>
    <router-outlet />
  `,
  imports: [RouterOutlet, LYNX_ELEMENTS],
})
export class NavComponent {
  #router = inject(Router);

  goToDetail(): void {
    // REQUIRED — defer navigation out of the Lynx worklet event callback
    setTimeout(() => {
      this.#router.navigateByUrl('/detail');
    }, 0);
  }
}
```

Angular's Router processes navigation synchronously, triggering `__RemoveElement`/`__CreateView`/`__AppendElement`. These DOM mutations inside a worklet event callback crash the app.

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

- **No URL bar** — users can't type URLs. All navigation is programmatic.
- **No browser back button** — use `Location.back()`. In the Android app `ng build --platform android` makes, the system back button goes back a screen through the router (and leaves the app from the first one).
- **In-memory only** — the URL state exists only in `LynxLocationStrategy`'s internal signal. There's no `window.location` or `history.pushState`.
