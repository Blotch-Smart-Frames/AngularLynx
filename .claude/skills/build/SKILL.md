---
name: build
description: Build all packages in the monorepo using turbo. Use when the user says "build", "run build", "compile", or wants to produce build artifacts.
metadata:
  internal: true
---

# Build

Build the packages from the project root:

```sh
npm run build
```

This runs the build task in every package under `packages/` except the website, via turbo with `^build` dependency ordering. It leaves out the examples and the website, which builds every example: each example is a full rspeedy build, and building them all at turbo's default concurrency swaps the machine to a crawl. When the examples or the website are what you need, use one of these, which run 4 example builds at a time with 2 Angular workers each, as CI does:

```sh
npm run build:examples   # Every example
npm run build:all        # The packages and the website
```

What each package's build does:
- `runtime` — `ng-packagr` (Angular library build + schematics via tsc)
- `rsbuild-plugin-angular-lynx` — `rslib build`
- `native` — `tsc`, and renders the iOS template's Xcode project
- `build` — copies `native`'s output into `native/`, then `tsc` (the builders and the plugin re-export)
- `testing-library` — `tsc`
- `kitchen-sink-app` and the other examples (`build:examples`) — `ng build` (the `build` package's builder)
- `website` (`build:all`) — builds every example, then `rspress build`

## Single package

To build a specific package:

```sh
npx turbo run build --filter=<package-name>
```

## After running

Report success or failure. If the build fails, show the error and identify which package failed.
