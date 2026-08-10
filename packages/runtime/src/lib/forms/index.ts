export { LynxInputValueAccessor } from './lynx-input-value-accessor';
export { LynxTextareaValueAccessor } from './lynx-textarea-value-accessor';

import { LynxInputValueAccessor } from './lynx-input-value-accessor';
import { LynxTextareaValueAccessor } from './lynx-textarea-value-accessor';

/**
 * Both Lynx form value accessors as a single importable array.
 */
export const LYNX_FORM_ACCESSORS = [
  LynxInputValueAccessor,
  LynxTextareaValueAccessor,
] as const;
