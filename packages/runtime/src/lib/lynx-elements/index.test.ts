// @vitest-environment jsdom
//
// index.ts is a pure re-export barrel plus the LYNX_ELEMENTS array literal —
// there is no branching logic, so importing it and asserting the array shape
// is enough to cover every line (the individual classes are exercised in
// directives.test.ts / input.test.ts / base.test.ts).
//
// @angular/compiler must load before any decorated class (the CVA directives
// re-exported here) is evaluated, otherwise Angular falls back to a JIT path
// that requires the compiler and throws at import time.
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { LYNX_FORM_ACCESSORS } from '../forms';
import { LYNX_ELEMENTS, LynxInput, LynxTextarea, LynxView } from './index';

describe('LYNX_ELEMENTS', () => {
  it('is a non-empty array including the core element directives', () => {
    expect(LYNX_ELEMENTS.length).toBeGreaterThan(0);
    expect(LYNX_ELEMENTS).toContain(LynxView);
    expect(LYNX_ELEMENTS).toContain(LynxInput);
    expect(LYNX_ELEMENTS).toContain(LynxTextarea);
  });

  it('spreads in both form CVA directives', () => {
    for (const accessor of LYNX_FORM_ACCESSORS) {
      expect(LYNX_ELEMENTS).toContain(accessor);
    }
  });
});
