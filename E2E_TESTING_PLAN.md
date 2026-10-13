<!-- cspell:ignore USERCONFIG bootstatus noasan openurl simctl xcrun XCUI -->

# End-to-End Testing Plan

**Status:** Proposal · **Last updated:** 2026-10-12

This plan adds end-to-end (E2E) tests that install and run AngularLynx the way a user does, on every pull request, before every publish, and on a nightly schedule. The goal is to catch broken releases in CI instead of hearing about them from users.

## Contents

1. [Why we need this](#why-we-need-this)
2. [Principles](#principles)
3. [Overview](#overview)
4. [The `packages/e2e` package](#the-packagese2e-package)
5. [Layer 1: Package contract checks](#layer-1-package-contract-checks)
6. [Layer 2: Fresh-app install from a local registry](#layer-2-fresh-app-install-from-a-local-registry)
7. [Layer 3: Render the app in a browser](#layer-3-render-the-app-in-a-browser)
8. [Layer 4: Platform matrix and upstream drift](#layer-4-platform-matrix-and-upstream-drift)
9. [Layer 5: Release gates](#layer-5-release-gates)
10. [Layer 6: Native iOS and Android](#layer-6-native-ios-and-android)
11. [CI wiring](#ci-wiring)
12. [Running locally](#running-locally)
13. [Rollout](#rollout)
14. [Open questions](#open-questions)
15. [Related hardening](#related-hardening)

## Why we need this

Releases 22.2.0 and 22.2.1 could not produce a working app, yet every CI check was green: 200 lint, format, spelling and test tasks, with 100% unit test coverage. Every bug was in the gap between our source code and what a user actually installs. Unit tests run against the monorepo's source and its `node_modules`, so they could never see that gap. The monorepo's copy of `@angular/build` was even carrying the patch that hid one of the bugs.

Each problem from the 22.2.x releases, and the layer of this plan that catches it:

| What broke                                                                        | Why existing tests missed it                                                                 | Caught by                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `npm create angular-lynx` crashed (`npx -w` needs a workspace root)               | The scaffolder had never run outside the monorepo                                            | Layer 2                                 |
| `@blotch/angular-lynx` shipped without its library (10 files, 12.8 kB)            | Tests import source code, never the packed tarball                                           | Layer 1, Layer 2                        |
| `ng add` silently did nothing (CommonJS schematics in an ES module package)       | `"type": "module"` only exists in the built `dist/package.json`, and `ng add` still exited 0 | Layer 1, Layer 2                        |
| `ng add` generated an `app.ts` that didn't compile (`LYNX_ELEMENTS` not imported) | The schematics have no tests, and their output was never compiled                            | Layer 2                                 |
| The plugin needed a `postinstall` script that npm 11 skips                        | The monorepo runs its own workspace scripts, and the patch was already applied locally       | Layer 2, Layer 4 (npm latest)           |
| The plugin crashed on `ng new` configs (no `index`/`outputPath`)                  | Every fixture and example sets both fields explicitly                                        | Layer 2                                 |
| The publish workflow failed with "Version not changed"                            | The workflow had never run before the first tag                                              | Layer 5 (dry run)                       |
| npm rejected the publish ("package not found")                                    | The trusted publisher was configured on the registry, outside the repo                       | Layer 5 (post-publish check), plus docs |

## Principles

- **Test what users install.** Use the packed tarballs, installed from a registry into a project outside the monorepo. Never import from `packages/*/src`.
- **Follow the documented path exactly.** Run `npm create angular-lynx`, `ng add`, `ng generate`, `npm run build` and `npm start`, as the README tells users to.
- **Check outcomes, not exit codes.** `ng add` exited 0 while doing nothing. Every step checks the files it was supposed to produce.
- **One harness, several triggers.** The same code runs as the PR check, the gate before publishing, the nightly drift check and the post-publish check.
- **Fast by default, wide on a schedule.** Pull requests run one configuration in about 10 minutes. The full OS, package manager and version matrix runs nightly and before releases.
- **Failures explain themselves.** Every failure uploads the generated app, logs and screenshots.

## Overview

| Layer                     | What it does                                                                                                            | Catches                                                                        | Runs                                | Target time          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- | -------------------- |
| 1. Package contract       | Packs each package, then lints its `package.json`, entry points, types and schematics                                   | Missing files, broken `exports`, wrong module format                           | Every PR                            | ~2 min               |
| 2. Fresh-app install      | Publishes to a local registry, scaffolds a new app, runs every schematic, builds, runs the app's tests                  | Scaffolder, schematic and plugin bugs, version ranges, install-script reliance | Every PR                            | ~6–8 min             |
| 3. Browser render         | Loads the app's web bundle in Chromium through Lynx for Web, clicks things, watches for errors                          | Runtime crashes, renderer regressions, blank screens                           | Every PR                            | ~2 min               |
| 4. Matrix and drift       | Windows and macOS, pnpm and Yarn, minimum Node, Angular `next`, latest npm and rspeedy                                  | Platform and shell bugs, breaking upstream releases                            | Nightly, before releases            | ~30 min (parallel)   |
| 5. Release gates          | Publishing waits for layers 1–3 on the tagged commit, plus a post-publish check                                         | Publish workflow bugs, registry-side problems                                  | Tags, publishes                     | ~10 min              |
| 6. Native iOS and Android | Opens the app in Lynx Explorer on the iOS Simulator, then an Android emulator, and runs the Layer 3 checks with Maestro | Missing JavaScript globals, native element bugs, threading bugs                | Nightly and release gate; PRs later | ~10 min per platform |

## The `packages/e2e` package

The harness lives in a new private workspace package, `@blotch/angular-lynx-e2e`:

```
packages/e2e/
  package.json            # "private": true; its own devDependencies (below)
  README.md               # How to run it and debug failures
  cspell.json
  tsconfig.json
  verdaccio/
    config.yaml           # Local registry config (Layer 2)
  src/
    packages.ts           # The single list of publishable packages
    registry.ts           # Starts and stops Verdaccio, writes the temporary .npmrc
    publish-local.ts      # Packs and publishes every package to Verdaccio
    check-packages.ts     # Layer 1
    scaffold.ts           # Layer 2 steps and their checks
    run.ts                # CLI entry: npm run e2e -- [options]
  fixtures/
    counter.ts            # Component used to test events in Layer 3
    lazy-route.ts         # Lazy-loaded route used to test chunk loading
  playwright/
    host.html             # Page that hosts the app in <lynx-view>
    playwright.config.ts
    render.test.ts        # Layer 3
```

**Why a package and not loose scripts.**

- **Its own dependencies.** The harness needs Verdaccio, Playwright, publint, `@arethetypeswrong/cli`, `@lynx-js/web-core` and `@angular-devkit/schematics`. A package keeps them out of every other package.
- **Build ordering.** The package lists the publishable packages as `devDependencies` (`"*"`), so turbo builds them first through the existing `^build` dependency.
- **Same tooling as everything else.** It gets the same `lint`, `format:check` and `cspell` tasks as the rest of the monorepo.

New turbo task:

```json
"e2e": { "dependsOn": ["^build"], "cache": false }
```

**The generated app must live outside the repository**, in `os.tmpdir()` locally or `$RUNNER_TEMP` in CI. Inside the repo, Node would find modules in the monorepo's `node_modules` and hide missing dependencies. That is exactly how the patched `@angular/build` hid the `postinstall` bug.

**One list of publishable packages.** `src/packages.ts` records each package's directory, name and publish directory; for the runtime that's `packages/runtime/dist`. Today `publish.yml` repeats this list five times. The harness and the publish workflow should share one list. A check should also fail if any workspace package without `"private": true` is missing from it, which today would flag `@blotch/angular-lynx-skills`.

## Layer 1: Package contract checks

These checks are fast and static. After building, for each publishable package:

1. **Pack it** with `npm pack` from the same directory the publish workflow publishes from, into a temporary folder.
2. **Run publint** on the tarball. It reports `main`, `module`, `types`, `exports` and `bin` entries that point at files missing from the tarball, and module format mismatches. On 22.2.1 it would have flagged the missing `fesm2022/` and `types/`.
3. **Run `attw --pack`** (`@arethetypeswrong/cli`) for packages that ship types: the runtime, the plugin and the testing library. It checks that the types resolve under `node16` and `bundler` module resolution.
4. **Load every schematic** listed in the runtime's `collection.json` from the extracted tarball, using `@angular-devkit/schematics`' `NodeWorkflow` (`collection.createSchematic(name)`). This is how Angular CLI loads them, and it would have caught the CommonJS-in-ES-module bug that made `ng add` report "no actions".
5. **Check for required files**, as a tripwire: `fesm2022/blotch-angular-lynx.mjs`, `types/blotch-angular-lynx.d.ts`, `schematics/package.json` and every factory in `collection.json`. The guard currently in `publish.yml` moves here, and `publish.yml` calls this check instead.

Loading the runtime's code itself needs Angular installed, so that happens in Layer 2.

## Layer 2: Fresh-app install from a local registry

The core of the plan: publish the freshly built packages to a throwaway registry, then do exactly what a new user does.

### Local registry

[Verdaccio](https://verdaccio.org/) runs on `localhost:4873` with:

```yaml
storage: ./storage # A temporary directory per run
uplinks:
  public:
    url: https://registry.npmjs.org/
packages:
  '@blotch/*':
    access: $all
    publish: $anonymous
    # No proxy: only versions published by this run exist. A broken local
    # package can never be silently swapped for a working one from the public registry.
  'create-angular-lynx':
    access: $all
    publish: $anonymous
  '**':
    access: $all
    proxy: public
log: { type: stdout, format: pretty, level: warn }
```

**Publishing:** each package is published from its publish directory with `npm publish --registry http://localhost:4873/` and a dummy `_authToken`, which Verdaccio's `$anonymous` publish rule accepts.

**Versions:** publish exactly the versions in the repo, for example 22.2.2. The registry is thrown away after the run, and `@blotch/*` is never fetched from the public npm registry, so there's no conflict with real releases.

- **Pitfall:** don't use prerelease versions such as `22.2.2-e2e.1`. `ng add` installs the plugin with the range `^22.2.0`, and semver ranges skip prereleases, so the install would fail for a reason users never hit.

**Pointing every tool at Verdaccio:** set `NPM_CONFIG_USERCONFIG` to a temporary `.npmrc` containing `registry=http://localhost:4873/`. `npx`, `ng add` and `npm install` all run as child processes and inherit it.

- **Verify in the spike:** Angular CLI reads `.npmrc` files itself when `ng add` looks up a package. Confirm it honors this setting. If it doesn't, also write a project-level `.npmrc` into the temporary workspace.

**Caching:** cache Verdaccio's storage directory between runs (keyed by date) so third-party packages come from the cache. That speeds up runs and makes them less sensitive to hiccups on the public npm registry.

### Steps and checks

Set `CI=true` and `NG_CLI_ANALYTICS=false`. CI has no terminal attached, so `ng new` uses its defaults instead of prompting.

1. **Scaffold**, using the exact README command, in a temporary directory:
   ```sh
   npm create angular-lynx@<version> my-app
   ```
2. **Check what the scaffold produced:**
   - `lynx.config.ts` exists.
   - `package.json` has `scripts.build === "rspeedy build"` and `scripts.start === "rspeedy dev"`.
   - `devDependencies` includes `@blotch/rsbuild-plugin-angular-lynx`.
   - `src/main.ts` imports `bootstrapApplication` from `@blotch/angular-lynx`.
   - `src/app/app.ts` imports `LYNX_ELEMENTS`.
   - `app.component.*` files from `ng new` are gone.
3. **Check what got installed:**
   - `npm ls --json` shows every `@blotch/*` package at the version just built, resolved from `localhost:4873`.
   - npm's "install scripts not covered by allowScripts" warning doesn't list any `@blotch/*` package. Our packages must never depend on install scripts.
4. **Build:**
   - `npm run build` exits 0, prints no `error` lines, and produces a non-empty `dist/main.lynx.bundle` (and `dist/main.web.bundle`; see Layer 3).
   - Type-check with `npx tsc -p tsconfig.app.json --noEmit`, so template type errors that rspeedy only reports as warnings still fail the run.
5. **Run each schematic, and build after each one:**
   - `ng generate @blotch/angular-lynx:component hello`: creates `hello.ts` and `hello.test.ts`, and the app still builds after `<app-hello />` is added to it.
   - `ng generate @blotch/angular-lynx:add-testing`, then `npm test`: the generated component's test passes using `@blotch/angular-lynx-testing-library`.
   - `ng generate @blotch/angular-lynx:add-i18n`, then build.
   - Tailwind is added by `ng add` by default. Also cover `ng add ... --tailwind=false` in the nightly matrix.
6. **Smoke-test the dev server:** start `npm start` in the background, wait for "ready", request the bundle URL, then stop it. The dev server takes code paths that `build` doesn't (watch mode, the Angular rebuild coordinator).
7. **On failure,** upload the generated app (without `node_modules`), the Verdaccio log, npm's debug logs and the build output as workflow artifacts.

## Layer 3: Render the app in a browser

Lynx for Web (`@lynx-js/web-core`) runs the same app in Chromium. The documentation site already uses it to show live examples, so the approach is proven here.

**Prerequisite:** today the scaffolded app only builds the native `lynx` environment. The recommended fix is to add `environments: { lynx: {}, web: {} }` to the `lynx.config.ts` that `ng add` generates. The repo's examples already do this, and it gives users a browser preview too. The alternative is for the harness to add the web environment itself, but then we wouldn't be testing what users get. See [Open questions](#open-questions).

**Host page** (`playwright/host.html`). Playwright's `webServer` serves it with a small Node static server, together with the app's `dist/` folder and the `client_prod/static` files from the e2e package's own pinned `@lynx-js/web-core`:

```html
<link rel="stylesheet" href="/web-core/css/client.css" />
<script type="module" src="/web-core/js/client.js"></script>
<lynx-view
  style="height: 100vh; width: 100vw"
  url="/main.web.bundle"
></lynx-view>
```

**Checks** (`render.test.ts`):

- **The app renders:** the title text (the project name) is visible. Lynx for Web draws elements inside shadow roots, and Playwright's text and CSS locators pierce open shadow roots, so no special handling is needed.
- **Events work:** `fixtures/counter.ts` replaces the generated `hello` component with a `<view bindtap>` that increments a signal. The test clicks it and expects the count to change. That proves the round trip from event to change detection to renderer.
- **Lazy routes load:** the test navigates to `fixtures/lazy-route.ts` and expects its content. Lazy chunk loading only fails at runtime, so builds alone never catch it.
- **No runtime errors:** no `pageerror` events and no `console.error` calls from page load to the end of the test.
- **On failure,** save a screenshot and a Playwright trace as artifacts.

**Cheap extension:** the CI build shards already produce a web bundle for every example. A render check over all examples, where each one loads with no errors and shows non-empty content, would catch renderer regressions across the whole example set for little extra cost.

**What this layer can't catch:** behavior that only exists natively, such as JavaScript globals that Lynx's own engine lacks, native elements and main-thread scripting. That is Layer 6.

## Layer 4: Platform matrix and upstream drift

Pull requests run one configuration: ubuntu-latest, Node 24 with its bundled npm, and the newest Angular 22.x. The full matrix runs nightly and before each release:

| What varies     | Values                                                              | Why                                                                                                                 |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| OS              | ubuntu, windows, macos                                              | The scaffolder builds shell commands, and `cmd.exe` treats `^` as an escape character. Path separators also differ. |
| Package manager | npm, pnpm, Yarn (node-modules linker)                               | pnpm's strict `node_modules` breaks undeclared dependencies, and install-script rules differ between them           |
| Node            | Lowest version Angular 22 supports, and 24                          | Make sure the versions we claim to support actually work                                                            |
| Angular         | 22.2.0 exactly (our minimum), newest 22.x, `next` (allowed to fail) | Keeps the `^22.2.0` peer range honest, and warns early about the next Angular release                               |
| npm             | Bundled with Node, and `npm@latest`                                 | npm 11's install-script blocking was exactly this kind of change                                                    |
| rspeedy         | Version pinned in `ng-add/versions.ts`, and latest                  | Warns early about Lynx toolchain changes                                                                            |

**pnpm and Yarn:** `create-angular-lynx` only uses npm. Testing them means `ng new --package-manager <pm>` followed by `ng add`. Decide which package managers we support first (see [Open questions](#open-questions)).

**Against the real registry:** the nightly run also installs `latest` from the public npm registry rather than Verdaccio. That catches registry-side problems such as a broken `latest` tag, a deprecation or a held version.

**Reporting:** a failing nightly run opens or updates a GitHub issue labeled `e2e-nightly`, de-duplicated by title, so drift doesn't go unnoticed.

## Layer 5: Release gates

1. **Publishing waits for the tests on the tagged commit.**
   - Split `publish.yml` into a `verify` job and a `publish` job. `verify` runs layers 1–3 on the tagged commit, and `publish` only runs if it passes. Before either, the workflow refuses a tag that doesn't match the version already in the repository (`check-version.ts`) rather than stamping the tag's version on: stamping is how 22.2.1 was published while the repository still said 22.2.0.
   - The E2E workflow is reusable (`on: workflow_call`), so `ci.yml`, `publish.yml` and the nightly schedule all call the same workflow.
2. **Publish the bytes that were tested.**
   - `verify` uploads the tarballs it tested as an artifact, and `publish` publishes those exact files with `npm publish <tarball>`. What users install is then byte-for-byte what passed.
   - Check during the spike that trusted publishing and provenance work when publishing a tarball rather than a folder.
3. **Test release-workflow changes before tagging.** ~~PRs that change `publish.yml` or any package's `package.json` run the publish steps with `npm publish --dry-run`.~~ Dropped: a PR must never start the publish workflow, and `npm publish --dry-run` fails anyway whenever the repository's version is already on npm, which it is between releases. Instead, PRs run Layer 1 through `e2e.yml`, and a manual dispatch of `publish.yml` from a branch runs the gate without publishing.
4. **Check the release after publishing.**
   - Poll npm until every package reports the new version. npm now holds new versions briefly for processing; it took about 2–3 minutes for 22.2.0.
   - Then run layers 2 and 3 against the public npm registry.
   - On failure, open an issue with the `npm deprecate` commands filled in. Don't deprecate automatically.
5. **Optional: staged publishing.** The publish job could use `npm stage publish`, run layers 2 and 3 against the staged tarballs (`npm stage download`), and then a maintainer approves with 2FA. This is the strongest gate, but it adds a manual step to every release (see [Open questions](#open-questions)).

## Layer 6: Native iOS and Android

### Why web rendering isn't enough

Layer 3 runs the app in Chromium through Lynx for Web, which provides every browser API and its own threading. On a phone, the app runs on Lynx's native renderer and Lynx's own JavaScript engine, split across a real main thread and background thread. Some bugs only appear there:

- **Missing globals.** Angular or one of its dependencies uses a JavaScript global that Lynx's engine doesn't provide. Chromium always has it, so Layer 3 passes.
- **Native elements.** `<scroll-view>`, `<list>`, `<input>` and `<image>` are native views, with their own layout and text measurement.
- **Threading.** Main-thread scripting and the timing between the two threads only exist natively.

The team already develops against an iPhone, so iOS comes first. Android reuses the same test flows.

### What makes iOS automation feasible

These are verified against Lynx release 4.1.0, the version of our Lynx toolchain:

- **A prebuilt app:** each Lynx release publishes Lynx Explorer for the iOS Simulator (`LynxExplorer-arm64.app.tar.gz`, about 28 MB, bundle ID `com.lynx.LynxExplorer`). There is no prebuilt build for physical devices.
- **A deep link:** Explorer opens a bundle from `lynx://open?url=<bundle-url>` (`explorer/darwin/ios/lynx_explorer/LynxExplorer/AppDelegate.mm`). A test can open the app with one command instead of typing into Explorer's home screen.
- **Plain HTTP works:** Explorer allows HTTP loads (`NSAllowsArbitraryLoads`), and the simulator shares the Mac's network, so it can load a bundle served from `localhost`.
- **Text is findable:** `<text>` and `<image>` are accessibility elements by default, labeled with their content, so UI testing tools find text with no changes to the app. `<view>` elements that the tests tap need `accessibility-element` and `accessibility-label`.
- **Lynx does this in its own CI:** `explorer/darwin/ios/lynx_explorer/scripts/run_sparkling_smoke.sh` boots a simulator, opens a bundle with `xcrun simctl openurl … "lynx://open?url=…"` and waits for log output confirming it loaded. It also works around simulators that fail to boot on GitHub's runners ("Data Migration Failed") by trying older runtimes. Use it as the reference implementation.

### iOS job (macOS runner)

1. **Reuse the bundle from Layer 2.** `main.lynx.bundle` is the same file on iOS and Android, so download it from the Linux job instead of rebuilding on the Mac, where minutes are slowest.
2. **Get Explorer.** Download it from a pinned release URL, check its SHA-256 (it's a binary we run in CI) and cache it. Bump the version on purpose, together with our Lynx toolchain.
3. **Boot a simulator:** `xcrun simctl boot <device>`, then `xcrun simctl bootstatus <device> -b`, retrying with another runtime if the boot fails, as Lynx's script does.
4. **Install:** `xcrun simctl install <device> LynxExplorer-arm64.app`.
5. **Serve the app's `dist/` folder** on `localhost:3000` with a small static server.
6. **Capture logs:** `xcrun simctl spawn <device> log stream --predicate 'process == "LynxExplorer"'`, saved to a file.
7. **Open the app:** `xcrun simctl openurl <device> "lynx://open?url=http://localhost:3000/main.lynx.bundle"`.
   - Explorer 4.1.0 reads everything after `url=` as-is, so pass the bundle URL unencoded.
   - The newer router on Lynx's `main` branch URL-decodes it, which is why Lynx's script encodes it. Re-check this when bumping Explorer.
8. **Run the UI checks** with [Maestro](https://maestro.mobile.dev/) (below).
9. **Fail on JavaScript errors** in the captured log, and upload screenshots, the log and Maestro's report as artifacts.

Maestro flow, shared by iOS and Android:

```yaml
# packages/e2e/native/app.yaml. appId is overridden per platform.
appId: ${APP_ID}
---
- openLink: lynx://open?url=${BUNDLE_URL}
- assertVisible: my-app # The title, a <text> element
- tapOn: Increment # A fixture <view> with accessibility-label="Increment"
- assertVisible: 'Count: 1'
- tapOn: Open lazy page
- assertVisible: Lazy page loaded
- takeScreenshot: final
```

**Why Maestro:** one YAML flow runs on both the iOS Simulator and the Android emulator. It finds elements through the accessibility tree, so nothing has to be added to Explorer. The alternatives are XCUITest, which needs our own Xcode test project that launches Explorer by bundle ID and works on iOS only, and Appium, which is heavier to run.

**Checks:** the same as Layer 3 (the app renders, a tap updates it, a lazy route loads, no JavaScript errors). A native-elements fixture adds:

- scrolling a `<scroll-view>`
- rendering a `<list>`
- typing into an `<input>`
- loading an `<image>`

### Android job

- Run it on a Linux runner with an Android emulator; hardware acceleration is available there.
- Install `LynxExplorer-noasan-release.apk` from the same Lynx release. Its package name is `com.lynx.explorer`, and `DebugBridgeActivity` handles the same `lynx://open?url=` link.
- The emulator reaches the host through `adb reverse tcp:3000 tcp:3000`, after which `localhost:3000` works as on iOS.
- Run the same Maestro flow with `APP_ID=com.lynx.explorer`.

### Physical devices

There's no prebuilt Explorer for physical iPhones. Testing on a device means building Explorer, or our own host app, from source with an Apple developer account and signing. It would then run on a device farm such as BrowserStack, AWS Device Farm or Firebase Test Lab, which costs money.

The simulator runs the same Lynx engine and native code, so it catches correctness bugs. Devices mainly add performance, memory and hardware differences. **Recommendation:** skip devices for now, and revisit before a 1.0 release or if a bug shows up only on devices.

### Alternative: our own iOS host app

Instead of Explorer, a minimal Swift app could embed the Lynx iOS SDK and load the bundle, with an XCUITest target.

- **Pros:** no dependence on Explorer's interface or release schedule, the Lynx SDK version is pinned exactly, and it tests embedding Lynx in an existing app, which is how real apps ship.
- **Cons:** building the Lynx SDK in CI is slow (though it can be cached), and an Xcode project has to be maintained.

**Recommendation:** start with Explorer, and switch if it gets in the way.

### Unknowns to settle in a short spike

- Whether iOS asks "Open in LynxExplorer?" when opening the link through `simctl`. If it does, the Maestro flow taps the prompt.
- Which log lines Lynx writes for JavaScript `console.error` output and uncaught errors on iOS, so the job fails on the right ones.
- Whether the prebuilt Explorer shows an error overlay that the screenshot would capture.
- How long simulator boot takes, and how flaky it is, on GitHub's macOS runners. Lynx's script suggests some flakiness is normal.

### Cost and schedule

GitHub-hosted macOS runners are free for public repositories, but a free account runs at most 5 macOS jobs at once, and they start more slowly. Expect about 8–12 minutes per run, mostly booting the simulator.

iOS and Android run on every pull request, as well as nightly and in the release gate. Bugs that only exist on Lynx's own engine should block a merge rather than surface the next morning. This roughly doubles a PR's wall-clock time (the native jobs start after the Linux fresh-app job).

## CI wiring

New workflow `.github/workflows/e2e.yml`:

```yaml
name: E2E

on:
  pull_request:
  push:
    branches: [master]
  schedule:
    - cron: '0 5 * * *' # Nightly: full matrix plus the real npm registry
  workflow_call: # Called by publish.yml before publishing
    inputs:
      registry: { type: string, default: local } # local | public
      matrix: { type: string, default: default } # default | full
  workflow_dispatch:

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true
```

**Jobs:** `package-contract` (Layer 1) runs first, then `fresh-app` (layers 2 and 3). `fresh-app` uses one configuration by default, and the full matrix on the nightly schedule.

**Caching:**

- npm's cache, through `setup-node`'s `cache: npm`.
- The turbo cache, restored the same way `build-packages` does it in `ci.yml`.
- Verdaccio's storage directory.
- Playwright's browsers (`~/.cache/ms-playwright`).

**Required check:** add `e2e` as a required status check on `master` once it has run reliably for about a week (see [Rollout](#rollout)).

**Cost:** GitHub-hosted runners are free for public repositories, including Windows and macOS. The real cost is wall-clock time, so keep the PR path under about 10 minutes.

## Running locally

```sh
npx playwright install chromium        # Once
npm run e2e                            # Layers 1–3, default configuration
npm run e2e -- --keep                  # Keep the generated app for debugging
npm run e2e -- --pm pnpm --angular next
npm run e2e -- --registry public       # Test what is published on npm now
npm run e2e -- --ios                   # Also run Layer 6 on the iOS Simulator (needs Xcode)
```

`--keep` prints the app's path, so you can `cd` into it and rerun `npm run build` or `npm start` by hand.

## Rollout

| Phase | Scope                                                                                                               | Effort   | Done when                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | `packages/e2e` skeleton, the shared package list, Layer 1, and moving the `publish.yml` guard into it. Runs on PRs. | 1 day    | It fails on a tarball shaped like 22.2.1 and passes on `master`                                                  |
| 2     | Verdaccio, plus the Layer 2 scaffold, schematic, build and dev-server checks. Runs on PRs.                          | 2–3 days | Undoing any single fix from #11 makes it fail with a clear message                                               |
| 3     | `web` environment in the `ng add` template, plus the Layer 3 Playwright tests                                       | 1–2 days | It fails when rendering is broken, for example with a renderer method that throws                                |
| 4     | `publish.yml` gate (`workflow_call`, publishing the tested tarballs), post-publish check                            | 1–2 days | A release goes out through the gate, and a deliberately broken tag is blocked                                    |
| 5     | Nightly matrix and the failure issue                                                                                | 1 day    | A week of nightly runs, with any failures triaged                                                                |
| 6     | iOS: Explorer on the simulator, the Maestro flow and log checks. Nightly and release gate.                          | 2–3 days | The scaffolded app passes the Layer 3 checks on iOS, and fails when a fixture uses a global Lynx doesn't provide |
| 7     | Android: the same flow on an emulator                                                                               | 1–2 days | The same flow passes on Android                                                                                  |
| 8     | Make `e2e` a required check (iOS later, on PRs that touch the runtime or plugin)                                    | —        | A week without flaky failures                                                                                    |

**Testing the harness itself.** On a throwaway branch, reintroduce each 22.2.x bug one at a time by reverting each fix from #11 separately, and confirm the harness fails with a message that points at the cause. A harness that can't catch the bugs that motivated it isn't finished.

## Open questions

1. **Should `ng add` generate a `web` environment?** Recommended: yes. Layer 3 needs it, the examples already have it, and users get a browser preview.
2. **Which package managers do we support?** The scaffolder is npm-only today. This decides the Layer 4 matrix and what the docs promise.
3. **What's the minimum Node version?** No package declares `engines` yet. Pick one and test it.
4. **Required or advisory to start with?** Recommended: advisory for about a week to shake out flakiness, then required.
5. **Use staged publishing with human approval?** It's the strongest gate, but every release then needs a maintainer with 2FA.
6. **When does iOS run on pull requests?** Decided: on every PR, together with Android.
7. **Do we need physical devices?** Recommended: not yet. The simulator catches correctness bugs; revisit before 1.0.

## Related hardening

These are cheap to do alongside the E2E work:

- **Derive `@blotch/*` versions in `ng-add/versions.ts` from the runtime's own version at build time,** as the scaffolder now does. That removes a place where versions can drift apart.
- **Share one list of publishable packages** between `publish.yml` and the harness (see above).
- **Add schematic unit tests with `SchematicTestRunner`.** They give feedback in seconds on template bugs like the missing `LYNX_ELEMENTS` import. They add to Layer 2 but don't replace it, because they don't compile or build the result.
- **Add `engines` fields** to the published packages once the minimum Node version is decided.
