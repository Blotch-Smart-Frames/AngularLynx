/**
 * Keeps `<svg content>` strings parseable by Lynx's native SVG engine.
 *
 * ServalSVG, which draws `<svg>` on iOS (and in Lynx's C++ SVG core generally),
 * parses `stroke-dasharray` with a loop that only advances while it's reading a
 * number. Any other token, such as `none`, a unit like `4px`, or `inherit`,
 * leaves it stuck on the same character forever. Worse, the parse runs on one
 * serial queue shared by every `<svg>` in the process, so a single such
 * attribute (TanStack Charts writes `stroke-dasharray="none"` on its bars)
 * blanks every icon and chart in the app until it's killed, with no error.
 *
 * The rewrite keeps what ServalSVG can draw: bare numbers, and `px` lengths,
 * which equal user units in SVG. Anything else is dropped, which on native is
 * the only way to get a drawing at all. `none` is the default anyway; a value
 * that can't be resolved here (`%`, `em`) would have hung the engine.
 */

const DASHARRAY_ATTRIBUTE =
  /(\s)stroke-dasharray\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
// A declaration inside an inline `style="…"` (ServalSVG reads those too).
const DASHARRAY_DECLARATION = /(^|[;"'\s])stroke-dasharray\s*:\s*([^;"']*);?/g;
const DASH_LENGTH = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i;

/**
 * Returns the dash lengths as a space-separated list of bare numbers, or
 * `null` when any part of the value isn't a plain length.
 */
export const normalizeDashArray = (value: string): string | null => {
  const tokens = value
    .trim()
    .split(/[\s,]+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0 || !tokens.every((t) => DASH_LENGTH.test(t))) {
    return null;
  }
  return tokens.map((token) => token.replace(/px$/i, '')).join(' ');
};

export const sanitizeSvgContent = (content: string): string => {
  // Most SVG (icons) has no dash arrays: skip the regex work entirely.
  if (!content.includes('stroke-dasharray')) return content;
  return content
    .replace(
      DASHARRAY_ATTRIBUTE,
      (_match, space: string, double?: string, single?: string) => {
        // The pattern matches one quote style or the other, so one is set.
        const normalized = normalizeDashArray((double ?? single)!);
        return normalized === null
          ? ''
          : `${space}stroke-dasharray="${normalized}"`;
      },
    )
    .replace(DASHARRAY_DECLARATION, (_match, before: string, value: string) => {
      const normalized = normalizeDashArray(value);
      return normalized === null
        ? before
        : `${before}stroke-dasharray:${normalized};`;
    });
};
