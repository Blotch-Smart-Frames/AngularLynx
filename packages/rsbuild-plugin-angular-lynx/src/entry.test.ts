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
import { applyEntry, getChunks } from './entry';

const entryOptions = {
  customCSSInheritanceList: [],
  debugInfoOutside: true,
  defaultDisplayLinear: true,
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
