# Investigation: False Positive in `scanCompiledOutputForStructuralIssues`

## Symptom

Every build emits this warning even though the template is correct:

```
[Lynx] Structural issues:
  src/app/elements-showcase/elements-showcase.component.ts: <list-item> used without a <list> parent.
```

The template (lines 69–81 of `packages/kitchen-sink-app/src/app/elements-showcase/elements-showcase.component.ts`):

```html
<list class="mini-list">
  @for (i of [1, 2, 3]; track i) {
  <list-item class="list-item" item-key="{{ i }}">
    <text>List Item {{ i }}</text>
  </list-item>
  }
</list>
```

`<list-item>` IS correctly nested inside `<list>`. This is a false positive.

---

## Validator Location

**File:** `packages/rsbuild-plugin-angular-lynx/src/lynx-diagnostics.ts`  
**Function:** `scanCompiledOutputForStructuralIssues` (lines 200–234)

It receives `typeScriptFileCache: Map<string, string | Uint8Array>`, populated by `compilation.emitAffectedFiles()` in `packages/rsbuild-plugin-angular-lynx/src/angular.ts` (lines 193–199). These are Angular AOT-compiled JavaScript outputs, keyed by the source `.ts` file path.

### Current logic

```ts
const pattern = /ɵɵelement(?:Start)?\(\d+,\s*["']([a-z][a-z0-9-]*)["']/g;
const tags = new Set<string>();
while ((match = pattern.exec(code)) !== null) {
  tags.add(match[1]!);
}

if (tags.has('list-item') && !tags.has('list')) {
  // emit warning
}
```

It collects all element tags found via `ɵɵelementStart`/`ɵɵelement` calls in the compiled JS, then warns if `list-item` appears without `list`.

---

## Root Cause (Confirmed)

Angular **chains** `ɵɵelementStart` calls when multiple elements open in sequence:

```js
ɵɵelementStart(9, 'view', 6)(10, 'list', 7);
```

The original regex `/ɵɵelement(?:Start)?\(\d+,\s*["']([a-z][a-z0-9-]*)["']/g` only matches the **first** call in a chain (capturing `"view"`). The chained `(10, "list", 7)` isn't preceded by `ɵɵelementStart` so it's missed entirely. Result: `list-item` is detected (it's not chained) but `list` is not.

**Fix:** Match the entire chain `ɵɵelementStart(...)(...)(...)*`, then extract all `(\d+, "tag")` groups from the matched string.

---

## Initial (Incorrect) Hypothesis

Angular's `@for` control flow block compiles its single root element using an **"insertion point" optimization** (`ingestControlFlowInsertionPoint` in the Angular compiler, `compiler.mjs` line 22843).

When `@for` has exactly **one root child element** (here: `<list-item>`), the compiler:

1. Passes `"list-item"` as the `tag` argument to `ɵɵrepeaterCreate`
2. Moves `<list-item>`'s attributes to the outer repeater op
3. The inner embedded template function does **NOT** emit `ɵɵelementStart(N, "list-item", ...)` — only `<list-item>`'s children are in the inner template

So the compiled output looks roughly like:

```js
// Inner template — only list-item's CHILDREN, not list-item itself
function Showcase_For_1_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementStart(0, 'text'); // <text>
    ɵɵtext(1);
    ɵɵelementEnd();
  }
}

// Main template
function Showcase_Template(rf, ctx) {
  if (rf & 1) {
    ɵɵelementStart(0, 'list', 0); // <list> — detected ✓
    ɵɵrepeaterCreate(
      1,
      Showcase_For_1_Template,
      2,
      1,
      'list-item',
      1, // tag arg — NOT matched by regex
      ɵɵrepeaterTrackByIndex,
    );
    ɵɵelementEnd();
  }
}
```

With this output, the scanner's regex only finds `"list"` and `"text"` — `"list-item"` is absent (it's inside `ɵɵrepeaterCreate`, not `ɵɵelement`/`ɵɵelementStart`). This means `tags.has('list-item')` is `false` and the condition should NOT fire.

**But the warning IS firing.** This means either:

1. The insertion point optimization does NOT apply here and `<list-item>` IS emitted as `ɵɵelementStart` in the inner template — meaning both `list` and `list-item` are detected and the condition is still false. ← Still can't explain the warning.

2. The file cache contains **a different file** (not the component's compiled JS) where `list-item` appears without `list` — for example, a compiled library file from `packages/runtime/dist/fesm2022/blotch-angular-lynx.mjs` that resolves via the tsconfig path mapping `"@blotch/angular-lynx": ["../runtime/dist"]`. With `preserveSymlinks: false`, this path does NOT contain `node_modules` and would NOT be filtered by the `node_modules` check.

3. Something about how `ɵɵrepeaterCreate` matches the regex unexpectedly.

---

## What Needs Confirming

The debug logging approach was started but interrupted. The next agent should:

### Step 1 — Add this debug log to `scanCompiledOutputForStructuralIssues` temporarily

```ts
// Around line 221, after `const fileName = ...`
if (fileName.includes('elements-showcase') || tags.has('list-item')) {
  console.log('[DEBUG] file:', fileName);
  console.log('[DEBUG] tags:', [...tags]);
  if (code.includes('list-item')) {
    const idx = code.indexOf('list-item');
    console.log(
      '[DEBUG] context:',
      JSON.stringify(code.slice(Math.max(0, idx - 60), idx + 80)),
    );
  }
}
```

### Step 2 — Rebuild the plugin and run the demo

```sh
npm run build -w packages/rsbuild-plugin-angular-lynx
npm run demo
```

Look at the console output to see:

- Which file is the offending one
- What tags are found in it
- What the compiled code looks like around `list-item`

### Step 3 — Remove the debug log and implement the fix

---

## Likely Fix Options

### Option A — Also scan `ɵɵrepeaterCreate` for tag names

If `list-item` is only appearing via `ɵɵrepeaterCreate`, we need to detect it there too, alongside `list` from `ɵɵelementStart`. Extend the tag collection:

```ts
// Collect tags from ɵɵelementStart/ɵɵelement AND ɵɵrepeaterCreate
const elementPattern = /ɵɵelement(?:Start)?\(\d+,\s*["']([a-z][a-z0-9-]*)["']/g;
const repeaterPattern =
  /ɵɵrepeaterCreate\(\d+,\s*\w+,\s*\d+,\s*\d+,\s*["']([a-z][a-z0-9-]*)["']/g;

const tags = new Set<string>();
let match: RegExpExecArray | null;
while ((match = elementPattern.exec(code)) !== null) tags.add(match[1]!);
while ((match = repeaterPattern.exec(code)) !== null) tags.add(match[1]!);
```

This adds `list-item` to the tag set from the `ɵɵrepeaterCreate` call, and `list` is already there from `ɵɵelementStart`. The condition `tags.has('list-item') && !tags.has('list')` would correctly be false.

### Option B — Scan the `.ts` source for structural issues instead of compiled output

Parse the template string from `@Component({ template: \`...\` })` in the TypeScript source and check nesting directly. More accurate but requires regex parsing of Angular templates (complex).

### Option C — Strengthen `node_modules` filtering

If the issue is an unfiltered library file (hypothesis 2 above), fix the filter:

```ts
// More robust: check if path contains common library indicators
if (file.includes('node_modules') || file.includes('/dist/fesm')) continue;
```

---

## Files to Modify

- `packages/rsbuild-plugin-angular-lynx/src/lynx-diagnostics.ts` — `scanCompiledOutputForStructuralIssues` function
- Rebuild: `npm run build -w packages/rsbuild-plugin-angular-lynx`

## Test

After fixing, `npm run demo` should not show the `[Lynx] Structural issues:` warning for `elements-showcase.component.ts`.
