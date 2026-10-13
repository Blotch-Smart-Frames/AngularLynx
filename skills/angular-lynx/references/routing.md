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
- `LynxRouteReuseStrategy` — detaches route components instead of destroying them
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

## Element Pool & Route Reuse

Lynx has a **finite element pool (~256 slots)**. `__RemoveElement` detaches elements but does not free pool slots. Without route reuse, the pool exhausts after ~9 navigations.

`LynxRouteReuseStrategy` (provided automatically by `provideRouter`) detaches route component trees instead of destroying them. When navigating back to a previously visited route, the same native elements are reattached rather than creating new ones.

## Router Outlet

`<router-outlet>` works as normal. Place it inside a sized container:

```html
<view style="height: 300px; overflow: hidden;">
  <router-outlet />
</view>
```

## Key Differences from Web Routing

- **No URL bar** — users can't type URLs. All navigation is programmatic.
- **No browser back button** — implement your own back navigation if needed.
- **In-memory only** — the URL state exists only in `LynxLocationStrategy`'s internal signal. There's no `window.location` or `history.pushState`.
- **Route reuse is mandatory** — without it, element pool exhaustion crashes the app after several navigations.
