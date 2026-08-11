---
name: test
description: Run the test suite (vitest) across all packages in the monorepo using turbo. Use when the user says "test", "run tests", "run the tests", or wants to verify correctness.
---

# Test

Run all tests from the project root:

```sh
npm run test
```

This runs `vitest run` in packages that have a test script (`runtime`, `rsbuild-plugin-angular-lynx`, `kitchen-sink-app`, `testing-library`) via turbo. Tests depend on `^build` completing first.

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
npx vitest run <path-to-test-file>
```

## Watch mode

For interactive development:

```sh
npx vitest <path-to-test-file>
```

## After running

Report pass/fail counts. If tests fail, show the failing test names and a brief summary of each failure.
