import { Injector, input, runInInjectionContext } from '@angular/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from './set-input-signal';

describe('setInputSignal', () => {
  it("sets an input signal's value", () => {
    const count = runInInjectionContext(
      Injector.create({ providers: [] }),
      () => input(0),
    );
    setInputSignal(count, 5);
    expect(count()).toBe(5);
  });

  it('is the helper the component tests import from packages/ui', () => {
    // Copied tests import `../../../test-utils/set-input-signal`, which dolan
    // rewrites to this file. A copy that drifted would test differently in an
    // app than in the library.
    const shipped = readFileSync(
      new URL('./set-input-signal.ts', import.meta.url),
      'utf-8',
    );
    const library = readFileSync(
      new URL(
        '../../../ui/src/test-utils/set-input-signal.ts',
        import.meta.url,
      ),
      'utf-8',
    );
    expect(shipped).toBe(library);
  });
});
