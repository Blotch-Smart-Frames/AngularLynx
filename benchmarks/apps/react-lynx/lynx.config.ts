import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig, type RsbuildPlugin } from '@lynx-js/rspeedy';
import { LynxTemplatePlugin } from '@lynx-js/template-webpack-plugin';

// The fixture server's origin is fixed at build time, as the other apps' is
// (benchmarks/SPEC.md, "Data"): localhost reaches the Mac from the iOS
// Simulator, and a phone build passes the Mac's LAN address.
const fixtureOrigin = process.env.FIXTURE_ORIGIN ?? 'http://localhost:8787';

/**
 * Writes the two page-config flags the AngularLynx build plugin writes into
 * every bundle for the native shell (packages/rsbuild-plugin-angular-lynx,
 * angular-webpack-plugin.ts), so the two Lynx apps ask the same of the same
 * shell. Neither is in `@lynx-js/type-config`, so `pluginLynxConfig` would
 * reject them; the AngularLynx plugin writes them the same way, in the
 * template plugin's beforeEncode hook.
 *
 * - `preferredFps: 'high'`: the shell allows 120 fps on ProMotion iPhones
 *   (CADisableMinimumFrameDurationOnPhone), and Lynx only asks its display
 *   link for more than 60 with this.
 * - `enableElementInvokeUIMethodPendingTask`: the shell runs Lynx's engine
 *   off the UI thread (MostOnTASM), where a UI method sent before its
 *   element's flush would be lost. This app calls none, but it costs nothing
 *   and keeps the pages' configs identical.
 *
 * The AngularLynx plugin's other config keys are Angular's own choices
 * (CSS inline variables for its theme, exposure in the background for
 * IntersectionObserver), so ReactLynx keeps its defaults for those.
 */
const pluginShellPageConfig = (): RsbuildPlugin => ({
  name: 'bench:shell-page-config',
  setup(api) {
    api.modifyBundlerChain((chain) => {
      chain.plugin('bench:shell-page-config').use(
        class {
          apply(compiler: {
            hooks: {
              thisCompilation: {
                tap(name: string, fn: (compilation: unknown) => void): void;
              };
            };
          }) {
            compiler.hooks.thisCompilation.tap(
              'bench:shell-page-config',
              (compilation) => {
                LynxTemplatePlugin.getLynxTemplatePluginHooks(
                  compilation as Parameters<
                    typeof LynxTemplatePlugin.getLynxTemplatePluginHooks
                  >[0],
                ).beforeEncode.tap('bench:shell-page-config', (args) => {
                  args.encodeData.sourceContent.config = {
                    ...args.encodeData.sourceContent.config,
                    preferredFps: 'high',
                    enableElementInvokeUIMethodPendingTask: true,
                  };
                  return args;
                });
              },
            );
          }
        },
      );
    });
  },
});

export default defineConfig({
  plugins: [pluginReactLynx(), pluginShellPageConfig()],
  source: {
    define: {
      'process.env.FIXTURE_ORIGIN': JSON.stringify(fixtureOrigin),
      // The benchmark screen the app opens on instead of the tabs, e.g.
      // `mount?kind=view&count=1500` (SPEC.md, "Benchmark screens").
      // Instruments launches an app with no URL, so the harness picks the
      // screen with a build variant rather than a deep link. Empty builds the
      // Pokédex.
      'process.env.BENCH_SCREEN': JSON.stringify(
        process.env.BENCH_SCREEN ?? '',
      ),
    },
  },
  // The shell loads only the Lynx bundle; the web preview would be built for
  // nothing.
  environments: {
    lynx: {},
  },
});
