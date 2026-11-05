/**
 * The `display` values the web lays out and Lynx doesn't, each with the Lynx
 * value that lays its children out the way the web value does.
 *
 * Lynx takes `display: block` but has no block layout: it logs "Unexpected
 * display type" and lays the element out as `flex`, a row, so a child that
 * doesn't set its width shrinks to its content (`GetDisplay` in Lynx core's
 * starlight/style/layout_computed_style.cc). `:host { display: block }` is how
 * a web component says it isn't inline, so most Angular components that size
 * themselves carry it. Lynx's `linear` (vertical, the default `auto` resolves
 * to) stacks the children and stretches each across the container, which is
 * what a block does on the web, and what Lynx itself maps `block` to in its
 * legacy W3C mode.
 *
 * Lynx has no inline formatting for elements other than text, so the inline
 * values can't flow along a line as they do on the web; Lynx drops them, and
 * the element lays out as the default `linear`. The way they lay out their own
 * children still carries over, so each maps to the value that does that:
 * `inline-flex` to `flex`, not the `linear` dropping it would give.
 *
 * The build plugin keeps its own copy of this map
 * (`packages/rsbuild-plugin-angular-lynx/src/display.ts`), which rewrites
 * stylesheets, and a test there keeps the two the same. This one is for
 * inline styles, which reach the runtime as they're written.
 */
export const LYNX_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['block', 'linear'],
  ['flow-root', 'linear'],
  ['inline', 'linear'],
  ['inline-block', 'linear'],
  ['inline-flex', 'flex'],
  ['inline-grid', 'grid'],
]);

/** A `display` value, with the `!important` a `[style.x.important]` binding adds. */
const DISPLAY_VALUE = /^\s*([a-z-]+)\s*(!\s*important\s*)?$/i;

/**
 * The `display` value Lynx lays out as the web does `value`: `block` becomes
 * `linear`. Any other value, such as `flex`, `none` or a number, is returned
 * as it is.
 */
export const toLynxDisplay = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const match = DISPLAY_VALUE.exec(value);
  const lynx = match && LYNX_DISPLAY.get(match[1]!.toLowerCase());
  if (!lynx) return value;
  return match[2] ? `${lynx} !important` : lynx;
};

/**
 * A `display` declaration in an inline style. The property has to start the
 * style or follow a `;`, so a custom property such as `--display` isn't one.
 */
const DISPLAY_DECLARATION =
  /(^|;)(\s*display\s*:\s*)([a-z-]+)(?=\s*(?:!\s*important\s*)?(?:;|$))/gi;

/**
 * `style` with each `display` declaration's value changed by `toLynxDisplay`:
 * `width: 100%; display: block` becomes `width: 100%; display: linear`.
 */
export const withLynxDisplay = (style: string): string =>
  style.replace(
    DISPLAY_DECLARATION,
    (declaration, start: string, property: string, value: string) => {
      const lynx = LYNX_DISPLAY.get(value.toLowerCase());
      return lynx ? `${start}${property}${lynx}` : declaration;
    },
  );
