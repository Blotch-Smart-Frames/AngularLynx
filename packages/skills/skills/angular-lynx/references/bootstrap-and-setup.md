# Bootstrap & Project Setup

## Minimal App

Three files are needed to bootstrap a AngularLynx app:

### `main.ts`

```typescript
import { bootstrapApplication } from '@blotch/angular-lynx';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig);
```

### `app.config.ts`

```typescript
import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer, provideRouter } from '@blotch/angular-lynx';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(), // Required — Zone.js crashes in Lynx
    provideRenderer(), // Required — sets up Renderer2 → Lynx bridge
    provideRouter(routes), // Required — in-memory routing (no browser History API)
  ],
};
```

### `app.routes.ts`

```typescript
import type { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' }, // Always set a default — empty path causes NavigationError
  { path: 'home', component: HomeComponent },
  {
    path: 'detail',
    loadComponent: () =>
      import('./detail/detail.component').then((m) => m.DetailComponent),
  },
];
```

## Build Configuration

### `lynx.config.ts`

```typescript
import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  source: {
    entry: './src/main.ts',
  },
  plugins: [
    pluginQRCode(), // Shows QR code in terminal for Lynx Explorer
    pluginAngularLynx(), // Angular compilation + Lynx entry splitting
  ],
});
```

### Running

```bash
npx rspeedy dev    # Start dev server — scan QR code with Lynx Explorer app
npx rspeedy build  # Production build
```

## What the Providers Do

- **`provideZonelessChangeDetection()`** — Uses Angular's zoneless scheduler. Zone.js is incompatible with Lynx's runtime (no browser globals it depends on).

- **`provideRenderer()`** — Replaces Angular's default DOM `RendererFactory2` with `LynxRendererFactory2`. Creates thread-aware document: `LynxDocument` on main thread (calls `__CreateElement`, `__SetAttribute`, etc.), `LynxBackgroundDocument` on background thread (virtual tree). Also provides `DOCUMENT` mock and `APP_BASE_HREF`.

- **`provideRouter(routes)`** — Replaces browser routing with in-memory routing (`LynxLocationStrategy`). Includes `LynxRouteReuseStrategy` to prevent element pool exhaustion. Adds `withRouterConfig({ resolveNavigationPromiseOnError: true })` to prevent background thread crashes from unhandled navigation errors.

- **`bootstrapApplication()`** — On main thread: waits for Lynx's `renderPage` callback before bootstrapping Angular. On background thread: bootstraps immediately. Also installs polyfills for `AbortController`, `queueMicrotask`, `setTimeout`/`setInterval` (from `lynx` global), and `document`/`window` mocks.

## Root Component Pattern

```typescript
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LYNX_ELEMENTS],
  template: `
    <scroll-view class="app-container" scroll-orientation="vertical">
      <view class="app">
        <router-outlet />
      </view>
    </scroll-view>
  `,
  styles: [
    `
      .app-container {
        height: 100vh;
        width: 100vw;
      }
    `,
  ],
})
export class AppComponent {}
```
