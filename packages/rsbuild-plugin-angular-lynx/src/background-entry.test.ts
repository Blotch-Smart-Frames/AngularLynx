import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBackgroundEntries,
  findLibraryBackgroundModules,
  renderBackgroundEntry,
} from './background-entry.js';

const BACKGROUND_FN = `import { backgroundFn } from '@blotch/angular-lynx';\nexport const echo = backgroundFn((text) => text);\n`;
const PLAIN = 'export const x = 1;\n';

let root: string;

beforeEach(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'background-entry-')),
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Writes `files` (relative path → contents) under `dir`.
 */
const write = (dir: string, files: Record<string, unknown>): void => {
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );
  }
};

describe('renderBackgroundEntry', () => {
  it('imports the runtime and the modules, then starts the background thread', () => {
    const source = renderBackgroundEntry({ modules: ['/a.ts', '/b.mjs'] });

    expect(source).toContain(
      'import { ɵstartBackgroundThread } from \'@blotch/angular-lynx\';\nimport "/a.ts";\nimport "/b.mjs";\nɵstartBackgroundThread();\n',
    );
    expect(source).not.toContain('Rebuild');
  });

  it('ends with the rebuild count in a watch build', () => {
    expect(renderBackgroundEntry({ modules: [], rebuild: 0 })).toMatch(
      /\/\/ Rebuild 0\n$/,
    );
  });
});

describe('createBackgroundEntries', () => {
  const entryFile = (environment: string, entry: string) =>
    path.join(
      root,
      'node_modules/.cache/angular-lynx/background-entries',
      environment,
      `${entry}.js`,
    );

  it('gives each environment and entry its own file, with the runtime alone until the first compile', () => {
    const entries = createBackgroundEntries({
      rootPath: root,
      findLibraryModules: () => [],
    });

    const file = entries.fileFor('lynx', 'main');

    expect(file).toBe(entryFile('lynx', 'main'));
    expect(fs.readFileSync(file, 'utf8')).toBe(
      renderBackgroundEntry({ modules: [] }),
    );
    expect(entries.fileFor('web', 'main')).toBe(entryFile('web', 'main'));
    expect(entries.isEntryFile(file)).toBe(true);
    expect(entries.isEntryFile(path.join(root, 'src/main.ts'))).toBe(false);
  });

  // The file may hold the previous build's modules; the first compile
  // rewrites it.
  it("leaves an existing file to the compile's update", () => {
    write(root, {
      'node_modules/.cache/angular-lynx/background-entries/lynx/main.js':
        'previous',
    });
    const entries = createBackgroundEntries({
      rootPath: root,
      findLibraryModules: () => [],
    });

    expect(fs.readFileSync(entries.fileFor('lynx', 'main'), 'utf8')).toBe(
      'previous',
    );
  });

  it("writes the libraries' and the app's modules, the app's sorted, and reports the files it changed", () => {
    const findLibraryModules = vi.fn(() => ['/lib/fesm2022/lib.mjs']);
    const entries = createBackgroundEntries({
      rootPath: root,
      findLibraryModules,
    });
    const main = entries.fileFor('lynx', 'main');
    const other = entries.fileFor('lynx', 'other');
    entries.fileFor('web', 'main');

    const changed = entries.update('lynx', {
      appModules: new Set(['/app/b.ts', '/app/a.ts']),
      watch: false,
      rebuilt: false,
    });

    expect(changed).toEqual([main, other]);
    expect(fs.readFileSync(main, 'utf8')).toBe(
      renderBackgroundEntry({
        modules: ['/lib/fesm2022/lib.mjs', '/app/a.ts', '/app/b.ts'],
      }),
    );
    expect(entries.isBackgroundModule('/app/a.ts')).toBe(true);
    expect(entries.isBackgroundModule('/lib/fesm2022/lib.mjs')).toBe(true);
    expect(entries.isBackgroundModule('/app/main.ts')).toBe(false);

    // The same modules again change nothing, and packages are read once.
    expect(
      entries.update('lynx', {
        appModules: ['/app/a.ts', '/app/b.ts'],
        watch: false,
        rebuilt: false,
      }),
    ).toEqual([]);
    expect(findLibraryModules).toHaveBeenCalledTimes(1);
    expect(findLibraryModules).toHaveBeenCalledWith(root);
  });

  it('has nothing to write for an environment without entries', () => {
    const entries = createBackgroundEntries({
      rootPath: root,
      findLibraryModules: () => [],
    });

    expect(
      entries.update('lynx', { appModules: [], watch: false, rebuilt: true }),
    ).toEqual([]);
  });

  // The main thread runs no HMR, so a watch build changes the background
  // entry on each rebuild for the HMR client to fall back to a reload.
  it("counts each environment's rebuilds in a watch build", () => {
    const entries = createBackgroundEntries({
      rootPath: root,
      findLibraryModules: () => [],
    });
    const lynx = entries.fileFor('lynx', 'main');
    const web = entries.fileFor('web', 'main');
    const update = (environment: string, rebuilt: boolean) =>
      entries.update(environment, { appModules: [], watch: true, rebuilt });

    expect(update('lynx', false)).toEqual([lynx]);
    expect(fs.readFileSync(lynx, 'utf8')).toMatch(/Rebuild 0\n$/);
    expect(update('lynx', true)).toEqual([lynx]);
    expect(update('web', true)).toEqual([web]);
    expect(fs.readFileSync(lynx, 'utf8')).toMatch(/Rebuild 1\n$/);
    expect(fs.readFileSync(web, 'utf8')).toMatch(/Rebuild 1\n$/);
    // A compile that rebuilt nothing, such as the one the rewrite itself
    // triggers, leaves the file alone.
    expect(update('lynx', false)).toEqual([]);
  });

  it('reads the packages installed in the project by default', () => {
    write(root, {
      'package.json': { dependencies: { lib: '1' } },
      'node_modules/lib/package.json': {
        peerDependencies: { '@blotch/angular-lynx': '*' },
      },
      'node_modules/lib/index.mjs': BACKGROUND_FN,
    });
    const entries = createBackgroundEntries({ rootPath: root });
    entries.fileFor('lynx', 'main');
    entries.update('lynx', { appModules: [], watch: false, rebuilt: false });

    expect(
      entries.isBackgroundModule(path.join(root, 'node_modules/lib/index.mjs')),
    ).toBe(true);
  });
});

describe('findLibraryBackgroundModules', () => {
  it('finds the files that define cross-thread values in packages that depend on the runtime', () => {
    write(root, {
      'package.json': {
        dependencies: { ui: '1', plain: '1', missing: '1' },
        devDependencies: { tools: '1' },
        peerDependencies: { '@blotch/angular-lynx': '*' },
      },
      // Depends on the runtime: its files are read, but not nested packages'.
      'node_modules/ui/package.json': {
        dependencies: { '@blotch/angular-lynx': '*', nested: '1' },
      },
      'node_modules/ui/fesm2022/ui.mjs': BACKGROUND_FN,
      'node_modules/ui/fesm2022/other.mjs': PLAIN,
      'node_modules/ui/README.md': BACKGROUND_FN,
      // A nested copy is found from its dependent, as Node finds it.
      'node_modules/ui/node_modules/nested/package.json': {
        optionalDependencies: { '@blotch/angular-lynx': '*' },
        dependencies: { ui: '1' },
      },
      'node_modules/ui/node_modules/nested/index.cjs': BACKGROUND_FN,
      // Doesn't depend on the runtime, so it can't call it.
      'node_modules/plain/package.json': {},
      'node_modules/plain/index.js': BACKGROUND_FN,
      // The app's dev dependencies are installed; theirs aren't walked.
      'node_modules/tools/package.json': {
        peerDependencies: { '@blotch/angular-lynx': '*' },
        devDependencies: { helper: '1' },
      },
      'node_modules/tools/index.js': BACKGROUND_FN,
      'node_modules/helper/package.json': {
        peerDependencies: { '@blotch/angular-lynx': '*' },
      },
      'node_modules/helper/index.js': BACKGROUND_FN,
      // The runtime itself is always in the background entry.
      'node_modules/@blotch/angular-lynx/package.json': {},
      'node_modules/@blotch/angular-lynx/index.mjs': BACKGROUND_FN,
    });

    expect(findLibraryBackgroundModules(root)).toEqual([
      path.join(root, 'node_modules/tools/index.js'),
      path.join(root, 'node_modules/ui/fesm2022/ui.mjs'),
      path.join(root, 'node_modules/ui/node_modules/nested/index.cjs'),
    ]);
  });

  it('finds nothing without a readable package.json', () => {
    expect(findLibraryBackgroundModules(root)).toEqual([]);
    write(root, {
      'package.json': '{',
    });
    expect(findLibraryBackgroundModules(root)).toEqual([]);
  });

  it('skips a dependency whose package.json is unreadable', () => {
    write(root, {
      'package.json': { dependencies: { broken: '1' } },
      'node_modules/broken/package.json': '{',
      'node_modules/broken/index.js': BACKGROUND_FN,
    });
    expect(findLibraryBackgroundModules(root)).toEqual([]);
  });
});
