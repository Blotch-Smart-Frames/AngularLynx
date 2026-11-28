import { describe, expect, it, vi } from 'vitest';
import { applyMangleExports } from './mangle-exports';

/**
 * Runs applyMangleExports's chain hook on a chain whose `mangleExports` is
 * `current`, and returns what it set.
 */
const run = (isProd: boolean, current?: unknown) => {
  let value = current;
  const chain = {
    optimization: {
      get: vi.fn((key: string) =>
        key === 'mangleExports' ? value : undefined,
      ),
      mangleExports: vi.fn((next: unknown) => {
        value = next;
      }),
    },
  };
  let handler:
    | ((chain: unknown, utils: { isProd: boolean }) => void)
    | undefined;
  const api = {
    modifyBundlerChain: vi.fn((h: typeof handler) => {
      handler = h;
    }),
  };
  applyMangleExports(api as never);
  handler!(chain, { isProd });
  return { value, chain };
};

describe('applyMangleExports', () => {
  // The getters between the modules rspack couldn't concatenate take the
  // shortest names, rather than rspack's three-character hashes.
  it('mangles exports by size in a production build', () => {
    expect(run(true).value).toBe('size');
  });

  // Rspack mangles nothing in development, which keeps names readable.
  it('leaves a development build as rspack has it', () => {
    const { value, chain } = run(false);

    expect(value).toBeUndefined();
    expect(chain.optimization.mangleExports).not.toHaveBeenCalled();
  });

  it("keeps an app config's own value", () => {
    for (const own of ['deterministic', false, true]) {
      const { value, chain } = run(true, own);

      expect(value).toBe(own);
      expect(chain.optimization.mangleExports).not.toHaveBeenCalled();
    }
  });
});
