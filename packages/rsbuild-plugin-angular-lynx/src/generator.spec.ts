// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { describe, expect, it, vi } from 'vitest';
import { applyGenerator } from './generator';
import { LAYERS } from './layers';

/**
 * Builds a mock webpack chain with a fluent rule builder and captures the rule name.
 */
const createMockChain = () => {
  let capturedRuleName: string | undefined;

  const ruleBuilder = {
    issuerLayer: vi.fn().mockReturnThis(),
    test: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    generator: vi.fn().mockReturnThis(),
  };

  const chain = {
    module: {
      rule: vi.fn((name: string) => {
        capturedRuleName = name;
        return ruleBuilder;
      }),
    },
  };

  return { chain, ruleBuilder, getRuleName: () => capturedRuleName };
};

/**
 * Builds a mock RsbuildPluginAPI and captures the handler passed to modifyBundlerChain.
 */
const createMockApi = () => {
  let capturedOrder: string | undefined;
  let capturedHandler: ((chain: unknown) => void) | undefined;

  const api = {
    modifyBundlerChain: vi.fn(
      ({
        order,
        handler,
      }: {
        order: string;
        handler: (chain: unknown) => void;
      }) => {
        capturedOrder = order;
        capturedHandler = handler;
      },
    ),
  };

  return {
    api,
    triggerHandler: (chain: unknown) => {
      if (!capturedHandler) throw new Error('handler not registered');
      capturedHandler(chain);
    },
    getOrder: () => capturedOrder,
  };
};

describe('applyGenerator', () => {
  it('registers modifyBundlerChain with order "pre"', () => {
    const { api } = createMockApi();

    applyGenerator(api as never);

    expect(api.modifyBundlerChain).toHaveBeenCalledWith(
      expect.objectContaining({ order: 'pre' }),
    );
  });

  it('creates a rule named "json-parse:<MAIN_THREAD_LAYER>"', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain, getRuleName } = createMockChain();

    applyGenerator(api as never);
    triggerHandler(chain);

    expect(getRuleName()).toBe(`json-parse:${LAYERS.MAIN_THREAD}`);
  });

  it('sets issuerLayer to LAYERS.MAIN_THREAD', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain, ruleBuilder } = createMockChain();

    applyGenerator(api as never);
    triggerHandler(chain);

    expect(ruleBuilder.issuerLayer).toHaveBeenCalledWith(LAYERS.MAIN_THREAD);
  });

  it('sets test to match .json files', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain, ruleBuilder } = createMockChain();

    applyGenerator(api as never);
    triggerHandler(chain);

    expect(ruleBuilder.test).toHaveBeenCalledWith(/\.json$/);
  });

  it('sets type to "json"', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain, ruleBuilder } = createMockChain();

    applyGenerator(api as never);
    triggerHandler(chain);

    expect(ruleBuilder.type).toHaveBeenCalledWith('json');
  });

  it('disables JSONParse in the generator to avoid JSON.parse() in bundles', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain, ruleBuilder } = createMockChain();

    applyGenerator(api as never);
    triggerHandler(chain);

    expect(ruleBuilder.generator).toHaveBeenCalledWith({ JSONParse: false });
  });
});
