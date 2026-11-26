import type { ElementRef } from '../types/lynx';

/**
 * Tells an element's LynxElement the text a main-thread script set on it
 * with `setValue` (MainThreadElement's invoke), as LynxElement's own invoke
 * notes it.
 *
 * LynxElement remembers the text a field has, so that a `value` set to it
 * again doesn't disturb the user's typing (its #setFieldText). A script on
 * the field's `input` that reformats what was typed, such as a card number
 * grouped in fours, sets other text natively. Unnoted, the element kept the
 * typed text as the field's, and a `[value]` set to that text afterwards was
 * skipped, so the field kept the script's.
 *
 * A hook rather than an import, as for script-styles.ts: the main-thread
 * module has no need of the element module, which installs it with its first
 * element. Before then no element has a LynxElement.
 */
type FieldTextNoter = (element: ElementRef, text: string) => void;

let noter: FieldTextNoter = () => {};

/**
 * Sets what noteScriptFieldText calls (see LynxElement's constructor).
 */
export const setScriptFieldTextNoter = (note: FieldTextNoter): void => {
  noter = note;
};

/**
 * Notes that a script set `element`'s text to `text`, for its LynxElement,
 * if it has one.
 */
export const noteScriptFieldText = (element: ElementRef, text: string): void =>
  noter(element, text);
