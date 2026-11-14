import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
  targetFromTargetString,
} from '@angular-devkit/architect';
import path from 'node:path';

import { angularCacheDir, nativeCacheDir } from '../application/native-cache';
import type { ApplicationBuilderOptions } from '../application/schema';
import { type NativeModule, importNative, readPackageVersion } from '../native';
import {
  type QRCodePluginModule,
  type RspeedyInstance,
  type RspeedyModule,
  type RspeedyPluginModule,
  createRspeedy,
  importPlugin,
  importQRCodePlugin,
  importRspeedy,
} from '../rspeedy';
import type { DevServerBuilderOptions } from './schema';

export type DevServerBuilderDeps = {
  readonly importRspeedy: () => Promise<RspeedyModule>;
  readonly importPlugin: () => Promise<RspeedyPluginModule>;
  readonly importQRCodePlugin: () => Promise<QRCodePluginModule>;
  readonly importNative?: () => Promise<NativeModule>;
};

/**
 * Starts rspeedy's dev server in this process, as `rspeedy dev` would, and
 * closes it when Angular CLI tears the builder down (Ctrl+C). rspeedy's own
 * plugins keep working unchanged, and live reload is rspeedy's. The QR code
 * plugin, which prints the link Lynx Explorer opens, is added unless
 * lynx.config.ts lists it.
 *
 * Like Angular's own dev server, it builds what `buildTarget` describes: its
 * options configure the compile, so `ng serve -c production` serves the
 * production configuration.
 *
 * With `--platform`, it then opens the app itself on a simulator, emulator or
 * phone, loading from this server (see {@link runDevelopmentApp}).
 */
const startDevServer = async (
  options: DevServerBuilderOptions,
  context: BuilderContext,
  deps: DevServerBuilderDeps,
): Promise<BuilderOutput> => {
  const projectName = context.target?.project;
  if (!projectName) {
    return { success: false, error: 'The builder needs a project target.' };
  }
  if (options.device && !options.platform) {
    return {
      success: false,
      error:
        '--device picks where --platform opens the app. Add --platform ios or --platform android.',
    };
  }
  const metadata = await context.getProjectMetadata(projectName);
  const projectRoot = path.join(
    context.workspaceRoot,
    (metadata['root'] as string | undefined) ?? '',
  );
  try {
    // The same default as Angular's dev server: the project's build target
    // with its development configuration.
    const buildTarget = targetFromTargetString(
      options.buildTarget ?? '::development',
      projectName,
      'build',
    );
    // Validated against the build builder's schema, which also fills in its
    // defaults, as the build itself would see them.
    const buildOptions = (await context.validateOptions(
      await context.getTargetOptions(buildTarget),
      await context.getBuilderNameForTarget(buildTarget),
    )) as ApplicationBuilderOptions;
    const environment = options.environment ?? buildOptions.environment;
    // An empty list, the build target's default, builds every environment.
    if (
      options.platform &&
      environment?.length &&
      !environment.includes('lynx')
    ) {
      return {
        success: false,
        error: `--platform opens the app on the lynx environment's bundle, which --environment leaves out (${environment.join(', ')}).`,
      };
    }
    // Loaded first, so a broken install fails before the server starts.
    const native = options.platform
      ? await (deps.importNative ?? importNative)()
      : undefined;
    const rspeedy = await createRspeedy({
      rspeedy: await deps.importRspeedy(),
      plugin: await deps.importPlugin(),
      qrCode: await deps.importQRCodePlugin(),
      projectRoot,
      angularCli: {
        workspaceRoot: context.workspaceRoot,
        project: buildTarget.project,
        buildOptions,
      },
      config: buildOptions.config,
      environment,
      server: { port: options.port, host: options.host },
      // Angular's cache, where `--platform` (or an `ng build --platform`
      // beside this server) generates and builds the native project.
      watchIgnore: [
        angularCacheDir({ metadata, workspaceRoot: context.workspaceRoot }),
      ],
    });
    const { server, urls, port } = await rspeedy.startDevServer();
    context.addTeardown(() => server.close());
    if (native && options.platform) {
      await runDevelopmentApp({
        native,
        platform: options.platform,
        device: options.device,
        bundleUrl: lynxBundleUrl(rspeedy, port),
        buildOptions,
        context,
        workDir: nativeCacheDir({
          metadata,
          workspaceRoot: context.workspaceRoot,
          projectRoot,
          projectName,
        }),
        projectRoot,
        projectName,
        bundleDir: rspeedy.context.distPath,
      });
    }
    return { success: true, baseUrl: urls[0] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * The URL of the Lynx bundle on the dev server, as the bundle names the
 * server: rspeedy builds a development bundle with the server's address in
 * its asset URLs and its live reload socket (`dev.assetPrefix`, the
 * computer's address on the local network unless lynx.config.ts sets one),
 * and the QR code for Lynx Explorer carries the same URL. The shells load
 * the bundle under the name they always do.
 */
const lynxBundleUrl = (rspeedy: RspeedyInstance, port: number): string => {
  const prefix = rspeedy.getNormalizedConfig({ environment: 'lynx' }).dev
    ?.assetPrefix;
  if (typeof prefix !== 'string' || !/^https?:\/\//.test(prefix)) {
    throw new Error(
      `--platform needs the lynx environment's dev.assetPrefix to be the dev server's URL, which the app loads from; lynx.config.ts sets it to ${JSON.stringify(prefix)}.`,
    );
  }
  return new URL(
    'main.lynx.bundle',
    prefix.replaceAll('<port>', String(port)),
  ).toString();
};

/**
 * `ng serve --platform <platform>`: builds the app's development build from
 * the build target's native options, as `ng build --platform` builds the
 * app, and opens it on the device `--device` names (or the one `--run` would
 * pick). It loads its bundle from `bundleUrl` rather than from a copy inside
 * it, and reloads on every edit, so it doesn't wait for the first compile:
 * the server answers the app once the bundle is ready.
 *
 * Its native project and build are kept in Angular's cache next to
 * `ng build --platform`'s, and reused: with the same native options, the
 * next `ng serve --platform` reinstalls the app without running Xcode or
 * Gradle.
 */
const runDevelopmentApp = async ({
  native,
  platform,
  device,
  bundleUrl,
  buildOptions,
  context,
  workDir,
  projectRoot,
  projectName,
  bundleDir,
}: {
  readonly native: NativeModule;
  readonly platform: 'ios' | 'android';
  readonly device: string | undefined;
  readonly bundleUrl: string;
  readonly buildOptions: ApplicationBuilderOptions;
  readonly context: BuilderContext;
  /** The native cache folder (see `nativeCacheDir`). */
  readonly workDir: string;
  readonly projectRoot: string;
  readonly projectName: string;
  readonly bundleDir: string;
}): Promise<void> => {
  context.reportStatus(`Building the ${platform} development app`);
  await native.buildNativeApp({
    platform,
    projectRoot,
    workDir,
    projectName,
    packageVersion: readPackageVersion(projectRoot),
    bundleDir,
    // Beside the generated project rather than in dist/, which holds what
    // `ng build` writes for release.
    outputDir: path.join(workDir, 'serve', platform),
    app: buildOptions,
    run: { device },
    devServer: { bundleUrl },
    log: (message) => context.logger.info(message),
    warn: (message) => context.logger.warn(message),
  });
  context.logger.info(
    `The ${platform} app loads from ${bundleUrl} and reloads on every edit.`,
  );
};

/**
 * `ng serve`. Angular CLI keeps a target running for as long as its outputs
 * haven't ended, so this reports the server's start and then never ends,
 * unless the server failed to start.
 */
export const runDevServer = (
  options: DevServerBuilderOptions,
  context: BuilderContext,
  deps: DevServerBuilderDeps = {
    importRspeedy,
    importPlugin,
    importQRCodePlugin,
  },
): AsyncIterable<BuilderOutput> => ({
  [Symbol.asyncIterator]: () => {
    let started: Promise<BuilderOutput> | undefined;
    return {
      next: async (): Promise<IteratorResult<BuilderOutput>> => {
        if (!started) {
          started = startDevServer(options, context, deps);
          return { value: await started, done: false };
        }
        return (await started).success
          ? new Promise<never>(() => {})
          : { value: undefined, done: true };
      },
    };
  },
});

export default createBuilder<DevServerBuilderOptions>(runDevServer);
