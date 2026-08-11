---
name: format
description: Run the formatter (oxfmt) across all packages in the monorepo using turbo. Use when the user says "format", "run format", "format code", "check formatting", or wants to auto-format files.
---

# Format

Run the monorepo formatter from the project root:

```sh
npm run format
```

This runs `oxfmt --write .` in every package via turbo.

## Check mode

To check formatting without writing changes:

```sh
npm run format:check
```

## Single package

To format a specific package, run from the project root:

```sh
npx turbo run format --filter=<package-name>
```

Package names: `runtime`, `rsbuild-plugin-angular-lynx`, `kitchen-sink-app`, `testing-library`, `create-angular-lynx`, `oxlint-plugin`, `website`.

## After running

Report whether formatting passed or how many files were reformatted.
