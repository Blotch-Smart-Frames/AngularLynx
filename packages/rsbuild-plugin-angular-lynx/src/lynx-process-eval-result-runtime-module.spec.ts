import { describe, expect, it } from 'vitest';
import { createLynxProcessEvalResultRuntimeModule } from './lynx-process-eval-result-runtime-module';

const STAGE_ATTACH = 10;

const createMockWebpack = () => {
  class MockRuntimeModule {
    name: string;
    stage: number;

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
});
