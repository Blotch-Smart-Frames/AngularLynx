import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OptionsModule from './utils/options.js';

vi.mock('./angular.js', () => ({ applyAngularRules: vi.fn() }));
vi.mock('./background-entry.js', () => ({
  createBackgroundEntries: vi.fn(() => ({ _backgroundEntries: true })),
}));
vi.mock('./css.js', () => ({ applyCSS: vi.fn() }));
vi.mock('./entry.js', () => ({ applyEntry: vi.fn() }));
vi.mock('./generator.js', () => ({ applyGenerator: vi.fn() }));
vi.mock('./layers.js', () => ({ applyLayers: vi.fn() }));
vi.mock('./resolve.js', () => ({ applyResolve: vi.fn() }));
vi.mock('./logger/dev-logger.js', () => ({ applyDevLogger: vi.fn() }));
vi.mock('./split-chunks.js', () => ({ applySplitChunksRule: vi.fn() }));
vi.mock('./tailwind.js', () => ({ applyTailwind: vi.fn() }));
vi.mock('./utils/options.js', async (importOriginal) => ({
  deprecatedOptionsIn: (await importOriginal<typeof OptionsModule>())
    .deprecatedOptionsIn,
  normalizeOptions: vi.fn((opts) => ({ _normalized: true, ...opts })),
}));

import { applyAngularRules } from './angular.js';
import { createBackgroundEntries } from './background-entry.js';
import { applyCSS } from './css.js';
import { applyEntry } from './entry.js';
import { applyGenerator } from './generator.js';
import { applyLayers } from './layers.js';
import { applyResolve } from './resolve.js';
import { applyDevLogger } from './logger/dev-logger.js';
import { applySplitChunksRule } from './split-chunks.js';
import { applyTailwind } from './tailwind.js';
import { normalizeOptions } from './utils/options.js';
import { pluginAngularLynx } from './plugin-angular-lynx';

describe('pluginAngularLynx', () => {
  it('returns a plugin with name "lynx:angular"', () => {
    const plugin = pluginAngularLynx();

    expect(plugin.name).toBe('lynx:angular');
  });

  it('sets up after "lynx:rsbuild:plugin-api" and the Angular CLI context', () => {
    const plugin = pluginAngularLynx();

    expect(plugin.pre).toEqual([
      'lynx:rsbuild:plugin-api',
      'lynx:angular-cli-context',
    ]);
  });

  it('calls normalizeOptions with provided options', () => {
    const options = { experimental_isLazyBundle: true } as any;
    const plugin = pluginAngularLynx(options);
    const mockApi = { context: { rootPath: '/proj' } } as any;

    plugin.setup(mockApi);

    expect(normalizeOptions).toHaveBeenCalledWith(options);
  });

  it('calls normalizeOptions with undefined when no options provided', () => {
    const plugin = pluginAngularLynx();
    const mockApi = { context: { rootPath: '/proj' } } as any;

    plugin.setup(mockApi);

    expect(normalizeOptions).toHaveBeenCalledWith(undefined);
  });

  describe('setup', () => {
    const mockApi = { context: { rootPath: '/proj' } } as any;
    const backgroundEntries = { _backgroundEntries: true };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls applyCSS with api and normalized options', () => {
      const plugin = pluginAngularLynx({ foo: 'bar' } as any);
      plugin.setup(mockApi);

      expect(applyCSS).toHaveBeenCalledWith(
        mockApi,
        expect.objectContaining({ _normalized: true }),
      );
    });

    it('warns once for each deprecated option the config sets', () => {
      const api = {
        context: { rootPath: '/proj' },
        logger: { warn: vi.fn() },
      } as any;
      const plugin = pluginAngularLynx({
        enableICU: true,
        pipelineSchedulerConfig: 0x00010000,
        enableA11y: false,
      });
      plugin.setup(api);

      expect(api.logger.warn).toHaveBeenCalledTimes(2);
      expect(api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('`enableICU` option has no effect'),
      );
      expect(api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          '`pipelineSchedulerConfig` option has no effect',
        ),
      );
    });

    it("doesn't warn without deprecated options", () => {
      const api = {
        context: { rootPath: '/proj' },
        logger: { warn: vi.fn() },
      } as any;
      pluginAngularLynx({ enableA11y: false }).setup(api);

      expect(api.logger.warn).not.toHaveBeenCalled();
    });

    it('calls applyTailwind with api', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyTailwind).toHaveBeenCalledWith(mockApi);
    });

    // entry.ts points the background entries at the files angular.ts writes,
    // so both get the same instance.
    it('creates the background entries for the project root and shares them', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(createBackgroundEntries).toHaveBeenCalledWith({
        rootPath: '/proj',
      });
      expect(applyEntry).toHaveBeenCalledWith(
        mockApi,
        expect.objectContaining({ _normalized: true }),
        backgroundEntries,
      );
      expect(applyAngularRules).toHaveBeenCalledWith(
        mockApi,
        expect.any(Object),
        backgroundEntries,
      );
    });

    it('calls applyResolve with api', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyResolve).toHaveBeenCalledWith(mockApi);
    });

    it('calls applyLayers with api', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyLayers).toHaveBeenCalledWith(mockApi);
    });

    it('calls applyAngularRules with api', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyAngularRules).toHaveBeenCalledWith(
        mockApi,
        expect.any(Object),
        backgroundEntries,
      );
    });

    it('calls applyGenerator with api', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyGenerator).toHaveBeenCalledWith(mockApi);
    });

    it('calls applySplitChunksRule with api and normalized options', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applySplitChunksRule).toHaveBeenCalledWith(
        mockApi,
        expect.objectContaining({ _normalized: true }),
      );
    });

    it('calls applyDevLogger with api', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyDevLogger).toHaveBeenCalledWith(mockApi);
    });

    it('calls sub-plugins in the correct order', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      const cssOrder = vi.mocked(applyCSS).mock.invocationCallOrder[0];
      const tailwindOrder =
        vi.mocked(applyTailwind).mock.invocationCallOrder[0];
      const entryOrder = vi.mocked(applyEntry).mock.invocationCallOrder[0];
      const layersOrder = vi.mocked(applyLayers).mock.invocationCallOrder[0];
      const angularOrder =
        vi.mocked(applyAngularRules).mock.invocationCallOrder[0];
      const generatorOrder =
        vi.mocked(applyGenerator).mock.invocationCallOrder[0];
      const splitChunksOrder =
        vi.mocked(applySplitChunksRule).mock.invocationCallOrder[0];
      const loggerOrder = vi.mocked(applyDevLogger).mock.invocationCallOrder[0];

      expect(cssOrder).toBeLessThan(tailwindOrder);
      expect(tailwindOrder).toBeLessThan(entryOrder);
      expect(entryOrder).toBeLessThan(layersOrder);
      expect(layersOrder).toBeLessThan(angularOrder);
      expect(angularOrder).toBeLessThan(generatorOrder);
      expect(generatorOrder).toBeLessThan(splitChunksOrder);
      expect(splitChunksOrder).toBeLessThan(loggerOrder);
    });
  });
});
