---
name: ui-component
description: Create a new Dolan UI component end-to-end — the component in packages/ui, its dolan registry entry, a runnable example in examples/, website docs, and tests. Use when creating, adding, or scaffolding a new @blotch/ui / Dolan UI component.
metadata:
  internal: true
---

# Create a Dolan UI Component

A Dolan UI component is never one file. Shipping one touches **four places**, then a sync-and-verify pass:

1. **`packages/ui`** — the component source (the single source of truth)
2. **`packages/dolan`** — a registry entry so `dolan add <name>` can scaffold it
3. **`examples/ui-<name>`** — a runnable demo, embedded in the docs via `<Go>`
4. **`packages/website`** — a docs page and sidebar entry

This skill walks the whole pipeline, using the **Button Group** component as the worked example.

> **Before you start**, open a sibling component that resembles what you're building and copy its shape. Good references:
> - **`button`** — the simplest interactive component (variants, sizes, press animation, a test).
> - **`toggle`** — the **group + item via DI** pattern (`UiToggleGroup` / `UiToggleGroupItem`). Copy this for any "a container that configures its children" component (button group, segmented control, etc.).
> - **`radio-group`** — group/item with per-item enter/exit animation.

---

## How the pieces fit together

```
packages/ui/src/lib/components/<name>/   ← YOU EDIT HERE (source of truth)
        │
        │  `npm run build` in packages/dolan copies src/lib → packages/dolan/dist/ui
        ▼
packages/dolan/dist/ui/components/<name>/  ← what the CLI scaffolds FROM
        │
        │  `dolan add <name>` / `dolan update --force` copies files out,
        │  rewriting `../../utils/*` imports → `@blotch/dolan/utils/*`
        ▼
examples/ui-<name>/src/components/ui/<name>/  ← a generated COPY (never authoritative)
```

**Golden rule:** `packages/ui/` is the single source of truth. Example copies under `examples/*/src/components/ui/` are generated — never treat one as authoritative. Make every change upstream, then re-propagate (see [Sync](#5-sync-the-example-from-upstream)).

---

## 1. Create the component in `packages/ui`

Create `packages/ui/src/lib/components/<name>/` with:

- **`<name>.ts`** — the component(s)/directive(s)
- **`index.ts`** — re-exports every public symbol
- **`<name>.test.ts`** — its spec, which must cover the component fully (see [Testing](#3-write-a-test))

There is **no `packages/ui/src/index.ts` barrel** — the package's `exports` map exposes each component directly as `@blotch/ui/components/<name>` → `./src/lib/components/<name>/index.ts`. So you do **not** add a top-level barrel export; the `index.ts` inside the component folder is all that's needed.

### Component conventions

Match the existing components exactly:

- **Standalone** — do **not** set `standalone: true` (it's the default).
- **`encapsulation: ViewEncapsulation.None`** — styling comes from Tailwind utility classes, not scoped styles.
- **`changeDetection`** is not set explicitly here — these components are simple and run under the app's zoneless setup; follow the sibling you're copying.
- **`imports: [LYNX_ELEMENTS]`** from `@blotch/angular-lynx` — this is what makes `<view>`, `<text>`, etc. resolve. Add other `Ui*` components you use.
- **Templates use Lynx elements** (`<view>`, `<text>`, `<scroll-view>`, `<image>`), never HTML.
- **Signals only**: `input()` / `input.required()`, `output()`, `model()`, `computed()`. Signal props must be **public `readonly`**.
- **Everything else is ES-private** (`#field`), never TypeScript `private`. Inject with `readonly #group = inject(UiButtonGroup)`.
- **`userClass` input aliased to `class`** so consumers can pass extra utilities:
  ```typescript
  readonly userClass = input<string>('', { alias: 'class' });
  ```
- **Merge classes with `cn()`** from `../../utils/cn` and derive variants with **`cva`** from `class-variance-authority`. Export the `cva` fn and its `VariantProps`-derived types.
- **Selector prefix `ui-`**.
- **Press feedback**: for elements that respond to taps, wire `(bindtouchstart)`/`(bindtouchend)`/`(bindtouchcancel)`/`(bindtap)` to `pressDown`/`pressRelease` from `../../utils/animate`, holding an `AnimationHandle` in a `#pressAnim` field. Copy this verbatim from `button.ts` — including restoring scale on **cancel** (a touch stolen by a scroll gesture otherwise leaves the element stuck pressed-down).
- **Comment the _why_.** Explain non-obvious CSS tricks and Lynx workarounds inline (repo rule).
- **No `constructor()`.** Create effects and other injection-context work in fields: `protected readonly entrance = effect(() => …)`. For a class with a constructor, Angular's test build keeps a `() => []` in `ɵsetClassMetadata` that nothing calls, so every app's coverage report would show the component with an uncovered function. (`protected`, because lint rejects an unused `#private` field.)
- **Query by template reference, or through a call.** `viewChild.required<ElementRef>('container')` for an element that's always in the template (no `if (!el)` guard to cover). A query by class (`contentChild(UiChartTooltip)`) gets an arrow function in the same metadata that nothing calls: query through a module-level `const tooltipDirectiveType = () => UiChartTooltip;` as `contentChild(tooltipDirectiveType())` (see `chart.ts`).
- **No inline functions in the decorator.** The metadata keeps its own copy of the decorator's arguments, so an inline `useFactory: () => …` in `providers` is a second function nothing calls. Name it at module level (`useFactory: itemIconColor`).
- **No `[(x)]` two-way bindings in a component's template.** For a signal, AOT compiles the listener to `ɵɵtwoWayBindingSet(ctx.x, $event) || (ctx.x = $event)`, whose right side never runs: an uncovered branch. Write `[x]="x()" (xChange)="x.set($event)"`.
- **No `/* v8 ignore */` hints.** Angular's build strips them (even with `-- @preserve`), so they do nothing in an app. Cover the code, or restructure it so the unreachable branch doesn't exist.

### The group + item (DI) pattern

For a component that configures a set of children (button group, toggle group, radio group), split it into two components in the **same file**: a `UiXGroup` that holds shared inputs, and a `UiXGroupItem` that reads them back via `inject(UiXGroup)`. This is how `toggle.ts` does it — copy that structure.

```typescript
@Component({ selector: 'ui-button-group', /* … */ })
export class UiButtonGroup {
  readonly variant = input<ButtonGroupVariant>('default');
  readonly size = input<ButtonGroupSize>('default');
  readonly disabled = input(false);
  // …
}

@Component({ selector: 'ui-button-group-item', /* … */ })
export class UiButtonGroupItem {
  readonly #group = inject(UiButtonGroup); // ← child reads shared config
  readonly disabled = input(false);        // ← per-item override
  readonly pressed = output<void>();

  protected readonly isDisabled = computed(
    () => this.#group.disabled() || this.disabled(),
  );
  // …
}
```

### Glass components

A Liquid Glass component (dock, glass button, menu…) builds on the `glass` component rather than on `<blur-view>` directly:

- **Draw glass with `<blur-view ui-glass>`**, and merge shapes with `<blur-view ui-glass-group>`, with the glass directly inside. Put content inside the glass (interactive glass only reacts to touches on itself). Color it `text-glass-foreground` / `text-glass-muted-foreground`; projected `<ui-icon>`s get the glass's foreground through `UI_ICON_COLOR`.
- **Pick the form from `injectGlassDesign()`**: `'glass'` (iOS 26+, web, Android when the app called `provideGlass({ android: 'glass' })`), `'frosted'` (iOS 15–25) or `'material'` (Android's default). `UiGlass.surface` says what a glass element ended up drawing after the user's settings.
- **Follow Reduce Motion in your own animations** with `inject(LynxAccessibilitySettings).reduceMotion()`; `ui-glass` already handles Reduce Transparency and Increase Contrast.
- **Don't put glass on glass**: a component inside another glass element can `inject(UiGlass, { optional: true })` to draw plain instead. Nested rounded shapes take `concentricRadius(outer, inset)`.
- **List `glass` in `dependencies`**, and the glass colors your classes use in the registry entry's `themeColors`, so `dolan doctor` can point out a theme that lacks them.
- **In tests, set the platform** with `vi.stubGlobal('SystemInfo', { platform: 'iOS', osVersion: '26.0' })` (with no SystemInfo the design is `'material'`), and provide a fake `LynxAccessibilitySettings` with signals to drive the settings. See `glass/glass.test.ts`.

### `index.ts`

Re-export every public symbol — components, the `cva` fn, and the variant/size types:

```typescript
export {
  UiButtonGroup,
  UiButtonGroupItem,
  buttonGroupItemVariants,
  type ButtonGroupVariant,
  type ButtonGroupSize,
  type ButtonGroupOrientation,
} from './button-group';
```

---

## 2. Lynx CSS: what you can and can't do

Lynx's CSS engine is narrower than a browser's. These constraints shape component styling — get them wrong and elements silently render transparent or unstyled, with no warning.

- **Use Tailwind semantic color utilities** — `bg-background`, `text-foreground`, `bg-card`, `border-border`, `bg-secondary`, `text-muted-foreground`. They switch with dark mode automatically. Never author raw HSL (see the root `CLAUDE.md` for why space-separated HSL is silently dropped).
- **Opacity modifiers on semantic colors work** (`bg-primary/50`, `border-border/60`) — the theme plugin's `themeColor()` reads each color's `--x-rgb` channels for them. An app whose theme was copied before those channels existed draws nothing for a modifier until it adds them (`dolan doctor` lists the lines), so don't let a component become unusable without one: a modifier for a tint is fine, a modifier for the only visible fill isn't. Named colors are safe too: `bg-black/50` works.
- **No positional CSS selectors.** `:first-child`, `:last-child`, `:nth-child`, child combinators (`> *`), and `divide-x` are **not supported** — no component in the library uses them. If styling depends on an item's position in a list, solve it another way (see the connected-bar trick below).
- **`overflow-hidden` clips to rounded corners** — reliable, used by `avatar`. Handy for making a container of square children read as one rounded control.
- **When you discover a new Lynx-vs-web difference, record it** in `investigations/lynx-vs-web-differences.md`.

### Worked trick: a "connected bar" without positional selectors

Button Group needs items that look joined into one rounded bar with hairline dividers — the classic job for `:first-child`/`:last-child`, which Lynx lacks. Solution, entirely on the container:

```
overflow-hidden rounded-md border border-border bg-border flex gap-px
```

- `gap-px` leaves a 1px seam between items; the container's own `bg-border` shows through it as a **divider** — no per-item borders, so items stay position-agnostic.
- `overflow-hidden` + `rounded-md` **clip the square item corners** into a single rounded shape.
- Items just need an **opaque** background (`bg-secondary` / `bg-background`) so the seam reads as a line.

---

## 3. Write a test

`dolan add` copies the component's tests with it, and apps run them with `ng test`, which compiles ahead of time: every template listener, `@if` branch and binding becomes a function or branch in the component's file. So the tests must **cover every `.ts` file in the folder 100% (statements, branches, functions, lines), on their own**: an app can copy a component without the ones that render it. `packages/ui` runs its specs the same way (`ng test`, through `@blotch/angular-lynx-build:unit-test`), and `npm run test:ci:coverage -w @blotch/ui` (`scripts/test-coverage.ts`) enforces it: every spec together, then each component that another one imports with its own specs alone. Run one component the way an app sees it:

```sh
cd packages/ui
npx ng test --no-watch --coverage --include src/lib/components/<name> --coverage-include 'src/lib/components/<name>/**/*.ts'
node scripts/test-coverage.ts --all   # every component alone
```

Write the test the way an app's developer would read it:

- **Render it in a host component** whose signals are bound in the template (`[variant]="variant()"`), then `host.variant.set(…); await waitForUpdate();`. Bind every required input, and import `LYNX_ELEMENTS` for the host's own `<view>`/`<text>` (templates are checked strictly).
- **Fire real events** on the rendered elements so the template's listeners run: `fireEvent.tap(el)`, `fireEvent.touchstart(el, { touches: [...] })`, `fireEvent.tap(el, { eventType: 'catchEvent' })` for `(catchtap)`, and `fireLynxEvent(el, 'mouseleave')` (from `../../../test-utils/fire-lynx-event`) for the events `fireEvent` has no shortcut for. Don't call protected handlers through casts.
- **Assert what users see**: outputs, `model()` values, text, classes, inline styles. For what jsdom can't show (an animation, a value it drops), spy on Lynx's element functions with `vi.spyOn(lynxMainThread(), '__ElementAnimate')` (`../../../test-utils/lynx-main-thread`), inside the test or a `beforeEach`: the testing library resets the main thread after each test.
- Each component's host renders as a `<view>` too, so find elements by class, text or attribute, not by being first.
- Test the exported `cva` functions directly too (`buttonVariants({ variant: 'destructive' })`).

The tests must compile in an `ng new` app: strict TypeScript (including `noPropertyAccessFromIndexSignature`), and both Vitest 4 (this repo) and Vitest 5 (new apps) types — give a `vi.fn()` whose calls you read typed parameters, and type the object you `vi.spyOn` rather than casting the key. Don't `vi.mock('@angular/core')` or `@blotch/angular-lynx`, and don't import `node:` modules: `ng test` runs every test file in one shared module graph, and the tests are copied into apps. Use only the testing library's published API (`render`, `waitForUpdate`, `fireEvent`, `screen`, `within`, …).

## 4. Register in `packages/dolan`

Add an entry to the `registry` array in `packages/dolan/src/registry.ts`, keeping it grouped with related components:

```typescript
{ name: 'button-group', dependencies: [] },
```

**Dependencies** are other UI components this one imports. List them so `dolan add` pulls them in automatically and installs them first (topological order):

```typescript
{ name: 'button', dependencies: ['spinner'] },     // button imports UiSpinner
{ name: 'avatar', dependencies: ['skeleton'] },
```

**Packages** are the npm packages it imports, as install specs matching `packages/ui/package.json` (`'class-variance-authority@^0.7.1'`). `dolan add` installs whichever the app lacks. Angular, `@blotch/angular-lynx` and `@blotch/dolan` are the app's already. A test in `registry.test.ts` fails when an import isn't listed.

### Import rules that make dependencies work

The CLI's `rewriteImports` only rewrites shared-util imports; cross-component imports must be plain sibling paths:

- **Shared utils** — import as `../../utils/cn` / `../../utils/animate`. The CLI rewrites these to `@blotch/dolan/utils/cn` etc. when scaffolding.
- **Another UI component** — import as `../<dep>/<dep>` (e.g. `import { UiSpinner } from '../spinner/spinner'`). This relative form resolves once both are scaffolded into the user's project. Also add `<dep>` to `dependencies`.
- **Test helpers** — tests may import `../../../test-utils/<helper>` (`fire-lynx-event`, `lynx-main-thread`, `set-input-signal`). The CLI rewrites it to `@blotch/dolan/testing/<helper>`, so each helper needs a copy in `packages/dolan/src/testing/` and an export in its `package.json` (tests check both). Tests are copied only into apps with `@blotch/angular-lynx-testing-library`, and every `.test.ts` in the folder is copied.
- **Nothing else** may be a relative import out of the component folder.

---

## 5. Create the example (`examples/ui-<name>`)

Each component gets a runnable example that the docs embed as an interactive `<Go>` preview. The fastest way to create one is to **copy the closest existing example** and adapt it — every UI example already has the Tailwind + theme + dolan wiring.

```sh
cd examples
rsync -a --exclude node_modules --exclude dist --exclude .turbo --exclude .rspeedy \
  ui-toggle/ ui-<name>/
rm -rf ui-<name>/src/components/ui/*        # drop the copied component(s)
mkdir -p ui-<name>/src/components/ui/<name>
```

Then edit:

- **`package.json`** — set `"name": "@angular-lynx-example/ui-<name>"`. UI examples depend on `@blotch/dolan` and use Tailwind (`@lynx-js/tailwind-preset`, `tailwindcss`) — copying from `ui-toggle` gets this right.
- **`angular.json`** — rename the project key to `ui-<name>`.
- **`src/app/app.ts`** — write the demo (see below).
- **`src/components/ui/<name>/`** — the scaffolded copy. You can hand-write it now (apply the import rewrite: `../../utils/*` → `@blotch/dolan/utils/*`) so the example builds immediately; the sync step will normalize it.
- **`dolan.lock.json`** — list the component(s) under `components` (and keep the `theme` block). Exact hashes don't matter yet — the sync step rewrites them. List every scaffolded file, including `<name>.test.ts`.

Leave `tsconfig*.json`, `src/main.ts`, `src/app/app.config.ts`, `src/styles.css`, `tailwind.config.ts`, and `src/styles/*` as copied. The example needs no `lynx.config.ts`: `ng build` takes the entry from angular.json.

### The demo (`src/app/app.ts`)

- Standalone `App` with `imports: [LYNX_ELEMENTS, Ui<Name>, …]`.
- Wrap everything in `<scroll-view scroll-orientation="vertical" class="h-full">`.
- Open with a title (`text-2xl font-bold text-foreground`) and a one-line description (`text-sm text-muted-foreground`).
- One `flex-col gap-3` section per facet: variants, sizes, orientation, disabled, interactive.
- Show interactivity with a signal (e.g. "Last action: …") so the preview visibly responds to taps.
- Use `(bindtap)` / component outputs for events — never `(click)`.

### Sync the example from upstream

Once upstream + the example scaffold exist, normalize the copy and fix the lockfile hashes from the repo root:

```sh
npm run dolan:update:force
```

This **rebuilds `@blotch/dolan`** (so it re-copies `packages/ui` into `dist/ui` and picks up your new registry entry), then overwrites every example's tracked component copies with the upstream version and writes correct lock hashes.

> **`--force` discards example edits you haven't ported upstream.** It overwrites example copies from upstream and does not reconcile local drift. Always make component changes in `packages/ui/` first, then run this — an edit made only in an example vanishes on the next sync. (`examples/forms` is hand-maintained and skipped by dolan; port to/from it by hand.)

---

## 6. Website docs (`packages/website`)

Create **`docs/dolan/<name>.mdx`**. Follow `button.mdx` / `toggle.mdx` and the website writing principles in `packages/website/CLAUDE.md` (lead with the payoff, code first, scannable, keep it short):

1. `# Title` + one-line "what it does for me".
2. `<Go example="ui-<name>" defaultFile="src/app/app.ts" />` — the interactive preview.
3. **Installation** — `npx @blotch/dolan add <name>` and the import line. If it has dependencies, add a `:::tip` noting they're installed automatically.
4. **Usage** — simplest working snippet first (use ```` ```angular-html ````), then variants/sizes/states.
5. **API** — a Markdown table per component (Inputs, then Outputs).

Add a sidebar entry in **`rspress.config.ts`** under the matching `/dolan/` section header (`General`, `Layout`, `Data Display`, `Forms`, `Feedback`):

```typescript
{ text: 'Button Group', link: '/dolan/button-group' },
```

UI component examples are surfaced **only** through the `<Go>` embed in their `docs/dolan/*.mdx` page — they do **not** get a separate `docs/examples/*.mdx` page or an `/examples/` sidebar entry.

---

## 7. Verify

Run from the repo root and fix anything that fails:

```sh
# Component + CLI registry tests
npx turbo run test --filter=@blotch/ui --filter=@blotch/dolan

# Rebuild dolan and re-propagate to examples (fixes the lockfile hashes)
npm run dolan:update:force

# The example must build for both targets
cd examples/ui-<name> && npm run build && cd ../..

# Quality gates
npm run format && npm run lint && npm run cspell
```

After `dolan:update:force`, **diff the example copy against upstream** — they must match except for the `@blotch/dolan/utils/*` import rewrite. Any other difference means drift.

---

## Checklist

- [ ] `packages/ui/src/lib/components/<name>/` with `<name>.ts` + `index.ts` + `<name>.test.ts`, covering the folder 100% on its own under `ng test`
- [ ] Conventions followed: standalone, `ViewEncapsulation.None`, `LYNX_ELEMENTS`, signals, `cn` + `cva`, `class` alias, `#`-private, `ui-` prefix
- [ ] No positional CSS selectors; semantic colors only; opacity-modifier caveat respected
- [ ] Registry entry in `packages/dolan/src/registry.ts` with correct `dependencies`
- [ ] Cross-component imports use `../<dep>/<dep>`; util imports use `../../utils/*`
- [ ] `examples/ui-<name>/` created, `package.json`/`angular.json` renamed, demo written
- [ ] `docs/dolan/<name>.mdx` with `<Go>`, usage, and API tables
- [ ] Sidebar entry in `rspress.config.ts`
- [ ] `dolan:update:force` run; example copy matches upstream (minus import rewrite)
- [ ] Tests pass; example builds (lynx + web); format/lint/cspell clean
