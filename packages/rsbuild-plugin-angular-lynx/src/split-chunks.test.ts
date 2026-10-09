import { describe, expect, it, vi } from 'vitest';
import { applySplitChunksRule } from './split-chunks';

const createMockApi = (userConfig: Record<string, any> = {}) => {
  let environmentConfigHandler:
    | ((
        config: any,
        utils: { name: string; mergeEnvironmentConfig: any },
      ) => any)
    | undefined;
  let rspackConfigHandler:
    | ((config: any, utils: { environment: { name: string } }) => any)
    | undefined;

  const api = {
    modifyEnvironmentConfig: vi.fn((handler) => {
      environmentConfigHandler = handler;
    }),
    modifyRspackConfig: vi.fn((handler) => {
      rspackConfigHandler = handler;
    }),
    getRsbuildConfig: vi.fn(() => userConfig),
  };

  return {
    api,
    triggerEnvironmentConfig: (config: any, name = 'lynx') => {
      const mergeEnvironmentConfig = vi.fn((cfg, override) => ({
        ...cfg,
        ...override,
      }));
      const result = environmentConfigHandler!(config, {
        name,
        mergeEnvironmentConfig,
      });
      return { result, mergeEnvironmentConfig };
    },
    triggerRspackConfig: (config: any, environment = { name: 'lynx' }) => {
      return rspackConfigHandler!(config, { environment });
    },
  };
};

const defaultOptions = {
  experimental_isLazyBundle: false,
} as any;

describe('applySplitChunksRule', () => {
  it('registers modifyEnvironmentConfig and modifyRspackConfig handlers', () => {
    const { api } = createMockApi();

    applySplitChunksRule(api as never, defaultOptions);

    expect(api.modifyEnvironmentConfig).toHaveBeenCalledOnce();
    expect(api.modifyRspackConfig).toHaveBeenCalledOnce();
  });

  describe('modifyEnvironmentConfig handler', () => {
    // Splitting must default to off: shared chunks extracted by
    // SplitChunksPlugin are missing from lynx_aci and break lazy routes.
    it('disables splitChunks when the user configured no splitting', () => {
      const { api, triggerEnvironmentConfig } = createMockApi({});

      applySplitChunksRule(api as never, defaultOptions);
      const { result, mergeEnvironmentConfig } = triggerEnvironmentConfig({});

      expect(mergeEnvironmentConfig).toHaveBeenCalledWith(
        {},
        { splitChunks: false },
      );
      expect(result).toEqual({ splitChunks: false });
    });

    it('disables splitChunks when the legacy strategy is "all-in-one"', () => {
      const { api, triggerEnvironmentConfig } = createMockApi({
        performance: { chunkSplit: { strategy: 'all-in-one' } },
      });

      applySplitChunksRule(api as never, defaultOptions);
      const { mergeEnvironmentConfig } = triggerEnvironmentConfig({});

      expect(mergeEnvironmentConfig).toHaveBeenCalledWith(
        {},
        { splitChunks: false },
      );
    });

    it('preserves config when the user set a global legacy splitting strategy', () => {
      const { api, triggerEnvironmentConfig } = createMockApi({
        performance: { chunkSplit: { strategy: 'split-by-experience' } },
      });

      applySplitChunksRule(api as never, defaultOptions);
      const config = { existing: true };
      const { result, mergeEnvironmentConfig } =
        triggerEnvironmentConfig(config);

      expect(result).toBe(config);
      expect(mergeEnvironmentConfig).not.toHaveBeenCalled();
    });

    it('preserves config when the user set splitChunks globally', () => {
      const { api, triggerEnvironmentConfig } = createMockApi({
        splitChunks: { preset: 'per-package' },
      });

      applySplitChunksRule(api as never, defaultOptions);
      const config = { existing: true };
      const { result, mergeEnvironmentConfig } =
        triggerEnvironmentConfig(config);

      expect(result).toBe(config);
      expect(mergeEnvironmentConfig).not.toHaveBeenCalled();
    });

    it('preserves config when the user explicitly set splitChunks: false', () => {
      // `false` is a user choice, not "unset" — nothing to merge.
      const { api, triggerEnvironmentConfig } = createMockApi({
        splitChunks: false,
      });

      applySplitChunksRule(api as never, defaultOptions);
      const config = { existing: true };
      const { result } = triggerEnvironmentConfig(config);

      expect(result).toBe(config);
    });

    it('prefers the environment-scoped splitChunks over the global one', () => {
      const { api, triggerEnvironmentConfig } = createMockApi({
        environments: { lynx: { splitChunks: { preset: 'per-package' } } },
      });

      applySplitChunksRule(api as never, defaultOptions);
      const config = { existing: true };

      // The lynx environment configured splitting itself → left alone...
      expect(triggerEnvironmentConfig(config, 'lynx').result).toBe(config);
      // ...while another environment without its own config gets it disabled.
      expect(triggerEnvironmentConfig({}, 'web').result).toEqual({
        splitChunks: false,
      });
    });

    it('prefers the environment-scoped legacy strategy over the global one', () => {
      const { api, triggerEnvironmentConfig } = createMockApi({
        performance: { chunkSplit: { strategy: 'split-by-experience' } },
        environments: {
          lynx: { performance: { chunkSplit: { strategy: 'all-in-one' } } },
        },
      });

      applySplitChunksRule(api as never, defaultOptions);
      const config = { existing: true };

      // Scoped `all-in-one` wins over the global split strategy → disabled.
      expect(triggerEnvironmentConfig({}, 'lynx').result).toEqual({
        splitChunks: false,
      });
      // An environment without scoped config falls back to the global strategy.
      expect(triggerEnvironmentConfig(config, 'web').result).toBe(config);
    });
  });

  describe('modifyRspackConfig handler', () => {
    it('returns config unchanged when environment.name is not "lynx"', () => {
      const { api, triggerRspackConfig } = createMockApi();
      const config = { output: {}, optimization: { splitChunks: {} } };

      applySplitChunksRule(api as never, defaultOptions);
      const result = triggerRspackConfig(config, { name: 'web' });

      expect(result).toBe(config);
    });

    it('sets asyncChunks to false when experimental_isLazyBundle is false', () => {
      const { api, triggerRspackConfig } = createMockApi();
      const config = { optimization: { splitChunks: { chunks: 'all' } } };

      applySplitChunksRule(api as never, {
        ...defaultOptions,
        experimental_isLazyBundle: false,
      });
      const result = triggerRspackConfig(config);

      expect((result as any).output.asyncChunks).toBe(false);
    });

    it('does not set asyncChunks to false when experimental_isLazyBundle is true', () => {
      const { api, triggerRspackConfig } = createMockApi();
      const config = { optimization: { splitChunks: { chunks: 'all' } } };

      applySplitChunksRule(api as never, {
        ...defaultOptions,
        experimental_isLazyBundle: true,
      });
      const result = triggerRspackConfig(config);

      expect((result as any).output.asyncChunks).toBeUndefined();
    });

    it('returns early if optimization is falsy', () => {
      const { api, triggerRspackConfig } = createMockApi();
      const config = { optimization: undefined };

      applySplitChunksRule(api as never, defaultOptions);
      const result = triggerRspackConfig(config);

      expect(result).toBe(config);
    });

    it('returns early if splitChunks is falsy', () => {
      const { api, triggerRspackConfig } = createMockApi();
      const config = { optimization: { splitChunks: false } };

      applySplitChunksRule(api as never, defaultOptions);
      const result = triggerRspackConfig(config);

      expect(result).toBe(config);
    });

    describe('chunks function replacement', () => {
      it('returns false for chunks with "__main-thread" in name', () => {
        const { api, triggerRspackConfig } = createMockApi();
        const config = { optimization: { splitChunks: { chunks: 'all' } } };

        applySplitChunksRule(api as never, defaultOptions);
        const result = triggerRspackConfig(config);
        const chunksFilter = (result as any).optimization.splitChunks.chunks;

        expect(chunksFilter({ name: 'app__main-thread' })).toBe(false);
      });

      it('delegates to original function if chunks was a function', () => {
        const originalFn = vi.fn().mockReturnValue(true);
        const { api, triggerRspackConfig } = createMockApi();
        const config = {
          optimization: { splitChunks: { chunks: originalFn } },
        };

        applySplitChunksRule(api as never, defaultOptions);
        const result = triggerRspackConfig(config);
        const chunksFilter = (result as any).optimization.splitChunks.chunks;
        const chunk = { name: 'vendor' };

        expect(chunksFilter(chunk)).toBe(true);
        expect(originalFn).toHaveBeenCalledWith(chunk);
      });

      it('maps "async" to !chunk.canBeInitial()', () => {
        const { api, triggerRspackConfig } = createMockApi();
        const config = {
          optimization: { splitChunks: { chunks: 'async' } },
        };

        applySplitChunksRule(api as never, defaultOptions);
        const result = triggerRspackConfig(config);
        const chunksFilter = (result as any).optimization.splitChunks.chunks;

        expect(chunksFilter({ name: 'lazy', canBeInitial: () => false })).toBe(
          true,
        );
        expect(chunksFilter({ name: 'main', canBeInitial: () => true })).toBe(
          false,
        );
      });

      it('maps "initial" to chunk.canBeInitial()', () => {
        const { api, triggerRspackConfig } = createMockApi();
        const config = {
          optimization: { splitChunks: { chunks: 'initial' } },
        };

        applySplitChunksRule(api as never, defaultOptions);
        const result = triggerRspackConfig(config);
        const chunksFilter = (result as any).optimization.splitChunks.chunks;

        expect(chunksFilter({ name: 'main', canBeInitial: () => true })).toBe(
          true,
        );
        expect(chunksFilter({ name: 'lazy', canBeInitial: () => false })).toBe(
          false,
        );
      });

      it('returns true when original chunks was "all"', () => {
        const { api, triggerRspackConfig } = createMockApi();
        const config = {
          optimization: { splitChunks: { chunks: 'all' } },
        };

        applySplitChunksRule(api as never, defaultOptions);
        const result = triggerRspackConfig(config);
        const chunksFilter = (result as any).optimization.splitChunks.chunks;

        expect(chunksFilter({ name: 'anything' })).toBe(true);
      });

      it('returns true when original chunks was undefined', () => {
        const { api, triggerRspackConfig } = createMockApi();
        const config = {
          optimization: { splitChunks: {} },
        };

        applySplitChunksRule(api as never, defaultOptions);
        const result = triggerRspackConfig(config);
        const chunksFilter = (result as any).optimization.splitChunks.chunks;

        expect(chunksFilter({ name: 'anything' })).toBe(true);
      });
    });
  });
});
