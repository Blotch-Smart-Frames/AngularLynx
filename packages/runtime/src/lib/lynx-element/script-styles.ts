import type { ElementRef } from '../types/lynx';

/**
 * Gives an element's LynxElement the inline styles a main-thread script sets
 * (MainThreadElement's setStyleProperty and setStyleProperties), so that they
 * go through the same path as the element's `[style.x]` bindings.
 *
 * A script writing straight to native with `__AddInlineStyle` goes wrong two
 * ways on an element whose LynxElement also writes its inline style:
 *
 * - On an element that sets a CSS variable, native parses the inline style
 *   string waiting for the flush as soon as `__AddInlineStyle` reaches it, and
 *   parsed there it doesn't note which variables changed. A `[style.--x]`
 *   that change detection changed, followed by a drag's `transform` before
 *   the flush, would leave the text and icons already drawn under the element
 *   with the old value (see "A CSS variable set inline doesn't reach drawn
 *   descendants when `__AddInlineStyle` follows it" in
 *   investigations/lynx-vs-web-differences.md, and LynxElement's
 *   #setsVariables).
 * - LynxElement writes the whole inline style again with `__SetInlineStyles`
 *   when a variable, `hidden` or a safe-area inset changes, which replaces
 *   every inline style native has, the script's among them. It puts back
 *   only the styles it knows of.
 *
 * A hook rather than an import, as for class-writes.ts: the main-thread
 * module has no need of the element module, which installs it with its first
 * element. Before then no element has a LynxElement.
 */
type ScriptStyleWriter = (
  element: ElementRef,
  styles: Record<string, string | null | undefined>,
) => boolean;

let writer: ScriptStyleWriter = () => false;

/**
 * Sets what writeScriptStyles calls (see LynxElement's constructor).
 */
export const setScriptStyleWriter = (write: ScriptStyleWriter): void => {
  writer = write;
};

/**
 * Has the element's LynxElement set `styles` as a script's: true if it has
 * one and they were set, false if the caller has to write them to native
 * itself. An empty or null value removes the style, as the DOM's
 * `style.setProperty()` does.
 */
export const writeScriptStyles = (
  element: ElementRef,
  styles: Record<string, string | null | undefined>,
): boolean => writer(element, styles);
