import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/angular/find-up.js', () => ({
  findUp: vi.fn(),
}));

vi.mock('rsbuild-plugin-tailwindcss', () => ({
  pluginTailwindCSS: vi.fn(),
}));

import { findUp } from './utils/angular/find-up.js';
import { pluginTailwindCSS } from 'rsbuild-plugin-tailwindcss';
import { applyTailwind } from './tailwind';

const mockedFindUp = vi.mocked(findUp);
const mockedPluginTailwindCSS = vi.mocked(pluginTailwindCSS);

describe('applyTailwind', () => {
  const mockApi = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls findUp with tailwind config filenames and process.cwd()', () => {
    mockedFindUp.mockReturnValue(null);

    applyTailwind(mockApi);

    expect(mockedFindUp).toHaveBeenCalledWith(
      [
        'tailwind.config.ts',
        'tailwind.config.js',
        'tailwind.config.mjs',
        'tailwind.config.cjs',
      ],
      process.cwd(),
    );
  });

  it('does not call pluginTailwindCSS when no config file is found', () => {
    mockedFindUp.mockReturnValue(null);

    applyTailwind(mockApi);

    expect(mockedPluginTailwindCSS).not.toHaveBeenCalled();
  });

  it('calls pluginTailwindCSS with config path when config is found', () => {
    const configPath = '/project/tailwind.config.ts';
    const mockSetup = vi.fn();
    mockedFindUp.mockReturnValue(configPath);
    mockedPluginTailwindCSS.mockReturnValue({ setup: mockSetup } as any);

    applyTailwind(mockApi);

    expect(mockedPluginTailwindCSS).toHaveBeenCalledWith({
      config: configPath,
      exclude: [/[\\/]node_modules[\\/]/],
    });
  });

  it('calls setup(api) on the returned plugin', () => {
    const mockSetup = vi.fn();
    mockedFindUp.mockReturnValue('/project/tailwind.config.js');
    mockedPluginTailwindCSS.mockReturnValue({ setup: mockSetup } as any);

    applyTailwind(mockApi);

    expect(mockSetup).toHaveBeenCalledWith(mockApi);
  });

  it('exclude regex matches node_modules paths with forward slashes', () => {
    const mockSetup = vi.fn();
    mockedFindUp.mockReturnValue('/project/tailwind.config.ts');
    mockedPluginTailwindCSS.mockReturnValue({ setup: mockSetup } as any);

    applyTailwind(mockApi);

    const excludePattern = (
      mockedPluginTailwindCSS.mock.calls[0]![0]!.exclude as RegExp[]
    )[0];
    expect(excludePattern.test('/foo/node_modules/bar')).toBe(true);
    expect(excludePattern.test('\\foo\\node_modules\\bar')).toBe(true);
    expect(excludePattern.test('/foo/src/bar')).toBe(false);
  });
});
