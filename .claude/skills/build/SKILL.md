---
name: build
description: Build all packages in the monorepo using turbo. Use when the user says "build", "run build", "compile", or wants to produce build artifacts.
---

# Build

Build all packages from the project root:

```sh
npm run build
```

This runs the build task in all packages via turbo with `^build` dependency ordering:
- `runtime` — `ng-packagr` (Angular library build + schematics via tsc)
- `rsbuild-plugin-angular-lynx` — `rslib build`
- `kitchen-sink-app` — `rspeedy build`
- `testing-library` — `tsc`
- `website` — `rspress build`

## Single package

To build a specific package:

```sh
npx turbo run build --filter=<package-name>
```

## After running

Report success or failure. If the build fails, show the error and identify which package failed.
