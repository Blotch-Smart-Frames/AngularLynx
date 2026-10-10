import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AngularCompileResult,
  type FileVersion,
  createAngularRebuildCoordinator,
} from './angular-rebuild-coordinator';

const result = (
  changedOutputs: string[] = [],
  inputFiles: string[] = [],
): AngularCompileResult => ({ changedOutputs, inputFiles });

describe('createAngularRebuildCoordinator', () => {
  // Fake file versions keyed by path, so tests control what counts as a new
  // edit without touching the file system.
  let versions: Map<string, FileVersion>;
  const getFileVersion = (file: string): FileVersion =>
    versions.get(file) ?? null;

  beforeEach(() => {
    versions = new Map();
  });

  const setup = (
    compile: (
      changedFiles: ReadonlySet<string> | undefined,
    ) => Promise<AngularCompileResult>,
  ) => createAngularRebuildCoordinator({ compile, getFileVersion });

  it('runs a full compile for the first build and reports nothing to rebuild', async () => {
    const compile = vi.fn(async () => result(['/src/app.ts']));
    const coordinator = setup(compile);

    const outdated = await coordinator.prepare('lynx', []);

    expect(compile).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(outdated).toEqual(new Set());
  });

  it('shares one initial compile between concurrent environments', async () => {
    const compile = vi.fn(async () => result());
    const coordinator = setup(compile);

    await Promise.all([
      coordinator.prepare('web', []),
      coordinator.prepare('lynx', []),
    ]);

    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('never runs two compiles at the same time', async () => {
    let running = 0;
    let maxRunning = 0;
    /**
     * Holds the rebuild compile open until the test releases it.
     */
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compile = vi.fn(async (changedFiles?: ReadonlySet<string>) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      if (changedFiles?.has('/src/a.ts')) await gate;
      running--;
      return result();
    });
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    versions.set('/src/a.ts', 1);
    const first = coordinator.prepare('web', ['/src/a.ts']);
    await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(2));
    // A second edit arrives while the first rebuild is still compiling.
    versions.set('/src/b.ts', 1);
    const second = coordinator.prepare('lynx', ['/src/b.ts']);
    await Promise.resolve();
    expect(compile).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);

    expect(compile).toHaveBeenCalledTimes(3);
    expect(compile).toHaveBeenNthCalledWith(2, new Set(['/src/a.ts']));
    expect(compile).toHaveBeenNthCalledWith(3, new Set(['/src/b.ts']));
    expect(maxRunning).toBe(1);
  });

  it('compiles the changed files on a rebuild and returns the changed outputs', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(['/src/app.ts', '/src/parent.ts']));
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    versions.set('/src/app.ts', 2);
    const outdated = await coordinator.prepare('lynx', ['/src/app.ts']);

    expect(compile).toHaveBeenLastCalledWith(new Set(['/src/app.ts']));
    expect(outdated).toEqual(new Set(['/src/app.ts', '/src/parent.ts']));
  });

  it('compiles once when two environments report the same edit, and gives both the outputs', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(['/src/app.ts']));
    const coordinator = setup(compile);
    await coordinator.prepare('web', []);
    await coordinator.prepare('lynx', []);

    versions.set('/src/app.ts', 2);
    const [webOutdated, lynxOutdated] = await Promise.all([
      coordinator.prepare('web', ['/src/app.ts']),
      coordinator.prepare('lynx', ['/src/app.ts']),
    ]);

    expect(compile).toHaveBeenCalledTimes(2);
    expect(webOutdated).toEqual(new Set(['/src/app.ts']));
    expect(lynxOutdated).toEqual(new Set(['/src/app.ts']));
  });

  it('skips the compile when an environment reports a version Angular already compiled', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(['/src/app.ts']));
    const coordinator = setup(compile);
    await coordinator.prepare('web', []);
    await coordinator.prepare('lynx', []);

    versions.set('/src/app.ts', 2);
    await coordinator.prepare('web', ['/src/app.ts']);
    // The lynx watcher reports the same save after the web compile finished.
    const lynxOutdated = await coordinator.prepare('lynx', ['/src/app.ts']);

    expect(compile).toHaveBeenCalledTimes(2);
    expect(lynxOutdated).toEqual(new Set(['/src/app.ts']));
  });

  it('compiles again on every new save of a file', async () => {
    const compile = vi.fn(async () => result());
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    versions.set('/src/app.ts', 2);
    await coordinator.prepare('lynx', ['/src/app.ts']);
    versions.set('/src/app.ts', 3);
    await coordinator.prepare('lynx', ['/src/app.ts']);

    expect(compile).toHaveBeenCalledTimes(3);
  });

  it('returns each changed output to an environment only once', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(['/src/a.ts']))
      .mockResolvedValueOnce(result(['/src/b.ts']));
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    versions.set('/src/a.ts', 1);
    await coordinator.prepare('lynx', ['/src/a.ts']);
    versions.set('/src/b.ts', 1);
    const outdated = await coordinator.prepare('lynx', ['/src/b.ts']);

    expect(outdated).toEqual(new Set(['/src/b.ts']));
  });

  it('reports nothing to an environment whose first build comes after a rebuild', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(['/src/app.ts']));
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);
    versions.set('/src/app.ts', 2);
    await coordinator.prepare('lynx', ['/src/app.ts']);

    // Its first build compiles every module, so there is nothing to add.
    const outdated = await coordinator.prepare('web', []);

    expect(outdated).toEqual(new Set());
  });

  it('ignores changes to files Angular does not read', async () => {
    const compile = vi.fn(async () => result([], ['/src/app.html']));
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    versions.set('/src/styles.css', 2);
    versions.set('/cache/app.__scoped_x.css', 2);
    await coordinator.prepare('lynx', [
      '/src/styles.css',
      '/cache/app.__scoped_x.css',
    ]);

    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('compiles when a template or stylesheet Angular read changes', async () => {
    const compile = vi.fn(async () => result([], ['/src/app.html']));
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    versions.set('/src/app.html', 2);
    await coordinator.prepare('lynx', ['/src/app.html']);

    expect(compile).toHaveBeenLastCalledWith(new Set(['/src/app.html']));
  });

  it.each(['/src/new.ts', '/src/new.mts', '/src/new.cts', '/src/new.tsx'])(
    'compiles for a TypeScript file the program has not seen yet (%s)',
    async (file) => {
      const compile = vi.fn(async () => result());
      const coordinator = setup(compile);
      await coordinator.prepare('lynx', []);

      versions.set(file, 1);
      await coordinator.prepare('lynx', [file]);

      expect(compile).toHaveBeenLastCalledWith(new Set([file]));
    },
  );

  it('compiles for a deleted file', async () => {
    const compile = vi.fn(async () => result());
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    // No version means the file no longer exists.
    await coordinator.prepare('lynx', ['/src/gone.ts']);
    await coordinator.prepare('web', ['/src/gone.ts']);

    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenLastCalledWith(new Set(['/src/gone.ts']));
  });

  it('retries the files of a failed rebuild on the next prepare', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce(new Error('worker crashed'))
      .mockResolvedValueOnce(result(['/src/app.ts']));
    const coordinator = setup(compile);
    await coordinator.prepare('lynx', []);

    versions.set('/src/app.ts', 2);
    await expect(coordinator.prepare('lynx', ['/src/app.ts'])).rejects.toThrow(
      'worker crashed',
    );
    // The other environment reports the same save; it must not be treated as
    // already compiled just because the failed compile saw it.
    const outdated = await coordinator.prepare('web', ['/src/app.ts']);

    expect(compile).toHaveBeenLastCalledWith(new Set(['/src/app.ts']));
    expect(outdated).toEqual(new Set());
    expect(await coordinator.prepare('lynx', [])).toEqual(
      new Set(['/src/app.ts']),
    );
  });

  it('retries the full compile after the initial compile fails', async () => {
    const compile = vi
      .fn()
      .mockRejectedValueOnce(new Error('init failed'))
      .mockResolvedValueOnce(result());
    const coordinator = setup(compile);

    await expect(coordinator.prepare('lynx', [])).rejects.toThrow(
      'init failed',
    );
    await coordinator.prepare('lynx', []);

    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenLastCalledWith(undefined);
  });

  describe('default file version', () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-rebuild-'));
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('uses the mtime to tell a new save from a duplicate notification', async () => {
      const file = path.join(root, 'app.ts');
      fs.writeFileSync(file, 'export const a = 1;');
      fs.utimesSync(file, 1, 1);
      const compile = vi.fn(async () => result());
      const coordinator = createAngularRebuildCoordinator({ compile });
      await coordinator.prepare('lynx', []);

      await coordinator.prepare('lynx', [file]);
      await coordinator.prepare('web', [file]);
      expect(compile).toHaveBeenCalledTimes(2);

      fs.utimesSync(file, 2, 2);
      await coordinator.prepare('lynx', [file]);
      expect(compile).toHaveBeenCalledTimes(3);
    });

    it('treats a missing file as one version, so its removal compiles once', async () => {
      const file = path.join(root, 'missing.ts');
      const compile = vi.fn(async () => result());
      const coordinator = createAngularRebuildCoordinator({ compile });
      await coordinator.prepare('lynx', []);

      await coordinator.prepare('lynx', [file]);
      await coordinator.prepare('web', [file]);

      expect(compile).toHaveBeenCalledTimes(2);
    });
  });
});
