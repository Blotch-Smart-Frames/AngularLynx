import { describe, expect, it } from 'vitest';
import {
  ANGULAR_CLI_CONTEXT_PLUGIN_NAME,
  type AngularCliContext,
  getAngularCliContext,
  pluginAngularCliContext,
} from './angular-cli-context';

/**
 * Rsbuild's expose / useExposed, shared by every plugin of one build.
 */
const fakeApi = () => {
  const exposed = new Map<string | symbol, unknown>();
  return {
    expose: (id: string | symbol, value: unknown) => exposed.set(id, value),
    useExposed: (id: string | symbol) => exposed.get(id),
  } as any;
};

const context: AngularCliContext = {
  workspaceRoot: '/workspace',
  project: 'my-app',
  buildOptions: { browser: 'src/main.ts', tsConfig: 'tsconfig.app.json' },
};

describe('pluginAngularCliContext', () => {
  it('sets up before the other plugins', () => {
    const plugin = pluginAngularCliContext(context);

    expect(plugin.name).toBe(ANGULAR_CLI_CONTEXT_PLUGIN_NAME);
    expect(plugin.enforce).toBe('pre');
  });

  it('hands the context to the plugin that compiles Angular', async () => {
    const api = fakeApi();

    await pluginAngularCliContext(context).setup(api);

    expect(getAngularCliContext(api)).toBe(context);
  });

  it('finds no context under plain rspeedy', () => {
    expect(getAngularCliContext(fakeApi())).toBeUndefined();
  });
});
