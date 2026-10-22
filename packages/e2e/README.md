# @blotch/angular-lynx-e2e

End-to-end tests that install and run AngularLynx the way a user does. They catch broken releases before users do: 22.2.0 and 22.2.1 passed every unit test and still couldn't produce a working app. The full design is in [`E2E_TESTING_PLAN.md`](../../E2E_TESTING_PLAN.md).

## Run it

```sh
npx playwright install chromium        # Once
npm run e2e                            # From the repo root: builds the packages, then layers 1-3
npm run e2e -- --keep                  # Keep the generated app and print its path
npm run e2e -- --layers 1              # Package checks only (seconds)
npm run e2e -- --pm pnpm --angular next
npm run e2e -- --registry public       # Test what is on npm right now
npm run e2e -- --ios                   # Also run on the iOS Simulator (needs Xcode and Maestro, below)
npm run e2e -- --ios --shell           # ...testing the app's own build from `ng build --platform ios`
npm run e2e -- --ios --shell --explorer  # ...testing both, as CI does
npm run e2e -- --help                  # Every option
```

`npm run e2e` from the repo root builds the publishable packages first. Running `npm run e2e -w packages/e2e` skips that, so it tests whatever is already built.

For `--ios`, install [Maestro](https://maestro.mobile.dev) at the version CI uses (`MAESTRO_VERSION` in `.github/workflows/e2e.yml`):

```sh
curl -fsSL https://get.maestro.mobile.dev | MAESTRO_VERSION=2.10.0 bash
```

The iOS run creates and reuses its own simulator, "AngularLynx E2E", so your own simulators stay untouched. To rerun only the native checks against an app you kept with `--keep`:

```sh
node packages/e2e/src/native/run-native.ts --platform ios --dist <app>/dist
```

Add `--app <app>` instead of `--dist` to test the app's own binary from `ng build --platform` rather than Lynx Explorer (the "shell" mode; `--app` builds it, `--prebuilt` uses the one already in `<app>/dist/<platform>`). Add `--explorer` too to test both, one after the other on the same device; a failure in one still lets the other run. iOS shells need Lynx's XCFrameworks: see [`packages/native/README.md`](../native/README.md#lynx-for-ios) for `ANGULAR_LYNX_IOS_FRAMEWORKS`.

```sh
node packages/e2e/src/native/run-native.ts --platform android --app <app>
```

Android has no `npm run e2e` flag: boot an emulator first (CI uses API 34 with Google APIs; on Apple silicon, the `arm64-v8a` image), put `adb` on your `PATH`, then run the same command with `--platform android`.

In CI, Layer 6 tests both hosts on both platforms. The Linux `build-app` job scaffolds the app, builds its APK (`--build-native android`) and hands the app folder (`--export-app`) to the `android` job, which runs `run-native.ts --app <app> --prebuilt --explorer` on the emulator. The `ios` job, on GitHub's `xcode-27` image, scaffolds and builds the app itself (the shell can only be built on macOS) with `run.ts --ios --shell --explorer`.

## What each layer does

| Layer | Where                          | What it checks                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `src/check-packages.ts`        | Packs every package and checks the tarball: required files, publint, `attw` type resolution, every schematic loads                                                                                                                                                                                                                                                                  |
| 2     | `src/scaffold.ts`              | Publishes the tarballs to a local Verdaccio, runs `npm create angular-lynx`, every schematic, `npm test`, the dev server, a production build and `ngc`                                                                                                                                                                                                                              |
| 3     | `playwright/render.test.ts`    | Opens the web bundle in Chromium through Lynx for Web: it renders, a tap updates it, a tap handler gets an async background function's result, a lazy route loads, a main-thread handler set to null stops running, Angular runs once while the background thread answers a lazy chunk's function and a JS module call, Tailwind styles a class from an `.html` template, no errors |
| 6     | `src/native/`, `native/*.yaml` | Opens the native bundle in Lynx Explorer, runs the app's own build from `ng build --platform` (`--shell`), or both, on the iOS Simulator or an Android emulator and runs the same checks with [Maestro](https://maestro.mobile.dev)                                                                                                                                                 |

Layers 4 (the OS, package manager and version matrix) and 5 (release gates) are CI wiring in `.github/workflows/e2e.yml` and `publish.yml`.

## Debug a failure

- **Read the last `✗` line.** Every check says what went wrong and where to look.
- **Look in `artifacts/`** (native runs add `<platform>-commands.log`, `<platform>-requests.log` with every bundle Explorer fetched, the app's log per host (`ios-shell.log`, `ios-explorer.log`, `android-<host>-logcat.log`) and Maestro's screenshots in `<platform>-<host>/`) (in CI, the `e2e-artifacts-*` workflow artifacts): `commands.log` has every command's output, `verdaccio.log` the registry's, `app/` the generated app without `node_modules`, `npm-logs/` npm's debug logs, and `playwright/` screenshots and traces.
- **Rerun with `--keep`**, then `cd` into the printed path and run `npm run build` or `npm start` by hand.
- **Open a Playwright trace** with `npx playwright show-trace artifacts/playwright/<test>/trace.zip`.

## Things to know

- **The generated app lives in a temporary folder, never in the repo.** Inside the monorepo, Node would resolve missing dependencies from its `node_modules` and hide them.
- **`@blotch/*` and `create-angular-lynx` never come from the public registry** in a local run. Verdaccio doesn't proxy them, so a broken local package can't be swapped for a published one.
- **Verdaccio's storage is cached** in `node_modules/.cache/angular-lynx-e2e/verdaccio` (or `--storage <dir>`), so third-party packages only download once.
- **The packages under test come from [`packages/release`](../release/README.md)'s publish list.** A new public package must be added there or marked `"private": true`, or Layer 1 fails.
- **Lynx Explorer is pinned** in `src/native/explorer.ts` with its SHA-256. Bump it together with the Lynx toolchain.
- **Native flows can only find elements that aren't flattened.** On Android, Lynx draws most elements into their parent without a View of their own, and Lynx Explorer only builds an accessibility tree for them while TalkBack is on. So every element a flow taps or checks sets `flatten` to false (see `fixtures/counter.ts`), which gives it a View carrying its label or text. iOS doesn't need it, but works the same with it.
- **Known failures are marked, not skipped.** A check for a known bug uses `test.fail()` and points at `BUG_LIST.md`, so it turns red when the bug is fixed.
