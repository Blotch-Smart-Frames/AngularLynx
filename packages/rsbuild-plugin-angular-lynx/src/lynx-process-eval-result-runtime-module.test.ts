import { describe, expect, it } from 'vitest';
import { createLynxProcessEvalResultRuntimeModule } from './lynx-process-eval-result-runtime-module';

const STAGE_ATTACH = 10;

const createMockWebpack = () => {
  class MockRuntimeModule {
    name: string;
    stage: number;
    // Populated by webpack at runtime; assigned directly in tests to drive generate().
    chunk: any;
    compilation: any;

    constructor(name: string, stage: number) {
      this.name = name;
      this.stage = stage;
    }
  }

  return {
    RuntimeModule: Object.assign(MockRuntimeModule, {
      STAGE_ATTACH,
    }),
    RuntimeGlobals: {
      externalInstallChunk: '__webpack_require__.externalInstallChunk',
      require: '__webpack_require__',
    },
  } as any;
};

describe('createLynxProcessEvalResultRuntimeModule', () => {
  it('returns a class that extends the provided RuntimeModule', () => {
    const webpack = createMockWebpack();
    const ModuleClass = createLynxProcessEvalResultRuntimeModule(webpack);

    const instance = new ModuleClass();
    expect(instance).toBeInstanceOf(webpack.RuntimeModule);
  });

  it('constructor sets name and stage', () => {
    const webpack = createMockWebpack();
    const ModuleClass = createLynxProcessEvalResultRuntimeModule(webpack);

    const instance = new ModuleClass();

    expect(instance.name).toBe('Lynx process eval result');
    expect(instance.stage).toBe(STAGE_ATTACH);
  });

  describe('generate()', () => {
    it('returns an empty string when the chunk is missing', () => {
      const webpack = createMockWebpack();
      const ModuleClass = createLynxProcessEvalResultRuntimeModule(webpack);
      const instance = new ModuleClass() as any;

      instance.chunk = undefined;
      instance.compilation = {};

      expect(instance.generate()).toBe('');
    });

    it('returns an empty string when the compilation is missing', () => {
      const webpack = createMockWebpack();
      const ModuleClass = createLynxProcessEvalResultRuntimeModule(webpack);
      const instance = new ModuleClass() as any;

      instance.chunk = {};
      instance.compilation = undefined;

      expect(instance.generate()).toBe('');
    });

    it('emits the runtime, ordering modules by pre-order index and dropping null ids', () => {
      const webpack = createMockWebpack();
      const ModuleClass = createLynxProcessEvalResultRuntimeModule(webpack);
      const instance = new ModuleClass() as any;

      const moduleA = { id: 'a' };
      const moduleB = { id: 'b' };
      const moduleC = { id: 'c' }; // getModuleId returns null → filtered out

      // chunkGroup drives the pre-order sort; B comes before A.
      const chunkGroup = {
        getModulePreOrderIndex: (m: unknown) => (m === moduleB ? 0 : 1),
      };
      instance.chunk = { _groupsIterable: [chunkGroup] };
      instance.compilation = {
        chunkGraph: {
          // Deliberately out of order to prove the sort runs.
          getChunkModules: () => [moduleA, moduleB, moduleC],
          getModuleId: (m: unknown) =>
            m === moduleC ? null : (m as { id: string }).id,
        },
      };

      const code = instance.generate();

      // lynxProcessEvalResult assignment is present with the sorted, filtered ids.
      expect(code).toContain('var moduleOrder = ["b","a"];');
      expect(code).toContain(
        '__webpack_require__.externalInstallChunk(chunk);',
      );
      expect(code).toContain('__webpack_require__(moduleOrder[i]);');
      // The null-id module is excluded from the order array.
      expect(code).not.toContain('"c"');
    });

    it('falls back to defaults when the chunk group and chunk modules are absent', () => {
      const webpack = createMockWebpack();
      const ModuleClass = createLynxProcessEvalResultRuntimeModule(webpack);
      const instance = new ModuleClass() as any;

      // No _groupsIterable (chunkGroup undefined → getModulePreOrderIndex ?? 0)
      // and chunkGraph.getChunkModules returns undefined (→ ?? []).
      instance.chunk = { _groupsIterable: undefined };
      instance.compilation = {
        chunkGraph: {
          getChunkModules: () => undefined,
          getModuleId: () => null,
        },
      };

      const codeEmpty = instance.generate();
      expect(codeEmpty).toContain('var moduleOrder = [];');

      // Also exercise the `?? 0` fallback when chunkGroup exists but returns
      // undefined for getModulePreOrderIndex (distinct branch from the outer
      // optional-chain on chunkGroup itself). Both modules coerce to 0 and the
      // original array order is preserved.
      const moduleA = { id: 'a' };
      const moduleB = { id: 'b' };
      instance.chunk = {
        _groupsIterable: [{ getModulePreOrderIndex: () => undefined }],
      };
      instance.compilation = {
        chunkGraph: {
          getChunkModules: () => [moduleA, moduleB],
          getModuleId: (m: unknown) => (m as { id: string }).id,
        },
      };

      const code = instance.generate();

      expect(code).toContain('var moduleOrder = ["a","b"];');
    });
  });
});
