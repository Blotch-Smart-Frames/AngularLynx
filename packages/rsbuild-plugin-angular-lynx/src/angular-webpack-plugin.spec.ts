// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lynx-js/template-webpack-plugin', () => ({
  LynxTemplatePlugin: {
    getLynxTemplatePluginHooks: vi.fn(),
  },
}));

vi.mock('@lynx-js/webpack-runtime-globals', () => ({
  RuntimeGlobals: {
    lynxProcessEvalResult: '__lynx_process_eval_result__',
  },
}));

vi.mock('./lynx-process-eval-result-runtime-module.js', () => ({
  createLynxProcessEvalResultRuntimeModule: vi.fn(),
}));

import { LynxTemplatePlugin } from '@lynx-js/template-webpack-plugin';
import { RuntimeGlobals as LynxRuntimeGlobals } from '@lynx-js/webpack-runtime-globals';
import { createLynxProcessEvalResultRuntimeModule } from './lynx-process-eval-result-runtime-module.js';
import { AngularWebpackPlugin } from './angular-webpack-plugin';

/**
 * Minimal ConcatSource that behaves like the real webpack one for testing.
 */
class MockConcatSource {
  #parts: (string | { source(): string })[];

  constructor(...parts: (string | { source(): string })[]) {
    this.#parts = parts;
  }

  source(): string {
    return this.#parts
      .map((p) => (typeof p === 'string' ? p : p.source()))
      .join('');
  }
}

type MockAsset = {
  name: string;
  source: { source(): string };
  info: Record<string, unknown>;
};

const mockSource = (content: string) => ({ source: () => content });

/**
 * Builds a minimal compiler mock and returns helpers to trigger compilation hooks.
 */
const createMockCompiler = (
  mode: 'development' | 'production' = 'development',
) => {
  let capturedDefineArgs: Record<string, string> = {};
  let capturedEnvironmentArgs: Record<string, unknown> = {};

  /**
   * Must be real constructors because the plugin calls `new DefinePlugin(...)` etc.
   * Mutate (not reassign) so destructured references in tests stay valid.
   */
  const MockDefinePlugin = function (
    this: { apply: ReturnType<typeof vi.fn> },
    args: Record<string, string>,
  ) {
    Object.assign(capturedDefineArgs, args);
    this.apply = vi.fn();
  };

  const MockEnvironmentPlugin = function (
    this: { apply: ReturnType<typeof vi.fn> },
    args: Record<string, unknown>,
  ) {
    Object.assign(capturedEnvironmentArgs, args);
    this.apply = vi.fn();
  };

  const compilationCallbacks: Array<(compilation: unknown) => void> = [];

  const compiler = {
    options: { mode },
    webpack: {
      DefinePlugin: MockDefinePlugin,
      EnvironmentPlugin: MockEnvironmentPlugin,
      RuntimeGlobals: {
        ensureChunkHandlers: '__webpack_require__.e.handlers',
      },
      Compilation: {
        PROCESS_ASSETS_STAGE_ADDITIONAL: 20000,
        PROCESS_ASSETS_STAGE_ADDITIONS: -100,
      },
      sources: { ConcatSource: MockConcatSource },
    },
    hooks: {
      thisCompilation: {
        tap: vi.fn((_name: string, cb: (compilation: unknown) => void) => {
          compilationCallbacks.push(cb);
        }),
      },
    },
  };

  return {
    compiler,
    triggerCompilation: (compilation: unknown) =>
      compilationCallbacks.forEach((cb) => cb(compilation)),
    capturedDefineArgs,
    capturedEnvironmentArgs,
    MockDefinePlugin,
    MockEnvironmentPlugin,
  };
};

/**
 * Builds a minimal compilation mock with helpers to trigger each hook type.
 */
const createMockCompilation = () => {
  const runtimeRequirementCallbacks: Record<
    string,
    Array<(chunk: unknown, requests: Set<string>) => void>
  > = {};

  type ProcessAssetsEntry = { stage: number; fn: () => void };
  const processAssetsCallbacks: ProcessAssetsEntry[] = [];

  const assets: Record<string, MockAsset> = {};

  const compilation = {
    hooks: {
      runtimeRequirementInTree: {
        for: vi.fn((req: string) => ({
          tap: vi.fn(
            (
              _name: string,
              cb: (chunk: unknown, requests: Set<string>) => void,
            ) => {
              (runtimeRequirementCallbacks[req] ??= []).push(cb);
            },
          ),
        })),
      },
      processAssets: {
        tap: vi.fn(
          ({ stage }: { name: string; stage: number }, fn: () => void) => {
            processAssetsCallbacks.push({ stage, fn });
          },
        ),
      },
    },
    chunkGroups: [] as unknown[],
    assets,
    getAsset: vi.fn((name: string) => assets[name] ?? null),
    updateAsset: vi.fn(
      (
        name: string,
        updater:
          | MockAsset['source']
          | ((old: MockAsset['source']) => MockAsset['source']),
        newInfo?: Record<string, unknown>,
      ) => {
        if (!assets[name]) return;
        const current = assets[name];
        assets[name] = {
          ...current,
          source:
            typeof updater === 'function' ? updater(current.source) : updater,
          info: newInfo !== undefined ? newInfo : current.info,
        };
      },
    ),
    addRuntimeModule: vi.fn(),
    chunkGraph: {},

    // Test helpers
    triggerRuntimeRequirement(
      req: string,
      chunk: unknown,
      requests = new Set<string>(),
    ) {
      (runtimeRequirementCallbacks[req] ?? []).forEach((cb) =>
        cb(chunk, requests),
      );
    },
    triggerProcessAssets(stage: number) {
      processAssetsCallbacks
        .filter((e) => e.stage === stage)
        .forEach(({ fn }) => fn());
    },
    addAsset(
      name: string,
      content: string,
      info: Record<string, unknown> = {},
    ) {
      assets[name] = { name, source: mockSource(content), info };
    },
  };

  return compilation;
};

/**
 * Wires up the beforeEncode hook mock and returns a trigger function.
 */
const setupBeforeEncodeHook = () => {
  let beforeEncodeCb: ((args: unknown) => unknown) | undefined;

  vi.mocked(LynxTemplatePlugin.getLynxTemplatePluginHooks).mockReturnValue({
    beforeEncode: {
      tap: vi.fn((_name: string, cb: (args: unknown) => unknown) => {
        beforeEncodeCb = cb;
      }),
    },
  } as never);

  return (args: unknown) => {
    if (!beforeEncodeCb)
      throw new Error('beforeEncode hook was not registered');
    return beforeEncodeCb(args);
  };
};

describe('AngularWebpackPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for createLynxProcessEvalResultRuntimeModule
    vi.mocked(createLynxProcessEvalResultRuntimeModule).mockReturnValue(
      class MockRuntimeModule {} as never,
    );
  });

  describe('defaultOptions', () => {
    it('has all expected default values', () => {
      expect(AngularWebpackPlugin.defaultOptions).toEqual({
        disableCreateSelectorQueryIncompatibleWarning: false,
        firstScreenSyncTiming: 'immediately',
        enableSSR: false,
        isWeb: false,
        mainThreadChunks: [],
        extractStr: false,
        experimental_isLazyBundle: false,
      });
    });

    it('is frozen', () => {
      expect(Object.isFrozen(AngularWebpackPlugin.defaultOptions)).toBe(true);
    });
  });

  describe('constructor', () => {
    it('can be created without options', () => {
      const plugin = new AngularWebpackPlugin();
      expect(plugin.options).toBeUndefined();
    });

    it('stores provided options', () => {
      const options = {
        enableSSR: true,
        firstScreenSyncTiming: 'jsReady' as const,
      };
      const plugin = new AngularWebpackPlugin(options);
      expect(plugin.options).toBe(options);
    });
  });

  describe('apply()', () => {
    describe('EnvironmentPlugin', () => {
      it('applies EnvironmentPlugin with DEBUG=null', () => {
        const { compiler, capturedEnvironmentArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);

        expect(capturedEnvironmentArgs).toEqual({ DEBUG: null });
      });
    });

    describe('DefinePlugin', () => {
      it('sets __DEV__ to true in development mode', () => {
        const { compiler, capturedDefineArgs } =
          createMockCompiler('development');
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);

        expect(capturedDefineArgs['__DEV__']).toBe('true');
      });

      it('sets __DEV__ to false in production mode', () => {
        const { compiler, capturedDefineArgs } =
          createMockCompiler('production');
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);

        expect(capturedDefineArgs['__DEV__']).toBe('false');
      });

      it('sets __PROFILE__ to match __DEV__', () => {
        const { compiler: devCompiler, capturedDefineArgs: devArgs } =
          createMockCompiler('development');
        setupBeforeEncodeHook();
        new AngularWebpackPlugin().apply(devCompiler as never);
        expect(devArgs['__PROFILE__']).toBe('true');

        vi.clearAllMocks();
        vi.mocked(createLynxProcessEvalResultRuntimeModule).mockReturnValue(
          class {} as never,
        );

        const { compiler: prodCompiler, capturedDefineArgs: prodArgs } =
          createMockCompiler('production');
        setupBeforeEncodeHook();
        new AngularWebpackPlugin().apply(prodCompiler as never);
        expect(prodArgs['__PROFILE__']).toBe('false');
      });

      it('sets __EXTRACT_STR__ to false by default', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);

        expect(capturedDefineArgs['__EXTRACT_STR__']).toBe('false');
      });

      it('sets __EXTRACT_STR__ to true when extractStr is truthy', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ extractStr: { strLength: 20 } }).apply(
          compiler as never,
        );

        expect(capturedDefineArgs['__EXTRACT_STR__']).toBe('true');
      });

      it('sets __FIRST_SCREEN_SYNC_TIMING__ from option', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ firstScreenSyncTiming: 'jsReady' }).apply(
          compiler as never,
        );

        expect(capturedDefineArgs['__FIRST_SCREEN_SYNC_TIMING__']).toBe(
          '"jsReady"',
        );
      });

      it('sets __FIRST_SCREEN_SYNC_TIMING__ to "immediately" by default', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);

        expect(capturedDefineArgs['__FIRST_SCREEN_SYNC_TIMING__']).toBe(
          '"immediately"',
        );
      });

      it('sets __ENABLE_SSR__ from option', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ enableSSR: true }).apply(compiler as never);

        expect(capturedDefineArgs['__ENABLE_SSR__']).toBe('true');
      });

      it('sets __WEB__ to true when isWeb is set', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ isWeb: true }).apply(compiler as never);

        expect(capturedDefineArgs['__WEB__']).toBe('true');
      });

      it('defaults __WEB__ to false (native builds) so web-only code is tree-shaken', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({}).apply(compiler as never);

        expect(capturedDefineArgs['__WEB__']).toBe('false');
      });

      it('sets __DISABLE_CREATE_SELECTOR_QUERY_INCOMPATIBLE_WARNING__ from option', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({
          disableCreateSelectorQueryIncompatibleWarning: true,
        }).apply(compiler as never);

        expect(
          capturedDefineArgs[
            '__DISABLE_CREATE_SELECTOR_QUERY_INCOMPATIBLE_WARNING__'
          ],
        ).toBe('true');
      });

      it('forces __FIRST_SCREEN_SYNC_TIMING__ to "jsReady" when enableSSR is true', () => {
        const { compiler, capturedDefineArgs } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ enableSSR: true }).apply(compiler as never);

        expect(capturedDefineArgs['__FIRST_SCREEN_SYNC_TIMING__']).toBe(
          '"jsReady"',
        );
      });
    });

    describe('thisCompilation hook', () => {
      it('registers on compiler.hooks.thisCompilation', () => {
        const { compiler } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);

        expect(compiler.hooks.thisCompilation.tap).toHaveBeenCalledWith(
          'AngularWebpackPlugin',
          expect.any(Function),
        );
      });
    });

    describe('runtimeRequirementInTree hooks', () => {
      it('adds lynxProcessEvalResult requirement when ensureChunkHandlers is required', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        triggerCompilation(compilation);

        const requests = new Set<string>();
        compilation.triggerRuntimeRequirement(
          compiler.webpack.RuntimeGlobals.ensureChunkHandlers,
          {},
          requests,
        );

        expect(requests.has(LynxRuntimeGlobals.lynxProcessEvalResult)).toBe(
          true,
        );
      });

      it('adds runtime module to chunk when lynxProcessEvalResult is required', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        triggerCompilation(compilation);

        const chunk = {};
        compilation.triggerRuntimeRequirement(
          LynxRuntimeGlobals.lynxProcessEvalResult,
          chunk,
        );

        expect(compilation.addRuntimeModule).toHaveBeenCalledWith(
          chunk,
          expect.any(Object),
        );
      });

      it('adds runtime module only once per chunk (WeakSet deduplication)', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        triggerCompilation(compilation);

        const chunk = {};
        compilation.triggerRuntimeRequirement(
          LynxRuntimeGlobals.lynxProcessEvalResult,
          chunk,
        );
        compilation.triggerRuntimeRequirement(
          LynxRuntimeGlobals.lynxProcessEvalResult,
          chunk,
        );
        compilation.triggerRuntimeRequirement(
          LynxRuntimeGlobals.lynxProcessEvalResult,
          chunk,
        );

        expect(compilation.addRuntimeModule).toHaveBeenCalledTimes(1);
      });

      it('adds runtime module for different chunks independently', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        triggerCompilation(compilation);

        const chunkA = {};
        const chunkB = {};
        compilation.triggerRuntimeRequirement(
          LynxRuntimeGlobals.lynxProcessEvalResult,
          chunkA,
        );
        compilation.triggerRuntimeRequirement(
          LynxRuntimeGlobals.lynxProcessEvalResult,
          chunkB,
        );

        expect(compilation.addRuntimeModule).toHaveBeenCalledTimes(2);
      });
    });

    describe('processAssets ADDITIONAL stage — main thread info', () => {
      const STAGE_ADDITIONAL = 20000;

      it('marks named main thread chunks with lynx:main-thread info', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ mainThreadChunks: ['main.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        compilation.addAsset('main.js', 'console.log(1)');
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONAL);

        expect(compilation.updateAsset).toHaveBeenCalledWith(
          'main.js',
          expect.anything(),
          expect.objectContaining({ 'lynx:main-thread': true }),
        );
      });

      it('throws when a named main thread chunk asset is missing', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ mainThreadChunks: ['missing.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        triggerCompilation(compilation);

        expect(() =>
          compilation.triggerProcessAssets(STAGE_ADDITIONAL),
        ).toThrow();
      });

      it('marks non-initial main-thread layer chunk group files', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('lazy.js', 'lazy code');

        // Non-initial chunk group whose origins all come from the main thread layer
        compilation.chunkGroups = [
          {
            isInitial: () => false,
            origins: [{ module: { layer: 'main' } }],
            getFiles: () => ['lazy.js'],
          },
        ];
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONAL);

        expect(compilation.updateAsset).toHaveBeenCalledWith(
          'lazy.js',
          expect.anything(),
          expect.objectContaining({ 'lynx:main-thread': true }),
        );
      });

      it('ignores initial chunk groups', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.chunkGroups = [
          {
            isInitial: () => true,
            origins: [{ module: { layer: 'main' } }],
            getFiles: () => ['initial.js'],
          },
        ];
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONAL);

        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });

      it('ignores chunk groups with background-layer origins', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.chunkGroups = [
          {
            isInitial: () => false,
            origins: [{ module: { layer: 'background' } }],
            getFiles: () => ['bg.js'],
          },
        ];
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONAL);

        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });

      it('ignores non-JS files in chunk groups', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.chunkGroups = [
          {
            isInitial: () => false,
            origins: [{ module: { layer: 'main' } }],
            getFiles: () => ['style.css', 'image.png'],
          },
        ];
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONAL);

        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });

      it('ignores chunk groups with mixed main-thread and background-layer origins', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('mixed.js', 'mixed code');
        compilation.chunkGroups = [
          {
            isInitial: () => false,
            origins: [
              { module: { layer: 'main' } },
              { module: { layer: 'background' } },
            ],
            getFiles: () => ['mixed.js'],
          },
        ];
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONAL);

        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });

      it('ignores chunk groups where an origin has no module', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('nullmod.js', 'code');
        compilation.chunkGroups = [
          {
            isInitial: () => false,
            origins: [{ module: { layer: 'main' } }, { module: null }],
            getFiles: () => ['nullmod.js'],
          },
        ];
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONAL);

        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });
    });

    describe('processAssets ADDITIONS stage — thread globals', () => {
      const STAGE_ADDITIONS = -100;

      it('prepends __MAIN_THREAD__=true for named main thread assets', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ mainThreadChunks: ['main.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        compilation.addAsset('main.js', 'code();');
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONS);

        const asset = compilation.assets['main.js'];
        expect(asset.source.source()).toContain(
          'globalThis["__MAIN_THREAD__"]=true;',
        );
      });

      it('prepends __MAIN_THREAD__=false for non-main-thread assets', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ mainThreadChunks: ['main.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        compilation.addAsset('bg.js', 'background();');
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONS);

        const asset = compilation.assets['bg.js'];
        expect(asset.source.source()).toContain(
          'globalThis["__MAIN_THREAD__"]=false;',
        );
      });

      it('skips non-JS assets', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('styles.css', '.foo { color: red; }');
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONS);

        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });

      it('injects globDynamicComponentEntry into main thread chunks', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ mainThreadChunks: ['main.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        compilation.addAsset('main.js', 'code();');
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONS);

        const finalSource = compilation.assets['main.js'].source.source();
        expect(finalSource).toContain('globDynamicComponentEntry');
        expect(finalSource).toContain("'__Card__'");
      });

      it('does not inject globDynamicComponentEntry when experimental_isLazyBundle is true', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({
          mainThreadChunks: ['main.js'],
          experimental_isLazyBundle: true,
        }).apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('main.js', 'code();');
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONS);

        // updateAsset called once for __MAIN_THREAD__ only, not for globDynamicComponentEntry
        const callsForMain = vi
          .mocked(compilation.updateAsset)
          .mock.calls.filter(([name]) => name === 'main.js');
        expect(callsForMain).toHaveLength(1);
      });

      it('does not inject globDynamicComponentEntry into background chunks', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ mainThreadChunks: ['main.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        compilation.addAsset('bg.js', 'background();');
        triggerCompilation(compilation);

        compilation.triggerProcessAssets(STAGE_ADDITIONS);

        const finalSource = compilation.assets['bg.js'].source.source();
        expect(finalSource).not.toContain('globDynamicComponentEntry');
      });

      it('handles missing main thread chunk asset gracefully', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        // mainThreadChunks names a chunk but no asset with that name is added
        new AngularWebpackPlugin({ mainThreadChunks: ['missing.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        triggerCompilation(compilation);

        // Should not throw — uses `if (!asset) continue`
        expect(() =>
          compilation.triggerProcessAssets(STAGE_ADDITIONS),
        ).not.toThrow();
      });

      it('includes "use strict" prefix when injecting globDynamicComponentEntry into a source starting with "use strict"', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        setupBeforeEncodeHook();

        new AngularWebpackPlugin({ mainThreadChunks: ['main.js'] }).apply(
          compiler as never,
        );
        const compilation = createMockCompilation();
        compilation.addAsset('main.js', "'use strict';code();");

        // Override getAsset to isolate the useStrictPrefix regex branch.
        // The __MAIN_THREAD__ loop uses Object.entries(compilation.assets),
        // not getAsset, so this override only affects the globDynamicComponentEntry loop.
        vi.mocked(compilation.getAsset).mockReturnValue({
          name: 'main.js',
          source: mockSource("'use strict';code();"),
          info: {},
        } as never);

        triggerCompilation(compilation);
        compilation.triggerProcessAssets(STAGE_ADDITIONS);

        const mainCalls = vi
          .mocked(compilation.updateAsset)
          .mock.calls.filter(([name]) => name === 'main.js');
        const globDynCall = mainCalls[1];
        expect(globDynCall).toBeDefined();

        const updater = globDynCall[1] as (old: { source(): string }) => {
          source(): string;
        };
        const result = updater(mockSource("'use strict';code();"));
        expect(result.source()).toContain(
          "'use strict';var globDynamicComponentEntry",
        );
      });
    });

    describe('beforeEncode hook', () => {
      it('wraps lepus root asset with module.exports IIFE', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        const triggerBeforeEncode = setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('main-thread.js', 'template code');
        triggerCompilation(compilation);

        triggerBeforeEncode({
          encodeData: {
            lepusCode: { root: { name: 'main-thread.js' } },
            sourceContent: { appType: 'card2' },
          },
        });

        const finalSource =
          compilation.assets['main-thread.js'].source.source();
        expect(finalSource).toContain('module.exports');
        expect(finalSource).toContain('globDynamicComponentEntry');
        expect(finalSource).toContain('return module.exports');
      });

      it('returns args unchanged when lepusCode.root is null', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        const triggerBeforeEncode = setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        triggerCompilation(compilation);

        const args = {
          encodeData: {
            lepusCode: { root: null },
            sourceContent: { appType: 'card2' },
          },
        };

        const result = triggerBeforeEncode(args);

        expect(result).toBe(args);
        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });

      it('returns args unchanged when appType is "card"', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        const triggerBeforeEncode = setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('main-thread.js', 'template code');
        triggerCompilation(compilation);

        const args = {
          encodeData: {
            lepusCode: { root: { name: 'main-thread.js' } },
            sourceContent: { appType: 'card' },
          },
        };

        const result = triggerBeforeEncode(args);

        expect(result).toBe(args);
        expect(compilation.updateAsset).not.toHaveBeenCalled();
      });

      it('returns args after wrapping non-card templates', () => {
        const { compiler, triggerCompilation } = createMockCompiler();
        const triggerBeforeEncode = setupBeforeEncodeHook();

        new AngularWebpackPlugin().apply(compiler as never);
        const compilation = createMockCompilation();
        compilation.addAsset('main-thread.js', 'template code');
        triggerCompilation(compilation);

        const args = {
          encodeData: {
            lepusCode: { root: { name: 'main-thread.js' } },
            sourceContent: { appType: 'card2' },
          },
        };

        const result = triggerBeforeEncode(args);

        expect(result).toBe(args);
      });
    });
  });
});
