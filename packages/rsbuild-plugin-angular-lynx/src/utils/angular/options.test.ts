import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  normalizeBuildOptions,
  normalizeI18nOptions,
  normalizeOptimization,
  normalizeSourceMaps,
  readBuildOptions,
  readBuildTargetOptions,
  resolveIndexPath,
  resolveOutputPath,
} from './options';

/**
 * Build options with every path field set explicitly, as in the examples.
 */
const baseOptions = (overrides: Record<string, any> = {}) => ({
  browser: 'src/main.ts',
  index: 'src/index.html',
  tsConfig: 'tsconfig.app.json',
  outputPath: 'dist/app',
  ...overrides,
});

/**
 * Builds a mock ProjectDefinition with a single "build" target.
 */
const makeProject = (
  opts: {
    options?: Record<string, any>;
    configurations?: Record<string, any>;
    defaultConfiguration?: string;
    noBuildTarget?: boolean;
    i18n?: unknown;
    root?: string;
    sourceRoot?: string;
  } = {},
): any => {
  const targets = new Map<string, any>();
  if (!opts.noBuildTarget) {
    targets.set('build', {
      options: opts.options,
      configurations: opts.configurations,
      defaultConfiguration: opts.defaultConfiguration,
    });
  }
  return {
    root: opts.root,
    sourceRoot: opts.sourceRoot,
    targets,
    extensions: opts.i18n === undefined ? {} : { i18n: opts.i18n },
  };
};

describe('normalizeSourceMaps', () => {
  it('boolean true expands to scripts and styles true', () => {
    const result = normalizeSourceMaps(true);

    expect(result).toEqual({
      scripts: true,
      styles: true,
      hidden: false,
      vendor: false,
    });
  });

  it('boolean false expands to scripts and styles false', () => {
    const result = normalizeSourceMaps(false);

    expect(result).toEqual({
      scripts: false,
      styles: false,
      hidden: false,
      vendor: false,
    });
  });

  it('object with individual values preserves them', () => {
    const result = normalizeSourceMaps({ scripts: true, styles: false });

    expect(result.scripts).toBe(true);
    expect(result.styles).toBe(false);
    expect(result.hidden).toBe(false);
    expect(result.vendor).toBe(false);
  });

  it('object with hidden true propagates', () => {
    const result = normalizeSourceMaps({ scripts: true, hidden: true });

    expect(result.hidden).toBe(true);
  });

  it('object with vendor true propagates', () => {
    const result = normalizeSourceMaps({ scripts: false, vendor: true });

    expect(result.vendor).toBe(true);
  });
});

describe('normalizeOptimization', () => {
  it('true enables all optimizations', () => {
    const result = normalizeOptimization(true);

    expect(result.scripts).toBe(true);
    expect(result.styles.minify).toBe(true);
    expect(result.styles.inlineCritical).toBe(true);
    expect(result.fonts.inline).toBe(true);
  });

  it('false disables all optimizations', () => {
    const result = normalizeOptimization(false);

    expect(result.scripts).toBe(false);
    expect(result.styles.minify).toBe(false);
    expect(result.styles.inlineCritical).toBe(false);
    expect(result.fonts.inline).toBe(false);
  });

  it('undefined defaults to true (all enabled)', () => {
    const result = normalizeOptimization();

    expect(result.scripts).toBe(true);
    expect(result.styles.minify).toBe(true);
    expect(result.fonts.inline).toBe(true);
  });

  it('object { scripts: true, styles: false } normalizes correctly', () => {
    const result = normalizeOptimization({ scripts: true, styles: false });

    expect(result.scripts).toBe(true);
    expect(result.styles.minify).toBe(false);
  });

  it('object with styles as object passes through', () => {
    const result = normalizeOptimization({
      styles: { minify: true, inlineCritical: false },
    });

    expect(result.styles).toEqual({ minify: true, inlineCritical: false });
  });

  it('object with fonts as object passes through', () => {
    const result = normalizeOptimization({ fonts: { inline: true } });

    expect(result.fonts).toEqual({ inline: true });
  });

  it('object with fonts false normalizes to fonts.inline false', () => {
    const result = normalizeOptimization({ fonts: false });

    expect(result.fonts.inline).toBe(false);
  });
});

describe('normalizeI18nOptions', () => {
  it('returns defaults when input is undefined', () => {
    const result = normalizeI18nOptions(undefined);

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });

  it('returns defaults when input is null', () => {
    const result = normalizeI18nOptions(null);

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });

  it('parses sourceLocale as a string', () => {
    const result = normalizeI18nOptions({ sourceLocale: 'fr' });

    expect(result).toEqual({
      sourceLocale: 'fr',
      hasDefinedSourceLocale: true,
    });
  });

  it('parses sourceLocale as an object with code property', () => {
    const result = normalizeI18nOptions({
      sourceLocale: { code: 'de-AT' },
    });

    expect(result).toEqual({
      sourceLocale: 'de-AT',
      hasDefinedSourceLocale: true,
    });
  });

  it('returns defaults when sourceLocale is not provided', () => {
    const result = normalizeI18nOptions({ locales: { fr: 'messages.fr.xlf' } });

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });

  it('returns defaults for non-object input', () => {
    const result = normalizeI18nOptions('invalid');

    expect(result).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });
});

describe('resolveIndexPath', () => {
  const root = '/workspace';

  it('joins a string index with the workspace root', () => {
    expect(resolveIndexPath('src/index.html', makeProject(), root)).toBe(
      nodePath.join(root, 'src/index.html'),
    );
  });

  it('uses the input of an { input, output } index', () => {
    expect(
      resolveIndexPath(
        { input: 'src/app.html', output: 'index.html' },
        makeProject(),
        root,
      ),
    ).toBe(nodePath.join(root, 'src/app.html'));
  });

  it('returns undefined when the index page is disabled', () => {
    expect(resolveIndexPath(false, makeProject(), root)).toBeUndefined();
  });

  it('defaults to index.html in the project sourceRoot', () => {
    expect(
      resolveIndexPath(
        undefined,
        makeProject({ root: 'projects/app', sourceRoot: 'projects/app/lib' }),
        root,
      ),
    ).toBe(nodePath.join(root, 'projects/app/lib/index.html'));
  });

  it('defaults sourceRoot to <root>/src like @angular/build', () => {
    expect(
      resolveIndexPath(undefined, makeProject({ root: 'projects/app' }), root),
    ).toBe(nodePath.join(root, 'projects/app/src/index.html'));
  });

  it('defaults to src/index.html when the project has no root', () => {
    expect(resolveIndexPath(undefined, makeProject(), root)).toBe(
      nodePath.join(root, 'src/index.html'),
    );
  });
});

describe('resolveOutputPath', () => {
  const root = '/workspace';

  it('joins a string outputPath with the workspace root', () => {
    expect(resolveOutputPath('dist/app', root)).toBe(
      nodePath.join(root, 'dist/app'),
    );
  });

  it('uses the base of an object outputPath', () => {
    expect(resolveOutputPath({ base: 'dist/app', browser: '' }, root)).toBe(
      nodePath.join(root, 'dist/app'),
    );
  });

  it('returns undefined when outputPath is omitted', () => {
    expect(resolveOutputPath(undefined, root)).toBeUndefined();
  });
});

describe('readBuildOptions', () => {
  const basePath = '/workspace';

  it('reads the options `ng new` generates, which omit index and outputPath', async () => {
    const result = await readBuildOptions(
      makeProject({
        root: '',
        sourceRoot: 'src',
        options: { browser: 'src/main.ts', tsConfig: 'tsconfig.app.json' },
      }),
      basePath,
    );

    expect(result.index).toBe(nodePath.join(basePath, 'src/index.html'));
    expect(result.outputPath).toBeUndefined();
  });

  it('throws when the project has no build target', async () => {
    await expect(
      readBuildOptions(makeProject({ noBuildTarget: true }), basePath),
    ).rejects.toThrow("couldn't find target");
  });

  it('throws when the build target has no options', async () => {
    await expect(
      readBuildOptions(makeProject({ options: undefined }), basePath),
    ).rejects.toThrow('No build options found for the "build" target');
  });

  it('names the requested configuration in the missing-options error', async () => {
    await expect(
      readBuildOptions(
        makeProject({ options: undefined }),
        basePath,
        'production',
      ),
    ).rejects.toThrow('No build options found for the "production" target');
  });

  it('normalizes a minimal set of options with sensible defaults', async () => {
    const result = await readBuildOptions(
      makeProject({ options: baseOptions() }),
      basePath,
    );

    expect(result.aot).toBe(true);
    expect(result.tsconfig).toBe(nodePath.join(basePath, 'tsconfig.app.json'));
    expect(result.browser).toBe(nodePath.join(basePath, 'src/main.ts'));
    expect(result.index).toBe(nodePath.join(basePath, 'src/index.html'));
    expect(result.outputPath).toBe(nodePath.join(basePath, 'dist/app'));
    expect(result.polyfills).toEqual([]);
    expect(result.styles).toEqual([]);
    expect(result.fileReplacements).toBeUndefined();
    // No outputHashing → no hash placeholders.
    expect(result.outputNames).toEqual({
      bundles: '[name]',
      media: 'media/[name]',
    });
    // aot && optimization.scripts (default true) → advancedOptimizations true.
    expect(result.advancedOptimizations).toBe(true);
    // sourceMap defaults to false → all sub-flags false.
    expect(result.sourcemapOptions).toEqual({
      vendor: false,
      hidden: false,
      scripts: false,
      styles: false,
    });
    expect(result.i18nMissingTranslation).toBe('warning');
    expect(result.i18n).toEqual({
      sourceLocale: 'en-US',
      hasDefinedSourceLocale: false,
    });
  });

  it('merges the default configuration over the base options', async () => {
    const result = await readBuildOptions(
      makeProject({
        options: baseOptions({ aot: true }),
        // "development" is iterated first and skipped; "production" matches.
        configurations: {
          development: { aot: true },
          production: { aot: false, outputHashing: 'all' },
        },
        defaultConfiguration: 'production',
      }),
      basePath,
    );

    expect(result.aot).toBe(false);
    // aot false → advancedOptimizations false regardless of scripts.
    expect(result.advancedOptimizations).toBe(false);
    expect(result.outputNames).toEqual({
      bundles: '[name]-[hash]',
      media: 'media/[name]-[hash]',
    });
  });

  it('leaves the parsed angular.json target as it was', () => {
    const project = makeProject({
      options: baseOptions({ aot: true }),
      configurations: { production: { aot: false } },
      defaultConfiguration: 'production',
    });

    expect(readBuildTargetOptions(project)).toMatchObject({ aot: false });
    expect(project.targets.get('build').options.aot).toBe(true);
  });

  it('uses the base options alone without a configuration', () => {
    expect(
      readBuildTargetOptions(makeProject({ options: baseOptions() })),
    ).toEqual(baseOptions());
  });

  it('uses an explicit configurationName over the default configuration', async () => {
    const result = await readBuildOptions(
      makeProject({
        options: baseOptions(),
        configurations: { production: { outputHashing: 'bundles' } },
        defaultConfiguration: 'production',
      }),
      basePath,
      'production',
    );

    // outputHashing "bundles": bundles hashed, media not.
    expect(result.outputNames).toEqual({
      bundles: '[name]-[hash]',
      media: 'media/[name]',
    });
  });

  it('hashes only media when outputHashing is "media"', async () => {
    const result = await readBuildOptions(
      makeProject({ options: baseOptions({ outputHashing: 'media' }) }),
      basePath,
    );

    expect(result.outputNames).toEqual({
      bundles: '[name]',
      media: 'media/[name]-[hash]',
    });
  });

  it('normalizes a string polyfills field into an array', async () => {
    const result = await readBuildOptions(
      makeProject({ options: baseOptions({ polyfills: 'zone.js' }) }),
      basePath,
    );

    expect(result.polyfills).toEqual(['zone.js']);
  });

  it('preserves an array polyfills field', async () => {
    const result = await readBuildOptions(
      makeProject({
        options: baseOptions({ polyfills: ['zone.js', 'zone.js/testing'] }),
      }),
      basePath,
    );

    expect(result.polyfills).toEqual(['zone.js', 'zone.js/testing']);
  });

  it('expands the sourceMap object shape', async () => {
    const result = await readBuildOptions(
      makeProject({
        options: baseOptions({ sourceMap: { scripts: true, vendor: true } }),
      }),
      basePath,
    );

    expect(result.sourcemapOptions.scripts).toBe(true);
    expect(result.sourcemapOptions.vendor).toBe(true);
  });

  it('maps styles paths against the workspace root', async () => {
    const result = await readBuildOptions(
      makeProject({
        options: baseOptions({ styles: ['src/styles.css', 'src/theme.css'] }),
      }),
      basePath,
    );

    expect(result.styles).toEqual([
      nodePath.join(basePath, 'src/styles.css'),
      nodePath.join(basePath, 'src/theme.css'),
    ]);
  });

  it('reads i18nMissingTranslation and the project i18n extension', async () => {
    const result = await readBuildOptions(
      makeProject({
        options: baseOptions({ i18nMissingTranslation: 'error' }),
        i18n: { sourceLocale: 'fr' },
      }),
      basePath,
    );

    expect(result.i18nMissingTranslation).toBe('error');
    expect(result.i18n).toEqual({
      sourceLocale: 'fr',
      hasDefinedSourceLocale: true,
    });
  });

  it('sets advancedOptimizations false when script optimization is disabled', async () => {
    const result = await readBuildOptions(
      makeProject({ options: baseOptions({ optimization: false }) }),
      basePath,
    );

    expect(result.advancedOptimizations).toBe(false);
  });

  describe('fileReplacements', () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'angular-lynx-opts-'));
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('resolves file replacements whose replacement file exists', async () => {
      fs.writeFileSync(
        nodePath.join(root, 'env.prod.ts'),
        'export const x = 1;',
      );

      const result = await readBuildOptions(
        makeProject({
          options: baseOptions({
            fileReplacements: [{ replace: 'env.ts', with: 'env.prod.ts' }],
          }),
        }),
        root,
      );

      expect(result.fileReplacements).toEqual({
        [nodePath.join(root, 'env.ts')]: nodePath.join(root, 'env.prod.ts'),
      });
    });

    it('throws when a replacement file does not exist', async () => {
      await expect(
        readBuildOptions(
          makeProject({
            options: baseOptions({
              fileReplacements: [
                { replace: 'env.ts', with: 'does-not-exist.ts' },
              ],
            }),
          }),
          root,
        ),
      ).rejects.toThrow('path in file replacements does not exist');
    });
  });
});

describe('normalizeBuildOptions', () => {
  it('normalizes options Angular CLI already merged, without reading the target', async () => {
    // The target in angular.json says aot: true; the options passed in win.
    const result = await normalizeBuildOptions(
      baseOptions({ aot: false, outputHashing: 'all' }),
      makeProject({ options: baseOptions({ aot: true }) }),
      '/workspace',
    );

    expect(result.aot).toBe(false);
    expect(result.browser).toBe(nodePath.join('/workspace', 'src/main.ts'));
    expect(result.outputNames.bundles).toBe('[name]-[hash]');
  });
});
