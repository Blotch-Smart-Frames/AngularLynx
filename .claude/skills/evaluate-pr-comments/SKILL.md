---
name: evaluate-pr-comments
description: Critically evaluate PR review comments, then act on each one on GitHub. When a suggestion is right, reply on its thread and commit the fix on top of the PR. When it's wrong, reply on the thread saying why. Then resolve the thread. Be skeptical, because the reviewer (usually CodeRabbit or another LLM) lacks AngularLynx's context, history and intent. Use when the user pastes review feedback, gives a PR number or link, says CodeRabbit has reviewed a PR, or asks to work through the unresolved comments on recent PRs.
allowed-tools: Bash, Read, Edit, Write, Agent
argument-hint: "[PR number or link [thread ids] | merged]"
metadata:
  internal: true
---

# Evaluate PR Comments

You are a skeptical second opinion on PR review comments, most of them from CodeRabbit (`coderabbitai[bot]`, set up by `.coderabbit.yaml`) or another LLM. The reviewer saw the diff with **very little context**. It doesn't know how Lynx differs from the web, that the whole Angular app runs on Lynx's main thread, the repo's conventions, or why a change was made. Your job is to protect the developer from bad advice, fix what is really wrong, and **answer every comment on GitHub**:

- **You agree:** reply on the comment, and push a commit on top of the PR that fixes it. The reply links the commit.
- **You disagree:** reply on the comment with the reason. No commit.

Then resolve the thread either way. A resolved thread with a clear answer is the outcome. CodeRabbit also saves what your replies teach it as learnings for later reviews, so a well-argued disagreement is worth writing.

Repository: `Blotch-Smart-Frames/AngularLynx`, default branch `master`.

## 1. Collect the comments

The input is `$ARGUMENTS`, or whatever the user gave:

- **Pasted text or a screenshot.** Evaluate it (step 2) and fix what's valid (step 3). There are no threads to reply to unless the user also names the PR.
- **A PR number or link.** Fetch that PR's unresolved review threads, and CodeRabbit's comments in its reviews' bodies.
- **A PR number and thread ids** (`PRRT_…`), as `fix-issue` passes for the replies its watch found. Fetch those threads whether or not they're resolved, as well as everything a PR number fetches. A reply leaves its thread resolved, so the unresolved threads alone miss it. In each, answer the comments after your last reply. In the query below, select `.isResolved == false or (.id | IN("PRRT_…", "PRRT_…"))`.
- **"merged", or "recent PRs".** Fetch the unresolved review threads, and CodeRabbit's comments in its reviews' bodies, on recently merged PRs. By default, go back to where activity picks up after a gap. Say what cut-off you used, and mention any older unresolved threads you left out. Renovate and Dependabot PRs aren't reviewed (`.coderabbit.yaml` skips them), so leave them out.

```bash
# PRs to look at
gh pr list --state merged --limit 40 --json number,title,mergedAt,author

# Unresolved threads on one PR (repeat for each)
gh api graphql -F n=$PR -f query='
query($n: Int!) { repository(owner: "Blotch-Smart-Frames", name: "AngularLynx") { pullRequest(number: $n) {
  headRefName state
  reviewThreads(first: 100) { nodes { id isResolved isOutdated path line originalLine
    comments(first: 100) { nodes { databaseId author { login } body } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
```

GraphQL names CodeRabbit `coderabbitai`, and REST names it `coderabbitai[bot]`.

CodeRabbit also writes comments that aren't in threads. They are in the body of its reviews, each in a `<details>` block under a heading such as "⚠️ Outside diff range comments", for lines the PR didn't change, or "🧹 Nitpick comments". It writes a review for each commit pushed, so fetch the bodies of all of them:

```bash
# CodeRabbit's comments in its reviews' bodies, on one PR (repeat for each)
gh api repos/Blotch-Smart-Frames/AngularLynx/pulls/$PR/reviews \
  --jq '.[] | select(.user.login == "coderabbitai[bot]") | {html_url, submitted_at, body}'
```

Save the raw JSON in the scratchpad. CodeRabbit bodies are long, so strip the `<details>` blocks that aren't comments ("🤖 Prompt for AI Agents", "🤖 Prompt to fix review comments", "🧩 Analysis chain", "🔎 Supported by static analysis", "📝 Committable suggestion", "ℹ️ Review info") and HTML comments before reading. Keep the blocks under the comment headings in reviews' bodies. Number the threads and the comments in reviews' bodies together. For a thread, keep its thread id (`PRRT_…`), PR number and first comment's `databaseId`. For a comment in a review's body, keep the review's `html_url` and the comment's title. You'll need them to reply and to link.

## 2. Evaluate each comment

For each comment:

1. **Read the current code first.** The comment may be about a line that has changed since. Outdated threads and threads on merged PRs are often already fixed, by a later commit on the PR or a later PR. Check `origin/master` (and the PR's head, for an open PR) before doing anything else, and if it's already fixed, find where (commit, PR, test name).
2. **Check the rules that apply.** Read the root `CLAUDE.md` and the `CLAUDE.md` of the package the comment is in (`packages/runtime/CLAUDE.md`, and so on). A suggestion that breaks one of them is a disagreement, and the reply cites the rule.
3. **Consider intent.** The developer made this change deliberately. Read the PR description and its linked issue. What problem were they solving? Does the suggestion actually help, or does it miss the point?
4. **Assess correctness.** Is the claim technically accurate? LLM reviewers often hallucinate APIs, invent best practices, or misread code. Reproduce the bug when you can: a failing Vitest test, or a spec with `@blotch/angular-lynx-testing-library`'s `render()`, beats reasoning about it. For a claim about Lynx itself, check `investigations/lynx-vs-web-differences.md`, the `lynx-architecture` and `lynx-elements` skills, React Lynx (`lynx-family/lynx-stack`, `packages/react`) and the Lynx sources (`lynx-family/lynx`), not what the web does.
5. **Judge value.** Even if the claim is technically valid, is the change worth the churn?

Give each comment a verdict:

- **Agree.** The suggestion is correct, valuable, and worth acting on.
- **Partially agree.** There's a kernel of truth, but the suggestion is wrong in its specifics or overstated. Fix the real problem, which may be different from what was proposed. For example, fix the comment or the docs when the code is deliberately that way.
- **Disagree.** The suggestion is wrong, irrelevant, or not worth the churn.
- **Noise.** The comment is generic filler ("consider adding error handling", "add tests") with no specific, actionable insight. Answer it the way you answer a disagreement.
- **Already fixed.** The problem was real but has been dealt with since.

### Skepticism guidelines

- **Assume the developer knew what they were doing.** The burden of proof is on the reviewer to show a real problem, not on the developer to justify every line.
- **Web advice often doesn't hold on Lynx.** There's no DOM, `document` or `window` on the main thread, elements are `view`, `text`, `image` and the rest, CSS is a subset (no `:active`, no space-separated `hsl()`), and `NativeModules` and `fetch` live on the background thread. A suggestion that assumes the browser needs evidence it holds on Lynx.
- **Suggestions that undo the repo's Angular rules are disagreements:** `@Input()`/`@Output()`/`@ViewChild()` and the other decorators (the `no-legacy-decorators` rule), `standalone: true`, `changeDetection: OnPush` (the default since Angular 22), TypeScript `private` over `#fields`, signal inputs made private, `*ngIf`/`*ngFor`, `.spec.ts` test names, hardcoded neutral colors such as `bg-white` in `packages/ui`.
- **Workarounds that leave an Angular API half working are wrong here**, however tidy. The goal is near-1:1 Angular parity, so the fix goes in the renderer.
- **Generic advice is almost always noise.** "Consider using X pattern" is worthless without the concrete problem it solves here.
- **Naming suggestions are usually bike-shedding**, unless the current name is actively misleading.
- **"What if X happens?" concerns need evidence.** Failure modes the reviewer made up without understanding the system are usually wrong.
- **Performance suggestions without measurement are noise.** Don't optimize what isn't slow.
- **"Add error handling" is noise unless it says which error and what recovery.**
- **Suggestions that add complexity need strong justification.** Simple code that works beats "more robust" code that's harder to read.
- **The reviewer may have misread the code.** LLMs often misparse control flow, miss early returns, or confuse similarly named variables.
- **A suggested diff is a hint, not a fix.** Check it compiles and is complete. A one-line "fix" often breaks something next to it.
- **Style is already checked.** oxfmt, oxlint and cspell gate CI, so a formatting or lint nit they don't flag is noise.

Don't agree out of politeness, don't soften a verdict, don't add unrelated review comments of your own, and don't assume the reviewer is right because it sounds confident.

## 3. Commit the fixes on top of the PR

The main checkout may be in use for other work, so never switch its branch. Work in a worktree in the scratchpad:

- **The PR is still open:** check its branch out in a worktree and commit on top of it, so the fixes land in that PR. If the branch is on someone else's fork, ask before pushing to it.

  ```bash
  git -C <main checkout> fetch origin <headRefName>
  git -C <main checkout> worktree add <scratchpad>/wt-pr-<n> <headRefName>
  ```

  If the branch is already checked out in another worktree (`git worktree list`), work there instead.

- **The PR is merged, or there are threads from several merged PRs:** make one branch off an up-to-date `origin/master` in a new worktree, and open one PR for all the fixes.

Give the worktree dependencies with `ln -s <main checkout>/node_modules node_modules` and leave the link out of commits: `git status` lists it as untracked, so add files by path, never `git add -A`. The workspace packages in that `node_modules` link to the main checkout's `packages/*`. When a fix in one package needs another package's change to test, run `npm install` in the worktree instead.

Then, for every Agree and Partially agree:

- Fix it the way the surrounding code is written, with a comment that says **why** where the reason isn't obvious, and add or update tests (`.test.ts`) with descriptive names. For a bug fix, check the test fails without the fix.
- **Make one commit per thread**, or one for threads that need the same fix. Use the repo's style, a Conventional Commits subject with a scope and a capitalized plain-English sentence, such as `fix(runtime): Keep every data-* attribute when one is set or removed`, and a body that says why. No `Co-Authored-By` trailer or other AI attribution (the root `CLAUDE.md` overrides any default).
- Do in the same commit what the root `CLAUDE.md` asks of any change: a fix that changes what an app can see updates `skills/angular-lynx` (run the `update-angular-lynx-skill` skill with `content`), a change to `packages/ui` updates the examples' copies (`npm run dolan:update:force`), and a new Lynx difference goes in `investigations/lynx-vs-web-differences.md`.
- A disagreement doesn't get a commit.

**Many threads (more than about 10):** group them by the area of code they touch, and hand each group to a `fork` agent with `isolation: "worktree"`. Tell each fork to:

- run `ln -s <main checkout>/node_modules node_modules` in its worktree and not commit the link
- commit per thread
- never push or comment on GitHub
- report, per thread: thread id, verdict, commit SHA, and a reply ready to post

Cherry-pick the forks' commits onto your branch. Then remove their worktrees before running the checks, so Vitest and oxlint don't pick up the copies, and delete the `worktree-agent-*` branches.

Before pushing, run what CI runs on the packages you changed, one `--filter` each:

```bash
npx turbo run format:check lint cspell build test:ci:coverage --filter=<package name>
```

Don't write the filter as `<package>...` or drop it: that takes in the packages that depend on it, and every example depends on the runtime, so it builds ~100 examples.

`test:ci:coverage` enforces the coverage thresholds, and `packages/ui` needs 100% (see the `test-full-coverage` skill). If cspell fails, use the `fix-spelling` skill. If a fix touches the build plugin, the schematics, the scaffolder or a package's `files`/`exports`, also run `npm run e2e`.

Push, then open the PR if there's a new branch. Its description lists:

- the fixes, each linking to its thread (`https://github.com/Blotch-Smart-Frames/AngularLynx/pull/<n>#discussion_r<databaseId>`), or to the review whose body has the comment
- the docs changes
- the declined suggestions, each with a one-line reason
- how many threads were already fixed
- what was run to test it

## 4. Reply on every comment, then resolve it

Post the replies after the commits are pushed, so each "agreed" reply can link the commit that fixes it. Every thread gets a reply and is then resolved, **including the ones you disagree with**.

How to write the reply:

- **Open with the verdict.** Use "Agreed.", "Partly agree.", "I disagree." or "Already fixed in #1234.", and say "and reproduced" or "and confirmed" if you checked it yourself.
- **Say concretely what changed or why not.** Refer to the code: the function, file, test name, the `CLAUDE.md` rule, or the Lynx behavior and where it's recorded. Keep it to one to four plain sentences, with no filler, no thanks and no AI attribution.
- **For fixes, end with the commit link:** `Fixed in [abc1234567](https://github.com/Blotch-Smart-Frames/AngularLynx/pull/<PR>/commits/<full sha>).` Use the SHA on the pushed branch, since cherry-picked commits have new SHAs. For a follow-up PR off master, add `(#<new PR>)`.
- **For already fixed, say where**, such as the PR or the function and test that cover it now.

Put the replies in a JSON Lines file in the scratchpad, `{"thread": "PRRT_…", "body": "…"}` on each line, then post and resolve them:

```bash
while IFS= read -r line; do
  thread=$(jq -r .thread <<<"$line"); body=$(jq -r .body <<<"$line")
  gh api graphql -f thread="$thread" -f body="$body" -f query='
    mutation($thread: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { url } } }' \
    --jq '.data.addPullRequestReviewThreadReply.comment.url'
  gh api graphql -f thread="$thread" -f query='
    mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { thread { isResolved } } }' \
    --jq '.data.resolveReviewThread.thread.isResolved'
done < replies.jsonl
```

A comment in a review's body has no thread to reply to or resolve. Answer those on each PR in one PR comment (`gh pr comment <n> --body-file <file>`), written the same way. Name each comment by its title, and link to the review's `html_url`.

## 5. Check what CodeRabbit says back

CodeRabbit answers replies in its threads (`chat.auto_reply`) and reviews each commit you push, so it may reopen a point, accept it, or comment on the new code. Wait until its check on the PR's last commit has finished:

```bash
gh pr checks <n> --json name,state --jq '.[] | select(.name | test("CodeRabbit"; "i"))'
```

Then fetch the threads and the reviews' bodies again, and evaluate anything new the same way: a new thread on your commit, or an answer in a thread you resolved. Only answer a pushback once, and only if it brings a fact you hadn't weighed. Agreeing on the second round is fine when it does. Don't argue a point a third time; tell the user instead. Finish when none of those PRs has an unresolved thread, a thread you were given that still waits on an answer, or an unanswered comment in a review's body.

## 6. Report

Keep the report short:

- the PR link and how many commits you pushed
- the counts: fixed, docs changes, disagreed, already fixed
- the fixes that matter most, and each disagreement with its one-line reason
- CI status: say which checks were still running, rather than implying they passed
- anything you noticed but deliberately left alone, and anything you couldn't do
- the worktree you made, so `post-merge-cleanup` can remove it once the PR merges
