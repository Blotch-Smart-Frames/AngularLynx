import { readFileSync } from 'node:fs';
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
import { applyEntry, BLUR_VIEW_STYLESHEET, getChunks } from './entry';

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

  const chain: any = {
    entryPoints: {
      entries: vi.fn(() => options.entries),
      clear: vi.fn(),
    },
    entry: vi.fn(
      (name: string) => (entryBuilders[name] ??= makeEntryBuilder()),
    ),
    plugin: vi.fn((name: string) => makePluginBuilder(name)),
  };

  return { chain, pluginUses, entryBuilders };
};

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
        utils: { environment: unknown; isDev: boolean },
      ) => void)
    | undefined;

  const api = {
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
      environment: { name: string; config?: unknown },
      isDev: boolean,
    ) => handler!(chain, { environment, isDev }),
  };
};

describe('applyEntry', () => {
  it('throws when the Lynx config is not exposed', () => {
    const { api, triggerChain } = createMockApi(null);
    const { chain } = createMockChain({ entries: null });

    // The lookup is deferred to the chain handler (pluginLynx exposes its
    // config during setup, possibly after this plugin), so applyEntry itself
    // must not throw.
    expect(() => applyEntry(api as never, entryOptions)).not.toThrow();
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

    applyEntry(api as never, entryOptions);
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
  });

  it('skips HMR/live-reload prepends when both are disabled', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, entryBuilders } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(api as never, entryOptions);
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

    applyEntry(api as never, entryOptions);
    triggerChain(chain, { name: 'web', config: {} }, false);

    expect(pluginUses.some((u) => u.Plugin === WebEncodePlugin)).toBe(true);
    expect(
      pluginUses.some((u) => u.Plugin === RuntimeWrapperWebpackPlugin),
    ).toBe(false);
    // Web target never enables HMR even in dev.
    expect(entryBuilders['main'].prepend).not.toHaveBeenCalled();
  });

  it('adds the blur-view stylesheet first, to the native bundle only', () => {
    const imports = (name: string) => {
      const { api, triggerChain } = createMockApi();
      const { chain, entryBuilders } = createMockChain({
        entries: { main: { values: () => ['./src/styles.css', './main.ts'] } },
      });
      applyEntry(api as never, entryOptions);
      triggerChain(chain, { name, config: {} }, false);
      const [background] = entryBuilders['main'].add.mock.calls[0];
      const [mainThread] = entryBuilders['main__main-thread'].add.mock.calls[0];
      expect(mainThread.import).toEqual(background.import);
      return background.import;
    };

    expect(imports('lynx')).toEqual([
      BLUR_VIEW_STYLESHEET,
      './src/styles.css',
      './main.ts',
    ]);
    expect(imports('web')).toEqual(['./src/styles.css', './main.ts']);
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

    applyEntry(api as never, entryOptions);
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

    applyEntry(api as never, entryOptions);
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

    applyEntry(api as never, entryOptions);
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    expect((pluginUses[0].args[0] as any).lazyBundleFilename).toBe(
      'lazy/[name].lynx.bundle',
    );
  });

  it('passes the enableA11y option to the template plugin', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    // It used to be hard-coded to true, so an app couldn't switch Android to
    // the accessibility path that UI test tools can read without TalkBack.
    applyEntry(api as never, { ...entryOptions, enableA11y: false });
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    expect((pluginUses[0].args[0] as any).enableA11y).toBe(false);
  });

  it('passes the defaultOverflowVisible option to the template plugin', () => {
    const { api, triggerChain } = createMockApi();
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    // It used to be accepted and then dropped, so `false` had no effect.
    applyEntry(api as never, {
      ...entryOptions,
      defaultOverflowVisible: false,
    });
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    expect((pluginUses[0].args[0] as any).defaultOverflowVisible).toBe(false);
  });

  it('tolerates an empty entry set (entries() returns null)', () => {
    const { api, triggerChain } = createMockApi();
    const { chain } = createMockChain({ entries: null });

    applyEntry(api as never, entryOptions);

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
