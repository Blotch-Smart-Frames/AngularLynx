import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
} from '@angular-devkit/architect';
import { createRequire } from 'node:module';
import path from 'node:path';

import { asAngularBuildTargets, importAngularBuild } from '../angular-build';
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
  importAngularBuild: (projectRoot) =>
    importAngularBuild<AngularBuildModule>(projectRoot),
  hasTestingLibrary,
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
  // The Lynx setup goes in as polyfills rather than `setupFiles` because
  // Angular compiles setup files with the tests, and TypeScript rejects one
  // outside the tsconfig's folder when the tsconfig sets an `outDir`, as
  // `ng new`'s tsconfig.spec.json does: a package in the workspace's
  // node_modules is outside a project in `projects/`. Polyfills are bundled
  // as modules, and run first.
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
