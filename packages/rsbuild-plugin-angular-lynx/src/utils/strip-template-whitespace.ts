/**
 * Strips leading and trailing newline-induced whitespace from single-line text
 * nodes in Angular component templates.
 *
 * Angular's template compiler (`preserveWhitespaces: false`, the default)
 * condenses consecutive whitespace but does NOT strip the edge spaces produced
 * by template indentation. A block-level text element written naturally:
 *
 *   <text class="...">
 *     The Quick Brown Fox
 *   </text>
 *
 * compiles to `ɵɵtext(1, " The Quick Brown Fox ")` — the newlines become
 * single spaces. Lynx has no HTML whitespace-collapsing model, so those edge
 * spaces render literally, producing a visible leading/trailing indent.
 *
 * This transform runs on the raw template source BEFORE Angular's compiler sees
 * it (in `buildLynxSchemaSourceFileCache`), so the compiler receives:
 *
 *   <text class="...">The Quick Brown Fox</text>
 *
 * and emits `ɵɵtext(1, "The Quick Brown Fox")` — clean, no extra spaces.
 *
 * Why this is safe for inline text:
 *   <text>Hello <text style="color:red">world</text> again</text>
 *
 * The text nodes "Hello " and " again" sit on the SAME line as their sibling
 * elements — no surrounding newlines — so the regex never matches them and their
 * inter-word spaces are preserved.
 *
 * Limitation: external templates (`templateUrl`) are read by Angular's compiler
 * host directly from disk and are not reachable from this transform path.
 */
export const stripTemplateWhitespace = (source: string): string =>
  source.replace(
    // Match text that:
    //   (?<=>) — immediately follows a closing `>` (end of an opening tag)
    //   [ \t]*\n[ \t]* — then optional horizontal space + newline + horizontal space
    //   ([^\n<]+?) — then the actual text content (no newlines or angle brackets, non-greedy)
    //   [ \t]*\n[ \t]* — then optional horizontal space + newline + horizontal space
    //   (?=<) — then a `<` (start of the closing or next tag)
    // and replaces the whole region with just the captured content (trimmed in place).
    /(?<=>)[ \t]*\n[ \t]*([^\n<]+?)[ \t]*\n[ \t]*(?=<)/g,
    '$1',
  );
