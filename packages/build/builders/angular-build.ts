import type { BuilderContext, Target } from '@angular-devkit/architect';

import { importFromProject } from './project-import';

/**
 * @angular/build comes from the project, like Angular's own builders: its
 * version must match the project's Angular version, which `ng new` installs
 * it for.
 */
export const importAngularBuild = <T>(projectRoot: string): Promise<T> =>
  importFromProject<T>(
    '@angular/build',
    projectRoot,
    'Run `npm install --save-dev @angular/build` (`ng new` adds it).',
  );

const LYNX_APPLICATION_BUILDER = '@blotch/angular-lynx-build:application';
const ANGULAR_APPLICATION_BUILDER = '@angular/build:application';

/**
 * The options of the Lynx application builder that are Angular's application
 * builder's too, and mean the same. The rest (native app settings, rspeedy's
 * `config` and `environment`) are Lynx-only; Angular's schema rejects them.
 */
export const ANGULAR_BUILD_OPTIONS: readonly string[] = [
  'browser',
  'tsConfig',
  'polyfills',
  'styles',
  'assets',
  'scripts',
  'inlineStyleLanguage',
  'fileReplacements',
  'aot',
  'optimization',
  'sourceMap',
  'outputHashing',
  'i18nMissingTranslation',
  'budgets',
  'extractLicenses',
  'outputPath',
  'index',
  'watch',
];

/**
 * How Angular's build loads imported assets (`import logo from
 * './logo.png'`): as files, so the import is the file's URL, as rspeedy
 * makes it in the app. Angular's build has no loader for them by default and
 * fails on the import.
 */
export const ASSET_LOADERS: Readonly<Record<string, 'file'>> =
  Object.fromEntries(
    [
      // Images
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'avif',
      'bmp',
      'ico',
      'svg',
      // Fonts
      'woff',
      'woff2',
      'ttf',
      'otf',
      'eot',
      // Audio and video
      'mp4',
      'webm',
      'mov',
      'mp3',
      'wav',
      'ogg',
      'm4a',
      'aac',
    ].map((extension) => [`.${extension}`, 'file' as const]),
  );

/**
 * The builder context Angular's unit-test and extract-i18n builders get.
 * Both compile the app with Angular's application builder, taking its
 * options (tsconfig, polyfills, styles, file replacements) from the build
 * target, and only know Angular's own application builder: for any other the
 * unit-test builder warns that "unexpected behavior or build failures may
 * occur", and both validate the options against that builder's schema. A
 * Lynx build target therefore reaches them as an Angular one, with the
 * options both builders share, which Angular's schema validates and
 * completes with its defaults, the asset loaders rspeedy's defaults
 * correspond to, and `lynxPolyfills` after the app's own polyfills.
 */
export const asAngularBuildTargets = (
  context: BuilderContext,
  lynxPolyfills: readonly string[] = [],
): BuilderContext => {
  const isLynxApplication = async (target: Target): Promise<boolean> =>
    (await context.getBuilderNameForTarget(target)) ===
    LYNX_APPLICATION_BUILDER;
  const overrides: Partial<BuilderContext> = {
    getBuilderNameForTarget: async (target) =>
      (await isLynxApplication(target))
        ? ANGULAR_APPLICATION_BUILDER
        : context.getBuilderNameForTarget(target),
    getTargetOptions: async (target) => {
      const options = await context.getTargetOptions(target);
      if (!(await isLynxApplication(target))) {
        return options;
      }
      const polyfills = options['polyfills'];
      return {
        ...Object.fromEntries(
          Object.entries(options).filter(([key]) =>
            ANGULAR_BUILD_OPTIONS.includes(key),
          ),
        ),
        loader: ASSET_LOADERS,
        polyfills: [
          ...(Array.isArray(polyfills)
            ? polyfills
            : typeof polyfills === 'string'
              ? [polyfills]
              : []),
          ...lynxPolyfills,
        ],
      };
    },
  };
  return new Proxy(context, {
    get: (target, property) =>
      property in overrides
        ? overrides[property as keyof BuilderContext]
        : Reflect.get(target, property),
  });
};
