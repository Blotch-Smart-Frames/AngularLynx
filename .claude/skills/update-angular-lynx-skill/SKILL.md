---
name: update-angular-lynx-skill
description: Keep the public angular-lynx skill (skills/angular-lynx, which apps install with `npx skills add Blotch-Smart-Frames/AngularLynx`) current. `content` brings it up to date with what's merged since the last release; `installed` refreshes the copies installed in other repositories on this machine; no argument does both. The release skill runs `content` before its release PR and `installed` after publishing. Use when the user asks to update, sync or refresh the angular-lynx skill, or says a copy of it is stale.
metadata:
  internal: true
---

# Update the public angular-lynx skill

`skills/angular-lynx` is the skill app developers install to write Angular for Lynx. The skills
CLI installs it from this repository's master on GitHub into other repositories, and records each
install in that repository's `skills-lock.json`. It goes stale in two ways, and each part of this
skill fixes one:

- **`content`:** the skill lags the code. A PR changed what an app developer writes, or found a
  Lynx difference, without updating the skill.
- **`installed`:** a repository's copy lags master, because nobody has run `npx skills update`
  there since the skill changed.

With no argument, do both, `content` first: the copies should pick up the updated content once
it's merged.

Do branch work in a git worktree outside the main checkout, which may be in use, and run git with
`git -C <dir>`. The shell may be zsh, which doesn't split an unquoted variable into words, so write
each command out in full.

## Part 1: `content`

### 1. Find the commits the skill hasn't caught up with

```bash
git -C <main> fetch --prune origin
git -C <main> tag --list 'v*' --sort=-creatordate | head -1
node <main>/.claude/skills/update-angular-lynx-skill/scripts/uncovered-commits.mts <last tag>
```

The script lists each commit since the last tag (or a base the user names) that changed code apps
use without touching `skills/angular-lynx`, with the packages it changed. "Code apps use" means
every published package in `packages/release/src/packages.ts`, plus `packages/ui`, whose
components dolan copies into apps. It leaves out tests, release commits, and commits that already
updated the skill: their PRs did this check.

Also look at what the range added to `investigations/lynx-vs-web-differences.md`, where Lynx
differences found while fixing bugs are recorded:

```bash
git -C <main> diff <last tag>..origin/master -- investigations/lynx-vs-web-differences.md
```

### 2. Decide what belongs in the skill

Read `skills/angular-lynx/SKILL.md` and its reference files first. The skill tells someone writing
an Angular app for Lynx how to set it up, build, test and debug it, how to write templates and
components for Lynx elements, and what behaves differently from the web. A commit needs a change
to the skill when it:

- adds something an app uses: an API, a directive, a builder option, a schematic or a CLI flag
- changes behavior that an app's code or tests can notice
- records a new Lynx difference or gotcha
- makes something the skill says untrue: search the skill for each API or option the commit
  touched (`grep -rn <name> <main>/skills/angular-lynx`)

Leave out internal refactors, tests, CI, the website, and a dolan component's own options. Those
options are documented on the website. The skill only points to `npx @blotch/dolan add <name>`
where a component saves writing something by hand, as `routing.md` does for the tab bar and the
navigation bar.

For each commit you keep, read its diff, its PR (`gh pr view <number>`) and the source as it is on
master. Write what the code does now: check a PR description's claims in the source before
repeating them.

### 3. Edit the skill

In a worktree on a new branch from origin/master:

- Put each fact in the reference file whose topic covers it. `SKILL.md` indexes the references:
  change a section's summary only when what it names changes, and keep its counts and lists true.
- Write the way the reference already does: short sections, code that compiles, Lynx element and
  event names (`<view>`, `(bindtap)`).
- Leave `metadata.version` alone. Installs track a hash of the content, not the version, and it
  hasn't been bumped so far.
- Check your work with `npx oxfmt --check skills/angular-lynx` from the repo root. The spell check
  doesn't cover this folder in CI, and some existing words fail it, so just make sure the lines you
  wrote pass:
  `npx cspell --no-progress 'skills/angular-lynx/**/*.md'`.

### 4. Land it

If nothing needs changing, say so, listing the commits you checked and why each stays out, and
stop.

Otherwise, commit as `docs: <what the skill now covers>`, push the branch, and open a PR. Its
description lists each change with the commit or PR it comes from, and the commits you left out
and why. The skills CLI installs from master, so users get the update once the PR is merged. Ask
the user to merge it. In a release, it has to merge before the release PR, so that the release and
the skill describe the same code.

## Part 2: `installed`

### 1. Find the installs

```bash
find ~/git -maxdepth 4 -name skills-lock.json -not -path '*/node_modules/*' -exec grep -l 'Blotch-Smart-Frames/AngularLynx' {} +
npx -y skills list -g
```

Each `skills-lock.json` that names `Blotch-Smart-Frames/AngularLynx` is a repository with a copy;
its `angular-lynx` entry has the source path and the hash of the copy. If the user keeps
repositories somewhere other than `~/git`, search there too. `skills list -g` shows whether the
skill is also installed globally, outside any repository.

The CLI installs what's on GitHub's master, so do this after the content you want has merged. Make
sure the main checkout's master matches origin, so you can compare against it:

```bash
git -C <main> fetch origin
git -C <main> diff --quiet origin/master -- skills/angular-lynx && echo "matches origin/master"
```

### 2. Refresh each repository's copy

Check that the repository isn't busy first:

```bash
git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD
git -C <repo> branch --show-current
git -C <repo> status --short
```

The repository has to be on its default branch and not mid-merge (no `.git/MERGE_HEAD`). Its skill
directories and `skills-lock.json` must have no changes. Untracked files elsewhere, such as another
tool's folder, are someone else's; leave them out of everything. Otherwise stop and ask: someone
may be working there.

```bash
git -C <repo> pull --ff-only
cd <repo> && npx -y skills update angular-lynx -p -y
git -C <repo> status --short
diff -r <main>/skills/angular-lynx <repo>/<copy's directory>
```

Name `angular-lynx`: a plain `npx skills update` refreshes every installed skill, which brings in
changes nobody asked for. The copy usually lives in `.agents/skills/angular-lynx`, with each
agent's skill directory (such as `.claude/skills/angular-lynx`) a symlink to it. `git status`
shows which paths changed, and `diff -r` must come out empty. If the harness refuses to run the
skills CLI, ask the user to run it with `! cd <repo> && npx -y skills update angular-lynx -p -y`,
and carry on from `git status`.

If nothing changed, the copy was already current. Otherwise, stage only the copy's paths and
`skills-lock.json` (`git -C <repo> add -- <paths> skills-lock.json`). Commit them with the message
that repository's earlier refreshes used:

```bash
git -C <repo> log --format=%s -3 -- skills-lock.json
```

It's another repository's history, so ask the user before pushing it, unless they've said to.

For a global install, run `npx -y skills update angular-lynx -g -y`. There's nothing to commit.

## Report

- `content`: the commits you checked, each change you made and the commit it came from, the
  commits you left out and why, and the PR
- `installed`: each repository and whether its copy changed, the commit, and whether it's pushed;
  and the global install, if there is one
