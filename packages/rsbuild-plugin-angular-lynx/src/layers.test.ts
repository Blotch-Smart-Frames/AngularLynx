// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { describe, expect, it, vi } from 'vitest';
import { LAYERS, applyLayers } from './layers';

/**
 * Builds a fluent oneOf builder that tracks calls, returned by chain.module.rule().oneOf().
 */
const createOneOfBuilder = () => {
  const useBuilder = {
    loader: vi.fn().mockReturnThis(),
    options: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };

  const builder = {
    layer: vi.fn().mockReturnThis(),
    test: vi.fn().mockReturnThis(),
    use: vi.fn().mockReturnValue(useBuilder),
    _use: useBuilder,
  };

  // .end() on the use builder navigates back up to the oneOf builder
  useBuilder.end.mockReturnValue(builder);

  return builder;
};

/**
 * Builds a mock bundler chain that tracks experiments and per-layer rule builders.
 */
const createMockChain = (existingExperiments: Record<string, unknown> = {}) => {
  const oneOfBuilders: Record<
    string,
    ReturnType<typeof createOneOfBuilder>
  > = {};

  const chain = {
    get: vi.fn().mockReturnValue(existingExperiments),
    experiments: vi.fn(),
    module: {
      rule: vi.fn().mockReturnValue({
        oneOf: vi.fn((name: string) => {
          const builder = createOneOfBuilder();
          oneOfBuilders[name] = builder;
          return builder;
        }),
      }),
    },
  };

  return {
    chain,
    getOneOf: (name: string) => oneOfBuilders[name],
  };
};

/**
 * Builds a mock RsbuildPluginAPI and captures the handler passed to modifyBundlerChain.
 */
const createMockApi = () => {
  let capturedHandler: ((chain: unknown) => void) | undefined;

  const api = {
    modifyBundlerChain: vi.fn((handler: (chain: unknown) => void) => {
      capturedHandler = handler;
    }),
  };

  return {
    api,
    triggerHandler: (chain: unknown) => {
      if (!capturedHandler) throw new Error('handler not registered');
      capturedHandler(chain);
    },
  };
};

describe('LAYERS', () => {
  it('BACKGROUND is "background"', () => {
    expect(LAYERS.BACKGROUND).toBe('background');
  });

  it('MAIN_THREAD is "main"', () => {
    expect(LAYERS.MAIN_THREAD).toBe('main');
  });
});

describe('applyLayers', () => {
  it('registers a modifyBundlerChain handler', () => {
    const { api } = createMockApi();

    applyLayers(api as never);

    expect(api.modifyBundlerChain).toHaveBeenCalledOnce();
  });

  it('enables the webpack layers experiment', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain } = createMockChain();

    applyLayers(api as never);
    triggerHandler(chain);

    expect(chain.experiments).toHaveBeenCalledWith(
      expect.objectContaining({ layers: true }),
    );
  });

  it('preserves existing experiments when enabling layers', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain } = createMockChain({
      outputModule: true,
      cacheUnaffected: true,
    });

    applyLayers(api as never);
    triggerHandler(chain);

    expect(chain.experiments).toHaveBeenCalledWith(
      expect.objectContaining({
        outputModule: true,
        cacheUnaffected: true,
        layers: true,
      }),
    );
  });

  describe('background layer rule', () => {
    it('sets layer to LAYERS.BACKGROUND', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.BACKGROUND).layer).toHaveBeenCalledWith(
        LAYERS.BACKGROUND,
      );
    });

    it('sets test to match JS/TS files', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.BACKGROUND).test).toHaveBeenCalledWith(
        /\.[cm]?[jt]sx?$/,
      );
    });

    it('uses builtin:swc-loader', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.BACKGROUND).use).toHaveBeenCalledWith(
        'builtin:swc-loader',
      );
    });

    it('sets loader to builtin:swc-loader', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.BACKGROUND)._use.loader).toHaveBeenCalledWith(
        'builtin:swc-loader',
      );
    });

    it('targets ES2015 for Lynx bytecode compatibility', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.BACKGROUND)._use.options).toHaveBeenCalledWith({
        jsc: {
          target: 'es2015',
          parser: { syntax: 'typescript' },
        },
      });
    });
  });

  describe('main-thread layer rule', () => {
    it('sets layer to LAYERS.MAIN_THREAD', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.MAIN_THREAD).layer).toHaveBeenCalledWith(
        LAYERS.MAIN_THREAD,
      );
    });

    it('sets test to match JS/TS files', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.MAIN_THREAD).test).toHaveBeenCalledWith(
        /\.[cm]?[jt]sx?$/,
      );
    });

    it('uses builtin:swc-loader', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.MAIN_THREAD).use).toHaveBeenCalledWith(
        'builtin:swc-loader',
      );
    });

    it('sets loader to builtin:swc-loader', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.MAIN_THREAD)._use.loader).toHaveBeenCalledWith(
        'builtin:swc-loader',
      );
    });

    it('targets ES2019 for Lynx bytecode compatibility', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.MAIN_THREAD)._use.options).toHaveBeenCalledWith({
        jsc: {
          target: 'es2019',
          parser: { syntax: 'typescript' },
        },
      });
    });
  });
});
