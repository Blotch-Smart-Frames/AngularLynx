import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
} from '@angular-devkit/architect';
import { createRequire } from 'node:module';
import path from 'node:path';

import { asAngularBuildTargets, importAngularBuild } from '../angular-build';
import type { ExtractI18nBuilderOptions } from './schema';

/** The part of @angular/build this builder uses (its public API). */
export type AngularBuildModule = {
  readonly executeExtractI18nBuilder: (
    options: ExtractI18nBuilderOptions,
    context: BuilderContext,
  ) => Promise<BuilderOutput>;
};

export type ExtractI18nBuilderDeps = {
  readonly importAngularBuild: (
    projectRoot: string,
  ) => Promise<AngularBuildModule>;
  readonly hasLocalize: (projectRoot: string) => boolean;
};

/** Whether the project has @angular/localize, which the extractor runs. */
export const hasLocalize = (projectRoot: string): boolean => {
  try {
    createRequire(path.join(projectRoot, 'package.json')).resolve(
      '@angular/localize/package.json',
    );
    return true;
  } catch {
    return false;
  }
};

const defaultDeps: ExtractI18nBuilderDeps = {
  importAngularBuild: (projectRoot) =>
    importAngularBuild<AngularBuildModule>(projectRoot),
  hasLocalize,
};

/**
 * Angular's own message for a project without @angular/localize suggests
 * `ng add @angular/localize`, which only sets up Angular's builders: on a
 * Lynx app, `$localize` would then be missing at runtime.
 */
const NO_LOCALIZE =
  'i18n extraction requires the @angular/localize package. Run `ng generate @blotch/angular-lynx:add-i18n` to install it and set up i18n.';

/**
 * `ng extract-i18n`: Angular's extract-i18n builder
 * (`@angular/build:extract-i18n`), so the options, formats and messages file
 * are the ones Angular developers know. Angular CLI picks that builder on its
 * own only for a project built with one of Angular's builders, so without a
 * target that names this one, `ng extract-i18n` fails with "Cannot determine
 * project or target for command."
 *
 * Angular's extractor compiles the app with Angular's application builder
 * from the build target's options. The Lynx build target reaches it as an
 * Angular one, as in `ng test`: Angular's builder neither rejects the
 * Lynx-only options nor fails on an imported image, which it has no loader
 * for by default. No Lynx polyfills load, since the extractor only reads the
 * compiled code and never runs it.
 */
export const runExtractI18n = async (
  options: ExtractI18nBuilderOptions,
  context: BuilderContext,
  deps: ExtractI18nBuilderDeps = defaultDeps,
): Promise<BuilderOutput> => {
  const projectName = context.target?.project;
  if (!projectName) {
    return { success: false, error: 'The builder needs a project target.' };
  }
  const metadata = await context.getProjectMetadata(projectName);
  const projectRoot = path.join(
    context.workspaceRoot,
    (metadata['root'] as string | undefined) ?? '',
  );
  if (!deps.hasLocalize(projectRoot)) {
    return { success: false, error: NO_LOCALIZE };
  }
  let angularBuild: AngularBuildModule;
  try {
    angularBuild = await deps.importAngularBuild(projectRoot);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return angularBuild.executeExtractI18nBuilder(
    options,
    asAngularBuildTargets(context),
  );
};

export default createBuilder<ExtractI18nBuilderOptions>((options, context) =>
  runExtractI18n(options, context),
);
