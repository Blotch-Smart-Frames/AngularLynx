import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The single list of packages we publish to npm.
 *
 * The E2E harness (`packages/e2e`) packs and installs exactly these, and
 * `publish.yml` checks the versions of and publishes exactly these (through
 * `check-version.ts` and the tarballs the harness produces). Before this list existed the publish
 * workflow repeated it five times, and a package missing from one of those
 * copies would ship stale or not at all.
 */
export type PublishablePackage = {
  /** The npm package name. */
  readonly name: string;
  /** The workspace directory, relative to the repository root. */
  readonly dir: string;
  /**
   * The directory `npm publish` runs from, relative to the repository root.
   * Differs from `dir` for the runtime, which ng-packagr builds into `dist/`
   * together with its own copy of `package.json`.
   */
  readonly publishDir: string;
  /** Whether the package ships TypeScript types, so `attw` should check them. */
  readonly hasTypes: boolean;
  /**
   * Files that must be in the tarball. A tripwire for the failure behind
   * 22.2.0 and 22.2.1, where packaging rules stripped the library and the
   * compiled schematics from the runtime tarball without any error.
   */
  readonly requiredFiles: readonly string[];
};

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

// Order matters: it is the publish order. Each package is published before
// anything that installs it, so a failed publish part-way through never leaves
// a released package pointing at a version of a dependency that doesn't exist.
export const PUBLISHABLE_PACKAGES: readonly PublishablePackage[] = [
  {
    name: '@blotch/rsbuild-plugin-angular-lynx',
    dir: 'packages/rsbuild-plugin-angular-lynx',
    publishDir: 'packages/rsbuild-plugin-angular-lynx',
    hasTypes: true,
    requiredFiles: ['dist/index.js', 'dist/index.d.ts'],
  },
  {
    name: '@blotch/angular-lynx-native',
    dir: 'packages/native',
    publishDir: 'packages/native',
    hasTypes: true,
    requiredFiles: [
      'dist/index.js',
      'dist/index.d.ts',
      // The native shells the generator copies. Without them every
      // `ng build --platform` fails, and no unit test would notice. The
      // Xcode project isn't in git: `npm run build` renders it.
      'templates/ios/App.xcodeproj/project.pbxproj',
      'templates/ios/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme',
      'templates/ios/App/Info.plist',
      'templates/android/gradlew',
      'templates/android/app/build.gradle.kts',
      'templates/android/app/src/main/AndroidManifest.xml',
    ],
  },
  {
    name: '@blotch/angular-lynx-build',
    dir: 'packages/build',
    publishDir: 'packages/build',
    hasTypes: true,
    requiredFiles: [
      'dist/index.js',
      'dist/index.d.ts',
      // The `ng build` / `ng serve` builders. builders/package.json marks
      // them as CommonJS in this ESM package: Angular CLI require()s them.
      'builders/builders.json',
      'builders/package.json',
      'builders/application/index.js',
      'builders/application/schema.json',
      'builders/dev-server/index.js',
      'builders/dev-server/schema.json',
    ],
  },
  {
    name: '@blotch/angular-lynx',
    dir: 'packages/runtime',
    publishDir: 'packages/runtime/dist',
    hasTypes: true,
    requiredFiles: [
      'fesm2022/blotch-angular-lynx.mjs',
      'types/blotch-angular-lynx.d.ts',
      'schematics/collection.json',
      // Marks the tsc-compiled schematics as CommonJS. ng-packagr stamps
      // `"type": "module"` on the dist package, and without this marker Node
      // loads them as ESM and Angular CLI reports that the package "does not
      // provide any `ng add` actions". Every factory in collection.json is
      // also checked separately, in packages/e2e/src/check-packages.ts.
      'schematics/package.json',
    ],
  },
  {
    name: '@blotch/angular-lynx-testing-library',
    dir: 'packages/testing-library',
    publishDir: 'packages/testing-library',
    hasTypes: true,
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'dist/setup.js'],
  },
  {
    name: '@blotch/dolan',
    dir: 'packages/dolan',
    publishDir: 'packages/dolan',
    // dolan is a CLI first; its two `utils/*` exports are consumed by copied
    // component source, not by a type-checked import of the package root.
    hasTypes: false,
    requiredFiles: ['dist/index.js'],
  },
  {
    name: 'create-angular-lynx',
    dir: 'packages/create-angular-lynx',
    publishDir: 'packages/create-angular-lynx',
    hasTypes: false,
    requiredFiles: ['src/index.js'],
  },
];

type WorkspacePackageJson = {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
};

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, 'utf8')) as T;

/** Reads a publishable package's `package.json` from its source directory. */
export const readPackageJson = (pkg: PublishablePackage) =>
  readJson<WorkspacePackageJson>(path.join(REPO_ROOT, pkg.dir, 'package.json'));

const PUBLISHABLE_NAMES = new Set(PUBLISHABLE_PACKAGES.map((pkg) => pkg.name));

/**
 * The dependencies of one publishable package on another (such as
 * @blotch/angular-lynx-build on @blotch/rsbuild-plugin-angular-lynx). They
 * are pinned to an exact version: the packages are released together, and a
 * package is tested only with the others from its own release.
 */
export const readInternalPins = (pkg: PublishablePackage) =>
  Object.entries(readPackageJson(pkg).dependencies ?? {})
    .filter(([name]) => PUBLISHABLE_NAMES.has(name))
    .map(([name, version]) => ({ name, version }));

/**
 * Each publishable package's version, from its source `package.json`, and
 * each pin from one to another. The packages are released in lockstep, so
 * these should all be equal: the `consistent-package-versions` lint rule
 * checks that on every lint run, and `check-version.ts` checks them against
 * the tag before a release.
 */
export const readVersions = () =>
  PUBLISHABLE_PACKAGES.flatMap((pkg) => [
    { name: pkg.name, version: readPackageJson(pkg).version },
    ...readInternalPins(pkg).map((pin) => ({
      name: `${pkg.name}'s dependency ${pin.name}`,
      version: pin.version,
    })),
  ]);

/**
 * Finds workspace packages that npm would publish (no `"private": true`) but
 * that are missing from {@link PUBLISHABLE_PACKAGES}. A new package added to the
 * monorepo must either be listed here, so it is tested and published, or be
 * marked private.
 */
export const findUnlistedPublicPackages = (): string[] => {
  const listed = new Set(PUBLISHABLE_PACKAGES.map((pkg) => pkg.dir));
  const packagesDir = path.join(REPO_ROOT, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .filter((dir) => existsSync(path.join(REPO_ROOT, dir, 'package.json')))
    .filter((dir) => {
      const pkg = readJson<WorkspacePackageJson>(
        path.join(REPO_ROOT, dir, 'package.json'),
      );
      return !pkg.private && !listed.has(dir);
    });
};
