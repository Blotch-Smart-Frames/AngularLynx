import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAngularConfig } from './angular-config';

const createMockApi = () => {
  let configHandler: ((config: any) => void) | undefined;

  const api = {
    modifyRsbuildConfig: vi.fn((handler) => {
      configHandler = handler;
    }),
  };

  return {
    api,
    triggerHandler: (config: any) => configHandler!(config),
  };
};

const createBuildOptions = (overrides: Record<string, any> = {}) => ({
  outputPath: undefined as string | undefined,
  polyfills: [] as string[],
  styles: [] as string[],
  tsconfig: '/project/tsconfig.json',
  i18n: { sourceLocale: 'en-US', hasDefinedSourceLocale: false },
  i18nMissingTranslation: 'warning' as const,
  ...overrides,
});

describe('applyAngularConfig', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('registers a modifyRsbuildConfig handler', () => {
    const { api } = createMockApi();

    applyAngularConfig(api as never, createBuildOptions() as never);

    expect(api.modifyRsbuildConfig).toHaveBeenCalledOnce();
  });

  describe('output configuration', () => {
    it('sets distPath.root when outputPath is present', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({ outputPath: '/dist/app' }) as never,
      );
      triggerHandler(config);

      expect(config.output.distPath.root).toBe('/dist/app');
    });

    it('preserves existing distPath properties when merging', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {
        output: { distPath: { js: 'scripts', css: 'styles' } },
      } as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({ outputPath: '/dist/app' }) as never,
      );
      triggerHandler(config);

      expect(config.output.distPath).toEqual({
        js: 'scripts',
        css: 'styles',
        root: '/dist/app',
      });
    });

    it('does not set distPath.root when outputPath is undefined', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({ outputPath: undefined }) as never,
      );
      triggerHandler(config);

      expect(config.output.distPath).toBeUndefined();
    });

    it('sets cleanDistPath to true', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.output.cleanDistPath).toBe(true);
    });

    it('initializes config.output when undefined', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.output).toBeDefined();
    });
  });

  describe('source.preEntry', () => {
    it('converts string preEntry to array before pushing', () => {
      const { api, triggerHandler } = createMockApi();
      const config = { source: { preEntry: 'existing-entry' } } as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(Array.isArray(config.source.preEntry)).toBe(true);
      expect(config.source.preEntry[0]).toBe('existing-entry');
    });

    it('initializes preEntry as empty array when undefined', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(Array.isArray(config.source.preEntry)).toBe(true);
    });

    it('pushes polyfills path', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      const polyfillsEntry = config.source.preEntry.find((e: string) =>
        e.includes('polyfills'),
      );
      expect(polyfillsEntry).toBeDefined();
    });

    it('pushes user polyfills when present', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({
          polyfills: ['zone.js', 'zone.js/testing'],
        }) as never,
      );
      triggerHandler(config);

      expect(config.source.preEntry).toContain('zone.js');
      expect(config.source.preEntry).toContain('zone.js/testing');
    });

    it('pushes styles from buildOptions', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({ styles: ['src/styles.css'] }) as never,
      );
      triggerHandler(config);

      expect(config.source.preEntry).toContain('src/styles.css');
    });
  });

  describe('tsconfigPath', () => {
    it('sets tsconfigPath from buildOptions', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({ tsconfig: '/app/tsconfig.app.json' }) as never,
      );
      triggerHandler(config);

      expect(config.source.tsconfigPath).toBe('/app/tsconfig.app.json');
    });
  });

  describe('production mode defines', () => {
    it('sets ngDevMode = false when NODE_ENV is "production"', () => {
      process.env['NODE_ENV'] = 'production';
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.source.define.ngDevMode).toBe(false);
    });

    it('sets ngDevMode = false when config.mode is "production"', () => {
      process.env['NODE_ENV'] = 'test';
      const { api, triggerHandler } = createMockApi();
      const config = { mode: 'production' } as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.source.define.ngDevMode).toBe(false);
    });

    it('does not set ngDevMode in non-production mode', () => {
      process.env['NODE_ENV'] = 'development';
      const { api, triggerHandler } = createMockApi();
      const config = { mode: 'development' } as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.source?.define?.ngDevMode).toBeUndefined();
    });

    it('initializes source.define when undefined before setting ngDevMode', () => {
      process.env['NODE_ENV'] = 'production';
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.source.define).toBeDefined();
      expect(config.source.define.ngDevMode).toBe(false);
    });
  });

  describe('i18n', () => {
    it('pushes @angular/localize/init when i18n sourceLocale is defined', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({
          i18n: { sourceLocale: 'fr', hasDefinedSourceLocale: true },
        }) as never,
      );
      triggerHandler(config);

      expect(config.source.preEntry).toContain('@angular/localize/init');
    });

    it('does not push @angular/localize/init when i18n is not configured', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.source.preEntry).not.toContain('@angular/localize/init');
    });

    it('sets __LYNX_SOURCE_LOCALE__ define to the configured sourceLocale', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({
          i18n: { sourceLocale: 'ja-JP', hasDefinedSourceLocale: true },
        }) as never,
      );
      triggerHandler(config);

      expect(config.source.define['__LYNX_SOURCE_LOCALE__']).toBe('"ja-JP"');
    });

    it('sets __LYNX_SOURCE_LOCALE__ to en-US by default', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(api as never, createBuildOptions() as never);
      triggerHandler(config);

      expect(config.source.define['__LYNX_SOURCE_LOCALE__']).toBe('"en-US"');
    });
  });
});
