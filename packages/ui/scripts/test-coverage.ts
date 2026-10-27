import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The coverage gate, run the way an app runs the components' specs.
 *
 * dolan copies each component with its specs, and apps run them with `ng
 * test` (Angular's unit-test builder, through AngularLynx's), which compiles
 * ahead of time: a template's listeners, `@if` branches and bindings become
 * functions and branches in the component's file. So `ng test` here, with the
 * thresholds in angular.json (100%), measures what an app's coverage report
 * shows for its copies.
 *
 * One run measures every spec together, but an app may copy a component
 * without the ones that render it: its own specs have to cover it alone. A
 * component's files are only reached from outside its folder through an
 * import (dolan's registry test checks each is a listed dependency), so the
 * components imported from elsewhere get a run of their own as well, with
 * only their own specs. `--all` runs every component alone, to audit them.
 *
 *   node scripts/test-coverage.ts [--all]
 */

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const COMPONENTS = 'src/lib/components';

/**
 * The files under `dir` (relative to the package), recursively.
 */
const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(PACKAGE_ROOT, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) =>
      path.relative(PACKAGE_ROOT, path.join(entry.parentPath, entry.name)),
    );

/**
 * The component folder a package-relative path is in, if any.
 */
const componentOf = (file: string): string | undefined => {
  const relative = path.relative(COMPONENTS, file);
  return relative.startsWith('..') ? undefined : relative.split(path.sep)[0];
};

/**
 * The components a file outside their folder imports.
 */
const importedFromOutside = (): Set<string> => {
  const imported = new Set<string>();
  for (const file of sourceFiles('src')) {
    const source = readFileSync(path.join(PACKAGE_ROOT, file), 'utf-8');
    for (const [, specifier] of source.matchAll(/from '(\.[^']*)'/g)) {
      const target = componentOf(
        path.join(path.dirname(file), specifier ?? ''),
      );
      if (target && target !== componentOf(file)) imported.add(target);
    }
  }
  return imported;
};

const ngTest = (args: string[]): boolean =>
  spawnSync('npx', ['ng', 'test', '--no-watch', '--coverage', ...args], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    // npx is a .cmd shim on Windows, which only a shell runs.
    shell: process.platform === 'win32',
  }).status === 0;

const alone = process.argv.includes('--all')
  ? readdirSync(path.join(PACKAGE_ROOT, COMPONENTS))
  : [...importedFromOutside()];

const failed = alone.sort().filter((name) => {
  console.log(`\nCoverage of ${name} from its own specs:`);
  return !ngTest([
    '--include',
    `${COMPONENTS}/${name}`,
    '--coverage-include',
    `${COMPONENTS}/${name}/**/*.ts`,
    '--coverage-reporters',
    'text-summary',
  ]);
});

// Last, so coverage/ holds the report for every file (Codecov reads it).
console.log('\nCoverage of every file from every spec:');
const allPassed = ngTest([]);

if (failed.length > 0) {
  console.error(
    `\nThese components' own specs don't cover them fully: ${failed.join(', ')}`,
  );
}
process.exit(allPassed && failed.length === 0 ? 0 : 1);
