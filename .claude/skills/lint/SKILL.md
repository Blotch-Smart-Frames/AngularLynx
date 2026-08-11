---
name: lint
description: Run the linter (oxlint) across all packages in the monorepo using turbo. Use when the user says "lint", "run lint", "check lint", or wants to find code quality issues.
---

# Lint

Run the monorepo linter from the project root:

```sh
npm run lint
```

This runs `oxlint .` in every package via turbo.

## Fix mode

If the user asks to fix lint errors, run:

```sh
npm run lint:fix
```

## Single package

To lint a specific package, run from the project root:

```sh
npx turbo run lint --filter=<package-name>
```

Package names: `runtime`, `rsbuild-plugin-angular-lynx`, `kitchen-sink-app`, `testing-library`, `create-angular-lynx`, `oxlint-plugin`, `website`.

## After running

Report the results concisely. If there are errors, summarize them grouped by category and offer to fix.
