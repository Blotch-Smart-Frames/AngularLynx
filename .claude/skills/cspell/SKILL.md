---
name: cspell
description: Run the spell checker (cspell) across all packages in the monorepo using turbo. Use when the user says "cspell", "spell check", "check spelling", or wants to find typos.
---

# CSpell

Run the spell checker from the project root:

```sh
npm run cspell -- --force
```

This runs `cspell .` in every package via turbo.

## Single package

To spell-check a specific package:

```sh
npx turbo run cspell --filter=<package-name>
```

## After running

Report any unknown words found. If there are spelling errors, list them grouped by file and suggest either fixing the typo or adding the word to the cspell dictionary (look for `cspell.json` or a `cspell` field in `package.json`).
