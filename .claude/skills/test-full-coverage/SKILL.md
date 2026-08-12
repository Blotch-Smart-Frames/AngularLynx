---
name: test-full-coverage
description: Run and enforce board-style 100% V8 test coverage across the publishable packages. Use when asked to check coverage, find uncovered code, reach 100%, or verify the coverage gate.
allowed-tools: Bash
---

# Test Full Coverage

Every publishable package is gated at **100%** coverage on all four V8 metrics
(statements, branches, functions, lines). Coverage is measured per package with
`@vitest/coverage-v8`, viewed interactively with `@vitest/ui`, and combined
across the monorepo by Codecov via per-package flags.

## Gated packages

| Directory | Workspace name | Codecov flag |
|---|---|---|
| `packages/runtime` | `@blotch/angular-lynx` | `runtime` |
| `packages/rsbuild-plugin-angular-lynx` | `@blotch/rsbuild-plugin-angular-lynx` | `rsbuild-plugin` |
| `packages/testing-library` | `@blotch/angular-lynx-testing-library` | `testing-library` |
| `packages/ui` | `@blotch/ui` | `ui` |
| `packages/dolan` | `@blotch/dolan` | `dolan` |
| `packages/oxlint-plugin` | `@blotch/oxlint-plugin` | `oxlint-plugin` |

## Quick commands

```sh
npm run test:coverage                                  # all packages (turbo)
npm run test:ci:coverage                               # the CI gate (fails <100%)
npm run test:coverage -w <workspace-name>              # one package
npm run test:ui -w <workspace-name>                    # interactive UI + coverage
```

Use Node 22 (`nvm use 22`). The lcov report lands at `packages/<dir>/coverage/lcov.info`.

## How it works

- Each package's vitest config has a `coverage` block: `provider: 'v8'`,
  `reporter: ['text','html','lcov']`, `include: ['src/**/*.ts']` (oxlint-plugin
  uses `src/**/*.mjs`), and `thresholds: { statements/branches/functions/lines: 100 }`.
- `coverage.all` defaults to true, so **every** source file matching `include`
  is instrumented even if no spec imports it — that is what makes 100% real.
- The gate is the vitest `thresholds`: `test:ci:coverage` exits non-zero if any
  package drops below 100% on any metric, failing CI with or without Codecov.
- CI (`.github/workflows/ci.yml`) runs `npm run test:ci:coverage`, then uploads
  each `coverage/lcov.info` to Codecov under its flag. `turbo` caches `coverage/**`.

## Testing idioms per package type

- **runtime** — its OWN idiom, NOT `@blotch/angular-lynx-testing-library` (importing
  it back into runtime creates a turbo build cycle). Use the `// @vitest-environment
  jsdom` pragma + `import '@angular/compiler'` + `TestBed`/`platformBrowserTesting`
  + the fake native tree in `src/lib/testing/fake-native-global.ts` (see
  `renderer/inline-text.spec.ts`, `renderer/teardown.spec.ts`). Services: `new Service()`
  + `vi.stubGlobal(...)`.
- **testing-library** — its own `render()` / `screen` / `fireEvent` / `waitForUpdate`.
- **ui** — the `render()` idiom from `@blotch/angular-lynx-testing-library` (config
  mirrors `examples/kitchen-sink-app/vitest.config.ts`), plus direct pure-function
  assertions (`buttonVariants`, chart geometry). Extract branchy logic into exported
  helpers (e.g. `toast-state.ts`) for heavy components.
- **rsbuild-plugin / dolan** — plain node/vitest with tmp-dir fixtures; mock
  build-tool / prompt internals with `vi.mock`.
- **oxlint-plugin** — drive each rule IN-PROCESS: `rule.create(fakeContext)` with
  hand-built AST nodes; assert on `context.report`. Never use `execSync('npx oxlint')`
  for coverage (a subprocess is invisible to V8).

## When something can't be tested

1. **Prefer extracting pure functions**, or **split any source file over 200 lines**,
   so the logic becomes directly testable.
2. **Only then** use `/* v8 ignore next N */` on the SOURCE file, with a short
   comment explaining WHY. Never expose `#` private fields or hack a test to reach
   an internal branch.
3. Legitimate ignore targets: non-Node/browser guards, defensive native-death
   branches, `unreachable` throws, env guards.

Config `exclude` is reserved for non-source only: spec/test files, `*.d.ts`,
type-only modules (`*.types.ts`, `types/**`), pure re-export barrels
(`public-api.ts`, some `index.ts`), CLI entrypoints, and test helpers.

## Debugging coverage gaps

```sh
# The text report already lists "Uncovered Line #s" per file — start there.
npm run test:coverage -w <workspace-name>

# For structured output, add the JSON reporter and inspect uncovered functions.
cd packages/<dir> && npx vitest run --coverage --coverage.reporter=json
node -e '
const d = require("./coverage/coverage-final.json");
for (const [f, c] of Object.entries(d))
  for (const k of Object.keys(c.f))
    if (c.f[k] === 0) console.log(f.split("/").pop(), "uncovered fn:", JSON.stringify(c.fnMap[k]));
'
```

## Combining coverage (Codecov)

Coverage is combined across packages by Codecov, not merged locally. Each package
uploads its `lcov.info` under a flag (`disable_search: true`, `fail_ci_if_error: false`,
`if: !cancelled()`). The root `codecov.yml` declares each flag's path,
`carryforward: true`, and a 100% target.

This needs the `CODECOV_TOKEN` repo secret. Without it the uploads no-op, and the
vitest threshold gate still fully protects the branch.

## After running

Report coverage per package and flag anything below 100%, with file paths and the
uncovered lines/branches/functions.
