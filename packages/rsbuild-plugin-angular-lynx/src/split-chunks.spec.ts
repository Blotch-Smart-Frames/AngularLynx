import { describe, expect, it, vi } from 'vitest';
import { applySplitChunksRule } from './split-chunks';

const createMockApi = (userConfig: Record<string, any> = {}) => {
  let rsbuildConfigHandler:
    | ((config: any, utils: { mergeRsbuildConfig: any }) => any)
    | undefined;
  let rspackConfigHandler:
    | ((config: any, utils: { environment: { name: string } }) => any)
    | undefined;

  const api = {
    modifyRsbuildConfig: vi.fn((handler) => {
      rsbuildConfigHandler = handler;
    }),
    modifyRspackConfig: vi.fn((handler) => {
      rspackConfigHandler = handler;
    }),
    getRsbuildConfig: vi.fn(() => userConfig),
  };

  return {
    api,
    triggerRsbuildConfig: (config: any) => {
      const mergeRsbuildConfig = vi.fn((_cfg, override) => ({
        ..._cfg,
        ...override,
        performance: { ..._cfg.performance, ...override?.performance },
      }));
      const result = rsbuildConfigHandler!(config, { mergeRsbuildConfig });
      return { result, mergeRsbuildConfig };
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
  it('registers modifyRsbuildConfig and modifyRspackConfig handlers', () => {
    const { api } = createMockApi();

    applySplitChunksRule(api as never, defaultOptions);

    expect(api.modifyRsbuildConfig).toHaveBeenCalledOnce();
    expect(api.modifyRspackConfig).toHaveBeenCalledOnce();
  });

  describe('modifyRsbuildConfig handler', () => {
    it('sets strategy to "all-in-one" when user has no chunkSplit strategy', () => {
      const { api, triggerRsbuildConfig } = createMockApi({});

      applySplitChunksRule(api as never, defaultOptions);
      const { mergeRsbuildConfig } = triggerRsbuildConfig({});

      expect(mergeRsbuildConfig).toHaveBeenCalledWith(
        {},
        { performance: { chunkSplit: { strategy: 'all-in-one' } } },
      );
    });

    it('preserves config when user already has a chunkSplit strategy', () => {
      const { api, triggerRsbuildConfig } = createMockApi({
        performance: { chunkSplit: { strategy: 'split-by-experience' } },
      });

      applySplitChunksRule(api as never, defaultOptions);
      const { result } = triggerRsbuildConfig({ existing: true });

      expect(result).toEqual({ existing: true });
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
