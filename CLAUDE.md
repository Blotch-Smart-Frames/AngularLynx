# AngularLynx

Angular renderer for [Lynx](https://lynxjs.org/) — a cross-platform native UI framework (ByteDance). Write Angular, render to native mobile/web via Lynx runtime. **WIP proof of concept.**

## Architecture

Lynx uses a dual-thread model: **main thread** (native UI rendering) and **background thread** (JS execution/layout). Elements are manipulated via global `__*` functions (`__CreateElement`, `__AppendElement`, `__SetAttribute`, `__AddInlineStyle`, `__AddEvent`, `__RemoveElement`, etc.) instead of browser DOM. Native elements: `view`, `text`, `image`, `scroll-view`, `list`, `block`, `if`, `for`.

## Monorepo Structure

- `packages/runtime` — Core Angular renderer for Lynx (published as `@blotch/angular-lynx`)
- `packages/rsbuild-plugin-angular-lynx` — Rsbuild plugin for building AngularLynx apps (published as `@blotch/rsbuild-plugin-angular-lynx`)
- `packages/create-angular-lynx` — Zero-setup scaffolder: `npm create angular-lynx <name>` runs `ng new` then `ng add @blotch/angular-lynx` automatically
- `examples/kitchen-sink-app` — Kitchen sink Angular app running on Lynx (the `npm run demo` target; consumes `@blotch/dolan` UI components)
- `references/lynx-stack-main/packages/react` — **React Lynx** (production-proven reference implementation). Always refer to how React Lynx does things — it's battle-tested and used in production. When unsure about renderer design, element handling, or Lynx API usage, check this reference first.
- `references/lynx-website-main` — **Lynx official documentation website**. Contains API docs, guides, element/CSS/native API compatibility data, and examples. Reference for understanding Lynx platform capabilities, supported elements, CSS properties, and API status across platforms.
- `references/lynx` — **Lynx core source code**. The actual C++/JS implementation of the Lynx runtime. Check here to understand how native elements, the dual-thread model, and platform APIs are implemented under the hood.

## Goal

Near-1:1 Angular parity — partial support isn't acceptable. Every Angular API (RouterOutlet, ViewContainerRef.createComponent(), NgComponentOutlet, etc.) should work on Lynx. If something doesn't work, fix the renderer rather than building workarounds.

## Key Patterns

- `bootstrapApplication(App, config)` replaces Angular's browser bootstrap
- `provideRenderer()` + zoneless change detection in app config
- Templates use Lynx elements: `<view>`, `<text>`, not HTML
- Standalone components, signals, `@if`/`@for` control flow, lazy-loaded routes all work

## Code Style

- Always write comments explaining **why** something is done, not just what. Future developers need to understand the reasoning and intent behind decisions.
- Use ES private fields (`#myVar`) instead of the TypeScript `private` keyword. Test private state through the public API. **Exception:** Angular signal props must be public `readonly` (see below).

## CSS Colors in Lynx

Use Tailwind semantic color utilities (`bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, etc.). They work on Lynx and switch with dark mode automatically. The `@blotch/ui` theme stores each color as a complete `rgba()` value (e.g. `--primary: rgba(24, 24, 27, 1)`) and the tailwind plugin references it directly as `var(--primary)`. Examples receive the theme via `dolan`; apps import it from `@blotch/ui/theme`.

Never author raw HSL. Lynx's parser accepts only comma-separated `hsl(240, 5.9%, 10%)`, but Tailwind's shadcn-style `hsl(var(--x) / 1)` resolves to space-separated HSL, which Lynx silently drops (the element renders transparent, no warning). The theme uses `rgba()` values specifically to sidestep this.

**Opacity modifiers on semantic colors do not work** (`bg-primary/50`, `border-destructive/50`). The value is an opaque `rgba()` with no separable channels for Tailwind to inject alpha into. Instead:

- add a dedicated translucent variable (see `--destructive-subtle` → `bg-destructive-subtle` in `packages/ui/src/lib/theme/`), or
- use a solid semantic token (e.g. `bg-muted` for a subtle track), or
- apply `opacity-*` to the whole element.

Named colors stay safe: `bg-white`, `bg-black`, `bg-gray-*`, `bg-red-*` compile to hex/rgb, and their opacity modifiers (`bg-black/50`) compile to `rgb(0 0 0 / 0.5)`, which Lynx accepts.

| Need | Use |
|------|-----|
| Themed color (preferred) | `bg-background`, `text-foreground`, `bg-card` |
| Translucent semantic color | dedicated var (`bg-destructive-subtle`) or `opacity-*` |
| One-off custom color | `style="background-color: rgba(0, 0, 0, 0.5)"` |
| Named color (± opacity) | `bg-white`, `bg-black/50` |

## Angular

- Standalone components only; do NOT set `standalone: true` (it's the default)
- Signals for state; `computed()` for derived state; no `mutate` (use `update`/`set`)
- **Never use legacy Angular decorators** — always use their modern signal-based/metadata replacements. This is enforced by the `no-legacy-decorators` lint rule (`oxlint --fix` auto-migrates). Specifically: `@Input()` → `input()`/`input.required()`, `@Output()` → `output()`, `@ViewChild()` → `viewChild()`/`viewChild.required()`, `@ViewChildren()` → `viewChildren()`, `@ContentChild()` → `contentChild()`/`contentChild.required()`, `@ContentChildren()` → `contentChildren()`, `@HostBinding()`/`@HostListener()` → `host` metadata property.
- Angular signal props (`input`, `output`, `viewChild`, `viewChildren`, `contentChild`, `contentChildren`, `model`) must be public `readonly` — no ES private (`#`) or TypeScript `private`/`protected`
- `changeDetection: ChangeDetectionStrategy.OnPush`
- `inject()` instead of constructor injection
- `providedIn: 'root'` for singleton services
- Host bindings in `host` object, not `@HostBinding`/`@HostListener`
- Native control flow (`@if`, `@for`, `@switch`), not `*ngIf`/`*ngFor`/`*ngSwitch`
- `NgOptimizedImage` for static images (not for inline base64)
- Reactive forms over template-driven; `class`/`style` bindings over `ngClass`/`ngStyle`
- Lazy loading for feature routes
- `Resource` values accessed via `.value()`

## Schematics (`ng add` / `ng generate`)

The runtime package ships an Angular schematics collection (`packages/runtime/schematics/collection.json`). These are the primary developer onboarding paths:

- **`ng add @blotch/angular-lynx`** — transforms an existing `ng new` project into a Lynx-native app: rewrites `main.ts`, `app.config.ts`, `app.ts`, adds `lynx.config.ts`, and optionally installs Tailwind (`--tailwind=false` to skip)
- **`ng generate @blotch/angular-lynx:component <name>`** (alias `c`) — generates a standalone component with Lynx element templates, `ChangeDetectionStrategy.OnPush`, and a Vitest spec file; options: `--path`, `--prefix`, `--inlineStyle`, `--inlineTemplate`, `--skipTests`, `--flat`
- **`ng generate @blotch/angular-lynx:add-tailwind`** — adds `tailwind.config.ts` with `@lynx-js/tailwind-preset` and updates `styles.css`
- **`ng generate @blotch/angular-lynx:add-testing`** — adds `vitest.config.ts`, `src/setup.ts`, and installs `@blotch/angular-lynx-testing-library`
- **`ng generate @blotch/angular-lynx:add-i18n`** — adds `@angular/localize`, configures `angular.json` i18n, and injects `provideLocale()` into app config

## Build & Run

```sh
npm install && npm run build   # Build all packages
npm run demo                   # Start demo dev server (rspeedy)
```

## Debugging

The demo runs on-device (iPhone) — there is no browser console. To debug, render logs on screen using `<text>` elements instead of `console.log`.

## Lynx vs Web Differences

When you discover that Lynx behaves differently from the web platform in a non-obvious way, **add it to `investigations/lynx-vs-web-differences.md`**. This file is the canonical reference for Lynx gotchas encountered during development.
