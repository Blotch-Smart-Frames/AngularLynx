import { describe, expect, it } from 'vitest';
import { resolvePages } from './resolve-pages';

const makeWorkspace = (
  projects: Record<
    string,
    { projectType: string; browser?: string; tsConfig?: string }
  >,
) => {
  const projectMap = new Map<string, any>();
  for (const [name, config] of Object.entries(projects)) {
    projectMap.set(name, {
      extensions: { projectType: config.projectType },
      targets: new Map([
        [
          'build',
          {
            options: {
              browser: config.browser,
              tsConfig: config.tsConfig ?? 'tsconfig.app.json',
            },
          },
        ],
      ]),
    });
  }
  return { projects: projectMap } as any;
};

describe('resolvePages', () => {
  const basePath = '/workspace';

  it('resolves specific project names from angular.json', () => {
    const workspace = makeWorkspace({
      main: { projectType: 'application', browser: 'src/main.ts' },
      settings: {
        projectType: 'application',
        browser: 'src/pages/settings/main.ts',
      },
    });

    const pages = resolvePages(workspace, basePath, ['main', 'settings']);

    expect(pages).toEqual([
      { name: 'main', browser: '/workspace/src/main.ts' },
      {
        name: 'settings',
        browser: '/workspace/src/pages/settings/main.ts',
      },
    ]);
  });

  it('"all" finds only application-type projects', () => {
    const workspace = makeWorkspace({
      'my-app': { projectType: 'application', browser: 'src/main.ts' },
      'my-lib': { projectType: 'library', browser: 'src/public-api.ts' },
      'other-app': {
        projectType: 'application',
        browser: 'src/other/main.ts',
      },
    });

    const pages = resolvePages(workspace, basePath, 'all');

    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.name)).toEqual(['my-app', 'other-app']);
  });

  it('throws when a named project does not exist', () => {
    const workspace = makeWorkspace({
      main: { projectType: 'application', browser: 'src/main.ts' },
    });

    expect(() => resolvePages(workspace, basePath, ['missing'])).toThrow(
      'Project "missing" not found in angular.json',
    );
  });

  it('throws on empty pages array', () => {
    const workspace = makeWorkspace({});

    expect(() => resolvePages(workspace, basePath, [])).toThrow('empty array');
  });

  it('throws when "all" finds no application projects', () => {
    const workspace = makeWorkspace({
      'my-lib': { projectType: 'library', browser: 'src/public-api.ts' },
    });

    expect(() => resolvePages(workspace, basePath, 'all')).toThrow(
      'No application-type projects found',
    );
  });

  it('throws when projects have different tsconfigs', () => {
    const workspace = makeWorkspace({
      main: {
        projectType: 'application',
        browser: 'src/main.ts',
        tsConfig: 'tsconfig.app.json',
      },
      settings: {
        projectType: 'application',
        browser: 'src/settings/main.ts',
        tsConfig: 'tsconfig.settings.json',
      },
    });

    expect(() =>
      resolvePages(workspace, basePath, ['main', 'settings']),
    ).toThrow('same tsConfig');
  });

  it('allows projects with the same tsconfig', () => {
    const workspace = makeWorkspace({
      main: {
        projectType: 'application',
        browser: 'src/main.ts',
        tsConfig: 'tsconfig.app.json',
      },
      settings: {
        projectType: 'application',
        browser: 'src/settings/main.ts',
        tsConfig: 'tsconfig.app.json',
      },
    });

    const pages = resolvePages(workspace, basePath, ['main', 'settings']);
    expect(pages).toHaveLength(2);
  });

  it('throws when a project has no browser field', () => {
    const workspace = makeWorkspace({
      main: { projectType: 'application' },
    });

    expect(() => resolvePages(workspace, basePath, ['main'])).toThrow(
      'no "browser" field',
    );
  });
});
