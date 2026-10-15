import { importFromProject } from './project-import';

/**
 * The part of rspeedy's public JavaScript API the builders use: `loadConfig`
 * and `createRspeedy` (both marked `@public` in its API report). Declared
 * here rather than imported, because the user's project decides which rspeedy
 * version is installed; these few members have been stable across releases.
 */
export type RspeedyConfig = {
  mode?: 'production' | 'development' | 'none';
  [key: string]: unknown;
};

export type RspeedyInstance = {
  context: { distPath: string; rootPath: string };
  build: () => Promise<{ close: () => Promise<void> }>;
  startDevServer: () => Promise<{
    urls: string[];
    port: number;
    server: { close: () => Promise<void> };
  }>;
};

export type RspeedyModule = {
  loadConfig: (options: {
    cwd?: string;
    configPath?: string;
  }) => Promise<{ content: RspeedyConfig; configPath: string }>;
  createRspeedy: (options: {
    cwd?: string;
    rspeedyConfig?: RspeedyConfig;
    environment?: string[];
    callerName?: string;
  }) => Promise<RspeedyInstance>;
};

export const importRspeedy = (projectRoot: string): Promise<RspeedyModule> =>
  importFromProject<RspeedyModule>(
    '@lynx-js/rspeedy',
    projectRoot,
    'Run `ng add @blotch/angular-lynx` to set the project up for Lynx.',
  );

/**
 * Creates an rspeedy instance the way `rspeedy build` and `rspeedy dev` do:
 * load lynx.config.ts, then apply the command-line overrides, which here come
 * from the builder options.
 */
export const createRspeedy = async ({
  rspeedy,
  projectRoot,
  config,
  mode,
  environment,
}: {
  rspeedy: RspeedyModule;
  projectRoot: string;
  config?: string;
  mode?: 'production' | 'development';
  environment?: string[];
}): Promise<RspeedyInstance> => {
  const { content, configPath } = await rspeedy.loadConfig({
    cwd: projectRoot,
    configPath: config,
  });
  // As `rspeedy build` does: a persistent build cache must be invalidated
  // when lynx.config.ts itself changes.
  const performance = content['performance'] as
    | { buildCache?: boolean | { buildDependencies?: string[] } }
    | undefined;
  if (performance?.buildCache === true) {
    performance.buildCache = { buildDependencies: [configPath] };
  } else if (performance?.buildCache) {
    (performance.buildCache.buildDependencies ??= []).push(configPath);
  }
  if (mode) {
    content.mode = mode;
  }
  return rspeedy.createRspeedy({
    cwd: projectRoot,
    rspeedyConfig: content,
    environment: environment ?? [],
  });
};
