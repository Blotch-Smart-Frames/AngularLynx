import assert from 'node:assert';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import type { OutputHashing } from '@angular-devkit/build-angular';
import type { workspaces } from '@angular-devkit/core';
import type { TargetDefinition } from '@angular-devkit/core/src/workspace/definitions';
import {
  type NormalizedCachedOptions,
  normalizeCacheOptions,
} from './normalize-cache.js';

/**
 * Normalizes angular.json's `sourceMap` field which accepts two shapes:
 *
 *   - Boolean (`true` / `false`) — applies the same setting to scripts, styles,
 *     hidden, and vendor sourcemaps.
 *   - Object (`{ scripts, styles, hidden, vendor }`) — fine-grained control
 *     used by production builds that want script maps but not vendor or
 *     stylesheet maps for bundle-size reasons.
 *
 * Downstream consumers (the JavaScriptTransformer, the rspack devtool option,
 * and the diagnostic reporters) all expect the object shape, so we expand the
 * boolean into the equivalent uniform-object form here.
 */
export const normalizeSourceMaps = (sourceMap: any): any => {
  const scripts = typeof sourceMap === 'object' ? sourceMap.scripts : sourceMap;
  const styles = typeof sourceMap === 'object' ? sourceMap.styles : sourceMap;
  const hidden = (typeof sourceMap === 'object' && sourceMap.hidden) || false;
  const vendor = (typeof sourceMap === 'object' && sourceMap.vendor) || false;

  return {
    vendor,
    hidden,
    scripts,
    styles,
  };
};

/**
 * Normalizes angular.json's `optimization` field which accepts three shapes:
 *
 *   - `undefined` / `true` — enable everything (the default for production).
 *   - `false` — disable everything (typical for dev builds).
 *   - Object — granular control over scripts/styles/fonts subsections, where
 *     each subsection can itself be a boolean or a config object.
 *
 * The double-nested shape is messy: `{ styles: true }` means "minify styles
 * with the default config" while `{ styles: { minify: false, inlineCritical: true } }`
 * means "use these exact style settings". This function flattens both forms
 * into a single canonical `{ scripts, styles, fonts }` object that all
 * downstream code can rely on without re-doing the shape check.
 *
 * Note: `inlineCritical` is included in the default style config even though
 * Lynx doesn't have a concept of "above-the-fold critical CSS" — leaving it
 * mirrored from Angular's default keeps the option surface compatible with
 * Angular's own builder so users can copy/paste angular.json snippets.
 */
export const normalizeOptimization = (
  optimization: boolean | Record<string, any> | undefined = true,
): any => {
  if (typeof optimization === 'object') {
    const styleOptimization = !!optimization.styles;

    return {
      scripts: !!optimization.scripts,
      styles:
        typeof optimization.styles === 'object'
          ? optimization.styles
          : {
              minify: styleOptimization,
              removeSpecialComments: styleOptimization,
              inlineCritical: styleOptimization,
            },
      fonts:
        typeof optimization.fonts === 'object'
          ? optimization.fonts
          : {
              inline: !!optimization.fonts,
            },
    };
  }

  return {
    scripts: optimization,
    styles: {
      minify: optimization,
      inlineCritical: optimization,
      removeSpecialComments: optimization,
    },
    fonts: {
      inline: optimization,
    },
  };
};

export type NormalizedI18nOptions = {
  sourceLocale: string;
  hasDefinedSourceLocale: boolean;
};

export type NormalizedOptions = {
  tsconfig: string;
  aot: boolean;
  optimizationOptions: {
    scripts: boolean;
    styles: any;
    fonts: any;
  };
  sourcemapOptions: {
    vendor: any;
    hidden: any;
    scripts: any;
    styles: any;
  };
  fileReplacements: Record<string, string> | undefined;
  polyfills?: string[];
  index: string;
  browser: string;
  advancedOptimizations: boolean;
  outputPath: string | undefined;
  workspaceRoot: string;
  outputNames: {
    bundles: string;
    media: string;
  };
  cacheOptions: NormalizedCachedOptions;
  inlineStyleLanguage: string | undefined;
  outputHashing: OutputHashing;
  styles: string[];
  i18n: NormalizedI18nOptions;
  i18nMissingTranslation: 'error' | 'warning' | 'ignore';
};
type Replacement = {
  with: string;
  replace: string;
};

export const readTarget = (
  project: workspaces.ProjectDefinition,
  target = 'build',
): TargetDefinition | undefined => {
  return project.targets.get(target);
};
export const readBuildOptions = async (
  project: workspaces.ProjectDefinition,
  basePath: string,
  configurationName?: string,
): Promise<NormalizedOptions> => {
  const workspaceRoot = basePath;
  const target = readTarget(project);
  if (!target) {
    throw new Error("couldn't find target");
  }
  const resolvedConfigurationName =
    configurationName ?? target.defaultConfiguration;
  const buildOptions = target?.options;
  if (!buildOptions) {
    throw new Error(
      `No build options found for the "${configurationName ?? 'build'}" target in angular.json. ` +
        'Make sure the target has an "options" section with at least "browser", "tsConfig", and "index" defined.',
    );
  }
  // Merge the selected configuration (e.g., 'production') over base options.
  // Object.assign overwrites keys present in the configuration while leaving
  // unmentioned keys at their base-options values.
  const configurations = target.configurations;
  if (configurations) {
    for (const name in configurations) {
      if (name === resolvedConfigurationName) {
        Object.assign(buildOptions, {
          ...configurations[name],
        });
        break;
      }
    }
  }
  assert(!!buildOptions, 'build options is undefined');
  // angular.json `aot` option — defaults to true (AOT). When false, Angular
  // skips template compilation and emits JIT-compatible metadata instead.
  const aot = (buildOptions.aot as boolean | undefined) ?? true;
  const tsconfig = path.join(workspaceRoot, buildOptions.tsConfig as string);
  const optimizationOptions = normalizeOptimization(
    buildOptions.optimization as Record<string, any>,
  );
  const sourcemapOptions = normalizeSourceMaps(buildOptions.sourceMap ?? false);
  const browser = path.join(workspaceRoot, buildOptions.browser as string);
  const index = path.join(workspaceRoot, buildOptions.index as string);
  // Angular's `polyfills` option accepts either a string or string[] in angular.json.
  // Normalize to array so downstream code can always use spread/push.
  let polyfills = buildOptions.polyfills as string | string[] | undefined;
  polyfills =
    polyfills === undefined || Array.isArray(polyfills)
      ? polyfills
      : [polyfills];
  let fileReplacements: Record<string, string> | undefined;
  const buildOptionsFileReplacements =
    buildOptions.fileReplacements as Replacement[];
  if (buildOptionsFileReplacements) {
    for (const replacement of buildOptionsFileReplacements) {
      const fileReplaceWith = path.join(workspaceRoot, replacement.with);

      try {
        await access(fileReplaceWith, constants.F_OK);
      } catch {
        throw new Error(
          `The ${fileReplaceWith} path in file replacements does not exist.`,
        );
      }

      fileReplacements ??= {};
      fileReplacements[path.join(workspaceRoot, replacement.replace)] =
        fileReplaceWith;
    }
  }
  const outputHashing = buildOptions.outputHashing as OutputHashing;
  const media = 'media';
  // outputHashing controls cache-busting hashes in emitted asset filenames.
  // Angular's option vocabulary:
  //   'none'    — no hashes (deterministic filenames, good for dev)
  //   'all'     — hashes on both bundles and media (the production default)
  //   'bundles' — hashes only on JS/CSS bundles, raw filenames for assets
  //   'media'   — hashes only on assets, raw filenames for bundles
  // Lynx delivers .lynx bundles via a URL/path that the host app embeds, so
  // bundle hashes matter for cache invalidation but media hashes mostly affect
  // images and fonts loaded at runtime.
  const outputNames = {
    bundles:
      outputHashing === 'all' || outputHashing === 'bundles'
        ? '[name]-[hash]'
        : '[name]',
    media:
      media +
      (outputHashing === 'all' || outputHashing === 'media'
        ? '/[name]-[hash]'
        : '/[name]'),
  };
  // advancedOptimizations gates Angular's pure-annotation-aware tree-shaking
  // in @angular/build's JavaScriptTransformer. It's only safe with AOT because
  // JIT keeps decorator metadata as runtime-reachable expressions; aggressive
  // pure-call removal would strip them and break component instantiation.
  // It's also gated on `optimizationOptions.scripts` — there's no point
  // running advanced JS transforms when the user explicitly disabled script
  // optimization (typically because they're debugging).
  const advancedOptimizations = !!aot && optimizationOptions.scripts;
  const cacheOptions = normalizeCacheOptions(
    buildOptions.projectMetadata,
    workspaceRoot,
  );
  const inlineStyleLanguage = buildOptions.inlineStyleLanguage as
    | string
    | undefined;
  const styles = ((buildOptions.styles as string[]) ?? []).map((stylePath) =>
    path.join(workspaceRoot, stylePath),
  );

  const outputPath = path.join(
    workspaceRoot,
    buildOptions.outputPath as string,
  );
  const i18n = normalizeI18nOptions(project.extensions['i18n']);
  const i18nMissingTranslation =
    (buildOptions.i18nMissingTranslation as
      | 'error'
      | 'warning'
      | 'ignore'
      | undefined) ?? 'warning';

  const normalizedOptions: NormalizedOptions = {
    aot,
    optimizationOptions,
    advancedOptimizations,
    index,
    browser,
    fileReplacements,
    sourcemapOptions,
    tsconfig,
    polyfills: polyfills ?? [],
    outputPath,
    workspaceRoot,
    outputNames,
    cacheOptions,
    inlineStyleLanguage,
    outputHashing,
    styles,
    i18n,
    i18nMissingTranslation,
  };
  return normalizedOptions;
};

/**
 * Normalizes the `i18n` section from angular.json's project definition.
 * Angular supports `sourceLocale` as either a string ('en-US') or an object
 * ({ code: 'en-US' }). We extract the locale code either way.
 */
export const normalizeI18nOptions = (raw: unknown): NormalizedI18nOptions => {
  if (!raw || typeof raw !== 'object') {
    return { sourceLocale: 'en-US', hasDefinedSourceLocale: false };
  }
  const i18nConfig = raw as Record<string, unknown>;
  let sourceLocale = 'en-US';
  let hasDefinedSourceLocale = false;

  if (typeof i18nConfig.sourceLocale === 'string') {
    sourceLocale = i18nConfig.sourceLocale;
    hasDefinedSourceLocale = true;
  } else if (
    i18nConfig.sourceLocale &&
    typeof i18nConfig.sourceLocale === 'object' &&
    typeof (i18nConfig.sourceLocale as Record<string, unknown>).code ===
      'string'
  ) {
    sourceLocale = (i18nConfig.sourceLocale as Record<string, unknown>)
      .code as string;
    hasDefinedSourceLocale = true;
  }

  return { sourceLocale, hasDefinedSourceLocale };
};
