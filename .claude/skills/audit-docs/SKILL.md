---
name: audit-docs
description: Check what the docs say against the source code, find the places where the code doesn't do what they promise, and file one GitHub issue per fix. Covers the website, the package and native template READMEs, the investigation notes, the public skill's references and the TSDoc on public exports. Use when the user asks to audit, fact-check or verify the docs, to find bugs by reading the docs against the code, or to file issues for the mismatches a docs rewrite turned up.
metadata:
  internal: true
---

# Audit the docs against the source, and file the bugs

Every doc is a set of claims about the code, and checking each claim against the source finds bugs
the tests miss:

- A service whose type promises data it never receives (#48).
- A README describing wiring that nobody built (#59).
- Element inputs that Lynx never reads (#53).

The output is a set of GitHub issues, each one a single fix, that someone can pick up without
redoing the audit.

This skill reads and files. It doesn't change the docs or the code. Where the docs are wrong and the
code is right, the fix still goes in an issue, labeled `documentation` (like #68), unless the user
asks for the docs to be fixed directly.

If the audit is part of a docs rewrite (the `documentation-writer` skill), have each writer report
findings in the format of step 3, then start at step 4.

## 1. Agree on the scope

When the user names pages, sections or packages, audit those. Otherwise audit all of these:

| Docs                    | Where                                                            |
| ----------------------- | ---------------------------------------------------------------- |
| Website                 | `packages/website/docs/**` (Guide, API, UI Components, Examples) |
| Package READMEs         | `packages/*/README.md`                                           |
| Native template READMEs | `packages/native/templates/*/README.md`                          |
| Investigation notes     | `investigations/*.md`                                            |
| Public skill            | `skills/angular-lynx/**`                                         |
| TSDoc on public exports | whatever `packages/*/src/index.ts` exports                       |

Audit what master says, not the main checkout, which may be on someone's branch. Read from a
detached worktree in the scratchpad, and send every agent there. Keep everything else the audit
writes (the issue list, scratch projects, issue drafts) beside it in `<scratchpad>/audit`, not
inside it:

```bash
git -C <main> fetch origin
git -C <main> worktree add --detach <scratchpad>/audit/src origin/master
```

The worktree has no `node_modules`. Reading the source doesn't need them. A reproduction that
needs a built package (step 4) does, so run `npm install` and `npm run build` there first.

## 2. Gather what's already known

- **Issues already filed.** Save every issue, open or closed, to a file the agents can search:

  ```bash
  gh issue list --state all --limit 500 --json number,title,state,labels,body > <scratchpad>/audit/issues.json
  ```

  A closed issue counts too: if its bug is back, that's a regression, and the new issue links it.
- **Facts already verified.** The thread model in `packages/website/CLAUDE.md` (the "Reader"
  section), the `lynx-architecture` skill and `investigations/lynx-vs-web-differences.md`. A page
  that contradicts them is wrong, not the code. Read them before splitting the work, so the agent
  prompts can carry the parts that matter.

## 3. Check every claim, in parallel

Split the docs into slices and give each slice to a `general-purpose` agent, all sent in one
message. List the files with `find` when you split them; the website's sidebar sections in
`packages/website/rspress.config.ts` are a good split:

- Get Started, Core Concepts and the landing page (`docs/index.mdx`)
- Build the UI
- Style, and App Features
- Debug & Test, and Ship (including `guide/embedding/**`)
- Advanced
- API (`docs/api/**`)
- UI Components and Examples, with `packages/ui` and the `examples/` projects they describe
- The repo's own notes: READMEs, template READMEs, `investigations/`, `skills/angular-lynx/`

Give each agent this brief, with its slice and paths filled in:

```text
You're auditing part of the AngularLynx docs against the source, to find bugs. Read from
<scratchpad>/audit/src. Edit nothing there. Put any scratch project under
<scratchpad>/audit/<slice>.

Your files: <list>

Read each file in full. For every claim that the code can settle, find the code that settles it:
an export, signature or default; a behavior ("the router restores scroll"); a command or schematic
and what it writes; a platform note; and every "isn't supported" or "known limitation". Wording and
style aren't findings.

Look in packages/*/src, the build plugin and the native templates. For how Lynx itself behaves,
read the upstream sources on GitHub: lynx-family/lynx (core, e.g. renderer_ng.cc),
lynx-family/lynx-stack packages/react (React Lynx, the reference for how a renderer should do it)
and lynx-family/lynx-website. Use `gh api repos/<repo>/contents/<path>` or `gh search code`.

Facts already verified, which the docs must agree with: <from step 2>

Before reporting a mismatch, search <scratchpad>/audit/issues.json for an issue that covers it.

Report each mismatch as:
- kind: code-bug (the code doesn't do what the docs, its types or its own comments promise) |
  missing (the docs describe a feature nobody built) | docs-wrong (the code is right) |
  limitation (the docs admit a gap with Angular or the web, which the project means to close) |
  unverified (the source can't settle it)
- symptom: what a user sees, in one sentence
- claim: the quote, with file:line
- evidence: file:line in the source, and what that code does
- confirmed by: read in the source | ran <what> | reproduced in <where>
- existing issue: #N, or none
- fix: one line, if the evidence points at one
```

## 4. Re-check every finding yourself

An agent's findings are leads. Before one goes into an issue:

- **Open the cited lines** in `<scratchpad>/audit/src` and confirm the code does what the finding says.
  Correct the line numbers, and drop the findings that don't hold.
- **Search the whole repo** before believing "nothing does X". The code that does it may be in the
  build plugin, a native template or a schematic.
- **Reproduce it when that's cheap**, and note how:
  - Template bindings: a scratch `ngc` project with `strictTemplates`, against the runtime's
    `dist`.
  - Services: a unit test.
  - What renders: the web preview (`ng serve` in an example, driven with `chrome-devtools-axi`;
    the app is inside the `lynx-view`'s shadow root).
  - Schematics: a scratch `ng new` app.
- **Don't let the web preview clear a native claim.** Web-core and native Lynx differ, and the
  differences are listed in `investigations/lynx-vs-web-differences.md`. Without a device or
  simulator run, the issue says "From the source; not reproduced on a device".
- **Leave out claims about a feature's future.** "Planned" isn't a bug. Keep only what the docs
  say works today, or what they admit doesn't.

## 5. Group the findings into issues

- **One issue per fix.** Findings that one change fixes go together. #50 lists six services that
  all need one relay to the background thread.
- **A checklist for small, separate fixes in one package.** #61 has five dev-logger problems as
  `- [ ]` items, so the fixer can tick them off.
- **Doc fixes grouped by area.** The docs-wrong findings go in one `documentation` issue per area,
  like #68.
- **Labels:**
  - `bug`: code-bug.
  - `enhancement`: missing, or a limitation that no issue tracks yet.
  - `documentation`: docs-wrong.

  Run `gh label list` in case they've changed.
- **Duplicates.** A finding that adds something to an open issue becomes a comment on that issue,
  not a new one. A bug that has come back after its issue closed gets a new issue linking the old
  one.

## 6. Propose before filing

Filing notifies everyone who watches the repo, so show the user the plan first:

- A table of the proposed issues: label, title, a one-line summary, and how each was confirmed.
- The comments you'd add to existing issues.
- The unverified claims, for the user to answer. For example, #47 asked whether HTTP really didn't
  work.

Then wait. Go straight to filing only if the user already asked for that.

## 7. Write the bodies

Model them on #48, #50, #59 and #61:

```markdown
<What goes wrong as a user meets it, in two or three sentences: the API, and what happens.>

## Where

- `packages/runtime/src/lib/<file>.ts:<line>`: <what this line does wrong>.
- <What Lynx core or React Lynx does instead, with its file.>

## Impact

- <Who hits it, and when.>
- <Which docs page describes today's behavior.>

## Suggested fix

- <The change, if the evidence points at one. Give alternatives as separate bullets.>

Found while auditing `<page or file>`. <Confirmed in the web preview. / From the source; not
reproduced on a device.>
```

- **The title is the symptom, in the user's words**, not the code change. For example, "Native
  InitData never reaches the app: renderPage drops its data". A grouped issue names its area and
  its parts: "@blotch/dolan CLI: missing class-variance-authority, broken doctor, wrong init
  steps" (#65).
- **Missing features** get `## Expected` in place of `## Impact`, describing what should happen
  (#59).
- **Paths are repo-relative, with master's line numbers.** When they share a folder, say so once:
  "All paths are under `packages/runtime/src/lib/`".
- **Many similar items go in a table** (Service | Problem | Where, as in #50).
- **Say how sure you are**: "Verified on a scratch app", "Most likely", "Re-measure on a device".
- **Link related issues by number.** For an issue that isn't filed yet, write a placeholder such as
  `#<host-updates>` and fill it in during step 8.
- **Use the house style**: short sentences, and the reason after the rule. Add no AI attribution:
  the project's CLAUDE.md forbids it.

## 8. File them

1. Write each body to `<scratchpad>/audit/issues/NN.md`. List them in
   `<scratchpad>/audit/issues/titles.tsv`, one line per issue: id, label, title, tab-separated.
   Order them so an issue comes before any issue that links to it.
2. File the first one on its own, and read what the command prints. `gh-axi` prints
   `number: <n>`, and `gh` prints the issue's URL. Parse the rest accordingly.

   ```bash
   gh issue create --title "<title>" --body-file <scratchpad>/audit/issues/01.md --label bug
   ```

3. File the rest in order. Before each one, replace its placeholders with the numbers just filed.
4. Open one or two with `gh issue view <n>` to check the Markdown rendered.
5. Post the comments on existing issues with `gh issue comment <n> --body-file <file>`.

## 9. Report and clean up

- A table of the new issues (number, label, title), and the existing issues you commented on.
- The unverified claims that are still open.
- Remove the audit worktree. It's detached, and nothing the audit wrote is inside it:

  ```bash
  git -C <main> worktree remove <scratchpad>/audit/src
  ```

  If git refuses, something edited the worktree. Show the user `git -C <scratchpad>/audit/src
  status --short` before discarding anything.
