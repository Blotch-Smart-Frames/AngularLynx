---
name: release-minor
description: Release AngularLynx on a new Angular minor, such as 22.3.0 when Angular 22.3 comes out. Waits until Angular and Angular CLI have both published the minor, offers to release what's on master as the old minor's last patch first, moves every Angular range and the published packages' peer ranges to the new minor, checks the rsbuild plugin against @angular/build's internals, sets the version to X.Y.0 and opens the PR. Once that's merged, it tags and publishes the release the way the release skill does. Use when Angular has released a new minor, when an "Update Angular to X.Y" issue is open, or when the user asks for a minor release or to move to Angular X.Y. Patches go through the release skill, and majors through update-angular.
invocationControl: user
metadata:
  internal: true
---

# Minor release: move AngularLynx to a new Angular minor

The published packages are versioned after Angular's major and minor: AngularLynx 22.2.x is for
Angular 22.2. So a new Angular minor means releasing AngularLynx X.Y.0, and that takes more than a
version bump:

- **The peer ranges move to `^X.Y.0`.** Once the lockfile is on X.Y, CI never tests the old minor
  again, so a range that still allowed it would promise support that nothing checks. The raised
  floor also steers Angular's own tools. In an app still on the old minor,
  `ng add @blotch/angular-lynx` looks back for the newest release whose peers the app satisfies,
  which is the old minor's last patch. And `ng update @blotch/angular-lynx` on its own refuses
  until Angular moves with it.
- **The rsbuild plugin loads `@angular/build`'s internals** (`build-internals.ts`), which a minor
  can reshape. In 22.2, `JavaScriptTransformer` moved, `compilation.initialize()` changed and
  `hostOptions.sourceFileCache` was removed (2e28aa53).
- **`@angular/build`'s builders can gain options**, and AngularLynx's builders and schematics copy
  their schemas.

This skill covers the minor's own work (steps 1–6), then hands over to the `release` skill to tag
and publish. A patch release uses only the `release` skill, and a major goes through
`update-angular` first.

Where the skill and the repository disagree, the repository is right, so say what changed when you
report. Do the branch work in a git worktree outside the main checkout, which may be in use. Run
git there with `git -C <dir>`. The shell may be zsh, which doesn't split an unquoted variable into
words, so write each command out in full.

## 1. Check that both halves of Angular X.Y are out

```bash
npm view @angular/core dist-tags --json
npm view @angular/build dist-tags --json
jq -r '.packages["node_modules/@angular/core"].version' <main>/package-lock.json
node -p "require('<main>/packages/runtime/package.json').version"
gh issue list --label angular-release --state open
```

- **Angular's `latest` is on the repository's minor:** there's no minor to release. A patch goes
  through the `release` skill.
- **Angular's `latest` is a new major:** that's `update-angular`, so stop and say so.
- **`@angular/core` is on X.Y but `@angular/build` isn't:** stop and wait. Angular and Angular
  CLI publish separately, sometimes a day or more apart. `npm create angular-lynx` runs
  `@angular/cli@<major>` and then `ng add @blotch/angular-lynx@<its own version>`. So an X.Y.0
  whose peers need `@angular/build ^X.Y.0`, published while the CLI's `latest` is still
  X.(Y-1), breaks every new app. `angular-release.yml` checks npm hourly and starts a builds run
  when the CLI's release lands, so come back then.

The open `angular-release` issue ("Update Angular to X.Y", opened by `angular-release.yml`) is the
one the PR closes.

Then see whether master already builds on X.Y:

```bash
gh run list --workflow angular-release-builds.yml --limit 5 --json displayTitle,conclusion,databaseId
gh issue list --label angular-release-builds --state open
```

Each run is named after the releases it built on, such as "Builds on Angular X.Y.0 and Angular CLI
X.Y.0". It runs CI and the full E2E matrix on master, with every Angular package moved to its
newest release. A green run on both X.Y releases means master works on X.Y as it is, so the move
should need no code. A red run, or an open `angular-release-builds` issue, shows what step 4 will
have to fix. If no run has covered both yet, carry on: the PR's own checks in step 6 cover the
same ground.

## 2. Offer the old minor's last patch first

```bash
git -C <main> fetch --prune origin
git -C <main> tag --list 'v*' --sort=-creatordate | head -1
git -C <main> log --oneline <last tag>..origin/master
```

If anything apps would notice has merged since the last tag, ask the user whether to release it
as the old minor's next patch first, with the `release` skill, and come back here afterwards. It's
their call. The reasons to do it:

- It keeps master's changes and the Angular move in separate releases, so a problem that appears
  after X.Y.0 points at the move.
- It gets those changes to apps that stay on Angular X.(Y-1). Once X.Y.0 raises the peers, `ng add`
  gives those apps the old minor's last patch. AngularLynx keeps no maintenance branch for an old
  minor (Angular stops patching one too), so that patch is the last they get.

If they skip it, the unreleased commits go in this PR's "In this release" section.

## 3. Move the ranges and set the version

```bash
git -C <main> worktree add -b chore/release-X.Y.0 <scratchpad>/wt-release-X.Y origin/master
cd <scratchpad>/wt-release-X.Y
node .claude/skills/release-minor/scripts/move-angular-ranges.mts X.Y --dry-run
```

The script reads the root `package.json` and each workspace's (`packages/*` and `examples/*`).
It moves:

- every `@angular/*`, `@angular-devkit/*`, `@schematics/angular` and `ng-packagr` range to
  `^X.Y.0`
- the `0.MMmm` ones (`@angular-devkit/architect`) to `^0.XXYY.0`
- the published packages' peer ranges on each other (the testing library's on
  `@blotch/angular-lynx`), which `set-version` doesn't touch, since it moves only exact pins

It leaves alone a range that isn't a plain `^` or `~` range, and lists it. The build's
`>=0.2200.0 <0.2300.0` architect peer covers the whole major, and the matching bounds in
`renovate.json` and `.github/dependabot.yml` move with `update-angular`. It also checks that npm
has every version it would move to, and changes nothing if one is missing.

Read the dry run's peer ranges. Every peer each published package has on Angular, and the testing
library's on the runtime, should be listed and moving to `^X.Y.0`. If one is missing, or anything
else is under "Left alone", find out why before going on. Then write the ranges, set the version
and install. Run the npm commands here, and the lockfile fix in step 6, under the npm that
`packageManager` pins, set up the way the `release` skill's step 4 describes. `set-version`
rewrites the lockfile, and another npm major rewrites its flags too.

```bash
node .claude/skills/release-minor/scripts/move-angular-ranges.mts X.Y
npm run set-version X.Y.0
node packages/release/src/check-version.ts X.Y.0
npm ci
jq -r '.packages | to_entries[] | select(.key | test("node_modules/(@angular|@angular-devkit|@schematics)/")) | "\(.key) \(.value.version)"' package-lock.json | grep -vE ' (X\.Y\.|0\.XXYY\.)'
```

`set-version` finishes with `npm install --package-lock-only`, which resolves the moved ranges, so
the lockfile moves to X.Y in the same step and `npm ci` installs it as written. The last command
lists any Angular package the lockfile still holds at the old minor. Some other package pinning
it is the usual cause; find that package with `npm ls <name>`.

## 4. Check the plugin against `@angular/build` X.Y

List what the plugin loads from inside `@angular/build`. That's the paths it passes to
`loadAngularBuildInternal()`, plus whatever it imports from `@angular/build/private`
(`src/private.d.ts`):

```bash
git grep -nE "loadAngularBuildInternal|@angular/build/(src|private)" -- packages/rsbuild-plugin-angular-lynx/src
```

Diff those files between the old and new releases. Unpack both into a new, empty folder in the
scratchpad. Only read what's in them; never run it.

```bash
mkdir <scratchpad>/angular-build-diff
cd <scratchpad>/angular-build-diff
npm pack @angular/build@<old version> @angular/build@X.Y.<p> --silent
mkdir old new
tar -xzf angular-build-<old version>.tgz -C old
tar -xzf angular-build-X.Y.<p>.tgz -C new
git diff --no-index --stat old/package/src new/package/src
git diff --no-index old/package/src/tools/angular/compilation new/package/src/tools/angular/compilation
```

Run the last command for each path from the grep, and diff `src/private.d.ts` too. Look for
anything the plugin calls that changed: a moved or renamed export, a different argument or options
object, a method removed. Then build and test in the worktree:

```bash
npm run build
npm test
```

The build type-checks `build-internals.ts` against the new declarations, so a changed signature
fails it. Two test files compare AngularLynx's copies of Angular's schemas with the installed ones:

- `packages/build/builders/builders.test.ts`: the unit-test and extract-i18n builders' options,
  and `ANGULAR_BUILD_OPTIONS` against the application builder
- `packages/runtime/schematics/component/schema.test.ts`: the component schematic

When Angular added an option, copy it over the way `update-angular`'s step 13 describes, so
AngularLynx's builders and schematics take it too.

Fix what fails in this PR. Code that only works on X.Y is fine, because the peers no longer allow
X.(Y-1).

## 5. Update what names the old minor, and check for migrations

```bash
git grep -nE "\^X\.(Y-1)\.|X\.(Y-1)\.0" -- ':!**/package-lock.json' ':!**/package.json'
```

Change the lines that state the current minimum or give ranges to copy. Leave history alone, such
as "since Angular 22.2 the router…", "how 22.2.1 was published…", or "`@boundary` needs Angular
22.2 or newer". So far, the lines that needed changing have been:

- the full E2E matrix's leg for the lowest Angular the peers allow, in
  `.github/workflows/e2e.yml` (`"Angular X.(Y-1).0"`, `--angular X.(Y-1).0`), and the row of
  `E2E_TESTING_PLAN.md`'s version table that describes it
- the `package.json` template in `.claude/skills/create-example/SKILL.md`
- the dependencies example in `skills/angular-lynx/references/build-configuration.md`

The public skill must change in this PR (see CLAUDE.md), so run the `update-angular-lynx-skill`
skill with `content` for anything else it says about versions.

Leave `benchmarks/` alone. Its apps pin exact versions on purpose, its results record what was
measured, and `benchmarks/apps/angular-lynx` moves by hand when it's re-run (see its README).
Note in the report that its next `use-local-packages.mjs` run needs its Angular pins moved to X.Y
first, or the new peer ranges refuse the install.

Then check for migrations the way the `release` skill's step 3 does. The Angular move alone needs
none: Angular's own changes come through `ng update @angular/core`, and builder options copied in
step 4 are optional.

## 6. Open the PR

```bash
npm run format:check
npm run lint
npm run cspell
git diff --stat
```

Commit the changes as `chore: Release X.Y.0 on Angular X.Y`, push the branch, and open a PR with
that title. Write the description like this:

````markdown
Moves AngularLynx to Angular X.Y and sets every published package to X.Y.0, ready to tag
`vX.Y.0`. Closes #<the angular-release issue>.

## What changes

- **Angular X.Y.** Every Angular range in the packages and the <n> examples is `^X.Y.0`. The
  lockfile has Angular X.Y.<p> and Angular CLI X.Y.<p>.
- **Peer ranges.** The published packages now need Angular X.Y (`^X.Y.0`), and the testing library
  needs AngularLynx X.Y. The full E2E matrix's lowest-Angular leg moves up to X.Y.0 with them.
- **Versions.** All <n> published packages are at X.Y.0, and so are the exact pins between them.
- **`@angular/build`'s internals.** <What step 4's diff showed for the files the plugin loads, and
  what the plugin changed to match, or that they're unchanged.>
- <Builder or schematic options copied from Angular, and docs and skill lines updated.>

## Updating an app

```sh
ng update @angular/core @angular/cli @blotch/angular-lynx
```

In an app still on Angular X.(Y-1), `ng update @blotch/angular-lynx` on its own stops at the peer
check. <No new migrations, or the one this ships.> An app that stays on Angular X.(Y-1) keeps
X.(Y-1).<last>, which is what `ng add` installs there.

## In this release

<As the release skill writes it, for the commits since the last tag. Or: "Nothing else.
X.(Y-1).<last> released everything merged before this.">

## Testing

- `npm run build`, `npm test`, lint, format and cspell pass on Angular X.Y.
- `e2e.yml` with the full matrix and the native platforms, on this branch: <run link>
- `check-version.ts X.Y.0` passes.
- `publish.yml` runs the full E2E release gate on the tag before it publishes anything.
````

Then run the full E2E matrix on the branch:

```bash
gh workflow run e2e.yml --ref chore/release-X.Y.0 -f matrix=full -f native=true
```

The PR's own checks run only the default E2E configuration, while the release gate on the tag
runs the full matrix. A failure first found at the tag means deleting and moving a pushed tag,
which is what happened to 22.2.11's Windows leg.

If master moves while the PR is open, merge it into the branch. Run the range script again: it's
safe to rerun, and it catches any example added since. Then resolve a `package-lock.json`
conflict by taking master's file and running `npm install --package-lock-only --ignore-scripts`,
with the pinned npm.
If a Renovate or Dependabot PR is open for the Angular group, say in the description that this PR
replaces it, and close it after the merge if it doesn't close itself.

## 7. Merge, tag and publish

Follow the `release` skill from its step 5 (waiting for the checks and having the PR merged) to its
end, with X.Y.0 as the version. Add three things:

- **Before tagging,** check that the peers are what you meant on the merge commit:
  `git -C <main> show <merge commit>:packages/runtime/package.json | jq .peerDependencies`. Check the
  plugin's and the testing library's the same way.
- **The GitHub release** puts the update command above GitHub's generated notes. `gh` puts
  `--notes` before them when both are given:

  ```bash
  gh release create vX.Y.0 --verify-tag --title vX.Y.0 --generate-notes --latest \
    --notes $'AngularLynx X.Y is for Angular X.Y. To update an app:\n\n```sh\nng update @angular/core @angular/cli @blotch/angular-lynx\n```'
  ```

- **The report** adds what step 4 found in `@angular/build`'s internals, the benchmark app's pins,
  and that the `angular-release` issue is closed. Close it yourself if the merge didn't.
