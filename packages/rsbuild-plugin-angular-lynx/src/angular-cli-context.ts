import type { RsbuildPlugin, RsbuildPluginAPI } from '@lynx-js/rspeedy';

/**
 * What Angular CLI knows about the build that a plain rspeedy run doesn't:
 * which project it is for, and its build target's options as Angular CLI
 * resolved them. `ng build` and `ng serve` (@blotch/angular-lynx-build) hand
 * it to the plugin through {@link pluginAngularCliContext}.
 */
export type AngularCliContext = {
  /** The workspace root, where angular.json is. */
  readonly workspaceRoot: string;
  /** The angular.json project being built. */
  readonly project: string;
  /**
   * The project's build target options: its base options, then each
   * configuration selected with `-c` (or the default one), then command-line
   * overrides, merged by Angular CLI.
   */
  readonly buildOptions: Readonly<Record<string, unknown>>;
};

/**
 * The id the context is exposed under. `Symbol.for` makes it the same symbol
 * in every copy of this package, so the builders and a plugin instance that
 * lynx.config.ts imported from elsewhere still find each other.
 */
const ANGULAR_CLI_CONTEXT = Symbol.for(
  '@blotch/rsbuild-plugin-angular-lynx:angular-cli-context',
);

export const ANGULAR_CLI_CONTEXT_PLUGIN_NAME = 'lynx:angular-cli-context';

/**
 * Hands the Angular CLI context to `pluginAngularLynx()` through Rsbuild's
 * plugin-to-plugin API (`api.expose` / `api.useExposed`). The builders add it
 * to rspeedy's config; lynx.config.ts never lists it.
 *
 * It works whether the builders added `pluginAngularLynx()` themselves or
 * lynx.config.ts lists it with options, which a constructor argument couldn't.
 */
export const pluginAngularCliContext = (
  context: AngularCliContext,
): RsbuildPlugin => ({
  name: ANGULAR_CLI_CONTEXT_PLUGIN_NAME,
  // Set up before every other plugin, so the context is exposed by the time
  // `pluginAngularLynx()` asks for it.
  enforce: 'pre',
  setup: (api) => {
    api.expose(ANGULAR_CLI_CONTEXT, context);
  },
});

/**
 * The Angular CLI context, or undefined when rspeedy runs on its own (then
 * the plugin reads angular.json itself).
 */
export const getAngularCliContext = (
  api: Pick<RsbuildPluginAPI, 'useExposed'>,
): AngularCliContext | undefined =>
  api.useExposed<AngularCliContext>(ANGULAR_CLI_CONTEXT);
