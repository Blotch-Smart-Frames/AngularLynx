import nodePath from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AngularCliContext } from '../../angular-cli-context';
import { resolvePrimaryBuild } from './resolve-primary-build';

const basePath = '/workspace';

/**
 * An angular.json project whose build target compiles `browser`.
 */
const project = (
  browser: string,
  { projectType = 'application', root = '' } = {},
): any => ({
  root,
  extensions: { projectType },
  targets: new Map([
    [
      'build',
      {
        options: { browser, tsConfig: 'tsconfig.app.json' },
        configurations: { development: { aot: false } },
        defaultConfiguration: 'development',
      },
    ],
  ]),
});

const workspace = (projects: Record<string, any>): any => ({
  projects: new Map(Object.entries(projects)),
});

const cli = (
  name: string,
  buildOptions: Record<string, unknown> = {},
): AngularCliContext => ({
  workspaceRoot: basePath,
  project: name,
  buildOptions: {
    browser: `src/${name}.ts`,
    tsConfig: 'tsconfig.app.json',
    ...buildOptions,
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolvePrimaryBuild', () => {
  it("uses the options Angular CLI resolved for the project it's building", async () => {
    const result = await resolvePrimaryBuild({
      workspace: workspace({ a: project('src/a.ts'), b: project('src/b.ts') }),
      basePath,
      pages: undefined,
      // angular.json's default configuration says aot: false; `ng build -c`
      // chose otherwise.
      cli: cli('b', { aot: true }),
    });

    expect(result.projectName).toBe('b');
    expect(result.buildOptions.browser).toBe(
      nodePath.join(basePath, 'src/b.ts'),
    );
    expect(result.buildOptions.aot).toBe(true);
  });

  it('reads angular.json for the project the working directory is in under plain rspeedy', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(nodePath.join(basePath, 'b'));

    const result = await resolvePrimaryBuild({
      workspace: workspace({
        a: project('src/a.ts', { root: 'a' }),
        b: project('src/b.ts', { root: 'b' }),
      }),
      basePath,
      pages: undefined,
      cli: undefined,
    });

    expect(result.projectName).toBe('b');
    // The target's default configuration applies.
    expect(result.buildOptions.aot).toBe(false);
  });

  it("prefers the page Angular CLI is building, with Angular CLI's options", async () => {
    const result = await resolvePrimaryBuild({
      workspace: workspace({
        lib: project('src/lib.ts', { projectType: 'library' }),
        home: project('src/home.ts'),
        settings: project('src/settings.ts'),
      }),
      basePath,
      pages: 'all',
      cli: cli('settings', { aot: true }),
    });

    expect(result.projectName).toBe('settings');
    expect(result.buildOptions.aot).toBe(true);
  });

  it('falls back to the first page, read from angular.json, when Angular CLI builds another project', async () => {
    const result = await resolvePrimaryBuild({
      workspace: workspace({
        home: project('src/home.ts'),
        settings: project('src/settings.ts'),
        other: project('src/other.ts'),
      }),
      basePath,
      pages: ['home', 'settings'],
      cli: cli('other', { aot: true }),
    });

    expect(result.projectName).toBe('home');
    expect(result.buildOptions.aot).toBe(false);
  });

  it('uses the first application project for pages: all under plain rspeedy', async () => {
    const result = await resolvePrimaryBuild({
      workspace: workspace({
        lib: project('src/lib.ts', { projectType: 'library' }),
        home: project('src/home.ts'),
      }),
      basePath,
      pages: 'all',
      cli: undefined,
    });

    expect(result.projectName).toBe('home');
  });

  it('throws when no project matches', async () => {
    await expect(
      resolvePrimaryBuild({
        workspace: workspace({
          lib: project('src/lib.ts', { projectType: 'library' }),
        }),
        basePath,
        pages: 'all',
        cli: undefined,
      }),
    ).rejects.toThrow("couldn't find the project");
  });

  it('throws when the project is missing from the workspace', async () => {
    await expect(
      resolvePrimaryBuild({
        workspace: workspace({ home: project('src/home.ts') }),
        basePath,
        pages: undefined,
        cli: cli('gone'),
      }),
    ).rejects.toThrow('Project "gone" not found in workspace');
  });
});
