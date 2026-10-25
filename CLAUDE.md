# AngularLynx

Angular renderer for [Lynx](https://lynxjs.org/) — a cross-platform native UI framework (ByteDance). Write Angular, render to native mobile/web via Lynx runtime. **WIP proof of concept.**

## Architecture

Lynx uses a dual-thread model: **main thread** (native UI rendering) and **background thread** (JS execution/layout). Elements are manipulated via global `__*` functions (`__CreateElement`, `__AppendElement`, `__SetAttribute`, `__AddInlineStyle`, `__AddEvent`, `__RemoveElement`, etc.) instead of browser DOM. Native elements: `view`, `text`, `image`, `scroll-view`, `list`, `block`, `if`, `for`.

## Monorepo Structure

- `packages/runtime` — Core Angular renderer for Lynx (published as `@blotch/angular-lynx`)
- `packages/build` — The Angular CLI builders (published as `@blotch/angular-lynx-build`): `ng build` / `ng serve` run rspeedy with the rsbuild plugin, and `ng build --platform ios|android` then runs the native app builder; `ng test` and `ng extract-i18n` run Angular's own unit-test and extract-i18n builders set up for Lynx. A thin layer over the next two packages and rspeedy, all its dependencies, so it's an app's only build dependency (like `@angular/build`); apps reference it in `angular.json` as `@blotch/angular-lynx-build:application` / `:dev-server` / `:unit-test` / `:extract-i18n`. Without a lynx.config.ts, the builders take the entry from angular.json's `browser` and build the `lynx` and `web` environments
- `packages/rsbuild-plugin-angular-lynx` — Rsbuild plugin that compiles Angular for Lynx (published as `@blotch/rsbuild-plugin-angular-lynx`). A dependency of `packages/build`, which adds it to rspeedy's config; also usable with plain rspeedy
- `packages/native` — Native app builder (published as `@blotch/angular-lynx-native`): the Swift and Kotlin shell templates and the generator behind `ng build --platform ios|android`. A dependency of `packages/build`, which loads it only for `--platform`. See its README and `investigations/native-app-builds.md`
- `packages/create-angular-lynx` — Zero-setup scaffolder: `npm create angular-lynx <name>` runs `ng new` then `ng add @blotch/angular-lynx` automatically
- `packages/e2e` — End-to-end tests (private): packs the publishable packages, installs them into a fresh `npm create angular-lynx` app from a local Verdaccio registry, builds it, and renders it in Chromium (and natively on the iOS Simulator). Run with `npm run e2e`; see its README
- `packages/release` — Release tooling (private): `src/packages.ts` is the single list of published packages, shared with the E2E tests, `publish.yml` and the `consistent-package-versions` lint rule, and the `ng update` package group (`NG_UPDATE_PACKAGE_GROUP`, which each grouped package lists as `ng-update.packageGroup`). `npm run set-version <version>` sets every published package's version before tagging a release; see its README
- `skills/angular-lynx` — Public [skills.sh](https://skills.sh) skill, installed with `npx skills add Blotch-Smart-Frames/AngularLynx`. It lives at the repo root because the skills CLI only searches root-level skill folders. The dev skills in `.claude/skills` and `.agents/skills` set `metadata.internal: true` so the CLI hides them; any new dev skill needs that flag too, or it gets listed on skills.sh under this repo
- `examples/kitchen-sink-app` — Kitchen sink Angular app running on Lynx (the `npm run demo` target; consumes `@blotch/dolan` UI components)

## Upstream Lynx Sources

These aren't vendored in this repo. Read them on GitHub, or clone one outside the repo when you need to search it.

- [`lynx-family/lynx-stack`](https://github.com/lynx-family/lynx-stack), `packages/react` — **React Lynx** (production-proven reference implementation). Always refer to how React Lynx does things — it's battle-tested and used in production. When unsure about renderer design, element handling, or Lynx API usage, check this reference first.
- [`lynx-family/lynx-website`](https://github.com/lynx-family/lynx-website) — **Lynx official documentation website** ([lynxjs.org](https://lynxjs.org/)). Contains API docs, guides, element/CSS/native API compatibility data, and examples. Reference for understanding Lynx platform capabilities, supported elements, CSS properties, and API status across platforms.
- [`lynx-family/lynx`](https://github.com/lynx-family/lynx) — **Lynx core source code**. The actual C++/JS implementation of the Lynx runtime. Check here to understand how native elements, the dual-thread model, and platform APIs are implemented under the hood.

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

## Commits, PRs and Comments

- Never add AI attribution to commit messages, PR descriptions or code comments: no `Co-Authored-By` trailer, no "Generated with Claude Code" line, no mention of the AI tool or the company behind it. This overrides any default attribution instructions.

## CSS Colors in Lynx

Use Tailwind semantic color utilities (`bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, etc.). They work on Lynx and switch with dark mode automatically. The `@blotch/ui` theme stores each color as a complete `rgba()` value (e.g. `--primary: rgba(24, 24, 27, 1)`) and the tailwind plugin references it directly as `var(--primary)`. Examples receive the theme via `dolan`; apps import it from `@blotch/ui/theme`.

Never author raw HSL. Lynx's parser accepts only comma-separated `hsl(240, 5.9%, 10%)`, but Tailwind's shadcn-style `hsl(var(--x) / 1)` resolves to space-separated HSL, which Lynx silently drops (the element renders transparent, no warning). The theme uses `rgba()` values specifically to sidestep this.

**Opacity modifiers on semantic colors do not work** (`bg-primary/50`, `border-destructive/50`). The value is an opaque `rgba()` with no separable channels for Tailwind to inject alpha into. Instead:

- add a dedicated translucent variable (see `--destructive-subtle` → `bg-destructive-subtle` in `packages/ui/src/lib/theme/`), or
- use a solid semantic token (e.g. `bg-muted` for a subtle track), or
- apply `opacity-*` to the whole element.

Named colors stay safe: `bg-white`, `bg-black`, `bg-gray-*`, `bg-red-*` compile to hex/rgb, and their opacity modifiers (`bg-black/50`) compile to `rgb(0 0 0 / 0.5)`, which Lynx accepts.

| Need                       | Use                                                    |
| -------------------------- | ------------------------------------------------------ |
| Themed color (preferred)   | `bg-background`, `text-foreground`, `bg-card`          |
| Translucent semantic color | dedicated var (`bg-destructive-subtle`) or `opacity-*` |
| One-off custom color       | `style="background-color: rgba(0, 0, 0, 0.5)"`         |
| Named color (± opacity)    | `bg-white`, `bg-black/50`                              |

## Angular

- Standalone components only; do NOT set `standalone: true` (it's the default)
- Signals for state; `computed()` for derived state; no `mutate` (use `update`/`set`)
- **Never use legacy Angular decorators** — always use their modern signal-based/metadata replacements. This is enforced by the `no-legacy-decorators` lint rule (`oxlint --fix` auto-migrates). Specifically: `@Input()` → `input()`/`input.required()`, `@Output()` → `output()`, `@ViewChild()` → `viewChild()`/`viewChild.required()`, `@ViewChildren()` → `viewChildren()`, `@ContentChild()` → `contentChild()`/`contentChild.required()`, `@ContentChildren()` → `contentChildren()`, `@HostBinding()`/`@HostListener()` → `host` metadata property.
- Angular signal props (`input`, `output`, `viewChild`, `viewChildren`, `contentChild`, `contentChildren`, `model`) must be public `readonly` — no ES private (`#`) or TypeScript `private`/`protected`
- Don't set `changeDetection: ChangeDetectionStrategy.OnPush`: it's the default since Angular 22. The `no-redundant-on-push` lint rule flags it (`oxlint --fix` removes it)
- `inject()` instead of constructor injection
- `providedIn: 'root'` for singleton services
- Host bindings in `host` object, not `@HostBinding`/`@HostListener`
- Native control flow (`@if`, `@for`, `@switch`), not `*ngIf`/`*ngFor`/`*ngSwitch`
- `NgOptimizedImage` for static images (not for inline base64)
- Reactive forms over template-driven; `class`/`style` bindings over `ngClass`/`ngStyle`
- Lazy loading for feature routes
- `Resource` values accessed via `.value()`

## Testing

- **Test files use `.test.ts`, never `.spec.ts`.** The whole repo standardized on `.test.ts` (the modern Vitest/Node convention). Vitest `include` globs and tsconfig excludes expect `.test.ts`. When creating a new test file, name it `<name>.test.ts` — never `<name>.spec.ts`. (In users' apps, `ng test` runs both: the `component` schematic emits a `.test.ts` that renders on Lynx when the app has the testing library, and keeps Angular's `.spec.ts` otherwise.)

- **Apps run tests with `ng test`** (`@blotch/angular-lynx-build:unit-test`, wrapping Angular's `@angular/build:unit-test`). It compiles tests ahead of time and checks templates strictly, so a component using Lynx elements must import `LYNX_ELEMENTS` (the app build alone would let it pass). Angular's runner shares one module graph across test files: don't `vi.mock('@angular/core')` or relative imports. `examples/kitchen-sink-app` runs its tests this way; the packages run theirs with plain Vitest.

- **End-to-end tests:** `npm run e2e` installs the packed packages into a fresh app the way a user does. Run it after changing schematics, the scaffolder, package.json `files`/`exports`, or anything in the build plugin: unit tests run against source and can't see packaging bugs.

## Schematics (`ng add` / `ng generate`)

The runtime package ships an Angular schematics collection (`packages/runtime/schematics/collection.json`). These are the primary developer onboarding paths:

- **`ng add @blotch/angular-lynx`** — transforms an existing `ng new` project into a Lynx-native app: rewrites `main.ts`, `app.config.ts`, `app.ts`; points `build` / `serve` / `test` / `extract-i18n` at the AngularLynx builders (keeping `ng new`'s options, resizing its `initial` budget for a Lynx bundle); puts `@blotch/angular-lynx` first in `cli.schematicCollections`; installs only `@blotch/angular-lynx-build`; and optionally installs Tailwind (`--tailwind=false` to skip). It writes no `lynx.config.ts`: angular.json holds the build config
- **`ng generate component <name>`** (or `ng generate @blotch/angular-lynx:component`, alias `c`) — runs Angular's own component schematic (every option, angular.json's `@schematics/angular:component` defaults), then turns the `<p>` template into Lynx elements, imports `LYNX_ELEMENTS`, and, if the app has the testing library, swaps Angular's TestBed `.spec.ts` for a `.test.ts` using `render()`. Its schema mirrors Angular's without defaults (a test in `schematics/component/schema.test.ts` keeps it in step). Other `ng generate` schematics come from Angular
- **`ng generate @blotch/angular-lynx:add-tailwind`** — adds `tailwind.config.ts` with `@lynx-js/tailwind-preset` and updates `styles.css`
- **`ng generate @blotch/angular-lynx:add-testing`** — installs `@blotch/angular-lynx-testing-library` and points the `test` target at the unit-test builder, which loads the library's setup itself (no `vitest.config.ts` or setup file)
- **`ng generate @blotch/angular-lynx:add-i18n`** — adds `@angular/localize`, configures `angular.json` i18n (with an `extract-i18n` target that writes JSON for `loadTranslations()`), and injects `provideLocale()` into app config
- **`ng update @blotch/angular-lynx`** — updates every package of the group together; migrations for breaking changes go in `packages/runtime/schematics/migrations.json` (its `ng-update.migrations`)

## Build & Run

```sh
npm install && npm run build   # Build all packages
npm run demo                   # Start demo dev server (ng serve)
```

## Debugging

The demo runs on-device (iPhone) — there is no browser console. To debug, render logs on screen using `<text>` elements instead of `console.log`.

## Lynx vs Web Differences

When you discover that Lynx behaves differently from the web platform in a non-obvious way, **add it to `investigations/lynx-vs-web-differences.md`**. This file is the canonical reference for Lynx gotchas encountered during development.
