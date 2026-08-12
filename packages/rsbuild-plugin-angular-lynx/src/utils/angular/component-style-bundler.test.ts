import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createComponentStyleBundler } from './component-style-bundler.js';
import type { NormalizedOptions } from './options.js';

const {
  mockBundlerConstructor,
  mockGetSupportedBrowsers,
  mockTransformTargets,
} = vi.hoisted(() => ({
  mockBundlerConstructor: vi.fn(),
  mockGetSupportedBrowsers: vi.fn().mockReturnValue(['chrome > 90']),
  mockTransformTargets: vi.fn().mockReturnValue(['chrome90']),
}));

vi.mock(
  '@angular/build/src/tools/esbuild/angular/component-stylesheets',
  () => ({ ComponentStylesheetBundler: mockBundlerConstructor }),
);

vi.mock('@angular/build/private', () => ({
  getSupportedBrowsers: mockGetSupportedBrowsers,
  transformSupportedBrowsersToTargets: mockTransformTargets,
}));

const baseOptions = (): NormalizedOptions =>
  ({
    workspaceRoot: '/workspace',
    optimizationOptions: {
      scripts: false,
      styles: { minify: false },
      fonts: { inline: false },
    },
    sourcemapOptions: {
      styles: false,
      hidden: false,
      scripts: false,
      vendor: false,
    },
    outputNames: { bundles: '[name]', media: 'media/[name]' },
    inlineStyleLanguage: 'css',
    cacheOptions: { enabled: true, path: '/cache', basePath: '/cache' } as any,
  }) as unknown as NormalizedOptions;

describe('createComponentStyleBundler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSupportedBrowsers.mockReturnValue(['chrome > 90']);
    mockTransformTargets.mockReturnValue(['chrome90']);
  });

  it('passes workspaceRoot, outputNames, and cacheOptions through unchanged', () => {
    const options = baseOptions();
    createComponentStyleBundler(options);

    const [config] = mockBundlerConstructor.mock.calls[0];
    expect(config.workspaceRoot).toBe('/workspace');
    expect(config.outputNames).toEqual({
      bundles: '[name]',
      media: 'media/[name]',
    });
    expect(config.cacheOptions).toBe(options.cacheOptions);
  });

  it('sets inlineFonts to true when fonts.inline is truthy', () => {
    const options = baseOptions();
    options.optimizationOptions.fonts.inline = true;
    createComponentStyleBundler(options);

    const [config] = mockBundlerConstructor.mock.calls[0];
    expect(config.inlineFonts).toBe(true);
  });

  it('sets inlineFonts to false when fonts.inline is falsy', () => {
    const options = baseOptions();
    options.optimizationOptions.fonts.inline = false;
    createComponentStyleBundler(options);

    const [config] = mockBundlerConstructor.mock.calls[0];
    expect(config.inlineFonts).toBe(false);
  });

  it('sets optimization to true when styles.minify is truthy', () => {
    const options = baseOptions();
    options.optimizationOptions.styles.minify = true;
    createComponentStyleBundler(options);

    const [config] = mockBundlerConstructor.mock.calls[0];
    expect(config.optimization).toBe(true);
  });

  it('sets optimization to false when styles.minify is falsy', () => {
    createComponentStyleBundler(baseOptions());

    const [config] = mockBundlerConstructor.mock.calls[0];
    expect(config.optimization).toBe(false);
  });

  describe('sourcemap', () => {
    it('is "linked" when styles is enabled and not hidden', () => {
      const options = baseOptions();
      options.sourcemapOptions.styles = true;
      options.sourcemapOptions.hidden = false;
      createComponentStyleBundler(options);

      const [config] = mockBundlerConstructor.mock.calls[0];
      expect(config.sourcemap).toBe('linked');
    });

    it('is false when styles sourcemaps are disabled', () => {
      const options = baseOptions();
      options.sourcemapOptions.styles = false;
      options.sourcemapOptions.hidden = false;
      createComponentStyleBundler(options);

      const [config] = mockBundlerConstructor.mock.calls[0];
      expect(config.sourcemap).toBe(false);
    });

    it('is false when sourcemaps are hidden (inaccessible to tooling)', () => {
      const options = baseOptions();
      options.sourcemapOptions.styles = true;
      options.sourcemapOptions.hidden = true;
      createComponentStyleBundler(options);

      const [config] = mockBundlerConstructor.mock.calls[0];
      expect(config.sourcemap).toBe(false);
    });
  });

  describe('inlineStyleLanguage', () => {
    it('uses the provided language', () => {
      const options = baseOptions();
      options.inlineStyleLanguage = 'scss';
      createComponentStyleBundler(options);

      const [, lang] = mockBundlerConstructor.mock.calls[0];
      expect(lang).toBe('scss');
    });

    it('defaults to "css" when inlineStyleLanguage is undefined', () => {
      const options = baseOptions();
      options.inlineStyleLanguage = undefined;
      createComponentStyleBundler(options);

      const [, lang] = mockBundlerConstructor.mock.calls[0];
      expect(lang).toBe('css');
    });
  });

  it('always passes incremental=false as the third argument', () => {
    createComponentStyleBundler(baseOptions());

    const [, , incremental] = mockBundlerConstructor.mock.calls[0];
    expect(incremental).toBe(false);
  });

  it('derives browser targets from the workspace root', () => {
    const options = baseOptions();
    mockGetSupportedBrowsers.mockReturnValue(['firefox > 80']);
    mockTransformTargets.mockReturnValue(['firefox80']);

    createComponentStyleBundler(options);

    expect(mockGetSupportedBrowsers).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({ warn: expect.any(Function) }),
    );
    expect(mockTransformTargets).toHaveBeenCalledWith(['firefox > 80']);

    const [config] = mockBundlerConstructor.mock.calls[0];
    expect(config.target).toEqual(['firefox80']);
  });

  it('warns via console when getSupportedBrowsers emits a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockGetSupportedBrowsers.mockImplementation(
      (_root: string, { warn }: { warn: (msg: string) => void }) => {
        warn('unsupported browser config');
        return [];
      },
    );

    createComponentStyleBundler(baseOptions());

    expect(warnSpy).toHaveBeenCalledWith('unsupported browser config');
    warnSpy.mockRestore();
  });
});
