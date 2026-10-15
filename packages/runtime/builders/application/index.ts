import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
} from '@angular-devkit/architect';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { importFromProject } from '../project-import';
import { type RspeedyModule, createRspeedy, importRspeedy } from '../rspeedy';
import type * as Native from '@blotch/angular-lynx-native' with {
  'resolution-mode': 'import',
};

import type { ApplicationBuilderOptions } from './schema';

type NativeModule = typeof Native;

export type ApplicationBuilderDeps = {
  readonly importRspeedy: (projectRoot: string) => Promise<RspeedyModule>;
  readonly importNative: (projectRoot: string) => Promise<NativeModule>;
};

const defaultDeps: ApplicationBuilderDeps = {
  importRspeedy,
  importNative: (projectRoot) =>
    importFromProject<NativeModule>(
      '@blotch/angular-lynx-native',
      projectRoot,
      'Install it to build native apps: npm install --save-dev @blotch/angular-lynx-native',
    ),
};

/**
 * `ng build`: builds the Lynx bundle with rspeedy, exactly as `rspeedy build`
 * did before this builder existed, then, with `--platform`, the native
 * binaries. The Angular compile happens inside rspeedy (through
 * @blotch/rsbuild-plugin-angular-lynx), so this builder only orchestrates.
 */
export const runApplication = async (
  options: ApplicationBuilderOptions,
  context: BuilderContext,
  deps: ApplicationBuilderDeps = defaultDeps,
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
  const platforms: ('ios' | 'android')[] =
    options.platform === 'all'
      ? ['ios', 'android']
      : options.platform
        ? [options.platform]
        : [];

  try {
    // Load the native builder first, so a missing package fails before a
    // minute of bundling rather than after it.
    const native =
      platforms.length > 0 ? await deps.importNative(projectRoot) : undefined;

    context.reportStatus('Building the Lynx bundle');
    const rspeedy = await createRspeedy({
      rspeedy: await deps.importRspeedy(projectRoot),
      projectRoot,
      config: options.config,
      mode: options.mode,
      // Native shells only load the Lynx bundle; skipping the web
      // environment halves the bundling time.
      environment: platforms.length > 0 ? ['lynx'] : options.environment,
    });
    const { close } = await rspeedy.build();
    await close();
    const bundleDir = rspeedy.context.distPath;

    for (const platform of platforms) {
      context.reportStatus(`Building the ${platform} app`);
      const { artifacts } = await native!.buildNativeApp({
        platform,
        projectRoot,
        projectName,
        packageVersion: readPackageVersion(projectRoot),
        bundleDir,
        outputDir: path.join(bundleDir, platform),
        app: options,
        log: (message) => context.logger.info(message),
      });
      for (const artifact of artifacts) {
        context.logger.info(
          `  ✓ ${path.relative(context.workspaceRoot, artifact)}`,
        );
      }
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const readPackageVersion = (projectRoot: string): string | undefined => {
  try {
    return JSON.parse(
      readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ).version;
  } catch {
    return undefined;
  }
};

export default createBuilder<ApplicationBuilderOptions>((options, context) =>
  runApplication(options, context),
);
