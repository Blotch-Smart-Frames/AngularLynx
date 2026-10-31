---
name: release
description: Cut an AngularLynx release. Pick the version, bring the public angular-lynx skill up to date, open the PR that sets every published package to the version, and once that's merged, tag it, watch publish.yml through the E2E release gate and the npm publish, create the GitHub release, and refresh the installed copies of the angular-lynx skill. Use when the user asks to cut, ship or publish a release, bump the published version, or release what's on master.
invocationControl: user
metadata:
  internal: true
---

# Release: publish what's on master to npm

The packages in `packages/release/src/packages.ts` publish together, at one version, when a
`v<version>` tag is pushed: the tag starts `.github/workflows/publish.yml`. The workflow refuses a
tag that doesn't match the version in the repository (see `packages/release/README.md`). So the
version reaches master through a PR first, and the tag goes on that PR's merge commit.

This skill describes the process. The details change from release to release, so read the current
ones from the repository as you go: the last tag and release PR, `packages.ts`, `publish.yml` and
`e2e.yml`. Where the skill and those files disagree, the files are right, so say what changed when
you report.

Do the branch work in a git worktree outside the main checkout, which may be in use. Run git there
with `git -C <dir>`. The shell may be zsh, which doesn't split an unquoted variable into words, so
write each command out in full.

## 1. Check that master is ready, and find the last release

```bash
git -C <main> fetch --prune origin
git -C <main> tag --list 'v*' --sort=-creatordate | head -1
git -C <main> log --oneline <last tag>..origin/master
gh run list --branch master --limit 6 --json name,status,conclusion,headSha
gh pr list --state open
gh pr list --state merged --search "chore: Release in:title" --limit 1
```

- **Nothing since the last tag:** there's nothing to release, so say so and stop.
- **CI or E2E failed on origin/master's head commit:** stop and report it. If they're still
  running, wait for them.
- **Open PRs:** list them for the user, who may want one in the release.

The last release PR (the final command) is the model for this one: its version reasoning, its
description, and how its tag and GitHub release were made.

## 2. Pick the version

```bash
npm view @angular/core version
node -p "require('<main>/packages/runtime/package.json').version"
```

The convention so far: the version follows Angular's major and minor, and every release bumps the
patch, even one that's mostly features. Check that the last release PR still says so.

- **Same major and minor as Angular's `latest`:** the next patch of the current version.
- **Angular has moved to a new minor or major:** that's an Angular update (the `update-angular`
  skill) before a release, so ask the user.
- **The user named a version:** use it, but say so if it breaks the convention.

## 3. Check whether apps need a migration

`ng update @blotch/angular-lynx` runs the migrations in
`packages/runtime/schematics/migrations.json`. Read the commits since the last tag for anything an
app must change itself, such as a renamed or removed builder option, or a schematic that writes
something different. A migration is its own PR, before the release, so stop and tell the user.

Also note changes an app's own code may notice that no migration covers. For example, a testing
library helper may now behave differently, or a component that dolan copies into apps may have
changed a method's signature. They go in the PR body.

## 4. Bring the public angular-lynx skill up to date

Run the `update-angular-lynx-skill` skill with the argument `content`. If the Skill tool isn't
available, follow `.claude/skills/update-angular-lynx-skill/SKILL.md` yourself. It checks the
commits since the last tag against `skills/angular-lynx`, the skill apps install to write Angular
for Lynx, and updates the skill where they changed something an app developer needs to know.

- **Nothing to change:** carry on, and mention the commits it checked in the report.
- **It opened a PR:** wait for its checks, and ask the user to merge it before you open the release
  PR. That way the release PR still changes nothing but versions, and the skill on master describes
  the code being released.

## 5. Open the release PR

```bash
git -C <main> worktree add -b chore/release-<version> <scratchpad>/wt-release origin/master
cd <scratchpad>/wt-release
npm run set-version <version>
node packages/release/src/check-version.ts <version>
git diff --stat
git diff -U0 | grep '^[-+][^-+]'
```

The diff should hold only versions:

- each published package's `version`
- the exact pins one published package holds on another (see `readInternalPins` in `packages.ts`)
- the lockfile's copies of them

So `--stat` lists `package-lock.json` and the `package.json` of each package in `packages.ts`, and
every changed line is a version or a pin. If it holds anything else, stop and look. The worktree
needs no `npm install`.

Commit it as `chore: Release <version>`, push the branch, and open a PR with that title. Write the
description the way the last release PR's is written (`gh pr view <number> --json body`), which so
far has been:

```markdown
Sets every published package to <version>, ready to tag `v<version>`. It releases everything
merged since <previous> (#<first> to #<last>). <Why this version: for a patch, that it stays in
step with Angular's, naming Angular's `latest`.>

## What changes

- **Versions.** All <n> published packages are at <version>. So are the exact pins between them.
  The lockfile changes only those lines.
- Nothing else.

## `ng update`

<No new migrations, or the migration it ships.> <Then any change an app's own code may notice,
one bullet each.>

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

Count the published packages in `packages.ts`. Sort the commits by their prefix (`feat`, `fix`,
`test`, `ci` and so on). Group features under a tracking issue when their PRs name one.

## 6. Wait for the checks, then have the PR merged

Wait in the background until no check is pending:

```bash
until gh pr checks <pr> --json bucket | jq -e 'length > 0 and all(.bucket != "pending")' >/dev/null; do sleep 60; done
gh pr checks <pr>
```

Every check must pass. Merging is the user's call: ask them to squash-merge the PR, unless they've
told you to merge it yourself. The harness may refuse `gh pr merge` as a merge without review
anyway.

## 7. After the merge: clean up and tag

Clean up `chore/release-<version>` the way the `post-merge-cleanup` skill does: prove it merged,
remove its worktree, delete the branch, and fast-forward master in the main checkout. Then check
the version, and tag the merge commit the way the last tag was made:

```bash
gh pr view <pr> --json state,mergeCommit --jq '"\(.state) \(.mergeCommit.oid)"'
node <main>/packages/release/src/check-version.ts <version>
git -C <main> cat-file -t <last tag>
git -C <main> tag --list --format='%(contents:subject)' <last tag>
git -C <main> tag -a v<version> -m "v<version>" <merge commit>
git -C <main> push origin v<version>
```

`cat-file -t` prints `tag` for an annotated tag: make this one annotated too, with the same kind of
message (so far, just the version). If it prints `commit`, the last tag was lightweight, so tag
without `-a` and `-m`. Tag the merge commit by its hash, not HEAD, in case master has moved on.

## 8. Watch publish.yml

Read the workflow's jobs first, so you know which run before the publish and which after:

```bash
sed -n '/^jobs:/,$p' <main>/.github/workflows/publish.yml | grep -E '^  [a-z-]+:$'
gh run list --workflow publish.yml --limit 1 --json databaseId,headBranch,status
until [ "$(gh run view <run> --json status --jq .status)" = "completed" ]; do sleep 60; done
gh run view <run> --json conclusion,jobs --jq '"\(.conclusion)", (.jobs[] | "\(.conclusion) \(.name)")'
```

Run the wait in the background, since the run includes the full E2E matrix and the native runs.
So far its shape has been:

1. a version check
2. the E2E release gate (`e2e.yml`)
3. the publish
4. a wait for npm
5. an install of the published packages into a fresh app
6. an issue filed when that install check fails

A red run isn't always a failed release. Read each failed job's log
(`gh run view <run> --job <job id> --log-failed`):

- **An experimental leg:** the entries marked `experimental: true` in `e2e.yml`'s matrix
  (`grep -n "experimental: true" <main>/.github/workflows/e2e.yml`). They have
  `continue-on-error`, so they never stop the publish. Check whether the same leg also fails on the
  latest nightly (`gh run list --workflow e2e.yml --event schedule --limit 1`). If it does, the
  release didn't cause it. Report it, and offer to file an issue if none exists.
- **The version check failed:** the tag doesn't match the repository, usually because it's on the
  wrong commit. Nothing was published.
- **A required leg of the release gate failed:** nothing was published. Fix it on master in a PR,
  then move the tag to the fixed commit. Moving a pushed tag means deleting it on origin, so ask
  the user before running `git push origin :refs/tags/v<version>`.
- **The publish failed partway:** some packages may be on npm already. Run the status script from
  step 9 to see which, and report it. Don't republish packages one at a time.
- **The post-publish install failed:** the packages are on npm, and the workflow has filed an
  issue about it, which suggests `npm deprecate` commands. First rule out registry lag. A 404 for
  a `.tgz` in the log means npm listed the version before its CDN served the tarball. Once the
  status script shows every tarball served, re-run only that job, with
  `gh run rerun <run> --job <job id>`. If the re-run passes, the release is fine: say so on the
  issue and close it, or ask the user to if you can't. If the job fails for any other reason, the
  release may be broken. Don't deprecate anything yourself; report it to the user, along with the
  issue.

## 9. Check npm

```bash
node <main>/.claude/skills/release/scripts/npm-status.mts <version>
```

It passes when npm lists every package in `packages.ts` at the version, tags it `latest`, and
serves its tarball.

## 10. Create the GitHub release

Check whether `publish.yml` creates the release itself (`grep -n "gh release" <main>/.github/workflows/publish.yml`).
So far it hasn't. In that case, once the packages are on npm, create it the way the last one was
made (`gh release view <last tag>`). So far that has meant GitHub's generated notes ("What's
Changed" and the full changelog):

```bash
gh release create v<version> --verify-tag --title v<version> --generate-notes --latest
```

## 11. Refresh the installed copies of the angular-lynx skill

Run the `update-angular-lynx-skill` skill with the argument `installed`, or follow its `SKILL.md`.
It finds the repositories on this machine that install the skill and refreshes each copy from
master. That includes step 4's update, if it made one. It commits in each repository, and asks
before pushing one.

## 12. Report

Give a short summary:

- the version, the release PR and its merge commit, and the tag
- the publish run: its result, and each failed job and why (an experimental leg, or registry lag
  fixed by a re-run)
- what the status script showed for npm
- the link to the GitHub release
- the angular-lynx skill: what step 4 changed (or the commits it checked and found nothing in), and
  which installed copies step 11 refreshed
- anything left for the user, such as an auto-filed issue, an experimental leg that's still
  failing, an unpushed copy, or a remote branch that's still there
- anything in the repository that no longer matches this skill, so it can be updated
