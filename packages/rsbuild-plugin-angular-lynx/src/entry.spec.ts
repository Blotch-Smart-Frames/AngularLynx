import { describe, expect, it, vi } from 'vitest';

// Recognizable plugin stand-ins so `.use(Plugin, [opts])` can be asserted and
// the `${Plugin.name}` plugin keys resolve.
vi.mock('@lynx-js/runtime-wrapper-webpack-plugin', () => ({
  RuntimeWrapperWebpackPlugin: class RuntimeWrapperWebpackPlugin {},
}));
vi.mock('@lynx-js/template-webpack-plugin', () => ({
  CSSPlugins: {
    parserPlugins: { removeFunctionWhiteSpace: () => ({ name: 'rmws' }) },
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
    entry: vi.fn((name: string) => (entryBuilders[name] ??= makeEntryBuilder())),
    plugin: vi.fn((name: string) => makePluginBuilder(name)),
  };

  return { chain, pluginUses, entryBuilders };
};

const createMockApi = (config: unknown | undefined) => {
  let handler:
    | ((
        chain: unknown,
        utils: { environment: unknown; isDev: boolean },
      ) => void)
    | undefined;

  const api = {
    useExposed: vi.fn(() =>
      config === undefined ? undefined : { config },
    ),
    modifyBundlerChain: vi.fn((h: any) => {
      handler = h;
    }),
  };

  return {
    api,
    triggerChain: (
      chain: unknown,
      environment: { name: string; config?: unknown },
      isDev: boolean,
    ) => handler!(chain, { environment, isDev }),
  };
};

describe('applyEntry', () => {
  it('throws when the rspeedy API is not exposed', () => {
    const { api } = createMockApi(undefined);

    expect(() => applyEntry(api as never, entryOptions)).toThrow(
      'Failed to get rspeedy API',
    );
  });

  it('splits entries and wires lynx plugins with HMR + live reload in dev', () => {
    const { api, triggerChain } = createMockApi({
      output: { filename: { bundle: '[name].[platform].bundle' } },
    });
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

    // RuntimeWrapper applied on lynx — exercise its injectVars renamer.
    const wrapperUse = pluginUses.find(
      (u) => u.Plugin === RuntimeWrapperWebpackPlugin,
    )!;
    expect(wrapperUse).toBeDefined();
    const injectVars = (wrapperUse.args[0] as any).injectVars;
    expect(injectVars(['Component', 'other'])).toEqual(['__Component', 'other']);

    // LynxEncodePlugin applied on lynx, WebEncodePlugin not.
    expect(pluginUses.some((u) => u.Plugin === LynxEncodePlugin)).toBe(true);
    expect(pluginUses.some((u) => u.Plugin === WebEncodePlugin)).toBe(false);
  });

  it('skips HMR/live-reload prepends when both are disabled', () => {
    const { api, triggerChain } = createMockApi({
      output: { filename: '[name].bundle' },
    });
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
    const { api, triggerChain } = createMockApi({
      output: { filename: { template: '[name].[platform].bundle' } },
    });
    const { chain, pluginUses, entryBuilders } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(api as never, entryOptions);
    triggerChain(chain, { name: 'web', config: {} }, false);

    expect(pluginUses.some((u) => u.Plugin === WebEncodePlugin)).toBe(true);
    expect(pluginUses.some((u) => u.Plugin === RuntimeWrapperWebpackPlugin)).toBe(
      false,
    );
    // Web target never enables HMR even in dev.
    expect(entryBuilders['main'].prepend).not.toHaveBeenCalled();
  });

  it('falls back to the default template filename when output.filename is undefined', () => {
    const { api, triggerChain } = createMockApi({ output: {} });
    const { chain, pluginUses } = createMockChain({
      entries: { main: { values: () => ['./src/main.ts'] } },
    });

    applyEntry(api as never, entryOptions);
    triggerChain(chain, { name: 'lynx', config: {} }, false);

    // The template plugin (first plugin used) received the default, interpolated.
    const templateUse = pluginUses[0];
    expect((templateUse.args[0] as any).filename).toBe('main.lynx.bundle');
  });

  it('tolerates an empty entry set (entries() returns null)', () => {
    const { api, triggerChain } = createMockApi({ output: {} });
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
