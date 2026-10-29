import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAngularConfig } from './angular-config';

const createMockApi = (rootPath = '/project') => {
  let configHandler: ((config: any) => void) | undefined;

  const api = {
    context: { rootPath },
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

    describe('cleanDistPath', () => {
      /**
       * Whether Rsbuild's clean would keep `entry`: it tests each `keep`
       * pattern against the absolute POSIX path of every entry it visits.
       */
      const keeps = (
        options: { rootPath?: string; outputPath?: string; config?: any },
        entry: string,
      ) => {
        const { api, triggerHandler } = createMockApi(options.rootPath);
        const config = options.config ?? {};
        applyAngularConfig(
          api as never,
          createBuildOptions({ outputPath: options.outputPath }) as never,
        );
        triggerHandler(config);
        const { keep } = config.output.cleanDistPath;
        return keep.some((pattern: RegExp) => pattern.test(entry));
      };

      it('empties the dist folder on every build', () => {
        const { api, triggerHandler } = createMockApi();
        const config = {} as any;

        applyAngularConfig(api as never, createBuildOptions() as never);
        triggerHandler(config);

        expect(config.output.cleanDistPath.enable).toBe(true);
      });

      it('keeps the native apps in dist/ios and dist/android', () => {
        expect(keeps({}, '/project/dist/ios')).toBe(true);
        expect(keeps({}, '/project/dist/android')).toBe(true);
      });

      it('cleans everything else in dist', () => {
        expect(keeps({}, '/project/dist/main.lynx.bundle')).toBe(false);
        expect(keeps({}, '/project/dist/static')).toBe(false);
        expect(keeps({}, '/project/dist/static/ios')).toBe(false);
        expect(keeps({}, '/project/dist/ios.txt')).toBe(false);
      });

      it('cleans a project that is itself in a folder named ios', () => {
        expect(
          keeps({ rootPath: '/home/me/ios' }, '/home/me/ios/dist/main.js'),
        ).toBe(false);
        expect(
          keeps({ rootPath: '/home/me/ios' }, '/home/me/ios/dist/ios'),
        ).toBe(true);
      });

      it('keeps the native folders of the outputPath', () => {
        expect(
          keeps({ outputPath: '/project/out/app' }, '/project/out/app/ios'),
        ).toBe(true);
        expect(
          keeps({ outputPath: '/project/out/app' }, '/project/dist/ios'),
        ).toBe(false);
      });

      it('resolves a relative dist root against the project', () => {
        const config = { output: { distPath: { root: 'build' } } };
        expect(keeps({ config }, '/project/build/android')).toBe(true);
      });

      it('reads a dist root given as a string', () => {
        const config = { output: { distPath: 'build' } };
        expect(keeps({ config }, '/project/build/android')).toBe(true);
      });

      it('matches regex characters in the path literally', () => {
        const rootPath = '/home/me/my.app (2)';
        expect(keeps({ rootPath }, '/home/me/my.app (2)/dist/ios')).toBe(true);
        expect(keeps({ rootPath }, '/home/me/my-app (2)/dist/ios')).toBe(false);
      });
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

    it('skips the polyfills push when polyfills is undefined', () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({ polyfills: undefined }) as never,
      );
      triggerHandler(config);

      // Only the internal polyfills bundle path is present; no user polyfills
      // were spread in because the `if (polyfills)` guard was false.
      const userPolyfills = config.source.preEntry.filter(
        (e: string) => !e.includes('polyfills'),
      );
      expect(userPolyfills).toEqual([]);
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

    it("loads @angular/localize/init once when the app's polyfills list it too", () => {
      const { api, triggerHandler } = createMockApi();
      const config = {} as any;

      applyAngularConfig(
        api as never,
        createBuildOptions({
          i18n: { sourceLocale: 'fr', hasDefinedSourceLocale: true },
          polyfills: ['@angular/localize/init', 'my-polyfill'],
        }) as never,
      );
      triggerHandler(config);

      expect(
        config.source.preEntry.filter(
          (entry: string) => entry === '@angular/localize/init',
        ),
      ).toHaveLength(1);
      // In the app's place for it, among its own polyfills.
      expect(config.source.preEntry.slice(1, 3)).toEqual([
        '@angular/localize/init',
        'my-polyfill',
      ]);
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
