import { describe, expect, it, vi } from 'vitest';
import { applyResolve } from './resolve.js';

/**
 * Runs applyResolve's config hook on `config` and returns the result.
 */
const resolveWith = (config: Record<string, any>) => {
  let handler: ((config: Record<string, any>) => void) | undefined;
  const api = {
    modifyRspackConfig: vi.fn((h: typeof handler) => {
      handler = h;
    }),
  };
  applyResolve(api as never);
  handler!(config);
  return config;
};

describe('applyResolve', () => {
  // rxjs lists `require` before `es2015` and `default`, so with the engine's
  // conditions an `import` of it resolved to the CommonJS build.
  it("resolves imports with the engine's conditions, without require and with module", () => {
    const config = resolveWith({
      resolve: { conditionNames: ['lynx', 'import', 'require', 'browser'] },
    });

    expect(config.resolve.byDependency.esm.conditionNames).toEqual([
      'lynx',
      'import',
      'module',
      'browser',
    ]);
    // A require() still gets every condition.
    expect(config.resolve.conditionNames).toEqual([
      'lynx',
      'import',
      'require',
      'browser',
    ]);
  });

  it('keeps the other dependency types and ESM options', () => {
    const config = resolveWith({
      resolve: {
        conditionNames: ['module', 'import'],
        byDependency: {
          commonjs: { conditionNames: ['require'] },
          esm: { fullySpecified: false },
        },
      },
    });

    expect(config.resolve.byDependency).toEqual({
      commonjs: { conditionNames: ['require'] },
      esm: { fullySpecified: false, conditionNames: ['module', 'import'] },
    });
  });

  it('works without any resolve config', () => {
    expect(resolveWith({}).resolve.byDependency.esm.conditionNames).toEqual([
      'module',
    ]);
  });
});
