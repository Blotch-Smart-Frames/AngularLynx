---
name: test-full-coverage
description: Run all tests with coverage reporting across the entire monorepo. Use when asked to check coverage, find uncovered code, or verify coverage thresholds.
allowed-tools: Bash
---

# Test Full Coverage

Run the complete test suite with V8 code coverage across all platform packages.

## Quick commands

```bash
npm run test:coverage                             # Full monorepo coverage (turbo + spa)
npm run test:coverage -w @blotch/<package>        # Single package coverage
cd platform/spa && npm run test:coverage          # SPA coverage only
```

## How it works

- Platform packages: `vitest run --coverage` via Turborepo
- Angular SPA: `ng test --coverage`
- Coverage provider: `@vitest/coverage-v8` (V8-based)

## Debugging coverage gaps

```bash
# Run coverage for a specific package
npm run test:coverage -w @blotch/<package>

# Run with JSON reporter to find uncovered functions/branches
npx vitest run --coverage --coverage.reporter=json

# Inspect uncovered items from JSON output
cat coverage/coverage-final.json | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
for (const [file, cov] of Object.entries(data)) {
  for (const [key, count] of Object.entries(cov.f))
    if (cov.f[key] === 0) console.log(file.split('/').pop(), 'uncovered fn:', JSON.stringify(cov.fnMap[key]));
}"
```

## When something can't be tested

1. **Prefer extracting pure functions** into a separate helpers file for direct testing
2. **If extraction is impractical**, use `/* v8 ignore next N */` on the SOURCE file (never hack tests to expose internals)
3. Common ignore targets: CLI entry guards, env-dependent code, `unreachable` throws

## Running

From the repo root, run:

```bash
npm run test:coverage
```

Report coverage percentages per package and flag any packages below threshold. Include file paths for any uncovered lines/branches/functions.
