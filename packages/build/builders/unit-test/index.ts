import {
  type BuilderContext,
  type BuilderOutput,
  type Target,
  createBuilder,
} from '@angular-devkit/architect';
import { createRequire } from 'node:module';
import path from 'node:path';

import { importFromProject } from '../project-import';
import type { UnitTestBuilderOptions } from './schema';

/** The part of @angular/build this builder uses (its public API). */
export type AngularBuildModule = {
  readonly executeUnitTestBuilder: (
    options: UnitTestBuilderOptions,
    context: BuilderContext,
  ) => AsyncIterable<BuilderOutput>;
};

export type UnitTestBuilderDeps = {
  readonly importAngularBuild: (
    projectRoot: string,
  ) => Promise<AngularBuildModule>;
  readonly hasTestingLibrary: (projectRoot: string) => boolean;
};

/**
 * @angular/build comes from the project, like Angular's own builders: its
 * version must match the project's Angular version, which `ng new` installs
 * it for.
 */
const importAngularBuild = (projectRoot: string): Promise<AngularBuildModule> =>
  importFromProject<AngularBuildModule>(
    '@angular/build',
    projectRoot,
    'Run `npm install --save-dev @angular/build` (`ng new` adds it).',
  );

/**
 * Whether the project has @blotch/angular-lynx-testing-library. Its package.json
 * isn't in its `exports` in every version, and Node then refuses to resolve
 * it, but only when the package is there.
 */
export const hasTestingLibrary = (projectRoot: string): boolean => {
  try {
    createRequire(path.join(projectRoot, 'package.json')).resolve(
      '@blotch/angular-lynx-testing-library/package.json',
    );
    return true;
  } catch (error) {
    return (
      (error as { code?: string }).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
    );
  }
};

const defaultDeps: UnitTestBuilderDeps = {
  importAngularBuild,
  hasTestingLibrary,
};

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
 * How Angular's test build loads imported assets (`import logo from
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
 * The builder context Angular's unit-test builder gets. It reads the
 * compiler options (tsconfig, polyfills, styles, file replacements) from the
 * build target, and only knows Angular's own application builder: for any
 * other it warns that "unexpected behavior or build failures may occur" and
 * validates the options against that builder's schema. A Lynx build target
 * therefore reaches it as an Angular one, with the options both builders
 * share, which Angular's schema validates and completes with its defaults,
 * the asset loaders rspeedy's defaults correspond to, and `lynxPolyfills`
 * after the app's own polyfills.
 *
 * The Lynx setup goes in as polyfills rather than `setupFiles` because
 * Angular compiles setup files with the tests, and TypeScript rejects one
 * outside the tsconfig's folder when the tsconfig sets an `outDir`, as
 * `ng new`'s tsconfig.spec.json does: a package in the workspace's
 * node_modules is outside a project in `projects/`. Polyfills are bundled as
 * modules, and run first.
 */
const asAngularBuildTargets = (
  context: BuilderContext,
  lynxPolyfills: readonly string[],
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

/**
 * The options as Angular CLI hands them to Angular's own builders. For a
 * builder outside `@angular/build`, it sets every array option the user left
 * out to `[]` (and nested ones too, e.g. `coverageWatermarks.lines`), which
 * Angular's unit-test builder reads as set: `reporters: []` runs Vitest with
 * no reporter, so `ng test` printed nothing. An empty list never means more
 * than an absent one here, so empty lists are dropped.
 */
const withoutEmptyLists = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => !(Array.isArray(item) && item.length === 0))
      .map(([key, item]) => [key, withoutEmptyLists(item)]),
  ) as T;
};

/**
 * `ng test`: Angular's unit-test builder (`@angular/build:unit-test`), so the
 * options, test discovery (`*.spec.ts` and `*.test.ts`), TestBed, watch mode
 * and coverage are the ones Angular developers know, and the tests compile
 * ahead of time like the app. Two modules load first: one defines the
 * compile-time flags the AngularLynx runtime reads, and, when the project has
 * @blotch/angular-lynx-testing-library, its setup prepares the Lynx
 * environment its `render()` needs.
 *
 * Tests render through Angular's DOM renderer under TestBed and through the
 * Lynx renderer under the testing library's `render()`. Either way the test
 * compile checks templates strictly, as the Angular Language Service does:
 * a component that uses Lynx elements imports LYNX_ELEMENTS (as generated
 * ones do). The app build is laxer, because it adds CUSTOM_ELEMENTS_SCHEMA to
 * every component, which Angular's test build has no hook for.
 */
export const runUnitTest = async function* (
  options: UnitTestBuilderOptions,
  context: BuilderContext,
  deps: UnitTestBuilderDeps = defaultDeps,
): AsyncIterable<BuilderOutput> {
  const projectName = context.target?.project;
  if (!projectName) {
    yield { success: false, error: 'The builder needs a project target.' };
    return;
  }
  const metadata = await context.getProjectMetadata(projectName);
  const projectRoot = path.join(
    context.workspaceRoot,
    (metadata['root'] as string | undefined) ?? '',
  );
  let angularBuild: AngularBuildModule;
  try {
    angularBuild = await deps.importAngularBuild(projectRoot);
  } catch (error) {
    yield {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    return;
  }
  const lynxPolyfills = [
    '@blotch/angular-lynx-build/unit-test/lynx-globals',
    ...(deps.hasTestingLibrary(projectRoot)
      ? ['@blotch/angular-lynx-testing-library/setup']
      : []),
  ];
  yield* angularBuild.executeUnitTestBuilder(
    withoutEmptyLists(options),
    asAngularBuildTargets(context, lynxPolyfills),
  );
};

export default createBuilder<UnitTestBuilderOptions>((options, context) =>
  runUnitTest(options, context),
);
