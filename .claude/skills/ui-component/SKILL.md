---
name: ui-component
description: Create a new Dolan UI component end-to-end — the component in packages/ui, its dolan registry entry, a runnable example in examples/, website docs, and tests. Use when creating, adding, or scaffolding a new @blotch/ui / Dolan UI component.
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
- **`<name>.test.ts`** — a Vitest spec (recommended; see [Testing](#3-write-a-test))

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
- **Opacity modifiers on semantic colors do NOT work** (`bg-primary/50`, `border-destructive/50`) — the token is an opaque `rgba()` with no channel to inject alpha into. Instead use a dedicated translucent token (e.g. `bg-destructive-subtle`), a solid token, or `opacity-*` on the whole element. Named colors are safe: `bg-black/50` works.
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

Tests live next to the component as `<name>.test.ts` and run under Vitest. The established pattern **tests the exported `cva` variant function**, not the rendered component — mock Angular so importing the module needs no framework runtime (the class field initializers never run because the component is never constructed):

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', () => ({
  Component: () => () => {},
  ViewEncapsulation: { None: 0 },
  computed: () => () => {},
  inject: () => ({}),
  input: () => () => {},
  output: () => () => {},
  viewChild: () => () => {},
}));
vi.mock('@blotch/angular-lynx', () => ({ LYNX_ELEMENTS: [] }));

const { buttonGroupItemVariants } = await import('./button-group');

describe('buttonGroupItemVariants', () => {
  it('returns default variant and size classes', () => {
    const result = buttonGroupItemVariants();
    expect(result).toContain('bg-secondary');
    expect(result).toContain('h-10');
  });
  // …one assertion per variant/size…
});
```

The mock only needs the symbols referenced when the module **loads** (the `@Component` decorator and `ViewEncapsulation`); provide the rest defensively. `<name>.test.ts` is copied into examples too, so keep it self-contained (it imports only `./＜name＞`).

---

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

### Import rules that make dependencies work

The CLI's `rewriteImports` only rewrites shared-util imports; cross-component imports must be plain sibling paths:

- **Shared utils** — import as `../../utils/cn` / `../../utils/animate`. The CLI rewrites these to `@blotch/dolan/utils/cn` etc. when scaffolding.
- **Another UI component** — import as `../<dep>/<dep>` (e.g. `import { UiSpinner } from '../spinner/spinner'`). This relative form resolves once both are scaffolded into the user's project. Also add `<dep>` to `dependencies`.
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

Leave `lynx.config.ts`, `tsconfig*.json`, `src/main.ts`, `src/app/app.config.ts`, `src/styles.css`, `tailwind.config.ts`, and `src/styles/*` as copied.

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

- [ ] `packages/ui/src/lib/components/<name>/` with `<name>.ts` + `index.ts` (+ `<name>.test.ts`)
- [ ] Conventions followed: standalone, `ViewEncapsulation.None`, `LYNX_ELEMENTS`, signals, `cn` + `cva`, `class` alias, `#`-private, `ui-` prefix
- [ ] No positional CSS selectors; semantic colors only; opacity-modifier caveat respected
- [ ] Registry entry in `packages/dolan/src/registry.ts` with correct `dependencies`
- [ ] Cross-component imports use `../<dep>/<dep>`; util imports use `../../utils/*`
- [ ] `examples/ui-<name>/` created, `package.json`/`angular.json` renamed, demo written
- [ ] `docs/dolan/<name>.mdx` with `<Go>`, usage, and API tables
- [ ] Sidebar entry in `rspress.config.ts`
- [ ] `dolan:update:force` run; example copy matches upstream (minus import rewrite)
- [ ] Tests pass; example builds (lynx + web); format/lint/cspell clean
