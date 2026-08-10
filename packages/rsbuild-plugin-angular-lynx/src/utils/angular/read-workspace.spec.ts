import { describe, expect, it, vi } from 'vitest';
import { getProjectByCwd } from './read-workspace';

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
