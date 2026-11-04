// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { experiments } from '@rspack/core';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { LAYERS, THIRD_PARTY, applyLayers } from './layers';

/**
 * Builds a fluent oneOf builder that tracks calls, returned by chain.module.rule().oneOf().
 */
const createOneOfBuilder = () => {
  const useBuilder = {
    loader: vi.fn().mockReturnThis(),
    options: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };

  const excludeBuilder = {
    add: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };

  const builder = {
    issuerLayer: vi.fn().mockReturnThis(),
    test: vi.fn().mockReturnThis(),
    exclude: excludeBuilder,
    use: vi.fn().mockReturnValue(useBuilder),
    _use: useBuilder,
  };

  // .end() on the use and exclude builders navigates back up to the oneOf
  // builder
  useBuilder.end.mockReturnValue(builder);
  excludeBuilder.end.mockReturnValue(builder);

  return builder;
};

/**
 * Builds a mock bundler chain that tracks per-layer rule builders. `get` and
 * `experiments` exist only so tests can assert they are never used.
 */
const createMockChain = () => {
  const oneOfBuilders: Record<
    string,
    ReturnType<typeof createOneOfBuilder>
  > = {};

  const chain = {
    get: vi.fn(),
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

  it('does not touch experiments (layers are always-on in Rspack 2)', () => {
    const { api, triggerHandler } = createMockApi();
    const { chain } = createMockChain();

    applyLayers(api as never);
    triggerHandler(chain);

    // Rspack 2 removed `experiments.layers`; setting it would be rejected.
    expect(chain.experiments).not.toHaveBeenCalled();
    expect(chain.get).not.toHaveBeenCalled();
  });

  describe('background layer rule', () => {
    // Matching on the importer's layer keeps each module in its entry's
    // layer. Setting the layer here put every module in the first branch's.
    it('matches modules imported from LAYERS.BACKGROUND', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.BACKGROUND).issuerLayer).toHaveBeenCalledWith(
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

    it('targets ES2015 for Lynx bytecode compatibility and sets __MAIN_THREAD__ to false, compiling first-party private fields to properties', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.BACKGROUND).exclude.add).toHaveBeenCalledWith(
        THIRD_PARTY,
      );
      expect(getOneOf(LAYERS.BACKGROUND)._use.options).toHaveBeenCalledWith({
        jsc: {
          target: 'es2015',
          assumptions: { privateFieldsAsProperties: true },
          parser: { syntax: 'typescript' },
          transform: {
            optimizer: {
              simplify: false,
              globals: { vars: { __MAIN_THREAD__: 'false' } },
            },
          },
        },
      });
    });

    it("compiles other packages' modules as before, after the first-party branch", () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      const thirdParty = getOneOf(`${LAYERS.BACKGROUND}-third-party`);
      expect(thirdParty.issuerLayer).toHaveBeenCalledWith(LAYERS.BACKGROUND);
      expect(thirdParty.test).toHaveBeenCalledWith(/\.[cm]?[jt]sx?$/);
      expect(thirdParty.exclude.add).not.toHaveBeenCalled();
      expect(thirdParty._use.options).toHaveBeenCalledWith({
        jsc: {
          target: 'es2015',
          parser: { syntax: 'typescript' },
          transform: {
            optimizer: {
              simplify: false,
              globals: { vars: { __MAIN_THREAD__: 'false' } },
            },
          },
        },
      });
      // oneOf takes the first branch that matches.
      const names =
        chain.module.rule.mock.results[0]!.value.oneOf.mock.calls.map(
          ([name]: [string]) => name,
        );
      expect(names.indexOf(LAYERS.BACKGROUND)).toBeLessThan(
        names.indexOf(`${LAYERS.BACKGROUND}-third-party`),
      );
    });
  });

  describe('main-thread layer rule', () => {
    // Matching on the importer's layer keeps each module in its entry's
    // layer. Setting the layer here put every module in the first branch's.
    it('matches modules imported from LAYERS.MAIN_THREAD', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.MAIN_THREAD).issuerLayer).toHaveBeenCalledWith(
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

    it('targets ES2019 for Lynx bytecode compatibility and sets __MAIN_THREAD__ to true, compiling first-party private fields to properties', () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      expect(getOneOf(LAYERS.MAIN_THREAD).exclude.add).toHaveBeenCalledWith(
        THIRD_PARTY,
      );
      expect(getOneOf(LAYERS.MAIN_THREAD)._use.options).toHaveBeenCalledWith({
        jsc: {
          target: 'es2019',
          assumptions: { privateFieldsAsProperties: true },
          parser: { syntax: 'typescript' },
          transform: {
            optimizer: {
              simplify: false,
              globals: { vars: { __MAIN_THREAD__: 'true' } },
            },
          },
        },
      });
    });

    it("compiles other packages' modules as before, after the first-party branch", () => {
      const { api, triggerHandler } = createMockApi();
      const { chain, getOneOf } = createMockChain();

      applyLayers(api as never);
      triggerHandler(chain);

      const thirdParty = getOneOf(`${LAYERS.MAIN_THREAD}-third-party`);
      expect(thirdParty.issuerLayer).toHaveBeenCalledWith(LAYERS.MAIN_THREAD);
      expect(thirdParty.test).toHaveBeenCalledWith(/\.[cm]?[jt]sx?$/);
      expect(thirdParty.exclude.add).not.toHaveBeenCalled();
      expect(thirdParty._use.options).toHaveBeenCalledWith({
        jsc: {
          target: 'es2019',
          parser: { syntax: 'typescript' },
          transform: {
            optimizer: {
              simplify: false,
              globals: { vars: { __MAIN_THREAD__: 'true' } },
            },
          },
        },
      });
      // oneOf takes the first branch that matches.
      const names =
        chain.module.rule.mock.results[0]!.value.oneOf.mock.calls.map(
          ([name]: [string]) => name,
        );
      expect(names.indexOf(LAYERS.MAIN_THREAD)).toBeLessThan(
        names.indexOf(`${LAYERS.MAIN_THREAD}-third-party`),
      );
    });
  });
});

describe('THIRD_PARTY', () => {
  it.each([
    '/app/node_modules/rxjs/dist/esm/index.js',
    '/app/node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs/dist/esm/index.js',
    'C:\\app\\node_modules\\three\\build\\three.module.js',
    '/app/node_modules/@blotch/angular-lynx/node_modules/some-dep/index.js',
  ])('matches another package: %s', (path) => {
    expect(THIRD_PARTY.test(path)).toBe(true);
  });

  it.each([
    '/app/src/app/app.ts',
    '/app/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
    '/app/node_modules/.pnpm/@blotch+angular-lynx@22.2.10/node_modules/@blotch/angular-lynx/fesm2022/blotch-angular-lynx.mjs',
    'C:\\app\\node_modules\\@blotch\\ui\\index.mjs',
    '/repo/packages/runtime/dist/fesm2022/blotch-angular-lynx.mjs',
  ])("doesn't match the app or AngularLynx's packages: %s", (path) => {
    expect(THIRD_PARTY.test(path)).toBe(false);
  });
});

describe("the first-party branch's compile", () => {
  /**
   * SWC's output for `source` with the options the branch passes.
   */
  const compile = (source: string, firstParty: boolean): string => {
    const { api, triggerHandler } = createMockApi();
    const { chain, getOneOf } = createMockChain();
    applyLayers(api as never);
    triggerHandler(chain);
    const branch = firstParty
      ? LAYERS.MAIN_THREAD
      : `${LAYERS.MAIN_THREAD}-third-party`;
    const [options] = getOneOf(branch)._use.options.mock.calls[0]!;
    return experiments.swc.transformSync(source, options).code;
  };

  const source = `
    class Node {
      static #count = 0;
      #parent = null;
      #children = [];
      constructor() { Node.#count++; }
      append(child) { child.#parent = this; this.#children.push(child); }
      #describe() { return this.#children.length + ':' + (this.#parent ? 1 : 0); }
      get summary() { return this.#describe(); }
      static get count() { return Node.#count; }
    }
    const root = new Node();
    const child = new Node();
    root.append(child);
    [root.summary, child.summary, Node.count, Object.keys(root).length];
  `;

  it('keeps no WeakMap per private field, and the fields still work', () => {
    const code = compile(source, true);

    expect(code).not.toContain('WeakMap');
    // Non-enumerable, as private fields aren't listed.
    expect(runInNewContext(code)).toEqual(['1:0', '0:1', 2, 0]);
  });

  it("compiles other packages' private fields to WeakMaps, as before", () => {
    const code = compile(source, false);

    expect(code).toContain('new WeakMap');
    expect(runInNewContext(code)).toEqual(['1:0', '0:1', 2, 0]);
  });
});
