# Release tooling

The list of packages we publish to npm, and the scripts that set their version, check it and publish them. Private: it is never published itself.

## Releasing

1. Set every published package to the new version, from the repo root:

   ```sh
   npm run set-version 22.3.0
   ```

2. Commit the result and get it onto `master`.
3. Tag that commit `v22.3.0` and push the tag. The tag starts `publish.yml`.

`publish.yml` refuses a tag that doesn't match the version in the repository. It used to write the tag's version into the packages at build time instead, and never committed it, which is how 22.2.1 was published while the repository still said 22.2.0.

## What's here

| File                      | Used by                                          | Does                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/packages.ts`         | everything below, `packages/e2e`, the lint rule  | The single list of published packages, in publish order. A public workspace package missing from it fails the E2E tests' Layer 1. Also `NG_UPDATE_PACKAGE_GROUP`, the packages `ng update` moves together                       |
| `src/set-version.ts`      | `npm run set-version <version>`                  | Sets every published package's `version`, and the exact version one pins another at (`@blotch/angular-lynx-build` → the rsbuild plugin and the native builder), and updates `package-lock.json`. Doesn't commit, tag or publish |
| `src/check-version.ts`    | `publish.yml`, before anything is built          | Fails unless every published package, and every pin between them, is at the tag's version                                                                                                                                       |
| `src/publish-tarballs.ts` | `publish.yml`                                    | Publishes the tarballs the E2E release gate tested, in publish order                                                                                                                                                            |
| `src/wait-for-npm.ts`     | `publish.yml`, before the post-publish E2E check | Waits until npm serves the new version of every package                                                                                                                                                                         |

The `consistent-package-versions` lint rule (in `packages/oxlint-plugin`) reads the same list, so `npm run lint` fails as soon as the published packages disagree on a version, or a package of the `ng update` group doesn't list the group as its `ng-update.packageGroup`.

## `ng update`

The packages an app installs (the runtime, the builders, the testing library, the rsbuild plugin and the native builder) each list the others as their `ng-update.packageGroup`, as every `@angular` package does. `ng update @blotch/angular-lynx` then updates them all to the same release, and `ng update` with no arguments lists them. The runtime's `ng-update.migrations` points at `packages/runtime/schematics/migrations.json`: add a migration there, with the version that needs it, whenever a release changes something an app must update, such as a builder option.

Everything here uses only Node built-ins, and Node runs the `.ts` files directly. Workflow jobs can run these scripts straight after checkout, without `npm ci`.
