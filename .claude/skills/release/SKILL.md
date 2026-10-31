---
name: release
description: Cut an AngularLynx release. Pick the version, open the PR that sets every published package to it, and once that's merged, tag it, watch publish.yml through the E2E release gate and the npm publish, and create the GitHub release. Use when the user asks to cut, ship or publish a release, bump the published version, or release what's on master.
invocationControl: user
metadata:
  internal: true
---

# Release: publish what's on master to npm

The packages in `packages/release/src/packages.ts` publish together, at one version, when a
`v<version>` tag is pushed: the tag starts `.github/workflows/publish.yml`. The workflow refuses a
tag that doesn't match the version in the repository (see `packages/release/README.md`). So the
version reaches master through a PR first, and the tag goes on that PR's merge commit.

Do the branch work in a git worktree outside the main checkout, which may be in use. Run git there
with `git -C <dir>`. The shell may be zsh, which doesn't split an unquoted variable into words, so
write each command out in full.

## 1. Check that master is ready

```bash
git -C <main> fetch --prune origin
git -C <main> tag --list 'v*' --sort=-creatordate | head -1
git -C <main> log --oneline <last tag>..origin/master
gh run list --branch master --limit 6 --json name,status,conclusion,headSha
gh pr list --state open
```

- **Nothing since the last tag:** there's nothing to release, so say so and stop.
- **CI or E2E failed on origin/master's head commit:** stop and report it. If they're still
  running, wait for them.
- **Open PRs:** list them for the user, who may want one in the release.

## 2. Pick the version

The version follows Angular's major and minor. Every release bumps the patch, even one that's
mostly features: 22.2.4 had nine.

```bash
npm view @angular/core version
node -p "require('<main>/packages/runtime/package.json').version"
```

- **Same major and minor as Angular's `latest`:** the next patch, so 22.2.4 becomes 22.2.5.
- **Angular has moved to a new minor or major:** that's an Angular update (the `update-angular`
  skill) before a release, so ask the user.
- **The user named a version:** use it, but say so if it breaks the convention.

## 3. Check whether apps need a migration

`ng update @blotch/angular-lynx` runs the migrations in
`packages/runtime/schematics/migrations.json`. Read the commits since the last tag for anything an
app must change itself, such as a renamed or removed builder option, or a schematic that writes
something different. A migration is its own PR, before the release, so stop and tell the user.

Also note changes an app's own code may notice that no migration covers. Two examples from 22.2.5:
a testing library event that now reaches more handlers, and a dolan component method that gained a
parameter. They go in the PR body.

## 4. Open the release PR

```bash
git -C <main> worktree add -b chore/release-<version> <scratchpad>/wt-release origin/master
cd <scratchpad>/wt-release
npm run set-version <version>
node packages/release/src/check-version.ts <version>
git diff --stat
```

`set-version` changes nothing but versions: each published package's `version`, the build
package's exact pins on the rsbuild plugin and the native builder, and the lockfile's copies of
them. That was 8 files and 18 lines for 22.2.5. If the diff holds anything else, stop and look. The
worktree needs no `npm install`.

Commit it as `chore: Release <version>`, push the branch, and open a PR with that title. Model the
body on #171 (22.2.5) and #133 (22.2.4):

```markdown
Sets every published package to <version>, ready to tag `v<version>`. It releases everything
merged since <previous> (#<first> to #<last>). It's a patch, so the version stays in step with
Angular's (<angular version> is Angular's `latest`).

## What changes

- **Versions.** All <n> published packages are at <version>. So are the build package's exact
  pins on the rsbuild plugin and the native builder. The lockfile changes only those lines.
- Nothing else.

## `ng update`

No new migrations: nothing merged since <previous> needs an app to change. <Then any change an
app's own code may notice, one bullet each.>

## In this release

Since <previous>: <n> features, <n> fixes and <n> <other kind>.

- **Features:**
  - <one line per PR, in the user's terms, ending with (#number)>
- **Fixes:**
  - ...

## Testing

- `npm run set-version <version>` exits 0.
- `check-version.ts <version>` passes: every package and pin is at <version>.
- `publish.yml` runs the full E2E release gate on the tag before it publishes anything.
```

Sort the commits by their prefix (`feat`, `fix`, `test`, `ci` and so on). Group related features
under their tracking issue, as Liquid Glass sits under #118. Take the number of published packages
from `packages.ts`: it was seven for 22.2.5, but the list can grow.

## 5. Wait for the checks, then have the PR merged

Wait in the background until no check is pending:

```bash
until gh pr checks <pr> --json bucket | jq -e 'length > 0 and all(.bucket != "pending")' >/dev/null; do sleep 60; done
gh pr checks <pr>
```

Every check must pass, including the native iOS and Android E2E runs. Merging is the user's call:
ask them to squash-merge the PR, unless they've told you to merge it yourself. Auto mode refuses
`gh pr merge` as a merge without review.

## 6. After the merge: clean up and tag

Clean up `chore/release-<version>` the way the `post-merge-cleanup` skill does: prove it merged,
remove its worktree, delete the branch, and fast-forward master in the main checkout. Then check
the version, and tag the merge commit:

```bash
gh pr view <pr> --json state,mergeCommit --jq '"\(.state) \(.mergeCommit.oid)"'
node <main>/packages/release/src/check-version.ts <version>
git -C <main> tag -a v<version> -m "v<version>" <merge commit>
git -C <main> push origin v<version>
```

Earlier tags are annotated, with the version as their message. Tag the merge commit by its hash,
not HEAD, in case master has moved on.

## 7. Watch publish.yml

```bash
gh run list --workflow publish.yml --limit 1 --json databaseId,headBranch,status
until [ "$(gh run view <run> --json status --jq .status)" = "completed" ]; do sleep 60; done
gh run view <run> --json conclusion,jobs --jq '"\(.conclusion)", (.jobs[] | "\(.conclusion) \(.name)")'
```

Run the wait in the background: the whole run takes about half an hour. Its jobs, in order:

1. `version`: every package is at the tag's version.
2. `verify`: the E2E release gate, which is `e2e.yml` with the full matrix and the native runs.
3. `publish`: publishes the tarballs the gate tested, through npm's OIDC trusted publishing.
4. `wait-for-npm`: waits until npm lists the version.
5. `post-publish`: builds a fresh app from the packages on npm.
6. `report-post-publish`: files an issue, but only when `post-publish` failed.

A red run isn't always a failed release. Read each failed job's log
(`gh run view <run> --job <job id> --log-failed`):

- **An experimental leg** (`fresh-app` with Angular next, rspeedy latest, pnpm or Yarn): these
  have `continue-on-error`, so they never stop the publish. Check the latest nightly too
  (`gh run list --workflow e2e.yml --event schedule --limit 1`). If the leg fails there as well,
  the release didn't cause it. As of 22.2.5, pnpm fails with `ERR_PNPM_IGNORED_BUILDS`, because
  pnpm's latest version refuses the build scripts of esbuild and other toolchain dependencies.
- **`version` failed:** the tag doesn't match the repository, usually because it's on the wrong
  commit. Nothing was published.
- **A required `verify` leg failed:** nothing was published. Fix it on master in a PR, then move
  the tag to the fixed commit (v22.2.4's tag is on #134, a commit after its release PR #133).
  Moving a pushed tag means deleting it on origin, so ask the user before running
  `git push origin :refs/tags/v<version>`.
- **`publish` failed partway:** some packages may be on npm already. Run the status script from
  step 8 to see which, and report it. Don't republish packages one at a time.
- **`post-publish` failed:** the packages are on npm, and `report-post-publish` has filed an issue
  titled "Published <version> fails the post-publish E2E check", which suggests `npm deprecate`
  commands. First rule out registry lag. A 404 for a `.tgz` in the log means npm listed the
  version, which is all `wait-for-npm` waits for, before its CDN served the tarball. Once the
  status script shows every tarball served, re-run only that job, with
  `gh run rerun <run> --job <job id>`. If the re-run passes, the release is fine: say so on the
  issue and close it, or ask the user to if you can't. If the job fails for any other reason, the
  release may be broken. Don't deprecate anything yourself; report it to the user, along with the
  issue.

## 8. Check npm

```bash
node <main>/.claude/skills/release/scripts/npm-status.mts <version>
```

It passes when npm lists every package at the version, tags it `latest`, and serves its tarball.

## 9. Create the GitHub release

`publish.yml` doesn't create one. Once the packages are on npm, create it with GitHub's generated
notes ("What's Changed" and the full changelog), as every earlier release has:

```bash
gh release create v<version> --verify-tag --title v<version> --generate-notes --latest
```

## 10. Report

Give a short summary:

- the version, the release PR and its merge commit, and the tag
- the publish run: its result, and each failed job and why (an experimental leg, or registry lag
  fixed by a re-run)
- what the status script showed for npm
- the link to the GitHub release
- anything left for the user, such as an auto-filed issue, an experimental leg that's still
  failing, or a remote branch that's still there
