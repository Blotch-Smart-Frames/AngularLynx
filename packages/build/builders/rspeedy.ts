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

/** What Angular CLI tells the plugin about the build (see the plugin's angular-cli-context.ts). */
export type AngularCliContext = {
  readonly workspaceRoot: string;
  readonly project: string;
  readonly buildOptions: Readonly<Record<string, unknown>>;
};

/** The part of @blotch/rsbuild-plugin-angular-lynx the builders use. */
export type RspeedyPluginModule = {
  readonly pluginAngularLynx: () => { readonly name: string };
  readonly pluginAngularCliContext: (context: AngularCliContext) => {
    readonly name: string;
  };
};

/**
 * Unlike rspeedy, the plugin is this package's own dependency, so it is
 * resolved from here rather than from the project: the builders always run
 * the plugin version they were released with.
 */
export const importPlugin = (): Promise<RspeedyPluginModule> =>
  import('@blotch/rsbuild-plugin-angular-lynx');

/** The name `pluginAngularLynx()` registers itself under. */
const ANGULAR_PLUGIN_NAME = 'lynx:angular';

/**
 * Whether an rspeedy `plugins` list holds the plugin named `name`. The list
 * takes Rsbuild's shapes: plugins, falsy entries (from `cond && plugin()`),
 * promises of either, and nested lists.
 */
const hasPlugin = async (plugins: unknown, name: string): Promise<boolean> => {
  const plugin = await plugins;
  if (Array.isArray(plugin)) {
    for (const item of plugin) {
      if (await hasPlugin(item, name)) {
        return true;
      }
    }
    return false;
  }
  return (plugin as { name?: unknown } | null | undefined)?.name === name;
};

/**
 * Creates an rspeedy instance the way `rspeedy build` and `rspeedy dev` do:
 * load lynx.config.ts, then apply the command-line overrides, which here come
 * from the builder options.
 *
 * It also adds two plugins. Unless lynx.config.ts lists the AngularLynx
 * plugin itself (to pass it options), that plugin is added, so the config an
 * Angular CLI project needs holds only rspeedy's own settings. And the
 * Angular CLI context plugin hands it the project and its build options as
 * Angular CLI resolved them (`-c` and command-line overrides included), which
 * it would otherwise read from angular.json under the default configuration.
 */
export const createRspeedy = async ({
  rspeedy,
  plugin,
  command,
  projectRoot,
  angularCli,
  config,
  mode,
  environment,
  server,
}: {
  rspeedy: RspeedyModule;
  plugin: RspeedyPluginModule;
  /** The rspeedy command this replaces, which decides the default mode. */
  command: 'build' | 'dev';
  projectRoot: string;
  angularCli: AngularCliContext;
  config?: string;
  mode?: 'production' | 'development';
  environment?: string[];
  /** Dev server settings that override lynx.config.ts's `server`. */
  server?: { readonly port?: number; readonly host?: string };
}): Promise<RspeedyInstance> => {
  // As the rspeedy CLI does before anything else: `build` defaults NODE_ENV
  // to production and `dev` to development. rspeedy takes the mode from it
  // when neither the options nor lynx.config.ts set one, and without it falls
  // back to mode 'none', which skips minification. Plugins read it too.
  if (!process.env['NODE_ENV']) {
    process.env['NODE_ENV'] =
      command === 'build' ? 'production' : 'development';
  }
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
  if (server?.port !== undefined || server?.host !== undefined) {
    content['server'] = {
      ...(content['server'] as object | undefined),
      ...(server.port !== undefined && { port: server.port }),
      ...(server.host !== undefined && { host: server.host }),
    };
  }
  const plugins = Array.isArray(content['plugins']) ? content['plugins'] : [];
  content['plugins'] = [
    plugin.pluginAngularCliContext(angularCli),
    ...plugins,
    ...((await hasPlugin(plugins, ANGULAR_PLUGIN_NAME))
      ? []
      : [plugin.pluginAngularLynx()]),
  ];
  return rspeedy.createRspeedy({
    cwd: projectRoot,
    rspeedyConfig: content,
    environment: environment ?? [],
  });
};
