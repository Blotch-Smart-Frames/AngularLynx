// @vitest-environment jsdom
//
// Pure re-export barrel plus the LYNX_FORM_ACCESSORS array literal — importing
// it and asserting the array shape covers every line (the classes themselves
// are exercised in lynx-input-value-accessor.test.ts / lynx-textarea-value-accessor.test.ts).
//
// @angular/compiler must load before the decorated CVA classes are evaluated,
// otherwise Angular falls back to a JIT path that requires the compiler and
// throws at import time.
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import {
  LYNX_FORM_ACCESSORS,
  LynxInputValueAccessor,
  LynxTextareaValueAccessor,
} from './index';

describe('LYNX_FORM_ACCESSORS', () => {
  it('contains both Lynx form value accessors', () => {
    expect(LYNX_FORM_ACCESSORS).toEqual([
      LynxInputValueAccessor,
      LynxTextareaValueAccessor,
    ]);
  });
});
