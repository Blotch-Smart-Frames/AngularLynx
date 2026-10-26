import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * npm packages a component imports. Components are copied, not installed, but
 * some build on a library (the charts on `@tanstack/charts`), and their copied
 * code can't compile until the project depends on it too. `dolan add` and
 * `dolan update` install what's missing with the project's own package manager.
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const LOCK_FILES: readonly [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

/**
 * The package manager whose lockfile is nearest `cwd`, looking up the tree
 * because in a workspace the lockfile sits at the root. npm when there's none.
 */
export const detectPackageManager = (cwd: string): PackageManager => {
  let dir = cwd;
  for (;;) {
    for (const [file, manager] of LOCK_FILES) {
      if (existsSync(join(dir, file))) return manager;
    }
    const parent = dirname(dir);
    if (parent === dir) return 'npm';
    dir = parent;
  }
};

/** `@scope/name@^1.0.0` → `@scope/name`; `name` stays `name`. */
export const packageName = (spec: string): string => {
  const at = spec.indexOf('@', 1);
  return at === -1 ? spec : spec.slice(0, at);
};

/** The specs whose package the project's package.json doesn't list yet. */
export const missingPackages = (
  cwd: string,
  specs: readonly string[],
): string[] => {
  const manifestPath = join(cwd, 'package.json');
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
        string,
        Record<string, string> | undefined
      >)
    : {};
  const listed = new Set(
    ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) =>
      Object.keys(manifest[key] ?? {}),
    ),
  );
  return specs.filter((spec) => !listed.has(packageName(spec)));
};

/** The command that adds `specs` as dependencies, e.g. `npm install a b`. */
export const installCommand = (
  manager: PackageManager,
  specs: readonly string[],
): string[] => [manager, manager === 'npm' ? 'install' : 'add', ...specs];

/**
 * Installs `specs` in `cwd`. Returns false when the package manager couldn't
 * run or failed, so the caller can show the command to run by hand.
 */
export const installPackages = (
  cwd: string,
  specs: readonly string[],
  run: typeof spawnSync = spawnSync,
): boolean => {
  const [command, ...args] = installCommand(detectPackageManager(cwd), specs);
  const result = run(command!, args, {
    cwd,
    stdio: 'inherit',
    // Package managers are .cmd shims on Windows, which only a shell runs.
    shell: process.platform === 'win32',
  });
  return result.status === 0;
};

/**
 * The library the components' tests render with. Apps get it from
 * `ng generate @blotch/angular-lynx:add-testing`.
 */
export const TESTING_LIBRARY = '@blotch/angular-lynx-testing-library';

/**
 * Whether dolan copies components' tests into the project: only when it
 * depends on the testing library, since the tests import it and `ng test`
 * fails to compile them otherwise. Every command asks the same question, so
 * a project without the library never sees the tests as missing or new.
 */
export const copiesTests = (cwd: string): boolean =>
  missingPackages(cwd, [TESTING_LIBRARY]).length === 0;
