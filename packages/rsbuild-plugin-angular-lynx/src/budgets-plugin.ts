import type { LynxConfig } from '@lynx-js/rsbuild-plugin';
import type { RsbuildPluginAPI, Rspack } from '@lynx-js/rspeedy';
import { LynxTemplatePlugin } from '@lynx-js/template-webpack-plugin';
import { S_LYNX_CONFIG } from './entry.js';
import {
  type BudgetAsset,
  type BudgetFailure,
  type ComponentStyleSize,
  checkBudgets,
} from './utils/angular/budgets.js';
import type { Budget } from './utils/angular/options.js';

const PLUGIN_NAME = 'lynx:angular:budgets';

/** The suffix `applyEntry` gives each entry's main-thread twin. */
const MAIN_THREAD_ENTRY_SUFFIX = '__main-thread';

/** The shape rspack accepts in `compilation.errors` and `compilation.warnings`. */
export type BudgetError = Error & { hideStack: boolean };

/**
 * Turns a budget failure into an rspack error or warning. As an error it
 * fails `ng build` / `rspeedy build`, like a budget error fails `ng build`
 * for a web app; as a warning it's printed and the build succeeds.
 */
export const toBudgetError = (failure: BudgetFailure): BudgetError => {
  const error = new Error(failure.message) as BudgetError;
  error.name =
    failure.severity === 'error'
      ? 'AngularBudgetError'
      : 'AngularBudgetWarning';
  // The stack would point into this plugin, not at anything the user can change.
  error.hideStack = true;
  return error;
};

/**
 * The entry (page) a Lynx template was built from, or undefined for a lazy
 * bundle. A template covers an entry and its main-thread twin; lazy bundles
 * cover async chunk groups, which aren't entry points.
 */
export const bundleEntryName = (
  chunkGroups: readonly { readonly name?: string | null }[],
  entrypoints: { has: (name: string) => boolean },
): string | undefined =>
  chunkGroups
    .map((chunkGroup) => chunkGroup.name)
    .find(
      (name): name is string =>
        !!name &&
        entrypoints.has(name) &&
        !name.endsWith(MAIN_THREAD_ENTRY_SUFFIX),
    );

/**
 * The emitted files budgets count: the bundles and any scripts left outside
 * them. Leaves out source maps and hot updates (as Angular does), media and
 * fonts, and the build's intermediate directory, where the Lynx template
 * plugin writes debug copies of what it encoded into the bundles.
 */
export const collectBudgetAssets = (
  assets: readonly {
    readonly name: string;
    readonly source: { size: () => number };
    readonly info: { readonly hotModuleReplacement?: boolean };
  }[],
  entryBundles: ReadonlyMap<string, string>,
  intermediateDir: string | undefined,
): BudgetAsset[] =>
  assets
    .filter(
      ({ name, info }) =>
        /\.(bundle|js)$/.test(name) &&
        !info.hotModuleReplacement &&
        !(intermediateDir && name.startsWith(`${intermediateDir}/`)),
    )
    .map(({ name, source }) => {
      const entryName = entryBundles.get(name);
      return {
        name,
        size: source.size(),
        ...(entryName === undefined ? {} : { entryName }),
      };
    });

export type AngularBudgetsPluginOptions = {
  readonly budgets: readonly Budget[];
  /** Kept current by the Angular compile, which runs before each compilation. */
  readonly componentStyleSizes: ReadonlyMap<string, ComponentStyleSize>;
  readonly intermediateDir: string | undefined;
};

/**
 * Checks the budgets after every compilation of the `lynx` environment,
 * including watch rebuilds, once its bundles are final.
 */
export class AngularBudgetsPlugin {
  readonly #options: AngularBudgetsPluginOptions;

  constructor(options: AngularBudgetsPluginOptions) {
    this.#options = options;
  }

  apply(compiler: Rspack.Compiler): void {
    const { budgets, componentStyleSizes, intermediateDir } = this.#options;
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      // Which emitted bundle belongs to which entry. Only the template
      // plugin knows: the file name can be any `output.filename.bundle`
      // pattern, hashed or not.
      const entryBundles = new Map<string, string>();
      LynxTemplatePlugin.getLynxTemplatePluginHooks(
        compilation as Parameters<
          typeof LynxTemplatePlugin.getLynxTemplatePluginHooks
        >[0],
      ).beforeEmit.tap(PLUGIN_NAME, (args) => {
        const entryName = bundleEntryName(
          args.chunkGroups,
          compilation.entrypoints,
        );
        if (entryName !== undefined) {
          entryBundles.set(args.outputName, entryName);
        }
        return args;
      });

      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          // After the last stage, when LynxEncodePlugin (at REPORT + 1) has
          // deleted the scripts and styles it encoded into the bundles, so
          // only what ships is left to measure.
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT + 2,
        },
        () => {
          const failures = checkBudgets(budgets, {
            assets: collectBudgetAssets(
              compilation.getAssets(),
              entryBundles,
              intermediateDir,
            ),
            componentStyles: [...componentStyleSizes.values()],
          });
          for (const failure of failures) {
            (failure.severity === 'error'
              ? compilation.errors
              : compilation.warnings
            ).push(toBudgetError(failure) as never);
          }
        },
      );
    });
  }
}

/**
 * Enforces angular.json's `budgets` on the `lynx` environment, the bundles
 * devices load. The `web` environment only builds a browser preview, so its
 * sizes say nothing about the app.
 */
export const applyBudgets = (
  api: Pick<RsbuildPluginAPI, 'context' | 'modifyBundlerChain' | 'useExposed'>,
  {
    budgets,
    componentStyleSizes,
    underAngularCli,
  }: {
    readonly budgets: readonly Budget[];
    readonly componentStyleSizes: ReadonlyMap<string, ComponentStyleSize>;
    /** Whether `ng build` / `ng serve` resolved the build options. */
    readonly underAngularCli: boolean;
  },
): void => {
  if (budgets.length === 0) {
    return;
  }
  // Under plain `rspeedy dev` the plugin reads angular.json's default
  // configuration, which for an `ng new` app is production, with its
  // budgets. Holding the not minified dev build to them would report errors
  // that the production build doesn't have. `ng serve` passes the options
  // of the configuration it serves, so there budgets apply when that
  // configuration sets them, as with Angular's dev server.
  if (!underAngularCli && api.context.action === 'dev') {
    return;
  }
  api.modifyBundlerChain((chain, { environment }) => {
    if (environment.name !== 'lynx') {
      return;
    }
    const lynxConfig = api.useExposed<LynxConfig>(S_LYNX_CONFIG);
    chain.plugin(PLUGIN_NAME).use(AngularBudgetsPlugin, [
      {
        budgets,
        componentStyleSizes,
        intermediateDir: lynxConfig?.resolveIntermediateDir(),
      },
    ]);
  });
};
