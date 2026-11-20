<!-- cspell:ignore XCUI -->

# e2e: why the harness works the way it does

`README.md` covers running the tests, what each layer checks and how to debug a failure. This file holds the reasons behind the design. Before removing or loosening a check, find the bug it was added for: most of them come from a release that shipped broken with CI green.

## Why it exists

Releases 22.2.0 and 22.2.1 couldn't produce a working app, yet every CI check passed, with 100% unit test coverage. Every bug was in the gap between the source code and what a user installs. Unit tests run against `packages/*/src` and the monorepo's `node_modules`, so they could never see it. The monorepo's copy of `@angular/build` even carried the patch that hid one of the bugs.

| What broke                                                                        | Why unit tests missed it                                                                     | What catches it now                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `npm create angular-lynx` crashed (`npx -w` needs a workspace root)               | The scaffolder had never run outside the monorepo                                            | Layer 2 runs the README's command                 |
| `@blotch/angular-lynx` shipped without its library (10 files, 12.8 kB)            | Tests import source code, never the packed tarball                                           | Layer 1's required files and publint              |
| `ng add` silently did nothing (CommonJS schematics in an ES module package)       | `"type": "module"` only exists in the built `dist/package.json`, and `ng add` still exited 0 | Layer 1 loads every schematic as Angular CLI does |
| `ng add` generated an `app.ts` that didn't compile (`LYNX_ELEMENTS` not imported) | The schematics' output was never compiled                                                    | Layer 2 builds and type-checks the generated app  |
| The plugin needed a `postinstall` script that npm 11 skips                        | The monorepo runs its own workspace scripts, and the patch was already applied locally       | Layer 2's install-script check, and `npm latest`  |
| The plugin crashed on `ng new` configs (no `index`/`outputPath`)                  | Every fixture and example set both fields                                                    | Layer 2 builds what `ng new` generates            |
| 22.2.1 was published while the repository still said 22.2.0                       | `publish.yml` stamped the tag's version on at build time                                     | Layer 5's `check-version.ts`                      |

## Principles

- **Test what users install.** The packed tarballs, installed from a registry into an app outside the repository. Never import from `packages/*/src`.
- **The app lives outside the repository** (`os.tmpdir()`, or `$RUNNER_TEMP` in CI). Inside it, Node finds modules in the monorepo's `node_modules` and hides a missing dependency. That's how the patched `@angular/build` hid the `postinstall` bug.
- **Follow the documented path exactly:** `npm create angular-lynx`, `ng add`, `ng generate`, `npm run build`, `npm start`, as the README tells users to.
- **Check outcomes, not exit codes.** `ng add` exited 0 while doing nothing. Every step checks the files it was supposed to produce.
- **One harness, several triggers.** `e2e.yml` is the PR check, the nightly drift check, the release gate and the post-publish check.
- **Fast on pull requests, wide on a schedule.** PRs run one configuration; the full matrix runs nightly and in the release gate.
- **Failures explain themselves.** Each check's message says what broke and where to look, and a failed CI run uploads the generated app, the logs and screenshots.

## Why it's a workspace package

- **Its own dependencies.** Verdaccio, Playwright, publint, `@arethetypeswrong/cli`, `@lynx-js/web-core` and `@angular-devkit/schematics` stay out of every other package.
- **Build order.** It lists the published packages as `devDependencies` (`"*"`), so turbo's `^build` builds them before `npm run e2e` runs.
- **The same lint, format and cspell tasks** as the rest of the monorepo.

## Layers 1–3

- **Layer 1 reads the tarballs, not the folders.** publint and `attw` judge exactly what npm would publish, and the schematics load from the extracted tarball through `NodeWorkflow`, the way Angular CLI loads them. It also fails when a workspace package isn't private and isn't in `packages/release`'s publish list, so a new package can't ship untested.
- **Verdaccio never proxies `@blotch/*` or `create-angular-lynx`.** Only versions published by this run exist, so a broken local package can't be silently swapped for a working one from npm. The registry is thrown away after each run, so publishing the repository's own versions never clashes with real releases.
- **Every tool reaches Verdaccio through `NPM_CONFIG_USERCONFIG`.** `npm create`, `ng add` and `npm install` all run as child processes and inherit it.
- **Layer 2 type-checks with `ngc`, not just the build.** An `ng add` that generates code with type errors must fail the run even if the build plugin stops reporting them.
- **None of our packages may rely on an install script.** npm 11 skips dependencies' install scripts unless the user approves them.
- **The dev server gets its own checks** because `ng serve` takes paths `ng build` doesn't: watch mode, the rebuild coordinator, `LynxLogger`'s `.dev-logs`, and the web preview's isolation headers (`credentialless` for Chrome so images from other servers load, `require-corp` for Safari, which knows no other value).
- **Layer 3 renders the web bundle in Chromium** through Lynx for Web. Lazy chunk loading and event round trips only fail at runtime, so a build alone never catches them. Chromium has every browser API, though, so this layer can't see what only breaks natively; that's Layer 6.

## Layer 4: the matrix

Each full-matrix leg exists for a reason:

- **Windows and macOS:** the scaffolder builds shell commands, `cmd.exe` treats `^` as an escape character, and path separators differ. Windows only runs nightly and in the release gate, so 22.2.11's first release run failed on a `path.relative()` backslash in an import string (#257). For a change that touches paths, dispatch `e2e.yml` with `matrix: full` on the branch before merging.
- **The lowest Node Angular 22 supports:** proves the versions we claim actually work.
- **Exactly the lowest Angular the peers allow:** keeps the peer ranges' floor honest by installing an app on it, as a user on that release would (#571).
- **`npm@latest`:** npm 11's install-script blocking was exactly this kind of change.
- **Angular `next` and the latest rspeedy:** early warning of upstream changes. They're `experimental`, so they may fail without failing the run.
- **pnpm and Yarn:** also `experimental`. The scaffolder is npm-only, so they go through `ng new --package-manager` and `ng add`, and we don't promise they work yet.
- **The public registry:** the nightly run also installs what's on npm now, which catches a broken `latest` tag, a deprecation or a held version. A failing nightly opens or updates an `e2e-nightly` issue, so drift doesn't go unnoticed.
- **New Angular releases:** a fresh app installs a new Angular release the day it's published, while the monorepo's lockfile can lag for weeks. Angular 22.2.6 broke every new app's production build with CI green on 22.2.4 (#384). So `angular-release.yml` checks npm hourly and runs `ci.yml` and this matrix against each new release.

## Layer 5: the release gate

- **The tag must match the repository's version** (`check-version.ts`). The workflow used to stamp the tag's version on instead.
- **Publishing waits for the full matrix and the native platforms on the tagged commit**, then publishes the exact tarballs the gate tested. What users install is byte-for-byte what passed.
- **No `npm publish --dry-run` on pull requests.** A PR must never be able to start a publish, and npm rejects a dry run whenever the repository's version is already on the registry, which it is between releases. A manual dispatch of `publish.yml` from a branch runs the gate without publishing.
- **`wait-for-npm.ts` waits for every tarball, not just the listing.** npm lists a version before its CDN serves the tarball, and 22.2.5's post-publish check 404ed on one.
- **The post-publish check never deprecates by itself.** A failure opens an issue with the `npm deprecate` commands filled in, and a maintainer decides.

## Layer 6: native iOS and Android

- **Why web rendering isn't enough:** on a phone the app runs on Lynx's own engine and native renderer, split across a real main thread and background thread. A JavaScript global Lynx's engine lacks, a native element's layout (`<scroll-view>`, `<list>`, `<input>`, `<image>`) and the timing between the threads only break there.
- **Lynx Explorer** has a prebuilt simulator build per Lynx release and opens a bundle from a `lynx://open?url=` deep link, so a test opens the app with one command. It's a binary CI runs, so it's pinned with its SHA-256 and bumped on purpose, with the Lynx toolchain.
- **The app's own shell (`ng build --platform`) is tested too.** Explorer alone hid a shell that didn't register XElement's elements (#34), because Explorer registers them itself. Explorer stays for the dev path, where `ng serve` hands it a bundle URL.
- **Maestro, not XCUITest or Appium.** One YAML flow runs on both platforms and finds elements through the accessibility tree, so nothing is added to Explorer. XCUITest is iOS-only and needs our own Xcode project; Appium is heavier to run.
- **Native runs on every pull request,** not just nightly: a bug that only exists on Lynx's engine should block the merge rather than surface the next morning. Android is still `continue-on-error` until its flow has run reliably for a while.
- **One Maestro session per host, and timeouts everywhere** (#125). A session per flow spent as long starting Maestro's driver as running the flow, and a hung run used to last GitHub's six-hour default.
- **No physical devices yet.** There's no prebuilt Explorer for them, so it needs signing and a paid device farm. The simulator runs the same engine and native code, so it catches correctness bugs; devices mainly add performance and hardware differences. Revisit before 1.0, or when a bug shows up only on a device.

## Not decided yet

- **Staged publishing:** `npm stage publish`, with layers 2 and 3 run against the staged tarballs and a maintainer approving with 2FA. The strongest gate, but it adds a manual step to every release.
- **Making E2E a required check:** `master`'s ruleset requires `test`, `cspell`, `lint` and `format` only.
- **pnpm and Yarn support:** decides whether their legs stop being `experimental`, and what the docs promise.
