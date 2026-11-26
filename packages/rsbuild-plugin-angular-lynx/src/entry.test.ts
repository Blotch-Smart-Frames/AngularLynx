import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';

// Recognizable plugin stand-ins so `.use(Plugin, [opts])` can be asserted and
// the `${Plugin.name}` plugin keys resolve.
vi.mock('@lynx-js/runtime-wrapper-webpack-plugin', () => ({
  RuntimeWrapperWebpackPlugin: class RuntimeWrapperWebpackPlugin {},
}));
vi.mock('@lynx-js/template-webpack-plugin', () => ({
  CSSPlugins: {
    parserPlugins: { removeFunctionWhiteSpace: () => ({ name: 'stub' }) },
  },
  LynxEncodePlugin: class LynxEncodePlugin {},
  LynxTemplatePlugin: class LynxTemplatePlugin {},
  WebEncodePlugin: class WebEncodePlugin {},
}));
vi.mock('./angular-webpack-plugin.js', () => ({
  AngularWebpackPlugin: class AngularWebpackPlugin {},
}));

import { RuntimeWrapperWebpackPlugin } from '@lynx-js/runtime-wrapper-webpack-plugin';
import {
  LynxEncodePlugin,
  WebEncodePlugin,
} from '@lynx-js/template-webpack-plugin';
import {
  applyEntry,
  BLUR_VIEW_STYLESHEET,
  WEB_SYSTEM_FONT_STYLESHEET,
  CSS_HOT_UPDATE,
  HTML_TEXT_TAGS_STYLESHEET,
  getChunks,
  HMR_BACKGROUND_CLIENT,
  HMR_MAIN_THREAD_CLIENT,
} from './entry';
import { LAYERS } from './layers';
import { styleIndexOf } from './style-index';
import {
  INHERITED_TEXT_PROPERTIES,
  textInheritanceForLynx,
} from './text-inheritance';
import { TEXT_SCALE_STYLESHEET } from './text-scale';
import { typeSelectorsForLynx } from './type-selectors';
import { ZeroBigIntLiteralsPlugin } from './zero-bigint-literals';

const entryOptions = {
  customCSSInheritanceList: [],
  debugInfoOutside: true,
  defaultDisplayLinear: true,
  defaultOverflowVisible: true,
  enableA11y: true,
  enableAccessibilityElement: true,
  enableCSSInheritance: false,
  enableCSSInvalidation: true,
  enableCSSSelector: true,
  enableNewGesture: false,
  enableRemoveCSSScope: undefined,
  removeDescendantSelectorScope: false,
  targetSdkVersion: '3.0',
  enableSSR: false,
  preferredFps: 'auto',
} as any;

/**
 * Fluent entry + plugin chain mock recording plugin .use() calls.
 */
const createMockChain = (options: {
  entries?: Record<string, { values: () => unknown[] }> | null;
}) => {
  const pluginUses: { name: string; Plugin: unknown; args: unknown[] }[] = [];
  const entryBuilders: Record<string, any> = {};

  const makeEntryBuilder = () => {
    const b: any = {};
    b.add = vi.fn(() => b);
    b.prepend = vi.fn(() => b);
    b.when = vi.fn((cond: boolean, cb: (e: unknown) => void) => {
      if (cond) cb(b);
      return b;
    });
    b.end = vi.fn(() => b);
    return b;
  };

  const makePluginBuilder = (name: string) => {
    const b: any = {};
    b.use = vi.fn((Plugin: unknown, args: unknown[]) => {
      pluginUses.push({ name, Plugin, args });
      return b;
    });
    b.after = vi.fn(() => b);
    b.end = vi.fn(() => b);
    return b;
  };

  const rules: Record<string, any> = {};
  const makeRuleBuilder = () => {
    const b: any = {};
    b.issuerLayer = vi.fn(() => b);
    b.test = vi.fn(() => b);
    b.sideEffects = vi.fn(() => b);
    return b;
  };

  const aliases = new Map<string, string>();
  const chain: any = {
    resolve: {
      alias: {
        set: vi.fn((key: string, value: string) => {
          aliases.set(key, value);
          return chain.resolve.alias;
        }),
      },
    },
    module: {
      rule: vi.fn((name: string) => (rules[name] ??= makeRuleBuilder())),
    },
    entryPoints: {
      entries: vi.fn(() => options.entries),
      clear: vi.fn(),
    },
    entry: vi.fn(
      (name: string) => (entryBuilders[name] ??= makeEntryBuilder()),
    ),
    plugin: vi.fn((name: string) => makePluginBuilder(name)),
  };

  return { chain, pluginUses, entryBuilders, rules, aliases };
};

/**
 * Recognizable stand-in for Rspack's plugin, passed in the chain's utils.
 */
class NormalModuleReplacementPlugin {}

/**
 * A stand-in for the background entries angular.ts writes: each entry's file
 * is `/cache/<environment>/<entry>.js`.
 */
const createBackgroundEntries = () => ({
  fileFor: vi.fn(
    (environmentName: string, entryName: string) =>
      `/cache/${environmentName}/${entryName}.js`,
  ),
  isBackgroundModule: vi.fn((file: string) => file === '/app/src/page.ts'),
  isEntryFile: vi.fn(),
  update: vi.fn(),
});

/**
 * A stand-in for the `LynxConfig` that `pluginLynx` exposes. The real one
 * resolves `output.filename` / the intermediate directory; here they are
 * deterministic so the template plugin's inputs can be asserted.
 */
const createLynxConfig = () => ({
  resolveBundleFilename: vi.fn(
    ({ entryName, platform }: { entryName: string; platform: string }) =>
      `${entryName}.${platform}.bundle`,
  ),
  resolveIntermediateDir: vi.fn(
    ({ entryName }: { entryName: string }) => `.lynx/${entryName}`,
  ),
  // `undefined` is what the real config returns unless `output.filename.bundle`
  // is a function.
  resolveLazyBundleFilename: vi.fn(
    (_context: { platform: string }): string | undefined => undefined,
  ),
});

/**
 * Builds a mock RsbuildPluginAPI exposing `lynxConfig`. Pass `null` (rather
 * than `undefined`, which would hit the default) to simulate `pluginLynx` not
 * being applied, so nothing is exposed.
 */
const createMockApi = (
  lynxConfig: ReturnType<typeof createLynxConfig> | null = createLynxConfig(),
) => {
  let handler:
    | ((
        chain: unknown,
        utils: { environment: unknown; isDev: boolean; rspack: unknown },
      ) => void)
    | undefined;

  const api = {
    context: { rootPath: '/app' },
    useExposed: vi.fn(() => lynxConfig ?? undefined),
    modifyBundlerChain: vi.fn((h: any) => {
      handler = h;
    }),
  };

  return {
    api,
    lynxConfig,
    triggerChain: (
      chain: unknown,
      environment: { name: string; config?: Record<string, unknown> },
      isDev: boolean,
    ) =>
      handler!(chain, {
        // Rsbuild normalizes `source.preEntry` to an array.
        environment: {
          ...environment,
          config: { source: { preEntry: [] }, ...environment.config },
        },
        isDev,
        rspack: { NormalModuleReplacementPlugin },
      }),
  };
};

describe('applyEntry', () => {
  it('throws when the Lynx config is not exposed', () => {
    const { api, triggerChain } = createMockApi(null);
    const { chain } = createMockChain({ entries: null });

    // The lookup is deferred to the chain handler (pluginLynx exposes its
    // config during setup, possibly after this plugin), so applyEntry itself
    // must not throw.
    expect(() =>
      applyEntry(
        api as never,
        entryOptions,
        createBackgroundEntries(),
        new Set(),
      ),
    ).not.toThrow();
    expect(() =>
      triggerChain(chain, { name: 'lynx', config: {} }, false),
    ).toThrow('No Lynx config exposed');
    expect(api.useExposed).toHaveBeenCalledWith(
      Symbol.for('@lynx-js/rsbuild-plugin:config'),
    );
  });

  it('splits entries and wires lynx plugins with HMR + live reload in dev', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, pluginUses, entryBuilders } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    // dev undefined exercises the `environment.config.dev ?? {}` fallback.
    triggerChain(chain, { name: 'lynx', config: {} }, true);

    // Both threads were registered.
    expect(chain.entry).toHaveBeenCalledWith('main__main-thread');
    expect(chain.entry).toHaveBeenCalledWith('main');
    // HMR + transport client were prepended onto the background entry.
    expect(entryBuilders['main'].prepend).toHaveBeenCalled();

    // RuntimeWrapper applied on lynx — exercise its injectVars renaming logic.
    const wrapperUse = pluginUses.find(
      (u) => u.Plugin === RuntimeWrapperWebpackPlugin,
    )!;
    expect(wrapperUse).toBeDefined();
    const injectVars = (wrapperUse.args[0] as any).injectVars;
    expect(injectVars(['Component', 'other'])).toEqual([
      '__Component',
      'other',
    ]);

    // LynxEncodePlugin applied on lynx, WebEncodePlugin not.
    expect(pluginUses.some((u) => u.Plugin === LynxEncodePlugin)).toBe(true);
    expect(pluginUses.some((u) => u.Plugin === WebEncodePlugin)).toBe(false);
    // The native main thread can't load a `0n`, so its scripts are rewritten.
    expect(pluginUses.some((u) => u.Plugin === ZeroBigIntLiteralsPlugin)).toBe(
      true,
    );
    // The frame rate the app chose goes to the plugin that writes it into
    // the page config.
    const angularUse = pluginUses.find((u) => u.name === 'lynx:angular')!;
    expect(angularUse.args[0]).toEqual(
      expect.objectContaining({ preferredFps: 'auto', multiTouch: false }),
    );
  });

  it("takes multi-touch from the plugin's option, or else angular.json's build option", () => {
    const multiTouchOf = (
      pluginOption: boolean | undefined,
      buildOptions: Record<string, unknown> | undefined,
    ): unknown => {
      const { api, lynxConfig, triggerChain } = createMockApi();
      // The Lynx config and the Angular CLI context are both exposed; the
      // CLI context is there only under `ng build` / `ng serve`.
      api.useExposed.mockImplementation(((id: symbol) =>
        id === Symbol.for('@lynx-js/rsbuild-plugin:config')
          ? lynxConfig
          : buildOptions && { buildOptions }) as never);
      const { chain, pluginUses } = createMockChain({
        entries: { main: { values: () => ['./src/main.ts'] } },
      });
      applyEntry(
        api as never,
        { ...entryOptions, multiTouch: pluginOption },
        createBackgroundEntries(),
        new Set(),
      );
      triggerChain(chain, { name: 'lynx', config: {} }, false);
      return (
        pluginUses.find((u) => u.name === 'lynx:angular')!.args[0] as {
          multiTouch: unknown;
        }
      ).multiTouch;
    };

    expect(multiTouchOf(undefined, undefined)).toBe(false);
    expect(multiTouchOf(undefined, { multiTouch: true })).toBe(true);
    expect(multiTouchOf(false, { multiTouch: true })).toBe(false);
    expect(multiTouchOf(true, undefined)).toBe(true);
  });

  it('adds the hot update clients to both threads in a dev build', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, entryBuilders, pluginUses, aliases } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'lynx', config: {} }, true);

    expect(entryBuilders['main__main-thread'].prepend).toHaveBeenCalledWith({
      layer: LAYERS.MAIN_THREAD,
      import: HMR_MAIN_THREAD_CLIENT,
    });
    // In place of `@rspack/core/hot/dev-server`, which only updates the
    // background thread, and after the dev transport's client.
    const background = entryBuilders['main'].prepend.mock.calls.map(
      ([entry]: [{ import: string }]) => entry.import,
    );
    expect(background).toEqual([
      HMR_BACKGROUND_CLIENT,
      '@lynx-js/webpack-dev-transport/client',
    ]);
    expect(background).not.toContain('@rspack/core/hot/dev-server');
    expect(aliases.get('@lynx-js/webpack-dev-transport/reloadApp')).toMatch(
      /webpack-dev-transport[\\/]lib[\\/]client[\\/]reloadApp\.js$/,
    );

    const replacement = pluginUses.find(
      (use) => use.Plugin === NormalModuleReplacementPlugin,
    )!;
    const [pattern, target] = replacement.args as [RegExp, string];
    expect(target).toBe(CSS_HOT_UPDATE);
    expect(
      pattern.test(
        '/app/node_modules/@lynx-js/css-extract-webpack-plugin/runtime/hotModuleReplacement.cjs',
      ),
    ).toBe(true);
    expect(
      pattern.test(
        'C:\\app\\node_modules\\@lynx-js\\css-extract-webpack-plugin\\runtime\\hotModuleReplacement.cjs',
      ),
    ).toBe(true);
    expect(
      pattern.test(
        '/app/node_modules/@lynx-js/css-extract-webpack-plugin/runtime/hotModuleReplacement.lepus.cjs',
      ),
    ).toBe(false);
  });

  it("records the app's own entry modules, which take hot updates", () => {
    const { api, triggerChain } = createMockApi();
    const { chain } = createMockChain({
      entries: {
        main: {
          values: () => [
            '@angular/localize/init',
            './src/styles.css',
            './src/main.ts',
            '/abs/other.ts',
          ],
        },
      },
    });
    const appEntries = new Set<string>();

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      appEntries,
    );
    triggerChain(chain, { name: 'lynx', config: {} }, true);

    expect([...appEntries]).toEqual([
      path.resolve('/app', './src/styles.css'),
      path.resolve('/app', './src/main.ts'),
      path.resolve('/abs/other.ts'),
    ]);
  });

  it('skips HMR/live-reload prepends when both are disabled', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, entryBuilders } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(
      chain,
      { name: 'lynx', config: { dev: { hmr: false, liveReload: false } } },
      true,
    );

    // Both when() conditions are false → nothing prepended.
    expect(entryBuilders['main'].prepend).not.toHaveBeenCalled();
  });

  it('uses the web encode plugin and no HMR on the web target', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, pluginUses, entryBuilders } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'web', config: {} }, false);

    expect(pluginUses.some((u) => u.Plugin === WebEncodePlugin)).toBe(true);
    // The web runs the main thread's script as plain JavaScript.
    expect(pluginUses.some((u) => u.Plugin === ZeroBigIntLiteralsPlugin)).toBe(
      false,
    );
    expect(
      pluginUses.some((u) => u.Plugin === RuntimeWrapperWebpackPlugin),
    ).toBe(false);
    // Web target never enables HMR even in dev.
    expect(entryBuilders['main'].prepend).not.toHaveBeenCalled();
  });

  it("starts the main thread from the app's entry, with the blur-view stylesheet first on native and the system font first on web, then the HTML text tags' bold on both", () => {
    const imports = (name: string) => {
      const { api, triggerChain } = createMockApi();
      const { chain, entryBuilders } = createMockChain({
        entries: { main: { values: () => ['./src/styles.css', './main.ts'] } },
      });
      applyEntry(
        api as never,
        entryOptions,
        createBackgroundEntries(),
        new Set(),
      );
      triggerChain(chain, { name, config: {} }, false);
      const [mainThread] = entryBuilders['main__main-thread'].add.mock.calls[0];
      expect(mainThread.layer).toBe(LAYERS.MAIN_THREAD);
      return mainThread.import;
    };

    expect(imports('lynx')).toEqual([
      BLUR_VIEW_STYLESHEET,
      TEXT_SCALE_STYLESHEET,
      HTML_TEXT_TAGS_STYLESHEET,
      './src/styles.css',
      './main.ts',
    ]);
    expect(imports('web')).toEqual([
      WEB_SYSTEM_FONT_STYLESHEET,
      HTML_TEXT_TAGS_STYLESHEET,
      './src/styles.css',
      './main.ts',
    ]);
  });

  // Angular runs on the main thread only, so the background thread gets the
  // pre-entries (polyfills) and the generated entry, never main.ts.
  it('starts the background thread from the pre-entries and its generated entry', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, entryBuilders } = createMockChain({
      entries: {
        main: {
          values: () => ['/polyfills.js', './src/styles.css', './main.ts'],
        },
        other: { values: () => ['/polyfills.js', './other.ts'] },
      },
    });
    const backgroundEntries = createBackgroundEntries();
    applyEntry(api as never, entryOptions, backgroundEntries, new Set());
    triggerChain(
      chain,
      {
        name: 'lynx',
        config: { source: { preEntry: ['/polyfills.js', './src/styles.css'] } },
      },
      false,
    );

    const [main] = entryBuilders['main'].add.mock.calls[0];
    expect(main.layer).toBe(LAYERS.BACKGROUND);
    expect(main.import).toEqual([
      '/polyfills.js',
      './src/styles.css',
      '/cache/lynx/main.js',
    ]);
    const [other] = entryBuilders['other'].add.mock.calls[0];
    expect(other.import).toEqual(['/polyfills.js', '/cache/lynx/other.js']);
    expect(backgroundEntries.fileFor).toHaveBeenCalledWith('lynx', 'main');
    expect(backgroundEntries.fileFor).toHaveBeenCalledWith('lynx', 'other');
  });

  // A package or app with `"sideEffects": false` would otherwise lose the
  // modules the generated entry imports for their side effects alone.
  it("keeps the background entry's modules' side effects in the background layer", () => {
    const { api, triggerChain } = createMockApi();
    const { chain, rules } = createMockChain({ entries: null });
    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    const rule = rules['lynx:background-modules'];
    expect(rule.issuerLayer).toHaveBeenCalledWith(LAYERS.BACKGROUND);
    expect(rule.sideEffects).toHaveBeenCalledWith(true);
    const test = rule.test.mock.calls[0][0] as (file: string) => boolean;
    expect(test('/app/src/page.ts')).toBe(true);
    expect(test('/app/src/other.ts')).toBe(false);
  });

  // Issues #611, #643 and #649: <b>, <em>, <u>, <s>, <code>, <small>, <a href>
  // and their kin drew as the text around them, as nothing gave them the
  // browser's text styles. The rules
  // only work once the plugin's own PostCSS has made the type selectors the
  // classes the runtime marks the elements with, and once the style index
  // says they set the property: without that, the runtime gives the element
  // its parent's value inline, which beats any rule.
  it("gives the HTML text tags the browser's text styles, on the runtime's elements and over the inherited values", () => {
    const css = postcss([typeSelectorsForLynx(), textInheritanceForLynx()])
      .process(readFileSync(HTML_TEXT_TAGS_STYLESHEET, 'utf8'), {
        from: undefined,
      })
      .css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = postcss
      .parse(css)
      .nodes.filter((node) => node.type === 'rule')
      .map((rule) => [
        rule.selector.replace(/\s*,\s*/g, ','),
        rule.nodes
          .map((node) =>
            node.type === 'decl' ? `${node.prop}: ${node.value}` : '',
          )
          .join('; '),
      ]);
    const tags = (...names: string[]) =>
      names.map((name) => `._ngtag-${name}`).join(',');
    const inherit = (...names: string[]) =>
      names.map((name) => `._ngtag-${name}._nginherit`).join(',');
    const link = '._ngattr-a-href';
    const nested = [
      ['._ngtag-u', '._ngtag-s'],
      ['._ngtag-u', '._ngtag-del'],
      ['._ngtag-ins', '._ngtag-s'],
      ['._ngtag-ins', '._ngtag-del'],
      ['._ngtag-s', '._ngtag-u'],
      ['._ngtag-s', '._ngtag-ins'],
      ['._ngtag-del', '._ngtag-u'],
      ['._ngtag-del', '._ngtag-ins'],
      [link, '._ngtag-s'],
      [link, '._ngtag-del'],
      ['._ngtag-s', link],
      ['._ngtag-del', link],
    ];

    expect(rules).toEqual([
      [tags('b', 'strong'), 'font-weight: bold'],
      // Loose text inside a <b> reads the weight from here.
      [inherit('b', 'strong'), '--angular-lynx-font-weight: bold'],
      [tags('em', 'i', 'cite', 'dfn', 'var'), 'font-style: italic'],
      [
        inherit('em', 'i', 'cite', 'dfn', 'var'),
        '--angular-lynx-font-style: italic',
      ],
      [tags('u', 'ins'), 'text-decoration: underline'],
      [inherit('u', 'ins'), '--angular-lynx-text-decoration: underline'],
      [tags('s', 'del'), 'text-decoration: line-through'],
      [inherit('s', 'del'), '--angular-lynx-text-decoration: line-through'],
      [tags('code', 'kbd', 'samp'), 'font-family: Menlo, monospace'],
      [
        inherit('code', 'kbd', 'samp'),
        '--angular-lynx-font-family: Menlo, monospace',
      ],
      // A smaller size than the text around, which has no copy: it would
      // read itself.
      [
        tags('small', 'sub', 'sup'),
        'font-size: calc(var(--angular-lynx-font-size, 14px) / 1.2)',
      ],
      [tags('sub'), 'vertical-align: -0.24em'],
      [tags('sup'), 'vertical-align: 0.4em'],
      [tags('mark'), 'background-color: #ffff00; color: #000000'],
      [inherit('mark'), '--angular-lynx-color: #000000'],
      // The runtime's class for an <a> with an href.
      [
        link,
        'color: var(--angular-lynx-link-color, #0000ee); text-decoration: underline',
      ],
      [
        `${link}._nginherit`,
        '--angular-lynx-color: var(--angular-lynx-link-color, #0000ee); --angular-lynx-text-decoration: underline',
      ],
      ['page.dark', '--angular-lynx-link-color: #9e9eff'],
      ['._ngattr-abbr-title', 'text-decoration: underline dotted'],
      [
        '._ngattr-abbr-title._nginherit',
        '--angular-lynx-text-decoration: underline dotted',
      ],
      // A <u> inside an <s> keeps the line through, as in a browser.
      [
        nested.map(([outer, inner]) => `${outer} ${inner}`).join(','),
        'text-decoration: underline line-through',
      ],
      [
        nested
          .map(([outer, inner]) => `${outer} ${inner}._nginherit`)
          .join(','),
        '--angular-lynx-text-decoration: underline line-through',
      ],
    ]);
    const bit = (property: string) =>
      1 << INHERITED_TEXT_PROPERTIES.indexOf(property);
    expect(styleIndexOf([css]).rules).toEqual(
      expect.arrayContaining([
        [['_ngtag-b'], bit('font-weight')],
        [['_ngtag-strong'], bit('font-weight')],
        ...['em', 'i', 'cite', 'dfn', 'var'].map((tag) => [
          [`_ngtag-${tag}`],
          bit('font-style'),
        ]),
        ...['u', 'ins', 's', 'del'].map((tag) => [
          [`_ngtag-${tag}`],
          bit('text-decoration'),
        ]),
        ...['code', 'kbd', 'samp'].map((tag) => [
          [`_ngtag-${tag}`],
          bit('font-family'),
        ]),
        ...['small', 'sub', 'sup'].map((tag) => [
          [`_ngtag-${tag}`],
          bit('font-size'),
        ]),
        [['_ngtag-mark'], bit('color')],
        [['_ngattr-a-href'], bit('color') | bit('text-decoration')],
        [['_ngattr-abbr-title'], bit('text-decoration')],
      ]),
    );
  });

  // The runtime sets the variables and the stylesheet reads them, from two
  // packages, so only this test notices when one side renames a variable.
  it('reads exactly the blur-view variables the runtime sets on Android', () => {
    const variables = (source: string) =>
      new Set(source.match(/--angular-lynx-blur-[a-z-]+/g));
    const css = readFileSync(BLUR_VIEW_STYLESHEET, 'utf8');
    const runtime = readFileSync(
      new URL(
        '../../runtime/src/lib/lynx-document/android-blur-material.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(variables(css).size).toBe(3);
    expect(variables(css)).toEqual(variables(runtime));
  });

  it('takes the template filename and intermediate dir from the Lynx config', () => {
    const { api, lynxConfig, triggerChain } = createMockApi();
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    // pluginLynx owns filename/intermediate resolution so the template plugin
    // stays in sync with where css-extract emits its intermediate CSS.
    expect(lynxConfig!.resolveBundleFilename).toHaveBeenCalledWith({
      entryName: 'main',
      platform: 'lynx',
    });
    expect(lynxConfig!.resolveIntermediateDir).toHaveBeenCalledWith({
      entryName: 'main',
    });
    // The template plugin (first plugin used) receives the resolved values as-is.
    const templateUse = pluginUses[0];
    expect((templateUse.args[0] as any).filename).toBe('main.lynx.bundle');
    expect((templateUse.args[0] as any).intermediate).toBe('.lynx/main');
  });

  it('leaves the lazy bundle filename to the template plugin by default', () => {
    const { api, lynxConfig, triggerChain } = createMockApi();
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'web', config: {} }, false);

    expect(lynxConfig!.resolveLazyBundleFilename).toHaveBeenCalledWith({
      platform: 'web',
    });
    expect(pluginUses[0].args[0]).not.toHaveProperty('lazyBundleFilename');
  });

  it('passes a lazy bundle filename resolved per platform to the template plugin', () => {
    const lynxConfig = createLynxConfig();
    lynxConfig.resolveLazyBundleFilename.mockImplementation(
      ({ platform }) => `lazy/[name].${platform}.bundle`,
    );
    const { api, triggerChain } = createMockApi(lynxConfig);
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    expect((pluginUses[0].args[0] as any).lazyBundleFilename).toBe(
      'lazy/[name].lynx.bundle',
    );
  });

  it('builds lazy bundles for FetchBundle when lazy bundles are on', () => {
    const templateOptions = (options: typeof entryOptions) => {
      const { api, triggerChain } = createMockApi();
      const { chain, pluginUses } = createMockChain({
        entries: { main: { values: () => ['./src/main.ts'] } },
      });
      applyEntry(api as never, options, createBackgroundEntries(), new Set());
      triggerChain(chain, { name: 'lynx', config: {} }, false);
      return pluginUses[0].args[0];
    };

    // The main thread, where Angular routes, can wait for a FetchBundle
    // bundle to download; with QueryComponent it couldn't (#451).
    expect(
      templateOptions({ ...entryOptions, experimental_isLazyBundle: true }),
    ).toHaveProperty('lazyBundleFetcher', 'FetchBundle');
    expect(
      templateOptions({ ...entryOptions, experimental_isLazyBundle: false }),
    ).not.toHaveProperty('lazyBundleFetcher');
  });

  it('passes the enableA11y option to the template plugin', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    // It used to be hard-coded to true, so an app couldn't switch Android to
    // the accessibility path that UI test tools can read without TalkBack.
    applyEntry(
      api as never,
      { ...entryOptions, enableA11y: false },
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    expect((pluginUses[0].args[0] as any).enableA11y).toBe(false);
  });

  it('passes the defaultOverflowVisible option to the template plugin', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    // It used to be accepted and then dropped, so `false` had no effect.
    applyEntry(
      api as never,
      { ...entryOptions, defaultOverflowVisible: false },
      createBackgroundEntries(),
      new Set(),
    );
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    expect((pluginUses[0].args[0] as any).defaultOverflowVisible).toBe(false);
  });

  it('tolerates an empty entry set (entries() returns null)', () => {
    const { api, triggerChain } = createMockApi();
    const { chain } = createMockChain({ entries: null });

    applyEntry(
      api as never,
      entryOptions,
      createBackgroundEntries(),
      new Set(),
    );

    expect(() =>
      triggerChain(chain, { name: 'lynx', config: {} }, false),
    ).not.toThrow();
    expect(chain.entryPoints.clear).toHaveBeenCalled();
  });
});

describe('getChunks', () => {
  it('string entry extracts import and uses entryName as chunk', () => {
    const result = getChunks('main', ['./src/index.ts']);

    expect(result.imports).toEqual(['./src/index.ts']);
    expect(result.chunks).toEqual(['main']);
  });

  it('EntryDescription with import string extracts import', () => {
    const result = getChunks('app', [{ import: './src/index.ts' }]);

    expect(result.imports).toEqual(['./src/index.ts']);
    expect(result.chunks).toEqual(['app']);
  });

  it('EntryDescription with import array extracts all imports', () => {
    const result = getChunks('app', [{ import: ['./a.ts', './b.ts'] }]);

    expect(result.imports).toEqual(['./a.ts', './b.ts']);
  });

  it('EntryDescription with dependOn string adds to front of chunks', () => {
    const result = getChunks('app', [
      { import: './src/index.ts', dependOn: 'vendor' },
    ]);

    expect(result.chunks).toEqual(['vendor', 'app']);
  });

  it('EntryDescription with dependOn array adds all to front of chunks', () => {
    const result = getChunks('app', [
      { import: './src/index.ts', dependOn: ['vendor', 'shared'] },
    ]);

    expect(result.chunks).toEqual(['vendor', 'shared', 'app']);
  });

  it('multiple string entries accumulate imports', () => {
    const result = getChunks('app', ['./a.ts', './b.ts']);

    expect(result.imports).toEqual(['./a.ts', './b.ts']);
    expect(result.chunks).toEqual(['app']);
  });

  it('array entry duplicates existing imports (documents current behavior)', () => {
    // Line 194 has `imports.push(...imports)` instead of `imports.push(...item)`
    // This means an array entry duplicates whatever imports were already collected
    const result = getChunks('app', ['./a.ts', ['./b.ts', './c.ts']]);

    // After processing './a.ts': imports = ['./a.ts']
    // After processing ['./b.ts', './c.ts']: imports.push(...imports) duplicates → ['./a.ts', './a.ts']
    expect(result.imports).toEqual(['./a.ts', './a.ts']);
  });
});
