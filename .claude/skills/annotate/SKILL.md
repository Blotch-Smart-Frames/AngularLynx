---
name: annotate
description: Add detailed comments to recent code changes explaining what was fixed, why it's needed, and the rationale. Use after making code changes to document the reasoning inline.
allowed-tools: Bash, Read, Edit
---

# Annotate Changes

Add detailed inline comments to all code changes made in this conversation. For each changed section, write comments that explain:

1. **What it fixes** — the bug or problem this code addresses
2. **Why it's needed** — the root cause that made this change necessary
3. **Rationale** — why this specific approach was chosen, what alternatives were considered, and what makes this safe

## Process

1. Review all files modified in this conversation to identify the changed sections
2. For each change, add a comment block **above** the changed code (or above the relevant block/function/field)
3. Write multi-line comments using `//` style for TypeScript, matching the project's existing conventions
4. Keep each comment block focused on one logical change — don't lump unrelated changes into one block

## Comment Style

- Write in plain English, not jargon
- Reference the data flow or signal dependency chain when relevant (e.g., "Firestore writes here, real-time subscription delivers it there, this effect picks it up")
- Explain non-obvious safety properties (e.g., "this doesn't cause an infinite loop because X", "duplicate calls are safe because of the Y guard")
- Mention the symptoms users would see without the fix (e.g., "Without this, the user would see 'Not Connected' despite a successful OAuth")
- If a line was removed or a guard was added, explain what previously went wrong

## What NOT to do

- Don't add trivial comments that restate the code (e.g., `// set the value` above `.set(value)`)
- Don't reference ticket numbers or PR numbers — those belong in commit messages, not code
- Don't add comments to unchanged code
- Don't rewrite or refactor the code — only add comments
- Don't add a separate `//` comment block when a TSDoc `/** ... */` comment already exists on the function/method — instead, append the rationale to the existing TSDoc block
- When annotating function/method/class signatures with TSDoc, always use multi-line format:
  ```ts
  /**
   * Explanation here.
   */
  ```
  Never use single-line `/** Explanation here. */` for these — the multi-line form is the project convention
- Don't rewrite or refactor the code — only add comments
