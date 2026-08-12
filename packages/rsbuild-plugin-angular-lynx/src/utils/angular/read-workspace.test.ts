import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAngularWorkspace, getProjectByCwd } from './read-workspace';

const createWorkspace = (projects: Record<string, { root: string }>): any => ({
  projects: new Map(Object.entries(projects).map(([name, def]) => [name, def])),
});

describe('getProjectByCwd', () => {
  it('single project returns that project name regardless of cwd', () => {
    const workspace = createWorkspace({
      'my-app': { root: 'projects/my-app' },
    });

    const result = getProjectByCwd(workspace, '/workspace');

    expect(result).toBe('my-app');
  });

  it('multiple projects, cwd inside one returns matching project', () => {
    const cwd = '/workspace/projects/app-a/src';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const workspace = createWorkspace({
      'app-a': { root: 'projects/app-a' },
      'app-b': { root: 'projects/app-b' },
    });

    const result = getProjectByCwd(workspace, '/workspace');

    expect(result).toBe('app-a');

    vi.restoreAllMocks();
  });

  it('multiple projects with same root returns null (ambiguous)', () => {
    const cwd = '/workspace/projects/shared';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const workspace = createWorkspace({
      'app-a': { root: 'projects/shared' },
      'app-b': { root: 'projects/shared' },
    });

    const result = getProjectByCwd(workspace, '/workspace');

    expect(result).toBeNull();

    vi.restoreAllMocks();
  });

  it('multiple projects, cwd outside all returns null', () => {
    const cwd = '/completely/different/path';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const workspace = createWorkspace({
      'app-a': { root: 'projects/app-a' },
      'app-b': { root: 'projects/app-b' },
    });

    const result = getProjectByCwd(workspace, '/workspace');

    expect(result).toBeNull();

    vi.restoreAllMocks();
  });

  it('deeper nested project wins over shallow one', () => {
    const cwd = '/workspace/projects/app-a/deep/nested';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const workspace = createWorkspace({
      parent: { root: 'projects' },
      nested: { root: 'projects/app-a' },
    });

    const result = getProjectByCwd(workspace, '/workspace');

    expect(result).toBe('nested');

    vi.restoreAllMocks();
  });
});

describe('getAngularWorkspace', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads angular.json found by walking up from cwd', async () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'angular-lynx-ws-'));
    // Nest cwd a couple levels down so findUp has to climb to reach angular.json.
    const nested = nodePath.join(root, 'src', 'app');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      nodePath.join(root, 'angular.json'),
      JSON.stringify({
        version: 1,
        projects: {
          demo: {
            projectType: 'application',
            root: '',
            sourceRoot: 'src',
            architect: {
              build: {
                builder: '@angular/build:application',
                options: {
                  browser: 'src/main.ts',
                  tsConfig: 'tsconfig.app.json',
                  index: 'src/index.html',
                },
              },
            },
          },
        },
      }),
    );

    vi.spyOn(process, 'cwd').mockReturnValue(nested);

    try {
      const { basePath, workspace } = await getAngularWorkspace();

      // basePath is path.dirname() of the located angular.json (the tmp root).
      expect(basePath).toBe(root);
      expect(workspace.projects.has('demo')).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws when no workspace file exists above cwd', async () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'angular-lynx-nows-'));
    // A fresh tmp dir with no angular.json anywhere up the tree.
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    try {
      await expect(getAngularWorkspace()).rejects.toThrow(
        "couldn't find workspace file",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
