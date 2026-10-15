import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The part of rspeedy's public JavaScript API the builders use: `loadConfig`
 * and `createRspeedy` (both marked `@public` in its API report), and the
 * Rsbuild instance methods they return. Declared here as the narrow shape the
 * builders rely on, so the tests can stand in for it.
 */
export type RspeedyConfig = {
  mode?: 'production' | 'development' | 'none';
  [key: string]: unknown;
};

/** What `build()` reports after each compile, in watch mode after each rebuild. */
export type RspeedyBuildResult = {
  readonly stats?: { hasErrors: () => boolean };
};

export type RspeedyInstance = {
  context: { distPath: string; rootPath: string };
  build: (options?: { watch?: boolean }) => Promise<{
    close: () => Promise<void>;
  }>;
  onAfterBuild: (callback: (result: RspeedyBuildResult) => void) => void;
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

/**
 * Like the rsbuild plugin, rspeedy is this package's own dependency, so the
 * builders always run the rspeedy version they were released and tested with,
 * and an app needs no build tool in its package.json besides this package
 * (as one from `ng new` needs only `@angular/build`).
 */
export const importRspeedy = (): Promise<RspeedyModule> =>
  import('@lynx-js/rspeedy') as unknown as Promise<RspeedyModule>;

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

/** The part of @lynx-js/qrcode-rsbuild-plugin the dev server uses. */
export type QRCodePluginModule = {
  readonly pluginQRCode: (options: { fullscreen?: boolean }) => {
    readonly name: string;
  };
};

export const importQRCodePlugin = (): Promise<QRCodePluginModule> =>
  import('@lynx-js/qrcode-rsbuild-plugin');

/** The name `pluginAngularLynx()` registers itself under. */
const ANGULAR_PLUGIN_NAME = 'lynx:angular';

/** The name `pluginQRCode()` registers itself under. */
const QR_CODE_PLUGIN_NAME = 'lynx:rsbuild:qrcode';

/**
 * The files rspeedy looks for when no `config` option names one, in its order
 * (`resolveConfigPath` in @lynx-js/rspeedy).
 */
const DEFAULT_CONFIG_FILES = [
  'lynx.config.ts',
  'lynx.config.js',
  'lynx.config.mts',
  'lynx.config.mjs',
];

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
 * The rspeedy mode for a build target's options. Angular has no mode option:
 * its `optimization` decides, and a build that doesn't optimize scripts runs
 * in dev mode (`ngDevMode` on). The same switch picks rspeedy's mode, so
 * `ng build -c development` (`optimization: false`) is a development build
 * and `ng serve -c production` a production one.
 */
export const modeFromOptimization = (
  optimization: unknown,
): 'production' | 'development' => {
  // Angular's own reading of the option (normalizeOptimization in
  // @angular/build): on by default, and in object form `scripts` decides.
  const scripts =
    typeof optimization === 'object' && optimization !== null
      ? !!(optimization as { scripts?: unknown }).scripts
      : optimization !== false;
  return scripts ? 'production' : 'development';
};

/**
 * Loads lynx.config.ts as `rspeedy build` and `rspeedy dev` would. Unlike
 * them, a project without one builds too, from the defaults
 * {@link createRspeedy} fills in: angular.json holds what the config would
 * repeat, as it does for any Angular app. A `config` option must name a file
 * that exists.
 */
const loadProjectConfig = async (
  rspeedy: RspeedyModule,
  projectRoot: string,
  config: string | undefined,
): Promise<{ content: RspeedyConfig; configPath?: string }> => {
  if (
    !config &&
    !DEFAULT_CONFIG_FILES.some((file) =>
      existsSync(path.join(projectRoot, file)),
    )
  ) {
    return { content: {} };
  }
  return rspeedy.loadConfig({ cwd: projectRoot, configPath: config });
};

/**
 * Creates an rspeedy instance the way `rspeedy build` and `rspeedy dev` do:
 * load lynx.config.ts, then apply the command-line overrides, which here come
 * from the builder options.
 *
 * What lynx.config.ts leaves out comes from angular.json and the defaults an
 * AngularLynx app needs, so most apps don't need the file at all:
 *
 * - `source.entry` is the build target's `browser` option.
 * - `environments` are `lynx` (the native bundle) and `web` (the browser
 *   preview).
 * - The mode follows the build target's `optimization` (see
 *   {@link modeFromOptimization}).
 *
 * It also adds plugins, each unless lynx.config.ts lists it itself (to pass
 * it options): the AngularLynx plugin, which compiles Angular, and for the
 * dev server the QR code plugin, which prints the link Lynx Explorer opens.
 * And the Angular CLI context plugin hands the AngularLynx plugin the project
 * and its build options as Angular CLI resolved them (`-c` and command-line
 * overrides included), which it would otherwise read from angular.json under
 * the default configuration.
 */
export const createRspeedy = async ({
  rspeedy,
  plugin,
  qrCode,
  projectRoot,
  angularCli,
  config,
  environment,
  server,
}: {
  rspeedy: RspeedyModule;
  plugin: RspeedyPluginModule;
  /** Given for the dev server, which prints the Lynx Explorer QR code. */
  qrCode?: QRCodePluginModule;
  projectRoot: string;
  angularCli: AngularCliContext;
  config?: string;
  environment?: string[];
  /** Dev server settings that override lynx.config.ts's `server`. */
  server?: { readonly port?: number; readonly host?: string };
}): Promise<RspeedyInstance> => {
  const mode = modeFromOptimization(angularCli.buildOptions['optimization']);
  // As the rspeedy CLI does before anything else, so plugins (Tailwind,
  // PostCSS) that read NODE_ENV agree with the mode. The CLI derives it from
  // the command; here the mode decides, as `optimization` does for Angular.
  if (!process.env['NODE_ENV']) {
    process.env['NODE_ENV'] = mode;
  }
  const { content, configPath } = await loadProjectConfig(
    rspeedy,
    projectRoot,
    config,
  );
  // As `rspeedy build` does: a persistent build cache must be invalidated
  // when lynx.config.ts itself changes.
  const performance = content['performance'] as
    | { buildCache?: boolean | { buildDependencies?: string[] } }
    | undefined;
  if (configPath) {
    if (performance?.buildCache === true) {
      performance.buildCache = { buildDependencies: [configPath] };
    } else if (performance?.buildCache) {
      (performance.buildCache.buildDependencies ??= []).push(configPath);
    }
  }
  content.mode = mode;
  content['environments'] ??= { lynx: {}, web: {} };
  const browser = angularCli.buildOptions['browser'];
  const source = (content['source'] ??= {}) as { entry?: unknown };
  if (source.entry === undefined && typeof browser === 'string') {
    source.entry = path.join(angularCli.workspaceRoot, browser);
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
    // `fullscreen` opens the app in Lynx Explorer without its navigation
    // bar, as the rspeedy project template does.
    ...(qrCode && !(await hasPlugin(plugins, QR_CODE_PLUGIN_NAME))
      ? [qrCode.pluginQRCode({ fullscreen: true })]
      : []),
  ];
  return rspeedy.createRspeedy({
    cwd: projectRoot,
    rspeedyConfig: content,
    environment: environment ?? [],
  });
};
