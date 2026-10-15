---
name: test
description: Run the test suite (vitest) across all packages in the monorepo using turbo. Use when the user says "test", "run tests", "run the tests", or wants to verify correctness.
metadata:
  internal: true
---

# Test

Run all tests from the project root:

```sh
npm run test
```

This runs each workspace's `test` script via turbo: `vitest run` in the packages (`runtime`, `build`, `rsbuild-plugin-angular-lynx`, `native`, `testing-library`, `ui`, ...), and `ng test` in `kitchen-sink-app`, which tests the way an app does (Angular's unit-test builder through `@blotch/angular-lynx-build:unit-test`, against the built packages). Tests depend on `^build` completing first.

## No cache

To force re-run without turbo cache:

```sh
npm run test:no-cache
```

## Single package

To test a specific package:

```sh
npx turbo run test --filter=<package-name>
```

## Single file

To run a specific test file directly:

```sh
npx vitest run <path-to-test-file>              # in a package
npx ng test --watch=false --include <file-glob> # in kitchen-sink-app
```

## Watch mode

For interactive development:

```sh
npx vitest <path-to-test-file>  # in a package
npx ng test                     # in kitchen-sink-app: watches in a terminal
```

## After running

Report pass/fail counts. If tests fail, show the failing test names and a brief summary of each failure.
