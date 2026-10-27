import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { lynxMainThread } from './lynx-main-thread';

describe('lynxMainThread', () => {
  afterEach(() => {
    delete (globalThis as { lynxTestingEnv?: unknown }).lynxTestingEnv;
  });

  it("is the testing library's main thread globals", () => {
    const globals = { __ElementAnimate: () => {} };
    (globalThis as { lynxTestingEnv?: unknown }).lynxTestingEnv = {
      mainThread: { globalThis: globals },
    };
    expect(lynxMainThread()).toBe(globals);
  });

  it('is the helper the component tests import from packages/ui', () => {
    // Copied tests import `../../../test-utils/lynx-main-thread`, which dolan
    // rewrites to this file. A copy that drifted would test differently in an
    // app than in the library.
    const shipped = readFileSync(
      new URL('./lynx-main-thread.ts', import.meta.url),
      'utf-8',
    );
    const library = readFileSync(
      new URL(
        '../../../ui/src/test-utils/lynx-main-thread.ts',
        import.meta.url,
      ),
      'utf-8',
    );
    expect(shipped).toBe(library);
  });
});
