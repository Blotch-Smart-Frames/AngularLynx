import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
} from '@angular-devkit/architect';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type RspeedyInstance,
  type RspeedyModule,
  type RspeedyPluginModule,
  createRspeedy,
  importPlugin,
  importRspeedy,
} from '../rspeedy';
import type * as Native from '@blotch/angular-lynx-native' with {
  'resolution-mode': 'import',
};

import type { ApplicationBuilderOptions } from './schema';

type NativeModule = typeof Native;

export type ApplicationBuilderDeps = {
  readonly importRspeedy: () => Promise<RspeedyModule>;
  readonly importPlugin: () => Promise<RspeedyPluginModule>;
  readonly importNative: () => Promise<NativeModule>;
};

/**
 * Like the rsbuild plugin, the native builder is this package's own
 * dependency, resolved from here. Imported only for `--platform`, so a plain
 * bundle build never loads it.
 */
const importNative = (): Promise<NativeModule> =>
  import('@blotch/angular-lynx-native');

const defaultDeps: ApplicationBuilderDeps = {
  importRspeedy,
  importPlugin,
  importNative,
};

const errorOutput = (error: unknown): BuilderOutput => ({
  success: false,
  error: error instanceof Error ? error.message : String(error),
});

/**
 * `ng build`: builds the Lynx bundle with rspeedy, as `rspeedy build` would,
 * then, with `--platform`, the native binaries. The Angular compile happens
 * inside rspeedy (through @blotch/rsbuild-plugin-angular-lynx, which
 * `createRspeedy` adds when lynx.config.ts doesn't), so this builder only
 * orchestrates.
 *
 * With `--watch` it reports a result after every rebuild and keeps running
 * until Angular CLI tears it down, as Angular's own application builder does.
 */
export const runApplication = async function* (
  options: ApplicationBuilderOptions,
  context: BuilderContext,
  deps: ApplicationBuilderDeps = defaultDeps,
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
  const platforms: ('ios' | 'android')[] =
    options.platform === 'all'
      ? ['ios', 'android']
      : options.platform
        ? [options.platform]
        : [];
  if (options.watch && platforms.length > 0) {
    // A native app is built once from a finished bundle; rebuilding the
    // Xcode or Gradle project on every save would take minutes each time.
    yield {
      success: false,
      error:
        "--watch rebuilds only the Lynx bundle and can't be combined with --platform. Use `ng serve` while developing, and `ng build --platform` for the app.",
    };
    return;
  }

  let rspeedy: RspeedyInstance;
  let native: NativeModule | undefined;
  try {
    // Load the native builder first, so a broken install fails before a
    // minute of bundling rather than after it.
    native = platforms.length > 0 ? await deps.importNative() : undefined;
    rspeedy = await createRspeedy({
      rspeedy: await deps.importRspeedy(),
      plugin: await deps.importPlugin(),
      projectRoot,
      // Angular CLI already merged these: base options, the configurations
      // chosen with -c (or the default one), then command-line overrides.
      angularCli: {
        workspaceRoot: context.workspaceRoot,
        project: projectName,
        buildOptions: options,
      },
      config: options.config,
      // Native shells only load the Lynx bundle; skipping the web
      // environment halves the bundling time.
      environment: platforms.length > 0 ? ['lynx'] : options.environment,
    });
  } catch (error) {
    yield errorOutput(error);
    return;
  }

  if (options.watch) {
    yield* watchBundle(rspeedy, context);
    return;
  }

  try {
    context.reportStatus('Building the Lynx bundle');
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
    yield { success: true };
  } catch (error) {
    yield errorOutput(error);
  }
};

/**
 * `ng build --watch`: rspeedy's watch build, reporting each compile's result.
 * Compile errors fail that result but keep watching, as in Angular, so the
 * next save can fix them. Angular CLI ends the run (Ctrl+C) through the
 * teardown, which stops the watcher.
 */
const watchBundle = async function* (
  rspeedy: RspeedyInstance,
  context: BuilderContext,
): AsyncIterable<BuilderOutput> {
  const results: BuilderOutput[] = [];
  let wake: (() => void) | undefined;
  rspeedy.onAfterBuild(({ stats }) => {
    results.push({ success: !stats?.hasErrors() });
    wake?.();
  });
  try {
    context.reportStatus('Watching the Lynx bundle');
    const { close } = await rspeedy.build({ watch: true });
    context.addTeardown(close);
  } catch (error) {
    yield errorOutput(error);
    return;
  }
  for (;;) {
    while (results.length > 0) {
      yield results.shift()!;
    }
    await new Promise<void>((resolve) => (wake = resolve));
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
