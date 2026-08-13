import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./angular.js', () => ({ applyAngularRules: vi.fn() }));
vi.mock('./css.js', () => ({ applyCSS: vi.fn() }));
vi.mock('./entry.js', () => ({ applyEntry: vi.fn() }));
vi.mock('./generator.js', () => ({ applyGenerator: vi.fn() }));
vi.mock('./layers.js', () => ({ applyLayers: vi.fn() }));
vi.mock('./logger/dev-logger.js', () => ({ applyDevLogger: vi.fn() }));
vi.mock('./split-chunks.js', () => ({ applySplitChunksRule: vi.fn() }));
vi.mock('./tailwind.js', () => ({ applyTailwind: vi.fn() }));
vi.mock('./utils/options.js', () => ({
  normalizeOptions: vi.fn((opts) => ({ _normalized: true, ...opts })),
}));

import { applyAngularRules } from './angular.js';
import { applyCSS } from './css.js';
import { applyEntry } from './entry.js';
import { applyGenerator } from './generator.js';
import { applyLayers } from './layers.js';
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

  it('has pre dependency on "lynx:rsbuild:plugin-api"', () => {
    const plugin = pluginAngularLynx();

    expect(plugin.pre).toEqual(['lynx:rsbuild:plugin-api']);
  });

  it('calls normalizeOptions with provided options', () => {
    const options = { experimental_isLazyBundle: true } as any;
    const plugin = pluginAngularLynx(options);
    const mockApi = {} as any;

    plugin.setup(mockApi);

    expect(normalizeOptions).toHaveBeenCalledWith(options);
  });

  it('calls normalizeOptions with undefined when no options provided', () => {
    const plugin = pluginAngularLynx();
    const mockApi = {} as any;

    plugin.setup(mockApi);

    expect(normalizeOptions).toHaveBeenCalledWith(undefined);
  });

  describe('setup', () => {
    const mockApi = {} as any;

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

    it('calls applyTailwind with api', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyTailwind).toHaveBeenCalledWith(mockApi);
    });

    it('calls applyEntry with api and normalized options', () => {
      const plugin = pluginAngularLynx();
      plugin.setup(mockApi);

      expect(applyEntry).toHaveBeenCalledWith(
        mockApi,
        expect.objectContaining({ _normalized: true }),
      );
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
