# kitchen-sink-app — Flagship AngularLynx Example

The `npm run demo` app: a `ui-nav-drawer` shell over ~24 lazy-loaded feature/demo
routes, showcasing both `@blotch/angular-lynx` runtime features and
`@blotch/dolan` UI components in one real, multi-route app.

## Patterns

- **Standalone components** importing `LYNX_ELEMENTS` from `@blotch/angular-lynx` for IDE support (the rsbuild plugin injects CUSTOM_ELEMENTS_SCHEMA automatically at build time)
- **Zoneless change detection** via `provideZonelessChangeDetection()`
- **Signals** for reactive state
- **Lazy-loaded routes** — all route components use `loadComponent`
- Templates use Lynx elements: `<view>`, `<text>`, `<image>`, etc.
- Angular signal props (`input`, `output`, `viewChild`, `viewChildren`, `contentChild`, `contentChildren`, `model`) must be public `readonly` — no ES private (`#`) or TypeScript `private`/`protected`

## Dolan components — do not hand-edit

`src/components/ui/*` and `src/styles/{default,dark}.css` / `src/styles/tailwind-plugin.ts`
are copied from `packages/ui/` by dolan — **never edit them directly**. Fix
upstream in `packages/ui/`, then run `npm run dolan:update:force` from the repo
root to re-sync every example. See `examples/CLAUDE.md`.

Hand-written app code lives entirely in `src/app/*` and the top-level `src/styles.css`.

## Shell + navigation

`src/app/app.ts` is a persistent shell: an app bar with a `ui-nav-drawer-trigger`
and a `ui-nav-drawer` grouping every route by category (Elements, Components,
Motion, Forms & Input, Platform, Validation). `<router-outlet>` fills the body.

Every route wraps its content in either:

- `src/app/demo-screen/demo-screen.ts` (`<app-demo-screen>`) — owns the page
  scroll-view; provides a heading/category/description header. Use for demos
  with **no** scroll-view/list/gesture surface of their own.
- An inline `ui-text`/`ui-badge` header as the first child of the demo's own
  scroll-view/list/gesture root — use when the demo needs its own top-level
  scroll-view or list (never nest scroll-views).

## Lynx gotchas this app relies on

- A background/decoration layer must be a **sibling before** a scroll-view in
  DOM order, never a child — absolutely-positioned children inside a
  scroll-view intercept the platform scroll gesture.
- Defer navigation/signal writes triggered from native event callbacks via
  `setTimeout(..., 0)` — mutating the element tree inside a Lynx worklet
  callback crashes. See `App.navigateTo()`.
- Use `catchtap` (not `bindtap`) on modal/dialog panels to stop tap bubbling —
  Lynx controls propagation via the event prefix, not `stopPropagation()`.

## Testing gotcha: `render()`'s extra tick

The shared `render()` helper (`@blotch/angular-lynx-testing-library`) calls
`appRef.tick()` a second time after `bootstrapApplication()`. Under Angular
22's zoneless JIT pipeline this second tick can reset a freshly-created child
component's `input()`-bound value back to its default (reproducible with a
bare custom component — unrelated to Lynx). Specs whose assertions depend on
a child's bound input reaching the DOM should use
`src/test-utils/render-once.ts`'s `renderOnce()` instead, which bootstraps
with a single tick. Angular's AOT compiler is unaffected — the compiled
`ɵcmp.inputs` metadata and `consts` bindings are correct in production
builds; this is JIT/test-harness-only.

## Routes

All demo routes are grouped under `App.navGroups` in `src/app/app.ts`, plus a
`home` route with the landing page (logo, native inputs, overlay dialog).

## Key Files

```
lynx.config.ts                     # RSpeedy config: pluginAngularLynx() + dual lynx/web environments
src/
  main.ts                          # Entry point — bootstrapApplication()
  test-utils/render-once.ts        # Single-tick bootstrap helper for specs (see gotcha above)
  components/ui/                   # Dolan-managed — do not hand-edit
  app/
    app.config.ts                  # App config (zoneless CD + provideRenderer())
    app.routes.ts                  # Route definitions (all lazy-loaded)
    app.ts                         # Root component — nav-drawer shell
    home/                          # Landing page (logo, inputs, overlay dialog)
    demo-screen/                   # Shared per-screen heading/category/description frame
    events-demo/                   # Native event bindings (tap, catch, longpress, touch)
    list-example/                  # list usage example
    scroll-example/                # scroll-view usage example
    forms-demo/                    # Reactive forms (native inputs, dolan chrome)
    ...                            # ~20 more feature/platform/validation demos
```

## Run

```sh
npm run demo    # Start dev server (rspeedy) — run from repo root
```
