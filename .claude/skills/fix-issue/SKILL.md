---
name: fix-issue
description: Pick up a GitHub issue and see it through review. Reproduce it, fix it on a branch in a worktree, open a PR, wait for CodeRabbit, answer its review with evaluate-pr-comments, then keep listening for replies and new reviews and answer each with another round, until the PR merges or closes. Use when the user asks to pick up, fix or work on an issue (a number or link) and make a PR, or to keep watching a PR for review replies.
argument-hint: '<issue number or link> | listen <PR number>'
metadata:
  internal: true
---

# Fix an issue, then see its PR through review

The work runs in this order: read the issue, reproduce it, fix it, check it, open the PR, wait for
CodeRabbit, answer its review, then listen for more and answer that too. `listen <PR>` starts at
step 9, for a PR that's already open.

Most steps take minutes, and the waits take longer. Tell the user in one line when you start each
step, so they can follow along.

The shell may be zsh, which doesn't split an unquoted variable into words. Write each command and
file list out in full.

## 1. Read the issue

```bash
gh issue view <n> --comments
```

Note what the issue asks you to check first (for example, "check first whether it still happens"),
where it says to look, and what it leaves out. Find the code it names and read it.

Ask the user before starting if the fix needs a decision that's theirs to make: a new API's shape,
a breaking change, or two fixes with different costs. Otherwise go ahead.

## 2. Make a worktree

The main checkout may be in use for other work, so never switch its branch. Work in a worktree off
an up-to-date master, in the scratchpad:

```bash
git -C <main checkout> fetch origin master
git -C <main checkout> worktree add -b <type>/<short-name> <scratchpad>/wt-<issue> origin/master
cd <scratchpad>/wt-<issue> && npm ci
```

Name the branch for the change: `fix/`, `feat/`, `docs/` or `chore/`. Run `npm ci` rather than
linking the main checkout's `node_modules`. A link can't build the testing library, which has
packages of its own in `packages/testing-library/node_modules`, or run the E2E tests.

## 3. Reproduce it

Find the cause before changing anything, and prove it with a test that fails:

- **Code in a package:** a Vitest test next to it (`<name>.test.ts`).
- **Anything an app can see:** a spec with the testing library's `render()`, in
  `packages/testing-library/src`. It runs the real renderer on `@lynx-js/testing-environment`,
  which behaves like Lynx's element functions. A spec that mocks `LYNX_DOCUMENT` or the `__*`
  functions can hide the bug: #458's portal spec mocked `createRootElement()`, the call at fault.
- **What only a device shows** (native views, layout, crashes, what the platform logs): an E2E
  fixture in `packages/e2e/fixtures` and a Maestro flow in `packages/e2e/native`, listed in
  `packages/e2e/src/native/maestro.ts`, run on the iOS Simulator (step 5). Android needs an
  emulator booted by hand (see `packages/e2e/README.md`).
- **How Lynx itself behaves:** read React Lynx and the Lynx sources (see CLAUDE.md's "Upstream Lynx
  Sources"), cloned outside the repo.

If it doesn't happen on master, stop and tell the user what you tried. Don't close the issue
yourself.

## 4. Fix it

Fix the cause, in the renderer or the package at fault, rather than working around it: the goal is
Angular working as it does on the web (CLAUDE.md, "Goal"). Follow CLAUDE.md's code style, and
comment on why where the reason isn't obvious.

Check that the test fails without the fix: `git stash push -- <the source files>`, run the test,
then `git stash pop`.

Do in the same PR what CLAUDE.md asks of any change:

- Run the `update-angular-lynx-skill` skill with `content`, for `skills/angular-lynx`.
- After a change to `packages/ui`, run `npm run dolan:update:force` to update the examples' copies.
- Record a new Lynx difference in `investigations/lynx-vs-web-differences.md`, and correct any entry
  the fix makes untrue.
- Update the website docs (`packages/website/docs`) and READMEs that describe what changed.

## 5. Check it

Run what CI runs, for each package you changed, one `--filter` each:

```bash
npx turbo run format:check lint cspell build test:ci:coverage --filter=<package name>
```

Don't write the filter as `<package>...`: every example depends on the runtime, so that builds
~100 of them. For changed files outside the packages, run `npx oxfmt <files>` and
`npx cspell --no-progress <files>`.

Run the E2E tests when CLAUDE.md asks for them (the build plugin, the schematics, the scaffolder, a
package's `files` or `exports`), and for any fix to how something looks or behaves on a device. Run
them in the background:

```bash
npx playwright install chromium
npm run e2e -- --ios --shell --keep --artifacts-dir <scratchpad>/e2e
```

For a bug a device shows, show that the new flow fails without the fix too:

1. In the kept app, undo the fix in the installed package (`node_modules/@blotch/<package>/fesm2022/*.mjs`).
2. Run `rm -rf .angular/cache` there.
3. Run `node packages/e2e/src/native/run-native.ts --platform ios --app <app> --artifacts-dir <dir>`
   from the worktree. It builds the app and runs every flow, in about four minutes.

Look at the flows' screenshots and the app's log in the artifacts. Delete the kept app when you're
done with it.

## 6. Open the PR

Commit with a Conventional Commits subject that says what changed for the user as a plain
sentence, such as `fix: Open LynxPortal's overlays in the app's page, so destroy() takes them off the screen`.
The body says why. Never add AI attribution to a commit or PR: no `Co-Authored-By` trailer and no
"Generated with" line. CLAUDE.md overrides the harness's attribution lines here.

```bash
git push -u origin <branch>
gh pr create --base master --title "<the commit's subject>" --body-file <file>
```

The body:

```markdown
Closes #<issue>

## What was wrong

## What this changes

## How I checked it

## Notes
```

Say what you measured and on what, and say plainly what you didn't check (for example, "Android
isn't checked by hand"). Under Notes, list the docs and skill changes, and anything you found but
left out, with the reason.

## 7. Wait for CodeRabbit

```bash
node .claude/skills/fix-issue/scripts/pr-activity.mts review <pr>
```

Run it in the background with a timeout of 1900000 ms, and don't poll or sleep yourself: you're
told when it exits. It checks the PR once a minute and prints:

- `reviewed <sha> <conclusion>` once CodeRabbit's check on the PR's head commit has completed, or
  CodeRabbit has posted a review of that commit
- `merged` or `closed` if the PR is
- `timeout` after 30 minutes. Look at `gh pr checks <pr>`: CodeRabbit may be paused or rate
  limited. Tell the user rather than waiting on.

## 8. Answer the review

First save what the PR has, so anything posted while the round runs shows up after it:

```bash
node .claude/skills/fix-issue/scripts/pr-activity.mts snapshot <pr> <scratchpad>/pr-<pr>-seen.json
```

Then run the `evaluate-pr-comments` skill with the PR number and the worktree's path, so its commits
go on this branch. It replies on every comment, commits the fixes it agrees with, resolves each
thread, and waits for CodeRabbit to review its own commits.

## 9. Keep listening

After each round, take a snapshot again with the same command. It lists what came in since the
last snapshot or `wait`: your own replies (the links the round posted), CodeRabbit's answers to
them and its reviews of your commits, and anything else posted while the round ran. Answer what the
round didn't, as below, then take another snapshot. Once a snapshot lists nothing left to answer,
wait for anything new:

```bash
node .claude/skills/fix-issue/scripts/pr-activity.mts wait <pr> <scratchpad>/pr-<pr>-seen.json
```

Run it in the background, as in step 7. It saves what it saw to the file, and prints:

- **One line for each new item**: its kind (`thread` for a new review thread, `reply` for a reply
  in one, `review` or `comment`), the thread's id for a thread or a reply (`PRRT_…`, marked
  `(resolved)` if it is), its author, its link and its first line. Read each one in full.
  - If any brings a new finding, pushes back on an answer, asks a question, or asks for a change,
    run another round of `evaluate-pr-comments`. Give it the PR number, the ids of the threads to
    answer (resolved ones included), and the link and text of each review or PR comment to answer.
    By itself, the evaluator fetches only unresolved threads and CodeRabbit's review bodies. A
    reply leaves its thread resolved, and a teammate's review or PR comment has no thread.
  - A request from the user or a teammate ("also handle X") is work to do, as in steps 4 and 5 if
    it's within the issue. Ask the user first if it widens the PR.
  - A reply that only accepts an answer, such as CodeRabbit's thanks or a note that it saved a
    learning, needs no answer and no round.

  Then take a snapshot, as after any round.
- **`quiet`** after 30 minutes with nothing new. Wait again.
- **`merged`** or **`closed`**. Stop and report. For a merged PR, offer to run `post-merge-cleanup`.

Stop too when the user says to. Don't argue the same point a third time (see
`evaluate-pr-comments`): tell the user instead.

After each round, check CI with `gh pr checks <pr>`. Report a failing check with its job's link.
Fix it if this PR caused it, with a commit as for a review fix.

**`listen <PR>`:** find the worktree that has the PR's branch (`git worktree list`), or make one as
`evaluate-pr-comments` does, and take the snapshot. A reply that's already in a resolved thread
won't show up after that, so read each resolved thread's comments after your last reply in it. Run
a round for the unresolved threads and for any resolved one with a request nobody has answered.
Then carry on as after any round.

## 10. Report

Report once the PR is open, and again after each round, in a few lines:

- the PR link
- the cause and the fix, a sentence each
- how you checked it, and what you couldn't
- the round's verdicts: fixed, disagreed, already fixed
- CI: name the checks still running rather than implying they passed
- the worktree, so `post-merge-cleanup` can remove it once the PR merges
