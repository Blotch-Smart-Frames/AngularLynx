import {
  getSupportedBrowsers,
  transformSupportedBrowsersToTargets,
} from '@angular/build/private';
import { ComponentStylesheetBundler } from '@angular/build/src/tools/esbuild/angular/component-stylesheets';
import type { NormalizedOptions } from './options.js';

/**
 * Creates an Angular `ComponentStylesheetBundler` configured for the current workspace.
 *
 * Angular's AOT compilation extracts component `styles`/`styleUrl` into separate virtual
 * style files that must be bundled independently. This bundler handles that step — it is
 * invoked by the Angular compilation pipeline whenever a component references inline or
 * external styles, producing CSS that is then injected back into the component's JS output.
 *
 * Several options available on `ComponentStylesheetBundler` (Sass preprocessor, Tailwind,
 * PostCSS, symlink preservation, public path) are intentionally left commented out. They are
 * not yet wired into the plugin's normalized option set and will need to be enabled as the
 * plugin matures.
 *
 * @param options - Normalized Angular build options derived from the workspace's `angular.json`.
 * @returns A configured `ComponentStylesheetBundler` ready for use in the compilation pipeline.
 */
export const createComponentStyleBundler = (
  options: NormalizedOptions,
): ComponentStylesheetBundler => {
  const {
    workspaceRoot,
    optimizationOptions,
    sourcemapOptions,
    outputNames,
    //   externalDependencies,
    //   preserveSymlinks,
    //   stylePreprocessorOptions,
    inlineStyleLanguage = 'css',
    cacheOptions,
    //   tailwindConfiguration,
    //   postcssConfiguration,
    //   publicPath,
  } = options;

  return new ComponentStylesheetBundler(
    {
      workspaceRoot,
      inlineFonts: !!optimizationOptions.fonts.inline,
      optimization: !!optimizationOptions.styles.minify,
      sourcemap:
        // Hidden sourcemaps are inaccessible to tooling, making them equivalent to no
        // sourcemaps but with unnecessary processing overhead — treat them as disabled.
        sourcemapOptions.styles && !sourcemapOptions.hidden ? 'linked' : false,
      outputNames,
      // includePaths: stylePreprocessorOptions?.includePaths,
      // string[] | undefined' is not assignable to type '(Version | DeprecationOrId)[] | undefined'.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // sass: stylePreprocessorOptions?.sass as any,
      // externalDependencies,
      target: transformSupportedBrowsersToTargets(
        getSupportedBrowsers(workspaceRoot, {
          warn: (message) => console.warn(message),
        }),
      ),
      // preserveSymlinks,
      // tailwindConfiguration,
      // postcssConfiguration,
      cacheOptions,
      // publicPath,
    },
    inlineStyleLanguage,
    // incremental=false: watch mode is handled at the Rsbuild level, not inside this bundler
    false,
  );
};
