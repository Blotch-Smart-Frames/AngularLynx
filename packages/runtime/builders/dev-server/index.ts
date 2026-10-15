import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
} from '@angular-devkit/architect';
import path from 'node:path';

import { type RspeedyModule, createRspeedy, importRspeedy } from '../rspeedy';
import type { DevServerBuilderOptions } from './schema';

type Deps = {
  readonly importRspeedy: (projectRoot: string) => Promise<RspeedyModule>;
};

/**
 * Starts rspeedy's dev server in this process, as `rspeedy dev` did, and
 * closes it when Angular CLI tears the builder down (Ctrl+C). rspeedy's own
 * plugins keep working unchanged (the QR code plugin still prints the Lynx
 * Explorer link), and live reload is rspeedy's.
 */
const startDevServer = async (
  options: DevServerBuilderOptions,
  context: BuilderContext,
  deps: Deps,
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
  try {
    const rspeedy = await createRspeedy({
      rspeedy: await deps.importRspeedy(projectRoot),
      projectRoot,
      config: options.config,
      environment: options.environment,
    });
    const { server, urls } = await rspeedy.startDevServer();
    context.addTeardown(() => server.close());
    return { success: true, baseUrl: urls[0] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * `ng serve`. Angular CLI keeps a target running for as long as its outputs
 * haven't ended, so this reports the server's start and then never ends,
 * unless the server failed to start.
 */
export const runDevServer = (
  options: DevServerBuilderOptions,
  context: BuilderContext,
  deps: Deps = { importRspeedy },
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
